package room

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	lkauth "github.com/livekit/protocol/auth"
	sio "github.com/zishang520/socket.io/v2/socket"

	gauth "github.com/gssr/game/internal/auth"
	"github.com/gssr/game/internal/config"
	"github.com/gssr/game/internal/db"
	"github.com/gssr/game/internal/game"
)

type Handler struct {
	cfg   *config.Config
	pg    *db.Postgres
	store *Store
	io    *sio.Server
}

func NewHandler(cfg *config.Config, pg *db.Postgres, store *Store, io *sio.Server) *Handler {
	return &Handler{cfg: cfg, pg: pg, store: store, io: io}
}

// cookieFromHeaders extracts a named cookie value from a socket.io Handshake.Headers map.
// Headers is map[string][]string populated from net/http (canonical keys, e.g. "Cookie").
func cookieFromHeaders(headers map[string][]string, name string) string {
	// net/http uses canonical "Cookie"; try both to be safe.
	for _, key := range []string{"Cookie", "cookie"} {
		for _, line := range headers[key] {
			for _, part := range strings.Split(line, ";") {
				part = strings.TrimSpace(part)
				k, v, ok := strings.Cut(part, "=")
				if ok && k == name {
					return v
				}
			}
		}
	}
	return ""
}

// SetupSocketIO registers socket.io middleware (auth) and connection handler.
// Call this once after creating the Handler.
func (h *Handler) SetupSocketIO(secret []byte) {
	// Auth middleware: validate JWT from cookie before accepting connection.
	h.io.Use(func(socket *sio.Socket, next func(*sio.ExtendedError)) {
		headers := socket.Handshake().Headers
		token := cookieFromHeaders(headers, "access_token")
		if token == "" {
			token = cookieFromHeaders(headers, "admin_token")
		}
		if _, err := gauth.Verify(secret, token); err != nil {
			next(sio.NewExtendedError("unauthorized", nil))
			return
		}
		next(nil)
	})

	_ = h.io.On("connection", func(clients ...any) {
		socket := clients[0].(*sio.Socket)

		// Extract roomId from auth object sent by client: io(url, { auth: { roomId } })
		var roomID string
		if authMap, ok := socket.Handshake().Auth.(map[string]interface{}); ok {
			roomID, _ = authMap["roomId"].(string)
		}
		if roomID == "" {
			socket.Disconnect(true)
			return
		}

		socket.Join(sio.Room(roomID))

		// BUG FIX: do NOT remove player from Valkey room state on WS disconnect.
		// Room membership is managed exclusively via REST:
		//   POST /api/rooms/:id/join   – add player
		//   DELETE /api/rooms/:id/leave – remove player
		_ = socket.On("disconnect", func(...any) {})
	})
}

// ──────────────────────────────────────────────
// POST /api/rooms
// ──────────────────────────────────────────────

type createRoomReq struct {
	MapID        string `json:"map_id"`
	MaxPlayers   int    `json:"max_players"`
	Rounds       int    `json:"rounds"`
	TimeLimitSec int    `json:"time_limit_sec"`
}

// Create godoc
// @Summary      Create a new room
// @Tags         rooms
// @Accept       json
// @Produce      json
// @Security     CookieAuth
// @Param        body  body      createRoomReq  true  "Room settings"
// @Success      201   {object} object
// @Router       /rooms [post]
func (h *Handler) Create(c *fiber.Ctx) error {
	var req createRoomReq
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
	}
	if req.MapID == "" || req.MaxPlayers < 1 || req.Rounds < 1 || req.TimeLimitSec < 10 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid room settings"})
	}

	userID := gauth.UserID(c)

	var username string
	var elo int
	err := h.pg.Pool.QueryRow(c.Context(),
		`SELECT username, elo FROM users WHERE id = $1`, userID,
	).Scan(&username, &elo)
	if err != nil {
		return fiber.ErrInternalServerError
	}

	roomID := uuid.NewString()
	state := &RoomState{
		ID:           roomID,
		HostID:       userID.String(),
		MapID:        req.MapID,
		MaxPlayers:   req.MaxPlayers,
		Rounds:       req.Rounds,
		TimeLimitSec: req.TimeLimitSec,
		Status:       "waiting",
		Players: []Player{{
			UserID:   userID.String(),
			Username: username,
			ELO:      elo,
		}},
		PanoIDs: []string{},
		Guesses: map[string]Guess{},
	}
	if err := h.store.Set(c.Context(), state); err != nil {
		return fiber.ErrInternalServerError
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"id": roomID, "map_id": req.MapID, "rounds": req.Rounds})
}

