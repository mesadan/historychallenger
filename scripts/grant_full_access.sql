-- Grant the project owner (maletethan@gmail.com) full access to every
-- difficulty on every mastery game by seeding 9999 mastery points per
-- (game, difficulty) cell. Way above the 500 unlock threshold, so every
-- difficulty appears unlocked from day one.
--
-- Run AFTER scripts/alter_user_mastery.sql and scripts/reset_progression.sql.
-- Idempotent: ON CONFLICT updates existing rows instead of failing.

INSERT INTO user_mastery (user_id, game_type, diff_key, points, last_session_at)
SELECT
  u.id,
  g.game_type,
  d.diff_key,
  9999,
  strftime('%s','now')
FROM users u
CROSS JOIN (
  SELECT 'timeline' AS game_type
  UNION ALL SELECT 'overlap'
  UNION ALL SELECT 'paintings'
  UNION ALL SELECT 'dialogue'
) g
CROSS JOIN (
  SELECT 'disciple' AS diff_key
  UNION ALL SELECT 'master'
  UNION ALL SELECT 'keeper'
) d
WHERE u.email = 'maletethan@gmail.com'
ON CONFLICT(user_id, game_type, diff_key) DO UPDATE SET points = 9999;
