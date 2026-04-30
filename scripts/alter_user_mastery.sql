-- Per-game-per-difficulty mastery tracking for the new dual-track
-- progression system (XP + Mastery).
--
-- One row per (user, game, difficulty). Points accumulate over time.
-- Used by the worker to gate higher difficulties (Master needs 500
-- Disciple mastery in same game; Keeper needs 500 Master mastery).
--
-- Games that contribute mastery:
--   timeline, overlap, paintings, dialogue
-- Games that do NOT (XP only, no skill ladder):
--   dispatch, persona
-- Games tracked separately:
--   hq (uses hq_score on users table; not in this table)
--
-- Idempotent: IF NOT EXISTS so safe to re-run.

CREATE TABLE IF NOT EXISTS user_mastery (
  user_id          TEXT NOT NULL,
  game_type        TEXT NOT NULL,
  diff_key         TEXT NOT NULL,
  points           INTEGER DEFAULT 0,
  last_session_at  INTEGER,
  PRIMARY KEY (user_id, game_type, diff_key)
);

CREATE INDEX IF NOT EXISTS idx_user_mastery_user
  ON user_mastery(user_id);