// ──────────────────────────────────────────────
// GET /api/rooms/:id
// ──────────────────────────────────────────────

// Get godoc
// @Summary      Get room state
// @Tags         rooms
// @Produce      json
// @Security     CookieAuth
// @Param        id  path  string  true  "Room ID"
// @Success      200 {object} RoomState
// @Failure      404 {object} object
// @Router       /rooms/{id} [get]
func (h *Handler) Get(c *fiber.Ctx) error {
	state, err := h.store.Get(c.Context(), c.Params("id"))
	if err != nil || state == nil {
		return fiber.ErrNotFound
	}
	return c.JSON(RoomView{
		ID:           state.ID,
		HostID:       state.HostID,
		MapID:        state.MapID,
		Players:      state.Players,
		Status:       state.Status,
		MaxPlayers:   state.MaxPlayers,
		Rounds:       state.Rounds,
		TimeLimitSec: state.TimeLimitSec,
		CurrentRound: state.CurrentRound,
	})
}

// ──────────────────────────────────────────────
// POST /api/rooms/:id/join
// ──────────────────────────────────────────────

// Join godoc
// @Summary      Join a room
// @Tags         rooms
// @Produce      json
// @Security     CookieAuth
// @Param        id  path  string  true  "Room ID"
// @Success      200 {object} object
// @Router       /rooms/{id}/join [post]
func (h *Handler) Join(c *fiber.Ctx) error {
	roomID := c.Params("id")
	userID := gauth.UserID(c)

	state, err := h.store.Get(c.Context(), roomID)
	if err != nil || state == nil {
		return fiber.ErrNotFound
	}
	if state.Status != "waiting" {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "game already started"})
	}
	if len(state.Players) >= state.MaxPlayers {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "room full"})
	}
	// Check if already joined
	for _, p := range state.Players {
		if p.UserID == userID.String() {
			return c.JSON(fiber.Map{"id": roomID, "map_id": state.MapID, "rounds": state.Rounds})
		}
	}

	var username string
	var elo int
	err = h.pg.Pool.QueryRow(c.Context(),
		`SELECT username, elo FROM users WHERE id = $1`, userID,
	).Scan(&username, &elo)
	if err != nil {
		return fiber.ErrInternalServerError
	}

	p := Player{UserID: userID.String(), Username: username, ELO: elo}
	state.Players = append(state.Players, p)
	if err := h.store.Set(c.Context(), state); err != nil {
		return fiber.ErrInternalServerError
	}

	_ = h.io.To(sio.Room(roomID)).Emit("player_joined", map[string]any{
		"user_id":  p.UserID,
		"username": p.Username,
		"elo":      p.ELO,
	})
	return c.JSON(fiber.Map{"id": roomID, "map_id": state.MapID, "rounds": state.Rounds})
}

// ──────────────────────────────────────────────
// DELETE /api/rooms/:id/leave
// ──────────────────────────────────────────────

// Leave godoc
// @Summary      Leave a room
// @Tags         rooms
// @Produce      json
// @Security     CookieAuth
// @Param        id  path  string  true  "Room ID"
// @Success      200 {object} object
// @Router       /rooms/{id}/leave [delete]
func (h *Handler) Leave(c *fiber.Ctx) error {
	roomID := c.Params("id")
	userID := gauth.UserID(c).String()

	state, err := h.store.Get(c.Context(), roomID)
	if err != nil || state == nil {
		return fiber.ErrNotFound
	}

	// Remove player
	remaining := state.Players[:0]
	for _, p := range state.Players {
		if p.UserID != userID {
			remaining = append(remaining, p)
		}
	}
	state.Players = remaining

	if len(state.Players) == 0 {
		_ = h.store.Delete(c.Context(), roomID)
		return c.JSON(fiber.Map{"ok": true})
	}
	// Reassign host if needed
	if state.HostID == userID {
		state.HostID = state.Players[0].UserID
	}
	if err := h.store.Set(c.Context(), state); err != nil {
		return fiber.ErrInternalServerError
	}

	_ = h.io.To(sio.Room(roomID)).Emit("player_left", map[string]any{"user_id": userID})
	return c.JSON(fiber.Map{"ok": true})
}

