export async function onRequestPost(context) {
  const { request, env } = context;

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  const { theme, diff, rounds } = body;
  if (!theme || !diff) {
    return new Response(JSON.stringify({ error: 'Missing theme or diff' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  const SYS = `You are a historical fact database modelled on the Encyclopaedia Britannica, with a content moderation role.

First, evaluate whether the requested theme is suitable for a history quiz game. Reject it if it is:
- Offensive, rude, or inappropriate
- Not a real historical topic (fictional, nonsensical, or absurd)
- So hyper-specific that 5 distinct verifiable events cannot be found (e.g. "my grandfather's village in 1943")
- A living person or very recent event (post-2000)

If the theme is unsuitable, return exactly: {"error":"<friendly explanation of why, one sentence, suggest an alternative if possible>"}

If the theme is suitable, generate the events with these rules:
1. Every event must be a real, verifiable occurrence with a confirmed year. BC = negative integer.
2. THEME FIDELITY — every single event must be directly and specifically about the requested theme. Zero exceptions.
3. Event names: 4-8 words, Britannica article title style. No vague names.
4. Descriptions: exactly one declarative sentence, past tense, factually grounded.
5. Do not repeat events across sets.
6. Vary event types within each set (battles, treaties, political acts, deaths, discoveries).`;

  const specMap = {
    easy: 'Most famous, universally recognised events — introductory textbook level.',
    intermediate: 'Notable events requiring real knowledge — beyond headlines, but mainstream.',
    hard: 'Specific events requiring deep period knowledge — secondary battles, precise treaties, succession crises.',
    historian: 'Archival-level — edicts, minor sieges, court decisions, dates specialists debate.'
  };

  const spanMap = {
    easy: 'Events in each set must span many centuries — minimum 200 years between any two.',
    intermediate: 'Each set spans several decades to a century. No two events in the same year.',
    hard: 'Each set spans 5-30 years total. Year precision matters greatly.',
    historian: 'Sets may span just a few years or even the same year. Exact years are critical.'
  };

  const needed = Math.min(rounds || 5, 8);

  const prompt = `Generate ${needed} sets of exactly 5 historical events, ALL specifically about: "${theme}".

Every event must be directly about "${theme}" — not the broader era, not related conflicts, not background context. The theme is the subject of every single event.

DIFFICULTY: ${diff.toUpperCase()}
Specificity: ${specMap[diff] || specMap.intermediate}
Time span: ${spanMap[diff] || spanMap.intermediate}

Return ONLY valid JSON, no markdown, no explanation:
{"sets":[[{"name":"Event name","year":1234,"desc":"One factual sentence."}]]}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        system: SYS,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    const raw = data.content.map(b => b.text || '').join('');
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    // If Claude returned an error (bad theme), pass it through to the client
    if (parsed.error) {
      return new Response(JSON.stringify({ error: parsed.error }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
