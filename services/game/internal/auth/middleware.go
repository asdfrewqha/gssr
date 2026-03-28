package auth

import (
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

const (
	ctxUserID  = "userID"
	ctxIsAdmin = "isAdmin"
)

// parseAndStoreClaims validates the JWT access cookie and stores claims in locals.
// It does NOT call c.Next(), so callers can add further checks before proceeding.
func parseAndStoreClaims(c *fiber.Ctx, secret []byte) error {
	token := c.Cookies("access_token")
	if token == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "missing token"})
	}
	claims, err := Verify(secret, token)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "invalid token"})
	}
	c.Locals(ctxUserID, claims.UserID)
	c.Locals(ctxIsAdmin, claims.IsAdmin)
	return nil
}

// Required validates the JWT access cookie and stores claims in locals.
func Required(secret []byte) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if err := parseAndStoreClaims(c, secret); err != nil {
			return err
		}
		return c.Next()
	}
}

// AdminRequired additionally checks the isAdmin claim.
func AdminRequired(secret []byte) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if err := parseAndStoreClaims(c, secret); err != nil {
			return err
		}
		if !c.Locals(ctxIsAdmin).(bool) {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "admin only"})
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
