-- +goose Up
-- +goose StatementBegin
CREATE TABLE admins (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username      VARCHAR(32) UNIQUE NOT NULL,
    password_hash VARCHAR(72) NOT NULL,
    email         VARCHAR(255) UNIQUE,
    created_by    UUID REFERENCES admins(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS admins;
-- +goose StatementEnd
