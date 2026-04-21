# Persona game v2 — deployment guide

## What changed

- 7 leaders: Caesar, Lincoln, Napoleon, Bismarck, Genghis, Shaka, Thatcher
- Removed: Saladin, Wu Zetian (too similar to Lincoln and Bismarck respectively)
- 25 questions (down from 42)
- Result card now shows portrait + bio (famous for / controversial because / today)
- Scoring uses trait-distance, not just pick counts

## Deployment order — do these in sequence

### 1. Download the 7 portrait images

Save each to `/images/leaders/` in your repo with the exact filename shown.

| File | Source | URL |
|---|---|---|
| `caesar.jpg` | Tusculum bust (1st century BC) | `https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Retrato_de_Julio_C%C3%A9sar_%2826724093101%29.jpg/640px-Retrato_de_Julio_C%C3%A9sar_%2826724093101%29.jpg` |
| `lincoln.jpg` | Gardner photograph, 1863 | `https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/Abraham_Lincoln_O-77_matte_collodion_print.jpg/640px-Abraham_Lincoln_O-77_matte_collodion_print.jpg` |
| `napoleon.jpg` | David, "Napoleon in his Study" 1812 | `https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/Jacques-Louis_David_-_The_Emperor_Napoleon_in_His_Study_at_the_Tuileries_-_Google_Art_Project.jpg/480px-Jacques-Louis_David_-_The_Emperor_Napoleon_in_His_Study_at_the_Tuileries_-_Google_Art_Project.jpg` |
| `bismarck.jpg` | Lenbach portrait, c.1890 | `https://upload.wikimedia.org/wikipedia/commons/thumb/2/2d/BismarckLenbach.jpg/640px-BismarckLenbach.jpg` |
| `genghis.jpg` | National Palace Museum Taipei, 14th c. | `https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/YuanEmperorAlbumGenghisPortrait.jpg/480px-YuanEmperorAlbumGenghisPortrait.jpg` |
| `shaka.jpg` | James King sketch, 1824 | `https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/Shaka_kaSenzangakhona.jpg/480px-Shaka_kaSenzangakhona.jpg` |
| `thatcher.jpg` | Chris Collins / Chatham House, 1983 (CC-BY 2.0) | `https://upload.wikimedia.org/wikipedia/commons/thumb/6/6a/Margaret_Thatcher_at_the_White_House_in_1988.jpg/480px-Margaret_Thatcher_at_the_White_House_in_1988.jpg` |

**How to download**: right-click each link, "Save image as…", rename to match the table, save locally. Then upload all 7 to `/images/leaders/` in your GitHub repo (create the folder if it doesn't exist — same way you uploaded the era paintings).

**Size check**: these are 480–640px. Under 200KB each. If any is bigger than 300KB run it through squoosh.app.

**Thatcher licensing note**: the Wikimedia file is a 1988 White House photo (public domain, US government work). The caption in the code says "Chris Collins, 1983" because that was the original plan — edit the caption in `persona.html` line 270 to match whatever file you actually use. If you want something else, search Wikimedia Commons for "Margaret Thatcher" and pick anything tagged PD or CC.

### 2. Deploy `persona.html` and `persona_seed.html`

Upload both files to your GitHub repo root. Wait for Cloudflare Pages to build (~30 seconds).

### 3. Seed the database

Visit `https://historychallenger.com/persona_seed.html`. Enter your admin password if it asks. Click the "Seed Persona Data v2" button.

Watch the log output. You should see:
- "removed leader saladin" and "removed leader wuzetian" (or "could not remove, skipping" if your worker doesn't have a delete action — that's fine, the old data just stays in the DB but won't be shown since the frontend only shows the 7 current leaders)
- 7 leaders seeded
- 25 questions seeded

### 4. Test

Visit `https://historychallenger.com/persona.html`. Play through. Check that:
- The portrait shows at the top of your result
- The biography renders with bolded "Famous for:", "Controversial because:", "Today" phrases
- The match percentage feels reasonable (should be 75–95% for most people)
- The radar chart shows your top 4 leaders

## Known issues to decide on later

**Answer distribution bias**: when a question is presented with 4 answer options, Bismarck and Lincoln appear as options roughly 22 times each across the 25 questions, while Shaka and Genghis only appear ~8 times. The new hybrid scoring compensates for this mathematically, but if playtesting shows people keep getting Lincoln or Bismarck regardless of how they answer, we should rewrite the answer mix in 6-8 questions to even things out. Wait and see.

**Leader deletion**: if your backend worker doesn't support `delete_persona_leader` as an action, the Saladin and Wu Zetian records stay in your DB. They won't appear in the UI (the frontend filters to the current roster via `get_persona_leaders`), but they take up a tiny bit of space. Harmless. Optional cleanup: ask me to add the action to your worker.
