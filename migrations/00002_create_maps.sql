-- +goose Up
CREATE TABLE maps (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(128) NOT NULL,
    description TEXT,
    x_min       FLOAT NOT NULL DEFAULT 0,
    x_max       FLOAT NOT NULL,
    y_min       FLOAT NOT NULL DEFAULT 0,
    y_max       FLOAT NOT NULL,
    coord_type  VARCHAR(32) NOT NULL DEFAULT 'pixels',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- +goose Down
DROP TABLE maps;
