package config

import (
	"os"
	"time"
)

type Config struct {
	Port          string
	PostgresURL   string
	ValkeyURL      string
	JWTSecret      []byte
	JWTAccessTTL   time.Duration
	JWTRefreshTTL  time.Duration
	LiveKitURL     string
	LiveKitAPIKey  string
	LiveKitSecret  string
	WorkersURL     string
}

func Load() *Config {
	accessTTL, _ := time.ParseDuration(getEnv("JWT_ACCESS_TTL", "15m"))
	refreshTTL, _ := time.ParseDuration(getEnv("JWT_REFRESH_TTL", "168h"))

	return &Config{
		Port:        getEnv("PORT", "3000"),
		PostgresURL: mustEnv("POSTGRES_URL"),
		ValkeyURL:     mustEnv("VALKEY_URL"),
		JWTSecret:     []byte(mustEnv("JWT_SECRET")),
		JWTAccessTTL:  accessTTL,
		JWTRefreshTTL: refreshTTL,
		LiveKitURL:    getEnv("LIVEKIT_URL", ""),
		LiveKitAPIKey: getEnv("LIVEKIT_API_KEY", ""),
		LiveKitSecret: getEnv("LIVEKIT_API_SECRET", ""),
		WorkersURL:    getEnv("WORKERS_URL", "http://workers:8000"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func mustEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		panic("required env var not set: " + key)
	}
	return v
}
