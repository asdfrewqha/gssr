-- +goose Up
-- +goose StatementBegin
ALTER TABLE panoramas
    ADD COLUMN haov          FLOAT       NOT NULL DEFAULT 360.0,
    ADD COLUMN vaov          FLOAT       NOT NULL DEFAULT 180.0,
    ADD COLUMN voffset       FLOAT       NOT NULL DEFAULT 0.0,
    ADD COLUMN source_format VARCHAR(32) NOT NULL DEFAULT 'equirectangular';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE panoramas
    DROP COLUMN haov,
    DROP COLUMN vaov,
    DROP COLUMN voffset,
    DROP COLUMN source_format;
-- +goose StatementEnd
