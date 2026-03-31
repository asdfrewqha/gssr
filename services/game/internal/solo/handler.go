package solo

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	gauth "github.com/gssr/game/internal/auth"
	"github.com/gssr/game/internal/db"
	"github.com/gssr/game/internal/game"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
)

const sessionTTL = 2 * time.Hour

// difficultyConfig maps a difficulty level to its K coefficient and time limit.
type difficultyConfig struct {
	K            float64
	TimeLimitSec int
}

var difficulties = map[string]difficultyConfig{
	"easy":   {K: 350, TimeLimitSec: 120},
	"normal": {K: 200, TimeLimitSec: 60},
	"hard":   {K: 100, TimeLimitSec: 30},
}

// activeSession is the in-Valkey state for an ongoing solo game.
type activeSession struct {
	SessionID    string   `json:"session_id"`
	UserID       string   `json:"user_id"`
	MapID        string   `json:"map_id"`
	Difficulty   string   `json:"difficulty"`
	Rounds       int      `json:"rounds"`
	CurrentRound int      `json:"current_round"`
	TotalScore   int      `json:"total_score"`
	PanoIDs      []string `json:"pano_ids"`
	TimeLimitSec int      `json:"time_limit_sec"`
}

func sessionKey(id string) string { return fmt.Sprintf("solo:%s", id) }

// Handler holds dependencies for solo endpoints.
type Handler struct {
	pg    *db.Postgres
	cache *db.Valkey
}

func NewHandler(pg *db.Postgres, cache *db.Valkey) *Handler {
	return &Handler{pg: pg, cache: cache}
}

// ──────────────────────────────────────────────
// POST /api/solo/start
// ──────────────────────────────────────────────

type startReq struct {
	MapID      string `json:"map_id"`
	Rounds     int    `json:"rounds"`
	Difficulty string `json:"difficulty"`
}

func (h *Handler) Start(c *fiber.Ctx) error {
	var req startReq
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
	}
	if req.MapID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "map_id required"})
	}
	if req.Rounds <= 0 {
		req.Rounds = 5
	}
	if req.Rounds > 20 {
		req.Rounds = 20
	}
	if req.Difficulty == "" {
		req.Difficulty = "normal"
	}
	diff, ok := difficulties[req.Difficulty]
	if !ok {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "difficulty must be easy, normal or hard"})
	}

	userID := gauth.UserID(c)

	// Pick random panoramas from the map.
	rows, err := h.pg.Pool.Query(c.Context(),
		`SELECT p.id FROM panoramas p
		 JOIN floors f ON f.id = p.floor_id
		 WHERE f.map_id = $1
		   AND p.tile_status = 'tiled'
		   AND p.moderation_status = 'clean'
		 ORDER BY RANDOM()
		 LIMIT $2`,
		req.MapID, req.Rounds)
	if err != nil {
		return fiber.ErrInternalServerError
	}
	defer rows.Close()

	var panoIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return fiber.ErrInternalServerError
		}
		panoIDs = append(panoIDs, id)
	}
	if len(panoIDs) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "no panoramas available for this map"})
	}
	actualRounds := len(panoIDs)

	// Create DB record.
	var sessionID string
	err = h.pg.Pool.QueryRow(c.Context(),
		`INSERT INTO solo_sessions
		   (user_id, map_id, difficulty, rounds, pano_ids, current_round, total_score)
		 VALUES ($1, $2, $3, $4, $5::uuid[], 1, 0)
		 RETURNING id`,
		userID, req.MapID, req.Difficulty, actualRounds, panoIDs,
	).Scan(&sessionID)
	if err != nil {
		return fiber.ErrInternalServerError
	}

	// Store active state in Valkey.
	sess := &activeSession{
		SessionID:    sessionID,
		UserID:       userID.String(),
		MapID:        req.MapID,
		Difficulty:   req.Difficulty,
		Rounds:       actualRounds,
		CurrentRound: 1,
		TotalScore:   0,
		PanoIDs:      panoIDs,
		TimeLimitSec: diff.TimeLimitSec,
	}
	if err := h.setSession(c.Context(), sess); err != nil {
		return fiber.ErrInternalServerError
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"session_id":     sessionID,
		"map_id":         req.MapID,
		"pano_id":        panoIDs[0],
		"round":          1,
		"total_rounds":   actualRounds,
		"time_limit_sec": diff.TimeLimitSec,
		"difficulty":     req.Difficulty,
	})
}

