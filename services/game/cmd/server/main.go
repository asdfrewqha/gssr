// @title           GSSR Game API
// @version         1.0
// @description     GeoGuessr School Edition – game service
// @host            localhost:3000
// @BasePath        /api
// @schemes         http

// @securityDefinitions.apikey  CookieAuth
// @in                          cookie
// @name                        access_token

package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	fiberprometheus "github.com/ansrivas/fiberprometheus/v2"
	fiberws "github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	swagger "github.com/gofiber/swagger"
	"github.com/gssr/game/internal/auth"
	"github.com/gssr/game/internal/config"
	"github.com/gssr/game/internal/db"
	_ "github.com/gssr/game/docs"
	"github.com/gssr/game/internal/leaderboard"
	"github.com/gssr/game/internal/maps"
	"github.com/gssr/game/internal/room"
	"github.com/gssr/game/internal/solo"
	"github.com/gssr/game/internal/user"
	"github.com/gssr/game/internal/ws"
)

func main() {
	cfg := config.Load()
	ctx := context.Background()

	pg, err := db.NewPostgres(ctx, cfg.PostgresURL)
	if err != nil {
		log.Fatalf("postgres: %v", err)
	}
	defer pg.Close()

	valkey, err := db.NewValkey(cfg.ValkeyURL)
	if err != nil {
		log.Fatalf("valkey: %v", err)
	}
	defer valkey.Close()

	// Seed initial admin from env if none exist.
	if err := auth.SeedAdmin(ctx, pg, cfg.AdminUsername, cfg.AdminPassword); err != nil {
		log.Printf("admin seed warning: %v", err)
	}

	hub := ws.NewHub()

	app := fiber.New(fiber.Config{
		AppName: "gssr-game",
	})

	// Middleware
	app.Use(recover.New())
	app.Use(logger.New())
	app.Use(cors.New(cors.Config{
		AllowCredentials: true,
		AllowOrigins:     os.Getenv("CORS_ORIGINS"),
		AllowHeaders:     "Origin, Content-Type, Accept, Authorization, Cookie",
		AllowMethods:     "GET,POST,PUT,DELETE,PATCH,HEAD,OPTIONS",
	}))

	// Yandex API Gateway strips Content-Type before forwarding to origin.
	// All game service endpoints accept JSON only, so default to application/json.
	app.Use(func(c *fiber.Ctx) error {
		m := c.Method()
		if (m == fiber.MethodPost || m == fiber.MethodPut || m == fiber.MethodPatch) &&
			c.Get(fiber.HeaderContentType) == "" {
			c.Request().Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
		}
		return c.Next()
	})

	// Prometheus metrics
	prom := fiberprometheus.New("gssr_game")
	prom.RegisterAt(app, "/metrics")
	app.Use(prom.Middleware)

	// Swagger UI (local only)
	app.Get("/swagger/*", swagger.HandlerDefault)

	// Health
	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "ok"})
	})

	// Routes
	api := app.Group("/api")

	authHandler := auth.NewHandler(cfg, pg, valkey)
	authGroup := api.Group("/auth")
	authGroup.Post("/register", authHandler.Register)
	authGroup.Post("/login", authHandler.Login)
	authGroup.Post("/admin-login", authHandler.AdminLogin)
	authGroup.Get("/verify-email", authHandler.VerifyEmail)
	authGroup.Post("/refresh", authHandler.Refresh)
	authGroup.Post("/logout", auth.Required(cfg.JWTSecret), authHandler.Logout)

	// Users
	userHandler := user.NewHandler(pg)
	api.Get("/users/me", auth.Required(cfg.JWTSecret), userHandler.GetMe)

	// Maps (public)
	mapsHandler := maps.NewHandler(pg)
	api.Get("/maps", mapsHandler.List)
	api.Get("/maps/:id", mapsHandler.Get)

	// Rooms + game flow (all auth-required)
	roomStore := room.NewStore(valkey)
	roomHandler := room.NewHandler(cfg, pg, roomStore, hub)
	rooms := api.Group("/rooms", auth.Required(cfg.JWTSecret))
	rooms.Post("", roomHandler.Create)
	rooms.Get("/:id", roomHandler.Get)
	rooms.Post("/:id/join", roomHandler.Join)
	rooms.Delete("/:id/leave", roomHandler.Leave)
	rooms.Post("/:id/start", roomHandler.Start)
	rooms.Post("/:id/guess", roomHandler.Guess)
	rooms.Get("/:id/livekit-token", roomHandler.LiveKitToken)

	// Leaderboard + public profiles (public)
	lbHandler := leaderboard.NewHandler(pg)
	api.Get("/leaderboard", lbHandler.List)
	api.Get("/users/:id/profile", lbHandler.Profile)

	// Solo play (auth-required)
	soloHandler := solo.NewHandler(pg, valkey)
	soloGroup := api.Group("/solo", auth.Required(cfg.JWTSecret))
	soloGroup.Post("/start", soloHandler.Start)
	soloGroup.Get("/history", soloHandler.History)
	soloGroup.Get("/:id", soloHandler.GetSession)
	soloGroup.Post("/:id/guess", soloHandler.Guess)
	soloGroup.Get("/:id/result", soloHandler.Result)
	soloGroup.Post("/:id/abandon", soloHandler.Abandon)

	// WebSocket: run auth middleware first, then upgrade
	app.Use("/ws/rooms/:id", auth.Required(cfg.JWTSecret), func(c *fiber.Ctx) error {
		if fiberws.IsWebSocketUpgrade(c) {
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	})
	app.Get("/ws/rooms/:id", fiberws.New(roomHandler.WsRoom))

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-quit
		log.Println("shutting down...")
		if err := app.Shutdown(); err != nil {
			log.Printf("shutdown error: %v", err)
		}
	}()

	log.Printf("listening on :%s", cfg.Port)
	if err := app.Listen(":" + cfg.Port); err != nil {
		log.Fatalf("server: %v", err)
	}
}
