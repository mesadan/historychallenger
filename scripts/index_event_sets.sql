-- Composite index speeds up the Timeline game's set selection.
-- Without this, every "get sets" call scans event_sets to apply
-- WHERE diff=? AND lang=? AND theme_slug=?. With it, SQLite jumps
-- straight to the matching slice via the index.
--
-- Combined with the worker's two-query refactor (commit pulling this
-- file in), Timeline session load drops from ~1-2s to ~150-300ms
-- on a pool of 1000+ rows per (diff × theme).
--
-- Idempotent: IF NOT EXISTS — safe to re-run.

CREATE INDEX IF NOT EXISTS idx_event_sets_filter
  ON event_sets(diff, lang, theme_slug);