// ──────────────────────────────────────────────
// GET /api/solo/:id
// ──────────────────────────────────────────────

func (h *Handler) GetSession(c *fiber.Ctx) error {
	userID := gauth.UserID(c)
	sessionID := c.Params("id")

	sess, err := h.getSession(c.Context(), sessionID)
	if err != nil || sess == nil {
		return fiber.ErrNotFound
	}
	if sess.UserID != userID.String() {
		return fiber.ErrForbidden
	}

	return c.JSON(fiber.Map{
		"session_id":     sess.SessionID,
		"map_id":         sess.MapID,
		"pano_id":        sess.PanoIDs[sess.CurrentRound-1],
		"round":          sess.CurrentRound,
		"total_rounds":   sess.Rounds,
		"total_score":    sess.TotalScore,
		"time_limit_sec": sess.TimeLimitSec,
		"difficulty":     sess.Difficulty,
	})
}

// ──────────────────────────────────────────────
// POST /api/solo/:id/guess
// ──────────────────────────────────────────────

type guessReq struct {
	X       float64 `json:"x"`
	Y       float64 `json:"y"`
	FloorID string  `json:"floor_id"`
}

func (h *Handler) Guess(c *fiber.Ctx) error {
	userID := gauth.UserID(c)
	sessionID := c.Params("id")

	var req guessReq
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
	}

	sess, err := h.getSession(c.Context(), sessionID)
	if err != nil || sess == nil {
		return fiber.ErrNotFound
	}
	if sess.UserID != userID.String() {
		return fiber.ErrForbidden
	}

	diff := difficulties[sess.Difficulty]
	currentPanoID := sess.PanoIDs[sess.CurrentRound-1]

	// Fetch correct location.
	var ax, ay float64
	var aFloorID string
	err = h.pg.Pool.QueryRow(c.Context(),
		`SELECT x, y, floor_id FROM panoramas WHERE id = $1`, currentPanoID,
	).Scan(&ax, &ay, &aFloorID)
	if err != nil {
		return fiber.ErrInternalServerError
	}

	// Coordinates are stored as normalized [0,1]; scale to pseudo-pixel space
	// so that K values (350/200/100) produce meaningful score curves.
	const coordScale = 1000.0
	score := game.CalculateScore(req.X*coordScale, req.Y*coordScale, ax*coordScale, ay*coordScale, req.FloorID, aFloorID, diff.K)
	distance := game.Distance(req.X*coordScale, req.Y*coordScale, ax*coordScale, ay*coordScale)

	// Fetch community stats for this panorama (last 30 days).
	var avgScore float64
	var avgDist float64
	var totalGuesses int
	_ = h.pg.Pool.QueryRow(c.Context(),
		`SELECT COALESCE(AVG(score),0), COALESCE(AVG(distance),0), COUNT(*)
		 FROM solo_guesses
		 WHERE panorama_id = $1
		   AND created_at > NOW() - INTERVAL '30 days'`,
		currentPanoID,
	).Scan(&avgScore, &avgDist, &totalGuesses)

	// Persist guess.
	_, _ = h.pg.Pool.Exec(c.Context(),
		`INSERT INTO solo_guesses
		   (session_id, panorama_id, round, guess_x, guess_y, guess_floor_id, score, distance)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		 ON CONFLICT (session_id, round) DO NOTHING`,
		sessionID, currentPanoID, sess.CurrentRound,
		req.X, req.Y, req.FloorID, score, distance,
	)

	sess.TotalScore += score
	finished := sess.CurrentRound >= sess.Rounds

	if finished {
		// Mark session as finished in DB; award XP.
		xpGained := sess.TotalScore / 1000
		_, _ = h.pg.Pool.Exec(c.Context(),
			`UPDATE solo_sessions
			 SET status = 'finished', total_score = $1, ended_at = NOW()
			 WHERE id = $2`,
			sess.TotalScore, sessionID,
		)
		if xpGained > 0 {
			_, _ = h.pg.Pool.Exec(c.Context(),
				`UPDATE users SET xp = xp + $1 WHERE id = $2`,
				xpGained, userID,
			)
		}
		h.cache.Client.Del(c.Context(), sessionKey(sessionID))

		return c.JSON(fiber.Map{
			"score":    score,
			"distance": distance,
			"correct_location": fiber.Map{
				"x":        ax,
				"y":        ay,
				"floor_id": aFloorID,
			},
			"total_score": sess.TotalScore,
			"xp_gained":   xpGained,
			"finished":    true,
			"community": fiber.Map{
				"avg_score":     int(avgScore),
				"avg_distance":  avgDist,
				"total_guesses": totalGuesses,
			},
		})
	}

	// Advance to next round.
	sess.CurrentRound++
	_, _ = h.pg.Pool.Exec(c.Context(),
		`UPDATE solo_sessions SET current_round = $1, total_score = $2 WHERE id = $3`,
		sess.CurrentRound, sess.TotalScore, sessionID,
	)
	if err := h.setSession(c.Context(), sess); err != nil {
		return fiber.ErrInternalServerError
	}

	return c.JSON(fiber.Map{
		"score":    score,
		"distance": distance,
		"correct_location": fiber.Map{
			"x":        ax,
			"y":        ay,
			"floor_id": aFloorID,
		},
		"total_score":  sess.TotalScore,
		"next_pano_id": sess.PanoIDs[sess.CurrentRound-1],
		"round":        sess.CurrentRound,
		"finished":     false,
		"community": fiber.Map{
			"avg_score":     int(avgScore),
			"avg_distance":  avgDist,
			"total_guesses": totalGuesses,
		},
	})
}

