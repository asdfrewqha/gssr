package auth

import (
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

const (
	ctxUserID  = "userID"
	ctxIsAdmin = "isAdmin"
)

// parseClaims reads a JWT from the given cookie name, verifies it,
// and stores the claims in Fiber locals. Returns an error if missing/invalid.
func parseClaims(c *fiber.Ctx, secret []byte, cookieName string) error {
	token := c.Cookies(cookieName)
	if token == "" {
		return fiber.NewError(fiber.StatusUnauthorized, "missing token")
	}
	claims, err := Verify(secret, token)
	if err != nil {
		return fiber.NewError(fiber.StatusUnauthorized, "invalid token")
	}
	c.Locals(ctxUserID, claims.UserID)
	c.Locals(ctxIsAdmin, claims.IsAdmin)
	return nil
}

// Required reads access_token (game player). Falls back to admin_token so that
// admin panel can also call shared endpoints like /api/users/me.
func Required(secret []byte) fiber.Handler {
	return func(c *fiber.Ctx) error {
		// Try game token first; if missing try admin token (for admin panel shared routes).
		if t := c.Cookies("access_token"); t != "" {
			if err := parseClaims(c, secret, "access_token"); err != nil {
				return err
			}
		} else {
			if err := parseClaims(c, secret, "admin_token"); err != nil {
				return err
			}
		}
		return c.Next()
	}
}

// AdminRequired reads admin_token with priority, then falls back to access_token
// (in case someone calls admin endpoint with a game token that has adm:true).
func AdminRequired(secret []byte) fiber.Handler {
	return func(c *fiber.Ctx) error {
		// Prefer admin_token so admin+player simultaneous sessions work correctly.
		if t := c.Cookies("admin_token"); t != "" {
			if err := parseClaims(c, secret, "admin_token"); err != nil {
				return err
			}
		} else {
			if err := parseClaims(c, secret, "access_token"); err != nil {
				return err
			}
		}
		if !c.Locals(ctxIsAdmin).(bool) {
			return fiber.NewError(fiber.StatusForbidden, "admin only")
		}
		return c.Next()
	}
}

func UserID(c *fiber.Ctx) uuid.UUID {
	return c.Locals(ctxUserID).(uuid.UUID)
}

func IsAdmin(c *fiber.Ctx) bool {
	v, _ := c.Locals(ctxIsAdmin).(bool)
	return v
}
