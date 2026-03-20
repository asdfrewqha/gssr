-- +goose Up
CREATE TYPE tile_status AS ENUM ('pending', 'tiling', 'tiled', 'failed');
CREATE TYPE moderation_status AS ENUM ('pending', 'clean', 'flagged', 'rejected');

CREATE TABLE panoramas (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    floor_id          UUID NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
    x                 FLOAT NOT NULL,
    y                 FLOAT NOT NULL,
    north_offset      FLOAT NOT NULL DEFAULT 0,
    tile_status       tile_status NOT NULL DEFAULT 'pending',
    moderation_status moderation_status NOT NULL DEFAULT 'pending',
    nsfw_score        FLOAT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_panoramas_floor_id ON panoramas (floor_id);
CREATE INDEX idx_panoramas_tile_status ON panoramas (tile_status);
CREATE INDEX idx_panoramas_moderation ON panoramas (moderation_status);

-- +goose Down
DROP TABLE panoramas;
DROP TYPE tile_status;
DROP TYPE moderation_status;
