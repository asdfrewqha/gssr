-- +goose Up
CREATE TABLE guesses (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id     UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id),
    panorama_id  UUID NOT NULL REFERENCES panoramas(id),
    round        INTEGER NOT NULL,
    guess_x      FLOAT,
    guess_y      FLOAT,
    guess_floor_id UUID REFERENCES floors(id),
    score        INTEGER NOT NULL DEFAULT 0,
    distance     FLOAT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (match_id, user_id, round)
);

CREATE INDEX idx_guesses_match_id ON guesses (match_id);
CREATE INDEX idx_guesses_user_id ON guesses (user_id);

-- Analytics view: per-user match history
CREATE VIEW user_match_history AS
SELECT
    g.user_id,
    m.id AS match_id,
    m.map_id,
    m.ended_at,
    SUM(g.score) AS total_score,
    AVG(g.distance) AS avg_distance
FROM guesses g
JOIN matches m ON m.id = g.match_id
WHERE m.status = 'finished'
GROUP BY g.user_id, m.id, m.map_id, m.ended_at;

-- +goose Down
DROP VIEW user_match_history;
DROP TABLE guesses;
