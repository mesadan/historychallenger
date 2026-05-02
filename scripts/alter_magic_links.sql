-- Magic link auth: short-lived, single-use sign-in tokens emailed to the
-- player. Used as the second auth path alongside the existing Google OAuth.
--
-- Each row represents one sent link. The token is the URL-safe random ID
-- the player clicks. Lookups are by token (PK). expires_at and used_at
-- enforce the safety rules:
--   token must not have been used before    used_at IS NULL
--   token must not have expired              expires_at > now
--
-- We keep used and expired rows around for a while (debug + auditing)
-- and prune them periodically with a separate housekeeping query.
--
-- Rate limit (3 requests per email per hour) is enforced at request time
-- by counting created_at >= now-3600 rows for the same email.
--
-- Idempotent: IF NOT EXISTS so safe to re-run.

CREATE TABLE IF NOT EXISTS magic_links (
  token       TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_magic_links_email   ON magic_links(email);
CREATE INDEX IF NOT EXISTS idx_magic_links_expires ON magic_links(expires_at);
