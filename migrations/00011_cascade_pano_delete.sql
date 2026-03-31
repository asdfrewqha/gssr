-- +goose Up
-- +goose StatementBegin
ALTER TABLE solo_guesses
    DROP CONSTRAINT solo_guesses_panorama_id_fkey,
    ADD  CONSTRAINT solo_guesses_panorama_id_fkey
         FOREIGN KEY (panorama_id) REFERENCES panoramas(id) ON DELETE CASCADE;

ALTER TABLE guesses
    DROP CONSTRAINT guesses_panorama_id_fkey,
    ADD  CONSTRAINT guesses_panorama_id_fkey
         FOREIGN KEY (panorama_id) REFERENCES panoramas(id) ON DELETE CASCADE;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE solo_guesses
    DROP CONSTRAINT solo_guesses_panorama_id_fkey,
    ADD  CONSTRAINT solo_guesses_panorama_id_fkey
         FOREIGN KEY (panorama_id) REFERENCES panoramas(id);

ALTER TABLE guesses
    DROP CONSTRAINT guesses_panorama_id_fkey,
    ADD  CONSTRAINT guesses_panorama_id_fkey
         FOREIGN KEY (panorama_id) REFERENCES panoramas(id);
-- +goose StatementEnd