// ──────────────────────────────────────────────
// POST /api/solo/:id/abandon
// ──────────────────────────────────────────────

func (h *Handler) Abandon(c *fiber.Ctx) error {
	userID := gauth.UserID(c)
	sessionID := c.Params("id")

	sess, err := h.getSession(c.Context(), sessionID)
	if err != nil || sess == nil {
		return fiber.ErrNotFound
	}
	if sess.UserID != userID.String() {
		return fiber.ErrForbidden
	}

	_, _ = h.pg.Pool.Exec(c.Context(),
		`UPDATE solo_sessions SET status = 'abandoned', ended_at = NOW() WHERE id = $1`, sessionID)
	h.cache.Client.Del(c.Context(), sessionKey(sessionID))

	return c.JSON(fiber.Map{"ok": true})
}

// ──────────────────────────────────────────────
// GET /api/solo/history
// ──────────────────────────────────────────────

func (h *Handler) History(c *fiber.Ctx) error {
	userID := gauth.UserID(c)

	rows, err := h.pg.Pool.Query(c.Context(),
		`SELECT s.id, s.map_id, m.name, s.difficulty, s.rounds, s.total_score,
		        s.status, s.started_at, s.ended_at
		 FROM solo_sessions s
		 JOIN maps m ON m.id = s.map_id
		 WHERE s.user_id = $1
		 ORDER BY s.started_at DESC
		 LIMIT 50`,
		userID,
	)
	if err != nil {
		return fiber.ErrInternalServerError
	}
	defer rows.Close()

	type historyEntry struct {
		ID         string  `json:"id"`
		MapID      string  `json:"map_id"`
		MapName    string  `json:"map_name"`
		Difficulty string  `json:"difficulty"`
		Rounds     int     `json:"rounds"`
		TotalScore int     `json:"total_score"`
		Status     string  `json:"status"`
		StartedAt  string  `json:"started_at"`
		EndedAt    *string `json:"ended_at,omitempty"`
	}

	var entries []historyEntry
	for rows.Next() {
		var e historyEntry
		var startedAt time.Time
		var endedAt *time.Time
		if err := rows.Scan(&e.ID, &e.MapID, &e.MapName, &e.Difficulty, &e.Rounds,
			&e.TotalScore, &e.Status, &startedAt, &endedAt); err != nil {
			continue
		}
		e.StartedAt = startedAt.UTC().Format(time.RFC3339)
		if endedAt != nil {
			s := endedAt.UTC().Format(time.RFC3339)
			e.EndedAt = &s
		}
		entries = append(entries, e)
	}
	if entries == nil {
		entries = []historyEntry{}
	}
	return c.JSON(entries)
}

