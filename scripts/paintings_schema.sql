-- Painting ID game: D1 schema
-- Paste into Cloudflare D1 Console (Workers & Pages → D1 → your database → Console)

-- ── Library of artworks ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS artworks (
  id              TEXT PRIMARY KEY,
  source          TEXT,
  source_id       TEXT,
  image_key       TEXT,        -- R2 key, e.g. 'images/met-12345.jpg'
  thumb_key       TEXT,
  title           TEXT,
  artist          TEXT,
  creation_year   INTEGER,     -- when the artwork was made
  depicted_era    TEXT,        -- 'ancient' | 'medieval' | 'modern'
  scene           TEXT,        -- short label, the correct MC answer
  scene_long      TEXT,        -- one-sentence reveal factoid
  distractors     TEXT,        -- JSON array of 3 wrong-answer scene labels
  medium          TEXT,        -- e.g. 'Oil on canvas', 'Marble'
  museum          TEXT,
  culture         TEXT,
  classification  TEXT,
  difficulty      INTEGER,     -- 1-5, set by Claude during curation
  source_url      TEXT,
  play_count      INTEGER DEFAULT 0,
  created_at      INTEGER DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_artworks_difficulty ON artworks(difficulty);
CREATE INDEX IF NOT EXISTS idx_artworks_era ON artworks(depicted_era);

-- ── Game sessions ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS painting_sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT,
  difficulty    TEXT,                   -- 'easy' | 'medium' | 'hard'
  round_num     INTEGER DEFAULT 0,
  artwork_ids   TEXT,                   -- JSON array of 5 artwork IDs (picked at start)
  answers       TEXT DEFAULT '[]',      -- JSON array: [{artwork_id, chosen, correct, clues_used}, ...]
  status        TEXT DEFAULT 'active',  -- 'active' | 'complete'
  started_at    INTEGER,
  completed_at  INTEGER,
  xp_earned     INTEGER DEFAULT 0,
  score         INTEGER DEFAULT 0       -- rounds answered correctly
);

CREATE INDEX IF NOT EXISTS idx_painting_sessions_user ON painting_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_painting_sessions_status ON painting_sessions(status);
