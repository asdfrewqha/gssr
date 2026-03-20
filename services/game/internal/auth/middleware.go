package auth

import (
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

const (
	ctxUserID  = "userID"
	ctxIsAdmin = "isAdmin"
)

// Required validates the JWT access cookie and stores claims in locals.
func Required(secret []byte) fiber.Handler {
	return func(c *fiber.Ctx) error {
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
		return c.Next()
	}
}

// AdminRequired additionally checks the isAdmin claim.
func AdminRequired(secret []byte) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if err := Required(secret)(c); err != nil {
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
