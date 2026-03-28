package auth

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gssr/game/internal/config"
	"github.com/gssr/game/internal/db"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

// Swagger request/response types.
var (
	_ = registerRequest{}
	_ = loginRequest{}
	_ = authResponse{}
	_ = errorResponse{}
)

type registerRequest struct {
	Username string `json:"username" example:"alice"`
	Password string `json:"password" example:"s3cr3tP@ss"`
	Email    string `json:"email"    example:"alice@example.com"`
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

// SeedAdmin creates the initial admin from env vars if no admins exist yet.
func SeedAdmin(ctx context.Context, pg *db.Postgres, username, password string) error {
	if username == "" || password == "" {
		return nil
	}
	var count int
	if err := pg.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM admins`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	_, err = pg.Pool.Exec(ctx,
		`INSERT INTO admins (username, password_hash) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		username, string(hash),
	)
	return err
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
// @Failure      422   {object}  errorResponse
// @Router       /auth/register [post]
func (h *Handler) Register(c *fiber.Ctx) error {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Email    string `json:"email"`
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
	if body.Email == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "email is required"})
	}

	if nsfw, reason := h.checkTextNSFW(body.Username); nsfw {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{"error": reason})
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "internal error"})
	}

	var userID string
	err = h.pg.Pool.QueryRow(context.Background(),
		`INSERT INTO users (username, password_hash, email) VALUES ($1, $2, $3) RETURNING id`,
		body.Username, string(hash), body.Email,
	).Scan(&userID)
	if err != nil {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "username or email already taken"})
	}

	// Create email verification token (fire-and-forget on failure)
	if token, err := generateToken(32); err == nil {
		expiry := time.Now().Add(24 * time.Hour)
		_, _ = h.pg.Pool.Exec(context.Background(),
			`INSERT INTO email_verification_tokens (token, user_id, expires_at) VALUES ($1, $2, $3)`,
			token, userID, expiry,
		)
		go h.sendVerificationEmail(userID, body.Email, token)
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"id": userID, "username": body.Username})
}

// Login godoc
// @Summary      Authenticate as regular user and receive tokens as cookies
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
	err := h.pg.Pool.QueryRow(context.Background(),
		`SELECT id, password_hash FROM users WHERE username = $1 AND banned = false`,
		body.Username,
	).Scan(&userID, &passwordHash)
	if err == pgx.ErrNoRows {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "invalid credentials"})
	}
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "internal error"})
	}

	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(body.Password)); err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "invalid credentials"})
	}

	return h.issueTokens(c, userID, false)
}

// AdminLogin godoc
// @Summary      Authenticate as admin and receive tokens as cookies
// @Tags         auth
// @Accept       json
// @Produce      json
// @Param        body  body      loginRequest  true  "credentials"
// @Success      200   {object}  authResponse
// @Failure      400   {object}  errorResponse
// @Failure      401   {object}  errorResponse
// @Router       /auth/admin-login [post]
func (h *Handler) AdminLogin(c *fiber.Ctx) error {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
	}

	var adminID, passwordHash string
	err := h.pg.Pool.QueryRow(context.Background(),
		`SELECT id, password_hash FROM admins WHERE username = $1`,
		body.Username,
	).Scan(&adminID, &passwordHash)
	if err == pgx.ErrNoRows {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "invalid credentials"})
	}
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "internal error"})
	}

	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(body.Password)); err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "invalid credentials"})
	}

	return h.issueTokens(c, adminID, true)
}

// VerifyEmail godoc
// @Summary      Verify email address via token link
// @Tags         auth
// @Param        token  query  string  true  "Verification token"
// @Success      302
// @Failure      400  {object}  errorResponse
// @Router       /auth/verify-email [get]
func (h *Handler) VerifyEmail(c *fiber.Ctx) error {
	token := c.Query("token")
	if token == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "missing token"})
	}

	var userID string
	var used bool
	var expiresAt time.Time
	err := h.pg.Pool.QueryRow(context.Background(),
		`SELECT user_id, used, expires_at FROM email_verification_tokens WHERE token = $1`,
		token,
	).Scan(&userID, &used, &expiresAt)
	if err == pgx.ErrNoRows {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid token"})
	}
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "internal error"})
	}
	if used || time.Now().After(expiresAt) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "token expired or already used"})
	}

	if _, err = h.pg.Pool.Exec(context.Background(),
		`UPDATE email_verification_tokens SET used = true WHERE token = $1`, token); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "internal error"})
	}
	if _, err = h.pg.Pool.Exec(context.Background(),
		`UPDATE users SET email_verified = true WHERE id = $1`, userID); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "internal error"})
	}

	return c.Redirect(h.cfg.FrontendURL + "/verified")
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
	claims := &Claims{}
	_ = claims.UserID.UnmarshalText([]byte(userIDStr))

	access, err := SignAccess(h.cfg.JWTSecret, claims.UserID, isAdmin, h.cfg.JWTAccessTTL)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "token error"})
	}

	refreshJWT, err := SignAccess(h.cfg.JWTSecret, claims.UserID, isAdmin, h.cfg.JWTRefreshTTL)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "token error"})
	}

	key := fmt.Sprintf("refresh:%s", claims.UserID)
	h.cache.Client.Set(context.Background(), key, refreshJWT, h.cfg.JWTRefreshTTL)

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

func generateToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func (h *Handler) checkTextNSFW(text string) (bool, string) {
	if h.cfg.WorkersURL == "" {
		return false, ""
	}
	payload, _ := json.Marshal(map[string]string{"text": text})
	resp, err := http.Post(h.cfg.WorkersURL+"/internal/check-text", "application/json", bytes.NewReader(payload))
	if err != nil {
		return false, "" // gracefully skip if workers unreachable
	}
	defer resp.Body.Close()
	var result struct {
		Clean  bool   `json:"clean"`
		Reason string `json:"reason"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&result)
	return !result.Clean, result.Reason
}

func (h *Handler) sendVerificationEmail(userID, email, token string) {
	if h.cfg.WorkersURL == "" {
		return
	}
	payload, _ := json.Marshal(map[string]string{
		"user_id": userID,
		"email":   email,
		"token":   token,
	})
	resp, err := http.Post(h.cfg.WorkersURL+"/internal/send-verification-email", "application/json", bytes.NewReader(payload))
	if err == nil {
		resp.Body.Close()
	}
}
