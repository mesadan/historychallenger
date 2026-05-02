-- Per-user opt-out from public leaderboards.
-- Default 1 (visible) so existing accounts stay where they are.
-- A user toggles this off via the profile page; get_leaderboard
-- filters them out regardless of XP / mastery.
--
-- D1 ALTER doesn't support IF NOT EXISTS; run once. A re-run gives
-- "duplicate column name" which is harmless to ignore.

ALTER TABLE users ADD COLUMN leaderboard_visible INTEGER DEFAULT 1;