// ──────────────────────────────────────────────
// POST /api/rooms/:id/start
// ──────────────────────────────────────────────

// Start godoc
// @Summary      Start the game (host only)
// @Tags         rooms
// @Produce      json
// @Security     CookieAuth
// @Param        id  path  string  true  "Room ID"
// @Success      200 {object} object
// @Router       /rooms/{id}/start [post]
func (h *Handler) Start(c *fiber.Ctx) error {
	roomID := c.Params("id")
	userID := gauth.UserID(c).String()

	state, err := h.store.Get(c.Context(), roomID)
	if err != nil || state == nil {
		return fiber.ErrNotFound
	}
	if state.HostID != userID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "only host can start"})
	}
	if state.Status != "waiting" {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "game already started"})
	}
	if len(state.Players) < 1 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "no players"})
	}

	// Select N random ready panoramas from this map
	rows, err := h.pg.Pool.Query(c.Context(),
		`SELECT p.id FROM panoramas p
		 JOIN floors f ON f.id = p.floor_id
		 WHERE f.map_id = $1
		   AND p.tile_status = 'tiled'
		   AND p.moderation_status = 'clean'
		 ORDER BY RANDOM()
		 LIMIT $2`,
		state.MapID, state.Rounds)
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
	// Allow fewer rounds than requested if not enough panoramas
	state.Rounds = len(panoIDs)

	// Create match record in DB
	var matchID string
	err = h.pg.Pool.QueryRow(c.Context(),
		`INSERT INTO matches (room_id, map_id, status, max_players, rounds, time_limit, started_at)
		 VALUES ($1, $2, 'active', $3, $4, $5, NOW())
		 RETURNING id`,
		roomID, state.MapID, state.MaxPlayers, state.Rounds, state.TimeLimitSec,
	).Scan(&matchID)
	if err != nil {
		return fiber.ErrInternalServerError
	}

	state.Status = "active"
	state.PanoIDs = panoIDs
	state.CurrentRound = 1
	state.CurrentPanoID = panoIDs[0]
	state.MatchID = matchID
	state.RoundToken = uuid.NewString()
	state.Guesses = map[string]Guess{}
	for i := range state.Players {
		state.Players[i].HasGuessed = false
	}

	if err := h.store.Set(c.Context(), state); err != nil {
		return fiber.ErrInternalServerError
	}

	_ = h.io.To(sio.Room(roomID)).Emit("round_started", map[string]any{
		"round":          state.CurrentRound,
		"pano_id":        state.CurrentPanoID,
		"time_limit_sec": state.TimeLimitSec,
	})
	h.startRoundTimer(roomID, state.RoundToken, time.Duration(state.TimeLimitSec)*time.Second)
	return c.JSON(fiber.Map{"ok": true, "match_id": matchID})
}

// ──────────────────────────────────────────────
// POST /api/rooms/:id/guess
// ──────────────────────────────────────────────

type guessReq struct {
	X       float64 `json:"x"`
	Y       float64 `json:"y"`
	FloorID string  `json:"floor_id"`
}

