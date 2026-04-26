-- Add attribution column to artworks table.
-- Required for CC-BY-licensed images from Wikimedia v3 onwards.
-- PD/CC0 items will have NULL attribution (no credit shown on the reveal card).
-- CC-BY items store "<author>, <license short name>" and the painting reveal
-- card displays it as "Image: <attribution>" in small italic text.
--
-- Safe to run on the existing D1 database. Idempotent IF NOT EXISTS not
-- supported by D1 ALTER, so run this exactly once. If you re-run by accident
-- you'll get a "duplicate column name" error which you can safely ignore.

ALTER TABLE artworks ADD COLUMN attribution TEXT;