// ──────────────────────────────────────────────
// GET /api/solo/:id/result  — full result of a finished session
// ──────────────────────────────────────────────

func (h *Handler) Result(c *fiber.Ctx) error {
	userID := gauth.UserID(c)
	sessionID := c.Params("id")

	var mapName, difficulty, status string
	var rounds, totalScore int
	var startedAt time.Time
	var endedAt *time.Time
	var ownerID uuid.UUID
	err := h.pg.Pool.QueryRow(c.Context(),
		`SELECT s.user_id, m.name, s.difficulty, s.rounds, s.total_score,
		        s.status, s.started_at, s.ended_at
		 FROM solo_sessions s
		 JOIN maps m ON m.id = s.map_id
		 WHERE s.id = $1`,
		sessionID,
	).Scan(&ownerID, &mapName, &difficulty, &rounds, &totalScore, &status, &startedAt, &endedAt)
	if err == pgx.ErrNoRows {
		return fiber.ErrNotFound
	}
	if err != nil {
		return fiber.ErrInternalServerError
	}
	if ownerID != userID {
		return fiber.ErrForbidden
	}

	// Fetch per-round breakdown.
	guessRows, err := h.pg.Pool.Query(c.Context(),
		`SELECT g.round, g.score, g.distance, g.guess_x, g.guess_y,
		        p.x, p.y, p.floor_id, g.guess_floor_id
		 FROM solo_guesses g
		 JOIN panoramas p ON p.id = g.panorama_id
		 WHERE g.session_id = $1
		 ORDER BY g.round`,
		sessionID,
	)
	if err != nil {
		return fiber.ErrInternalServerError
	}
	defer guessRows.Close()

	type roundResult struct {
		Round      int     `json:"round"`
		Score      int     `json:"score"`
		Distance   float64 `json:"distance"`
		GuessX     float64 `json:"guess_x"`
		GuessY     float64 `json:"guess_y"`
		CorrectX   float64 `json:"correct_x"`
		CorrectY   float64 `json:"correct_y"`
		FloorID    string  `json:"floor_id"`
		GuessFloor string  `json:"guess_floor_id"`
	}

	var roundResults []roundResult
	for guessRows.Next() {
		var r roundResult
		if err := guessRows.Scan(&r.Round, &r.Score, &r.Distance,
			&r.GuessX, &r.GuessY, &r.CorrectX, &r.CorrectY,
			&r.FloorID, &r.GuessFloor); err != nil {
			continue
		}
		roundResults = append(roundResults, r)
	}
	if roundResults == nil {
		roundResults = []roundResult{}
	}

	var endedAtStr *string
	if endedAt != nil {
		s := endedAt.UTC().Format(time.RFC3339)
		endedAtStr = &s
	}

	return c.JSON(fiber.Map{
		"session_id":  sessionID,
		"map_name":    mapName,
		"difficulty":  difficulty,
		"rounds":      rounds,
		"total_score": totalScore,
		"xp_gained":   totalScore / 1000,
		"status":      status,
		"started_at":  startedAt.UTC().Format(time.RFC3339),
		"ended_at":    endedAtStr,
		"breakdown":   roundResults,
	})
}

// ──────────────────────────────────────────────
// Valkey helpers
// ──────────────────────────────────────────────

func (h *Handler) getSession(ctx context.Context, id string) (*activeSession, error) {
	data, err := h.cache.Client.Get(ctx, sessionKey(id)).Bytes()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var s activeSession
	if err := json.Unmarshal(data, &s); err != nil {
		return nil, err
	}
	return &s, nil
}

func (h *Handler) setSession(ctx context.Context, s *activeSession) error {
	data, err := json.Marshal(s)
	if err != nil {
		return err
	}
	return h.cache.Client.Set(ctx, sessionKey(s.SessionID), data, sessionTTL).Err()
}