// Guess godoc
// @Summary      Submit a guess for the current round
// @Tags         rooms
// @Accept       json
// @Produce      json
// @Security     CookieAuth
// @Param        id    path  string    true  "Room ID"
// @Param        body  body  guessReq  true  "Guess coordinates"
// @Success      200 {object} object
// @Router       /rooms/{id}/guess [post]
func (h *Handler) Guess(c *fiber.Ctx) error {
	roomID := c.Params("id")
	userID := gauth.UserID(c).String()

	var req guessReq
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
	}

	state, err := h.store.Get(c.Context(), roomID)
	if err != nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "state unavailable"})
	}
	if state == nil {
		return fiber.ErrNotFound
	}
	if state.Status != "active" {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "game not active"})
	}

	// Check player is in this room and hasn't guessed
	var playerName string
	inRoom := false
	for _, p := range state.Players {
		if p.UserID == userID {
			inRoom = true
			playerName = p.Username
			if p.HasGuessed {
				return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "already guessed"})
			}
			break
		}
	}
	if !inRoom {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "not in room"})
	}

	state.Guesses[userID] = Guess(req)
	for i := range state.Players {
		if state.Players[i].UserID == userID {
			state.Players[i].HasGuessed = true
		}
	}
	if err := h.store.Set(c.Context(), state); err != nil {
		return fiber.ErrInternalServerError
	}

	_ = h.io.To(sio.Room(roomID)).Emit("guess_broadcast", map[string]any{
		"user_id":  userID,
		"username": playerName,
	})

	// Check if all players have guessed
	allGuessed := true
	for _, p := range state.Players {
		if !p.HasGuessed {
			allGuessed = false
			break
		}
	}
	if allGuessed {
		go h.advanceRound(context.Background(), state)
	}

	return c.JSON(fiber.Map{"ok": true})
}

// startRoundTimer fires after dur and force-closes the round if the token is still valid.
func (h *Handler) startRoundTimer(roomID, token string, dur time.Duration) {
	time.AfterFunc(dur, func() {
		ctx := context.Background()
		fresh, err := h.store.Get(ctx, roomID)
		if err != nil || fresh == nil || fresh.RoundToken != token || fresh.Status != "active" {
			return // stale timer or game already over
		}
		// Mark every player as having guessed so advanceRound scores them 0
		for i := range fresh.Players {
			fresh.Players[i].HasGuessed = true
		}
		if err := h.store.Set(ctx, fresh); err != nil {
			return
		}
		h.advanceRound(ctx, fresh)
	})
}

