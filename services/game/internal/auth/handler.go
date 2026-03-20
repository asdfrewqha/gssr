package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gssr/game/internal/config"
	"github.com/gssr/game/internal/db"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

// swagger request/response types

type registerRequest struct {
	Username string `json:"username" example:"alice"`
	Password string `json:"password" example:"s3cr3tP@ss"`
}

type loginRequest struct {
	Username string `json:"username" example:"alice"`
	Password string `json:"password" example:"s3cr3tP@ss"`
}

type authResponse struct {
	UserID    string `json:"user_id"    example:"550e8400-e29b-41d4-a716-446655440000"`
	ExpiresIn int    `json:"expires_in" example:"900"`
}

type errorResponse struct {
	Error string `json:"error" example:"invalid credentials"`
}

type Handler struct {
	cfg   *config.Config
	pg    *db.Postgres
	cache *db.Valkey
}

func NewHandler(cfg *config.Config, pg *db.Postgres, cache *db.Valkey) *Handler {
	return &Handler{cfg: cfg, pg: pg, cache: cache}
}

// Register godoc
// @Summary      Register a new user
// @Tags         auth
// @Accept       json
// @Produce      json
// @Param        body  body      registerRequest  true  "credentials"
// @Success      201   {object}  map[string]string
// @Failure      400   {object}  errorResponse
// @Failure      409   {object}  errorResponse
// @Router       /auth/register [post]
func (h *Handler) Register(c *fiber.Ctx) error {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
	}
	if len(body.Username) < 3 || len(body.Username) > 32 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "username must be 3-32 chars"})
	}
	if len(body.Password) < 8 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "password too short"})
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "internal error"})
	}

	var userID string
	err = h.pg.Pool.QueryRow(context.Background(),
		`INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id`,
		body.Username, string(hash),
	).Scan(&userID)
	if err != nil {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "username already taken"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"id": userID, "username": body.Username})
}

// Login godoc
// @Summary      Authenticate and receive tokens as cookies
// @Tags         auth
// @Accept       json
// @Produce      json
// @Param        body  body      loginRequest  true  "credentials"
// @Success      200   {object}  authResponse
// @Failure      400   {object}  errorResponse
// @Failure      401   {object}  errorResponse
// @Router       /auth/login [post]
func (h *Handler) Login(c *fiber.Ctx) error {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
	}

	var userID, passwordHash string
	var isAdmin bool
	err := h.pg.Pool.QueryRow(context.Background(),
		`SELECT id, password_hash, is_admin FROM users WHERE username = $1 AND banned = false`,
		body.Username,
	).Scan(&userID, &passwordHash, &isAdmin)
	if err == pgx.ErrNoRows {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "invalid credentials"})
	}
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "internal error"})
	}

	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(body.Password)); err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "invalid credentials"})
	}

	return h.issueTokens(c, userID, isAdmin)
}

// Refresh godoc
// @Summary      Rotate tokens using the refresh_token cookie
// @Tags         auth
// @Produce      json
// @Success      200  {object}  authResponse
// @Failure      401  {object}  errorResponse
// @Router       /auth/refresh [post]
func (h *Handler) Refresh(c *fiber.Ctx) error {
	refreshToken := c.Cookies("refresh_token")
	if refreshToken == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "missing refresh token"})
	}
	claims, err := Verify(h.cfg.JWTSecret, refreshToken)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "invalid refresh token"})
	}

	// Verify token is in Valkey (rotation check)
	key := fmt.Sprintf("refresh:%s", claims.UserID)
	stored, err := h.cache.Client.Get(context.Background(), key).Result()
	if err != nil || stored != refreshToken {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "refresh token revoked"})
	}

	return h.issueTokens(c, claims.UserID.String(), claims.IsAdmin)
}

// Logout godoc
// @Summary      Revoke tokens and clear cookies
// @Tags         auth
// @Security     CookieAuth
// @Success      204
// @Failure      401  {object}  errorResponse
// @Router       /auth/logout [post]
func (h *Handler) Logout(c *fiber.Ctx) error {
	userID := UserID(c)
	h.cache.Client.Del(context.Background(), fmt.Sprintf("refresh:%s", userID))
	clearCookies(c)
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *Handler) issueTokens(c *fiber.Ctx, userIDStr string, isAdmin bool) error {
	// Parse UUID from string
	claims := &Claims{}
	_ = claims.UserID.UnmarshalText([]byte(userIDStr))

	access, err := SignAccess(h.cfg.JWTSecret, claims.UserID, isAdmin, h.cfg.JWTAccessTTL)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "token error"})
	}

	// Generate opaque refresh token stored in Valkey
	b := make([]byte, 32)
	rand.Read(b)
	refreshToken := hex.EncodeToString(b)

	// Sign refresh token as JWT for expiry verification
	refreshJWT, err := SignAccess(h.cfg.JWTSecret, claims.UserID, isAdmin, h.cfg.JWTRefreshTTL)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "token error"})
	}

	key := fmt.Sprintf("refresh:%s", claims.UserID)
	h.cache.Client.Set(context.Background(), key, refreshJWT, h.cfg.JWTRefreshTTL)
	_ = refreshToken // keep for future opaque token variant

	c.Cookie(&fiber.Cookie{
		Name:     "access_token",
		Value:    access,
		HTTPOnly: true,
		Secure:   true,
		SameSite: "Strict",
		MaxAge:   int(h.cfg.JWTAccessTTL.Seconds()),
	})
	c.Cookie(&fiber.Cookie{
		Name:     "refresh_token",
		Value:    refreshJWT,
		HTTPOnly: true,
		Secure:   true,
		SameSite: "Strict",
		Path:     "/api/auth/refresh",
		MaxAge:   int(h.cfg.JWTRefreshTTL.Seconds()),
	})

	return c.JSON(fiber.Map{"user_id": claims.UserID, "expires_in": int(h.cfg.JWTAccessTTL.Seconds())})
}

func clearCookies(c *fiber.Ctx) {
	expired := time.Now().Add(-time.Hour)
	c.Cookie(&fiber.Cookie{Name: "access_token", Expires: expired, HTTPOnly: true})
	c.Cookie(&fiber.Cookie{Name: "refresh_token", Expires: expired, HTTPOnly: true})
}
