-- +goose Up
CREATE TABLE floors (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    map_id       UUID NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    floor_number INTEGER NOT NULL,
    label        VARCHAR(64),
    image_url    TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (map_id, floor_number)
);

CREATE INDEX idx_floors_map_id ON floors (map_id);

-- +goose Down
DROP TABLE floors;
