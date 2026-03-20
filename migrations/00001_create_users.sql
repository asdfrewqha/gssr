-- +goose Up
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username      VARCHAR(32) UNIQUE NOT NULL,
    password_hash VARCHAR(72) NOT NULL,
    avatar_url    TEXT,
    elo           INTEGER NOT NULL DEFAULT 1000,
    banned        BOOLEAN NOT NULL DEFAULT FALSE,
    is_admin      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_username ON users (username);

-- +goose Down
DROP TABLE users;
