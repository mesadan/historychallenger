-- Hard reset for the new XP + Mastery system rollout.
-- Wipes all session history and resets user counters to zero,
-- but KEEPS users (Google identity, name, avatar, profile email).
--
-- Run AFTER:
--   scripts/alter_user_mastery.sql
-- and AFTER you've redeployed the new worker.js, so any in-flight
-- sessions complete cleanly under the old code first.
--
-- Apply once. The user agreed to a fresh start (no marketing yet,
-- no real player data to preserve).

-- 1. Wipe session history across all games
DELETE FROM game_sessions;
DELETE FROM hq_sessions;
DELETE FROM hq_seen_questions;
DELETE FROM dialogue_sessions;
DELETE FROM painting_sessions;
DELETE FROM dispatch_sessions;
DELETE FROM user_seen_sets;

-- 2. Wipe per-user mastery (in case partial data exists from this rollout)
DELETE FROM user_mastery;

-- 3. Reset all user counters but keep accounts
UPDATE users SET
  total_xp           = 0,
  total_games        = 0,
  total_rounds       = 0,
  avg_score          = NULL,
  best_score         = NULL,
  current_streak     = 0,
  longest_streak     = 0,
  last_streak_date   = NULL,
  last_played        = NULL,
  hq_score           = NULL,
  hq_taken_at        = NULL;
