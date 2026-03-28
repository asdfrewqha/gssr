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
	ID            string `json:"id"`
	Username      string `json:"username"`
	AvatarURL     string `json:"avatar_url"`
	ELO           int    `json:"elo"`
	XP            int    `json:"xp"`
	Email         string `json:"email,omitempty"`
	EmailVerified bool   `json:"email_verified"`
	IsAdmin       bool   `json:"is_admin"`
	CreatedAt     string `json:"created_at"`
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
	isAdmin := auth.IsAdmin(c)

	// Admins are stored in a separate table; return a minimal admin response.
	if isAdmin {
		var username string
		var createdAt time.Time
		err := h.pg.Pool.QueryRow(c.Context(),
			`SELECT username, created_at FROM admins WHERE id = $1`,
			userID,
		).Scan(&username, &createdAt)
		if err != nil {
			return fiber.ErrNotFound
		}
		return c.JSON(userResponse{
			ID:        userID.String(),
			Username:  username,
			IsAdmin:   true,
			CreatedAt: createdAt.UTC().Format(time.RFC3339),
		})
	}

	var (
		id            string
		username      string
		avatarURL     string
		elo           int
		xp            int
		email         string
		emailVerified bool
		createdAt     time.Time
	)
	err := h.pg.Pool.QueryRow(c.Context(),
		`SELECT id, username, COALESCE(avatar_url,''), elo, xp,
		        COALESCE(email,''), email_verified, created_at
		 FROM users WHERE id = $1`,
		userID,
	).Scan(&id, &username, &avatarURL, &elo, &xp, &email, &emailVerified, &createdAt)
	if err != nil {
		return fiber.ErrNotFound
	}
	return c.JSON(userResponse{
		ID:            id,
		Username:      username,
		AvatarURL:     avatarURL,
		ELO:           elo,
		XP:            xp,
		Email:         email,
		EmailVerified: emailVerified,
		IsAdmin:       false,
		CreatedAt:     createdAt.UTC().Format(time.RFC3339),
	})
}
