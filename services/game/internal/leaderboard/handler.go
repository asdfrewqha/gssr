package leaderboard

import (
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gssr/game/internal/db"
	"github.com/jackc/pgx/v5"
)

const pageSize = 50

type Handler struct {
	pg *db.Postgres
}

func NewHandler(pg *db.Postgres) *Handler {
	return &Handler{pg: pg}
}

// List godoc
// @Summary      Leaderboard (ELO or XP)
// @Tags         leaderboard
// @Produce      json
// @Param        type  query  string  false  "elo or xp (default: elo)"
// @Param        page  query  int     false  "page number (default: 1)"
// @Success      200  {array} object
// @Router       /leaderboard [get]
func (h *Handler) List(c *fiber.Ctx) error {
	lbType := c.Query("type", "elo")
	page := c.QueryInt("page", 1)
	if page < 1 {
		page = 1
	}
	offset := (page - 1) * pageSize

	var orderCol string
	switch lbType {
	case "xp":
		orderCol = "xp"
	default:
		orderCol = "elo"
	}

	// Only email-verified users appear in leaderboard.
	rows, err := h.pg.Pool.Query(c.Context(),
		`SELECT id, username, COALESCE(avatar_url,''), elo, xp, created_at
		 FROM users
		 WHERE email_verified = true AND banned = false
		 ORDER BY `+orderCol+` DESC
		 LIMIT $1 OFFSET $2`,
		pageSize, offset,
	)
	if err != nil {
		return fiber.ErrInternalServerError
	}
	defer rows.Close()

	type entry struct {
		Rank      int    `json:"rank"`
		ID        string `json:"id"`
		Username  string `json:"username"`
		AvatarURL string `json:"avatar_url"`
		ELO       int    `json:"elo"`
		XP        int    `json:"xp"`
		CreatedAt string `json:"created_at"`
	}

	var result []entry
	rank := offset + 1
	for rows.Next() {
		var e entry
		var createdAt time.Time
		if err := rows.Scan(&e.ID, &e.Username, &e.AvatarURL, &e.ELO, &e.XP, &createdAt); err != nil {
			continue
		}
		e.Rank = rank
		e.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		result = append(result, e)
		rank++
	}
	if result == nil {
		result = []entry{}
	}
	return c.JSON(result)
}

// Profile godoc
// @Summary      Get a user's public profile
// @Tags         users
// @Produce      json
// @Param        id  path  string  true  "User ID"
// @Success      200  {object} object
// @Failure      404  {object} object
// @Router       /users/{id}/profile [get]
func (h *Handler) Profile(c *fiber.Ctx) error {
	id := c.Params("id")

	var username, avatarURL string
	var elo, xp int
	var createdAt time.Time
	err := h.pg.Pool.QueryRow(c.Context(),
		`SELECT username, COALESCE(avatar_url,''), elo, xp, created_at
		 FROM users WHERE id = $1 AND banned = false`,
		id,
	).Scan(&username, &avatarURL, &elo, &xp, &createdAt)
	if err == pgx.ErrNoRows {
		return fiber.ErrNotFound
	}
	if err != nil {
		return fiber.ErrInternalServerError
	}

	// Recent solo sessions.
	rows, err := h.pg.Pool.Query(c.Context(),
		`SELECT s.id, m.name, s.difficulty, s.total_score, s.status, s.started_at
		 FROM solo_sessions s
		 JOIN maps m ON m.id = s.map_id
		 WHERE s.user_id = $1 AND s.status = 'finished'
		 ORDER BY s.started_at DESC
		 LIMIT 10`,
		id,
	)
	if err != nil {
		return fiber.ErrInternalServerError
	}
	defer rows.Close()

	type recentGame struct {
		ID         string `json:"id"`
		MapName    string `json:"map_name"`
		Difficulty string `json:"difficulty"`
		TotalScore int    `json:"total_score"`
		StartedAt  string `json:"started_at"`
	}

	var recent []recentGame
	for rows.Next() {
		var g recentGame
		var status string
		var startedAt time.Time
		if err := rows.Scan(&g.ID, &g.MapName, &g.Difficulty, &g.TotalScore, &status, &startedAt); err != nil {
			continue
		}
		g.StartedAt = startedAt.UTC().Format(time.RFC3339)
		recent = append(recent, g)
	}
	if recent == nil {
		recent = []recentGame{}
	}

	return c.JSON(fiber.Map{
		"id":          id,
		"username":    username,
		"avatar_url":  avatarURL,
		"elo":         elo,
		"xp":          xp,
		"created_at":  createdAt.UTC().Format(time.RFC3339),
		"recent_games": recent,
	})
}
