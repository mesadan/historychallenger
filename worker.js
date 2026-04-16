export default {
  async fetch(request, env) {

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) return json({ error: 'API key not configured.' }, 500);

    let body;
    try { body = await request.json(); }
    catch { return json({ error: 'Invalid request.' }, 400); }

    const langNames = { en:'English', fr:'French', de:'German', es:'Spanish' };

    // ── ROUTE: translate ──────────────────────────────────────────────
    if (body.action === 'translate') {
      const { events, lang } = body;
      if (!events || !lang || lang === 'en') return json({ events }, 200);
      const outputLang = langNames[lang] || 'English';

      const prompt = `Translate the following historical event names and descriptions into ${outputLang}.
Keep the translation factually accurate and in the style of an encyclopaedia.
Do NOT change the year values.
Return ONLY valid JSON in exactly this format, no markdown:
{"events":[{"name":"...","year":0,"desc":"..."}]}

Events to translate:
${JSON.stringify(events)}`;

      try {
        const res = await callClaude(apiKey, prompt, 1000);
        const parsed = JSON.parse(res);
        return json({ events: parsed.events }, 200);
      } catch {
        return json({ events }, 200); // silent fallback to English
      }
    }

    // ── ROUTE: generate (theme or random) ────────────────────────────
    const { theme, diff, rounds, lang, random } = body;
    if (!diff) return json({ error: 'Missing difficulty.' }, 400);

    const outputLang = langNames[lang] || 'English';
    const needed = Math.min(rounds || 5, 10); // cap at 10 to avoid timeout

    let SYS, prompt;

    if (random) {
      // Random mode — AI picks the theme and era mix itself
      const randomRules = {
        disciple: `You are generating events for a history quiz at DISCIPLE level.
Rules for random mode:
- Choose ${needed} completely different historical themes or eras — one per set. Do not repeat themes across sets.
- Each set must span at least 3 distinct historical eras (ancient, medieval, early modern, modern, contemporary).
- Events should be famous, widely recognised milestones that anyone with basic education would know.
- Events within each set should be as far apart in time as possible to make spacing forgiving.
- No event should appear in more than one set.`,
        master: `You are generating events for a history quiz at MASTER level.
Rules for random mode:
- Choose ${needed} different historical themes or eras — one per set. Do not repeat themes.
- Each set: 3 events from one era or topic, 2 outlier events from very different periods.
- Events should require real historical knowledge beyond just headlines.
- No event should appear in more than one set.`,
        keeper: `You are generating events for a history quiz at KEEPER OF TIME level.
Rules for random mode:
- Choose ${needed} different tight historical periods — one per set. Do not repeat periods.
- Each set: all 5 events within the same era, campaign, or conflict. Events may be years or months apart.
- Events should be specific and require expert knowledge.
- No event should appear in more than one set.`
      };

      SYS = `You are a historical fact database modelled on the Encyclopaedia Britannica.
${randomRules[diff] || randomRules.disciple}

For all events:
1. Every event must be real and verifiable with a confirmed year. BC = negative integer.
2. Event names: 4-8 words, Britannica article title style.
3. Descriptions: one declarative sentence, past tense, factually grounded.
4. Write all event names and descriptions in ${outputLang}.`;

      prompt = `Generate ${needed} sets of exactly 5 historical events for a history quiz game.
Each set must have a different theme or era. No event may appear in more than one set.

Return ONLY valid JSON, no markdown:
{"sets":[[{"name":"Event name","year":1234,"desc":"One factual sentence."}]]}`;

    } else {
      // Theme mode — focus on the chosen theme
      if (!theme) return json({ error: 'Missing theme.' }, 400);

      const themeRules = {
        disciple: `Select the most famous, universally recognised events within this theme. Events should be as spread out in time as possible within the theme.`,
        master: `Select notable but non-obvious events requiring real knowledge beyond headlines. Moderate time gaps between events.`,
        keeper: `Select specific, obscure events close together in time — same decade, campaign, or year. Expert knowledge required.`
      };

      SYS = `You are a historical fact database modelled on the Encyclopaedia Britannica, with a content moderation role.

First, evaluate whether the requested theme is suitable for a history quiz game. Reject it if it is:
- Offensive, rude, or inappropriate
- Not a real historical topic (fictional, nonsensical, or absurd)
- So hyper-specific that 5 distinct verifiable events cannot be found
- A living person or very recent event (post-2000)

If unsuitable, return exactly: {"error":"<friendly explanation in ${outputLang}, one sentence>"}

If suitable:
1. Every event must be real and verifiable with a confirmed year. BC = negative integer.
2. THEME FIDELITY — every event must be directly about the requested theme. Zero exceptions.
3. Event names: 4-8 words, Britannica article title style.
4. Descriptions: one declarative sentence, past tense, factually grounded.
5. Do not repeat events across sets.
6. Vary event types within each set.
7. Write all event names and descriptions in ${outputLang}.
8. ${themeRules[diff] || themeRules.disciple}`;

      prompt = `Generate ${needed} sets of exactly 5 historical events, ALL specifically about: "${theme}".

DIFFICULTY: ${diff.toUpperCase()}
OUTPUT LANGUAGE: ${outputLang}

Return ONLY valid JSON, no markdown:
{"sets":[[{"name":"Event name","year":1234,"desc":"One factual sentence."}]]}`;
    }

    try {
      const raw = await callClaude(apiKey, prompt, 8000, SYS);
      const parsed = JSON.parse(raw);
      if (parsed.error) return json({ error: parsed.error }, 422);
      return json(parsed, 200);
    } catch (err) {
      return json({ error: 'Generation failed: ' + err.message }, 500);
    }
  }
};

async function callClaude(apiKey, prompt, maxTokens, system) {
  const messages = [{ role: 'user', content: prompt }];
  const body = { model: 'claude-sonnet-4-5', max_tokens: maxTokens, messages };
  if (system) body.system = system;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  if (data.error || !data.content) {
    throw new Error(data.error?.message || 'API error');
  }
  const raw = data.content.map(b => b.text || '').join('');
  return raw.replace(/```json|```/g, '').trim();
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
