-- +goose Up
-- +goose StatementBegin
ALTER TABLE solo_sessions
    DROP CONSTRAINT solo_sessions_map_id_fkey,
    ADD CONSTRAINT solo_sessions_map_id_fkey
        FOREIGN KEY (map_id) REFERENCES maps(id) ON DELETE CASCADE;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE solo_sessions
    DROP CONSTRAINT solo_sessions_map_id_fkey,
    ADD CONSTRAINT solo_sessions_map_id_fkey
        FOREIGN KEY (map_id) REFERENCES maps(id);
-- +goose StatementEnd
