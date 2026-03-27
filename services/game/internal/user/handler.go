package user

import (
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gssr/game/internal/auth"
	"github.com/gssr/game/internal/db"
)

type Handler struct {
	pg *db.Postgres
}

func NewHandler(pg *db.Postgres) *Handler {
	return &Handler{pg: pg}
}

type userResponse struct {
	ID        string `json:"id"`
	Username  string `json:"username"`
	AvatarURL string `json:"avatar_url"`
	ELO       int    `json:"elo"`
	IsAdmin   bool   `json:"is_admin"`
	CreatedAt string `json:"created_at"`
}

// GetMe godoc
// @Summary      Get current user profile
// @Tags         users
// @Produce      json
// @Security     CookieAuth
// @Success      200  {object}  userResponse
// @Failure      401  {object}  fiber.Map
// @Router       /users/me [get]
func (h *Handler) GetMe(c *fiber.Ctx) error {
	userID := auth.UserID(c)

	var (
		id        string
		username  string
		avatarURL string
		elo       int
		isAdmin   bool
		createdAt time.Time
	)
	err := h.pg.Pool.QueryRow(c.Context(),
		`SELECT id, username, COALESCE(avatar_url,''), elo, is_admin, created_at
		 FROM users WHERE id = $1`,
		userID,
	).Scan(&id, &username, &avatarURL, &elo, &isAdmin, &createdAt)
	if err != nil {
		return fiber.ErrNotFound
	}
	return c.JSON(userResponse{
		ID:        id,
		Username:  username,
		AvatarURL: avatarURL,
		ELO:       elo,
		IsAdmin:   isAdmin,
		CreatedAt: createdAt.UTC().Format(time.RFC3339),
	})
}
