package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	fiberprometheus "github.com/ansrivas/fiberprometheus/v2"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/gssr/game/internal/auth"
	"github.com/gssr/game/internal/config"
	"github.com/gssr/game/internal/db"
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
	}))

	// Prometheus metrics
	prom := fiberprometheus.New("gssr_game")
	prom.RegisterAt(app, "/metrics")
	app.Use(prom.Middleware)

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
	authGroup.Post("/refresh", authHandler.Refresh)
	authGroup.Post("/logout", auth.Required(cfg.JWTSecret), authHandler.Logout)

	// TODO: wire remaining handlers (user, map, room, game, ws, livekit)
	_ = hub

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-quit
		log.Println("shutting down...")
		app.Shutdown()
	}()

	log.Printf("listening on :%s", cfg.Port)
	if err := app.Listen(":" + cfg.Port); err != nil {
		log.Fatalf("server: %v", err)
	}
}
