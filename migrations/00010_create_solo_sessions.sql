-- +goose Up
-- +goose StatementBegin
CREATE TYPE solo_status AS ENUM ('active', 'finished', 'abandoned');

CREATE TABLE solo_sessions (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    map_id        UUID NOT NULL REFERENCES maps(id),
    difficulty    VARCHAR(32) NOT NULL DEFAULT 'normal',
    status        solo_status NOT NULL DEFAULT 'active',
    rounds        INTEGER NOT NULL DEFAULT 5,
    pano_ids      UUID[] NOT NULL,
    current_round INTEGER NOT NULL DEFAULT 1,
    total_score   INTEGER NOT NULL DEFAULT 0,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at      TIMESTAMPTZ
);
CREATE INDEX idx_solo_sessions_user ON solo_sessions(user_id);
CREATE INDEX idx_solo_sessions_status ON solo_sessions(status);

CREATE TABLE solo_guesses (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id     UUID NOT NULL REFERENCES solo_sessions(id) ON DELETE CASCADE,
    panorama_id    UUID NOT NULL REFERENCES panoramas(id),
    round          INTEGER NOT NULL,
    guess_x        FLOAT,
    guess_y        FLOAT,
    guess_floor_id UUID REFERENCES floors(id),
    score          INTEGER NOT NULL DEFAULT 0,
    distance       FLOAT,
    time_taken_sec INTEGER,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (session_id, round)
);
CREATE INDEX idx_solo_guesses_session ON solo_guesses(session_id);
CREATE INDEX idx_solo_guesses_pano ON solo_guesses(panorama_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS solo_guesses;
DROP TABLE IF EXISTS solo_sessions;
DROP TYPE IF EXISTS solo_status;
-- +goose StatementEnd
