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
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	fiberprometheus "github.com/ansrivas/fiberprometheus/v2"
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
	sioadapter "github.com/zishang520/socket.io-go-redis/adapter"
	siotypes "github.com/zishang520/socket.io-go-redis/types"
	sio "github.com/zishang520/socket.io/v2/socket"
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

	// Socket.io server (runs on a separate port via net/http).
	// Fiber uses fasthttp which does not implement http.Hijacker, so socket.io
	// cannot share the Fiber listener; it gets its own net/http server on SocketPort.
	ioServer := sio.NewServer(nil, nil)

	// Valkey pub/sub adapter — makes socket.io broadcasts work across all nodes.
	// Each node publishes to Valkey; every other node receives and forwards to
	// its locally connected clients. Zynq nodes already connect to the main PC's
	// Valkey via ZYNQ_VALKEY_URL, so this works across the whole cluster.
	ioServer.SetAdapter(&sioadapter.RedisAdapterBuilder{
		Redis: siotypes.NewRedisClient(ctx, valkey.Client),
	})

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
	authGroup.Post("/admin-refresh", authHandler.AdminRefresh)
	authGroup.Post("/logout", auth.Required(cfg.JWTSecret), authHandler.Logout)

	// Users
	userHandler := user.NewHandler(pg)
	api.Get("/users/me", auth.Required(cfg.JWTSecret), userHandler.GetMe)
	// Admin-only identity endpoint — uses AdminRequired so admin_token wins over access_token
	// when both are present (i.e. user logged in as both player and admin simultaneously).
	api.Get("/admin/me", auth.AdminRequired(cfg.JWTSecret), userHandler.GetMe)

	// Maps (public)
	mapsHandler := maps.NewHandler(pg)
	api.Get("/maps", mapsHandler.List)
	api.Get("/maps/:id", mapsHandler.Get)

	// Rooms + game flow (all auth-required)
	roomStore := room.NewStore(valkey)
	roomHandler := room.NewHandler(cfg, pg, roomStore, ioServer)
	roomHandler.SetupSocketIO(cfg.JWTSecret)
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

	// Start socket.io on a dedicated net/http server (separate from Fiber/fasthttp).
	go func() {
		srv := &http.Server{
			Addr:              ":" + cfg.SocketPort,
			Handler:           ioServer.ServeHandler(nil),
			ReadHeaderTimeout: 10 * time.Second,
		}
		log.Printf("socket.io listening on :%s", cfg.SocketPort)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("socket.io server: %v", err)
		}
	}()

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
