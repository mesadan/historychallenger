# Painting library QC + re-curation runbook

The original 470-piece library was 82% objects/fragments and underweight on
narrative scenes. This runbook drops the bad ones and adds ~300 historical
scenes (battles, named figures, treaties, coronations).

## TL;DR

1. **Deploy the worker** (already committed): `wrangler deploy` from project root. This widens difficulty ranges and skips recently-seen artworks per user.
2. **Inspect what QC will drop**: open `paintings_data/qc_review.html` in a browser. Use the filter buttons to spot-check drops vs keeps.
3. **Run new historical curation** (~2 hours, ~$3 in Anthropic API):
   ```powershell
   $env:ANTHROPIC_API_KEY="sk-ant-..."
   & "C:\Program Files\nodejs\node.exe" scripts/curate_historical.mjs
   ```
4. **Combine manifests**:
   ```powershell
   & "C:\Program Files\nodejs\node.exe" scripts/combine_manifests.mjs
   ```
5. **Upload new images + generate seed SQL**:
   ```powershell
   $env:R2_ACCOUNT_ID="..."; $env:R2_ACCESS_KEY_ID="..."; $env:R2_SECRET_KEY="..."; $env:R2_BUCKET="paintings"
   $env:MANIFEST_FILE="manifest_combined.json"
   & "C:\Program Files\nodejs\node.exe" scripts/upload_paintings.mjs
   ```
6. **Apply changes in D1 console** (paintings_data/qc_drop.sql first, then scripts/artworks_seed.sql).

## Step-by-step

### 1. Deploy the worker
```powershell
wrangler deploy
```
This deploys the difficulty + repeat fix. It widens the medium pool from 14 to 99 artworks and skips artworks the user saw in their last 4 sessions.

### 2. Inspect QC drops
```powershell
& "C:\Program Files\nodejs\node.exe" scripts/qc_paintings.mjs
```
Already done — outputs:
- `paintings_data/qc_review.html` — open in browser, filter Keepers/Drops/Theme
- `paintings_data/qc_drop.sql` — DELETE statements for 387 items
- `paintings_data/manifest_clean.json` — 83 keepers (the rest will be replaced)
- `paintings_data/qc_report.json` — full per-id classification

If you disagree with any drops, edit `paintings_data/qc_drop.sql` directly to remove their IDs before pasting.

### 3. Curate ~300 historical scenes
```powershell
$env:ANTHROPIC_API_KEY="sk-ant-..."
& "C:\Program Files\nodejs\node.exe" scripts/curate_historical.mjs
```
Targets battles, sieges, named figures (Napoleon, Caesar, etc.), coronations, treaties. Stricter Claude prompt rejects objects/devotional. Saves to `paintings_data/manifest_historical.json` every 20 items so a crash doesn't lose progress.

Re-run safely: it skips IDs already in any manifest.

### 4. Combine
```powershell
& "C:\Program Files\nodejs\node.exe" scripts/combine_manifests.mjs
```
Merges clean + historical into `manifest_combined.json`. De-dupes by id.

### 5. Upload images + build seed SQL
```powershell
$env:R2_ACCOUNT_ID="..."; $env:R2_ACCESS_KEY_ID="..."
$env:R2_SECRET_KEY="..."; $env:R2_BUCKET="paintings"
$env:MANIFEST_FILE="manifest_combined.json"
& "C:\Program Files\nodejs\node.exe" scripts/upload_paintings.mjs
```
Set `$env:SKIP_R2="1"` to skip R2 uploads (e.g. if all images are already there and you only need the SQL regenerated).

Outputs `scripts/artworks_seed.sql` with INSERT OR REPLACE for every artwork in the combined manifest.

### 6. Apply in D1 console
1. Paste `paintings_data/qc_drop.sql` — drops 387 bad items.
2. Paste `scripts/artworks_seed.sql` — INSERT OR REPLACE keeps the 83 good ones (no-op for existing rows) and adds the new ~300 historical pieces.

Final library: ~380 pieces, mostly battles + historical events + named figures.

## Future: other museum APIs

When ready to expand beyond the Met, see the memory note `paintings_future_sources.md`. Top picks:
- **Louvre Collections API** — Egyptian, Persian, Mesopotamian
- **British Museum** — Mesopotamian, Egyptian, Greek antiquities
- **Wikimedia Commons** — famous battle paintings (Trumbull, David, Delaroche) not in the Met
