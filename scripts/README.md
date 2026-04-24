# History Challenger curation scripts

Offline tools that build content libraries before loading into R2 + D1.

## Painting curation (`curate_paintings.mjs`)

Builds a curated artwork library from the Metropolitan Museum Open Access collection. Uses Claude Vision to classify what each artwork depicts (not when it was made) and to generate multiple-choice distractors.

### Setup

Requires Node 18+ and an Anthropic API key.

```
cd scripts
npm install
```

### Run

Windows (CMD):
```
set ANTHROPIC_API_KEY=sk-ant-...
node curate_paintings.mjs
```

Windows (PowerShell):
```
$env:ANTHROPIC_API_KEY = "sk-ant-..."
node curate_paintings.mjs
```

Mac/Linux:
```
ANTHROPIC_API_KEY=sk-ant-... node curate_paintings.mjs
```

Runtime ~30-60 minutes. Progress logs every 10 items. Intermediate manifest saved every 50 acceptances so a crash is recoverable.

Outputs to `paintings_data/` at project root:
- `manifest.json` - metadata for each accepted artwork
- `images/met-{id}.jpg` - 1200px main images (~200KB each)
- `thumbs/met-{id}.jpg` - 400px thumbnails
- `review.html` - single-file browser page to spot-check by era

Target quotas: 200 Ancient, 120 Medieval, 180 Modern = 500 total.

### Cost

About $3 in Anthropic API spend (one Claude Vision call per candidate, ~1000 candidates).

### Review pass

Open `paintings_data/review.html` in a browser. Filter by era. Look for:
- Scenes that are too obscure or not quizzable
- Bad distractors
- Wrong era classification
- Difficulty ratings that feel off

Delete bad rows from `manifest.json` directly, then re-open `review.html` to confirm.

### Next steps (not done yet)

After you are happy with the manifest:
1. Upload `images/` and `thumbs/` to the R2 `paintings` bucket
2. Run `SQL INSERT` statements into a new D1 `artworks` table
3. Build the paintings game UI against this data
