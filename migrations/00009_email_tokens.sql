-- +goose Up
-- +goose StatementBegin
CREATE TABLE email_verification_tokens (
    token      VARCHAR(64) PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    used       BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_email_tokens_user ON email_verification_tokens(user_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS email_verification_tokens;
-- +goose StatementEnd
