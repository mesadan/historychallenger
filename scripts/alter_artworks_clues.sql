-- Add 3 new clue columns to artworks for the rebuilt clue system.
--
-- Replaces the old "Creation year" + (later) "Era depicted" clues with
-- three richer, vaguer-by-design clues curated by Claude in a single
-- text-only backfill pass:
--
--   time_clue        free-text time framing tuned per painting
--                    (e.g. "5th century BC", "Late medieval Europe",
--                     "1450 to 1500 AD", "Bronze Age")
--   culture_clue     vague cultural pointer that may list several
--                    cultures, never names the answer
--                    (e.g. "Mediterranean classical world",
--                     "Western European, 14th–17th century")
--   depicted_region  broad geographic region
--                    (e.g. "Mediterranean", "East Asia", "Western
--                     Europe", "Middle East", "Sub-Saharan Africa",
--                     "Americas", "South Asia", "Central Asia")
--
-- Safe to run on the existing D1 database. D1's ALTER does NOT support
-- IF NOT EXISTS, so run each ADD COLUMN exactly once. If you re-run by
-- accident you'll get a "duplicate column name" error which is harmless.

ALTER TABLE artworks ADD COLUMN time_clue TEXT;
ALTER TABLE artworks ADD COLUMN culture_clue TEXT;
ALTER TABLE artworks ADD COLUMN depicted_region TEXT;