// advanceRound resolves the current round and starts the next or ends the game.
func (h *Handler) advanceRound(ctx context.Context, state *RoomState) {
	roomID := state.ID

	// Guard: reload from Valkey and verify the round token hasn't changed.
	// Prevents double-advance when both the timer and the last guess fire concurrently.
	fresh, err := h.store.Get(ctx, roomID)
	if err != nil || fresh == nil || fresh.RoundToken != state.RoundToken || fresh.Status != "active" {
		return
	}
	state = fresh

	// Fetch actual panorama location
	var ax, ay float64
	var aFloorID string
	err = h.pg.Pool.QueryRow(ctx,
		`SELECT x, y, floor_id FROM panoramas WHERE id = $1`, state.CurrentPanoID,
	).Scan(&ax, &ay, &aFloorID)
	if err != nil {
		return
	}

	type scoreEntry struct {
		UserID   string  `json:"user_id"`
		Username string  `json:"username"`
		Score    int     `json:"score"`
		Distance float64 `json:"distance"`
	}
	var scores []scoreEntry

	for _, p := range state.Players {
		g, hasGuess := state.Guesses[p.UserID]
		var sc int
		var dist float64
		if hasGuess {
			dist = game.Distance(g.X, g.Y, ax, ay)
			sc = game.CalculateScore(g.X, g.Y, ax, ay, g.FloorID, aFloorID, 200)
		}
		scores = append(scores, scoreEntry{
			UserID:   p.UserID,
			Username: p.Username,
			Score:    sc,
			Distance: dist,
		})

		// Persist guess to DB
		gFloorID := aFloorID
		gx, gy := ax, ay
		if hasGuess {
			gFloorID = g.FloorID
			gx, gy = g.X, g.Y
		}
		_, _ = h.pg.Pool.Exec(ctx,
			`INSERT INTO guesses (match_id, user_id, panorama_id, round, x, y, guess_floor_id, score, distance)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			 ON CONFLICT DO NOTHING`,
			state.MatchID, p.UserID, state.CurrentPanoID,
			state.CurrentRound, gx, gy, gFloorID, sc, dist,
		)
	}

	// Broadcast round results
	_ = h.io.To(sio.Room(roomID)).Emit("round_ended", map[string]any{
		"round":  state.CurrentRound,
		"scores": scores,
		"correct": map[string]any{
			"x":        ax,
			"y":        ay,
			"floor_id": aFloorID,
		},
	})

	// Reset guesses for next round
	state.Guesses = map[string]Guess{}
	for i := range state.Players {
		state.Players[i].HasGuessed = false
	}

	if state.CurrentRound < state.Rounds {
		state.CurrentRound++
		state.CurrentPanoID = state.PanoIDs[state.CurrentRound-1]
		state.RoundToken = uuid.NewString()
		_ = h.store.Set(ctx, state)
		_ = h.io.To(sio.Room(roomID)).Emit("round_started", map[string]any{
			"round":          state.CurrentRound,
			"pano_id":        state.CurrentPanoID,
			"time_limit_sec": state.TimeLimitSec,
		})
		h.startRoundTimer(roomID, state.RoundToken, time.Duration(state.TimeLimitSec)*time.Second)
	} else {
		// Game over: aggregate scores
		state.Status = "finished"
		_ = h.store.Set(ctx, state)

		_, _ = h.pg.Pool.Exec(ctx,
			`UPDATE matches SET status = 'finished', ended_at = NOW() WHERE id = $1`,
			state.MatchID,
		)

		// Build aggregate totals from DB
		type finalScore struct {
			UserID   string `json:"user_id"`
			Username string `json:"username"`
			Total    int    `json:"total"`
		}
		rows, err := h.pg.Pool.Query(ctx,
			`SELECT g.user_id, u.username, COALESCE(SUM(g.score), 0)
			 FROM guesses g
			 JOIN users u ON u.id::text = g.user_id::text
			 WHERE g.match_id = $1
			 GROUP BY g.user_id, u.username
			 ORDER BY 3 DESC`,
			state.MatchID,
		)
		var finals []finalScore
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var f finalScore
				_ = rows.Scan(&f.UserID, &f.Username, &f.Total)
				finals = append(finals, f)
			}
		}

		_ = h.io.To(sio.Room(roomID)).Emit("game_ended", map[string]any{"scores": finals})

		// Trigger ELO recalculation in workers service
		go h.triggerELO(state.MatchID)
	}
}

func (h *Handler) triggerELO(matchID string) {
	if h.cfg.WorkersURL == "" {
		return
	}
	body, _ := json.Marshal(map[string]string{"match_id": matchID})
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/internal/elo", h.cfg.WorkersURL),
		bytes.NewReader(body),
	)
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err == nil {
		resp.Body.Close()
	}
}

// ──────────────────────────────────────────────
// GET /api/rooms/:id/livekit-token
// ──────────────────────────────────────────────

// LiveKitToken godoc
// @Summary      Get a LiveKit room token
// @Tags         rooms
// @Produce      json
// @Security     CookieAuth
// @Param        id  path  string  true  "Room ID"
// @Success      200 {object} object
// @Router       /rooms/{id}/livekit-token [get]
func (h *Handler) LiveKitToken(c *fiber.Ctx) error {
	roomID := c.Params("id")
	userID := gauth.UserID(c)

	// Fetch username
	var username string
	_ = h.pg.Pool.QueryRow(c.Context(),
		`SELECT username FROM users WHERE id = $1`, userID,
	).Scan(&username)

	at := lkauth.NewAccessToken(h.cfg.LiveKitAPIKey, h.cfg.LiveKitSecret)
	grant := &lkauth.VideoGrant{
		RoomJoin: true,
		Room:     roomID,
	}
	at.SetVideoGrant(grant).
		SetIdentity(userID.String()).
		SetName(username).
		SetValidFor(24 * time.Hour)

	token, err := at.ToJWT()
	if err != nil {
		return fiber.ErrInternalServerError
	}
	return c.JSON(fiber.Map{
		"token": token,
		"url":   h.cfg.LiveKitURL,
	})
}
