-- +goose Up
CREATE TYPE match_status AS ENUM ('waiting', 'active', 'finished');

CREATE TABLE matches (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id     VARCHAR(64) NOT NULL,
    map_id      UUID NOT NULL REFERENCES maps(id),
    status      match_status NOT NULL DEFAULT 'waiting',
    max_players INTEGER NOT NULL DEFAULT 10,
    rounds      INTEGER NOT NULL DEFAULT 5,
    time_limit  INTEGER NOT NULL DEFAULT 60,
    started_at  TIMESTAMPTZ,
    ended_at    TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_matches_room_id ON matches (room_id);
CREATE INDEX idx_matches_status ON matches (status);

-- +goose Down
DROP TABLE matches;
DROP TYPE match_status;
