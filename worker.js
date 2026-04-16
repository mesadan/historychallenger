export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }});
    }
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) return json({ error: 'API key not configured.' }, 500);

    let body;
    try { body = await request.json(); }
    catch { return json({ error: 'Invalid request.' }, 400); }

    const langNames = { en:'English', fr:'French', de:'German', es:'Spanish' };

    // ── TRANSLATE ─────────────────────────────────────────────────────
    if (body.action === 'translate') {
      const { events, lang } = body;
      if (!events || !lang || lang === 'en') return json({ events }, 200);
      const outputLang = langNames[lang] || 'English';
      const prompt = `Translate the following historical event names and descriptions into ${outputLang}.
Keep translations factually accurate and encyclopaedic. Do NOT change year values.
Return ONLY valid JSON, no markdown: {"events":[{"name":"...","year":0,"desc":"..."}]}
Events: ${JSON.stringify(events)}`;
      try {
        const raw = await callClaude(apiKey, prompt, 1000);
        return json({ events: JSON.parse(raw).events }, 200);
      } catch { return json({ events }, 200); }
    }

    // ── GENERATE ──────────────────────────────────────────────────────
    const { theme, diff, rounds, lang, random, excluded, eraGeos } = body;
    if (!diff) return json({ error: 'Missing difficulty.' }, 400);

    const outputLang = langNames[lang] || 'English';
    const needed = Math.min(rounds || 5, 10);

    // Build exclusion instruction
    const exclusionNote = excluded && excluded.length > 0
      ? `\n\nEXCLUDED EVENTS — do NOT use any of these (the player has already seen them):\n${excluded.map(e=>`- ${e}`).join('\n')}`
      : '';

    // Difficulty flavour
    const diffFlavour = {
      disciple: 'Events should be widely spaced in time and from different sub-periods within the era. Choose events that are genuinely famous within that era, but not necessarily globally famous.',
      master: 'Mix 3 events from one tight period with 2 from very different times. Events should require real knowledge beyond casual reading.',
      keeper: 'All 5 events from the same tight period — same war, same reign, same decade. Events may be separated by months. Specialist knowledge required.'
    }[diff] || '';

    let SYS, prompt;

    if (random) {
      // Build per-set era/geo instructions
      const setInstructions = (eraGeos && eraGeos.length > 0)
        ? eraGeos.map((eg, i) => `Set ${i+1}: Era = "${eg.era}", Region/Focus = "${eg.geo}"`).join('\n')
        : `Generate ${needed} sets each from a completely different era and region.`;

      SYS = `You are a specialist historian and curator for a history quiz game. Your job is to produce VARIED, SURPRISING, and DEEPLY RESEARCHED historical events.

CORE RULES:
1. Every event must be real, verifiable, and have a confirmed year. BC years = negative integers.
2. Event names: 4-8 words, Britannica title style.
3. Descriptions: one declarative sentence, past tense, factually precise.
4. All content in ${outputLang}.
5. No event appears in more than one set.
${exclusionNote}

VARIETY IS ESSENTIAL:
- You have access to ALL of human history across ALL civilisations. Use it.
- Do NOT default to the 50 most famous events. Dig deeper into each era.
- Within each assigned era/region, choose events that a SPECIALIST would find interesting, not just what appears on a Wikipedia summary page.
- Include a mix of: battles, political decisions, cultural achievements, scientific discoveries, natural disasters, trade events, religious moments, dynastic changes.
- Actively avoid: French Revolution, WW1 beginning, Moon landing, Fall of Rome, Columbus, Magna Carta, American Declaration of Independence — unless specifically assigned to a set where they fit and haven't been excluded.

DIFFICULTY: ${diff.toUpperCase()} — ${diffFlavour}`;

      prompt = `Generate ${needed} sets of exactly 5 historical events. Each set is assigned a specific era and region — stay within it.

ASSIGNMENTS:
${setInstructions}

Return ONLY valid JSON, no markdown:
{"sets":[[{"name":"Event name","year":1234,"desc":"One precise sentence."}]]}`;

    } else {
      // Theme mode
      if (!theme) return json({ error: 'Missing theme.' }, 400);

      const themeDepth = {
        disciple: 'Choose the most iconic events within this theme — but go beyond the absolute top 3. Find events that capture the full arc of the theme, spread across its timeline.',
        master: 'Choose notable but non-obvious events. Avoid the events that appear in the first paragraph of Wikipedia. Require real knowledge.',
        keeper: 'Choose specific, obscure events that only a dedicated student of this theme would know. Pack them as close together in time as possible.'
      }[diff] || '';

      SYS = `You are a specialist historian and curator for a history quiz game.

CONTENT MODERATION: First check if the theme is suitable. Reject if: offensive, fictional, too vague to find 5 events, a living person, or post-2000.
If unsuitable: {"error":"<explanation in ${outputLang}>"}

If suitable, follow ALL these rules:
1. Every event directly and specifically about "${theme}". No tangents.
2. Real, verifiable, confirmed year. BC = negative integer.
3. Event names: 4-8 words, Britannica title style.
4. Descriptions: one declarative sentence, past tense, precise.
5. All content in ${outputLang}.
6. No event repeated across sets.
7. Vary event types: battles, treaties, political acts, discoveries, births/deaths of key figures.
${exclusionNote}

DEPTH RULE — ${themeDepth}

VARIETY: Within this theme, explore different sub-periods, different actors, different types of events. Do not cluster everything around the 2-3 most famous moments.`;

      prompt = `Generate ${needed} sets of exactly 5 historical events, ALL about: "${theme}".
DIFFICULTY: ${diff.toUpperCase()}

Return ONLY valid JSON, no markdown:
{"sets":[[{"name":"Event name","year":1234,"desc":"One precise sentence."}]]}`;
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
  const body = {
    model: 'claude-sonnet-4-5',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }]
  };
  if (system) body.system = system;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (data.error || !data.content) throw new Error(data.error?.message || 'API error');
  return data.content.map(b => b.text || '').join('').replace(/```json|```/g, '').trim();
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
