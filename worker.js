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
    if (!apiKey) {
      return json({ error: 'API key not configured on the server.' }, 500);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid request.' }, 400);
    }

    const { theme, diff, rounds, lang } = body;
    if (!theme || !diff) {
      return json({ error: 'Missing theme or difficulty.' }, 400);
    }

    const langNames = { en: 'English', fr: 'French', de: 'German', es: 'Spanish' };
    const outputLang = langNames[lang] || 'English';

    const SYS = `You are a historical fact database modelled on the Encyclopaedia Britannica, with a content moderation role.

First, evaluate whether the requested theme is suitable for a history quiz game. Reject it if it is:
- Offensive, rude, or inappropriate
- Not a real historical topic (fictional, nonsensical, or absurd)
- So hyper-specific that 5 distinct verifiable events cannot be found
- A living person or very recent event (post-2000)

If the theme is unsuitable, return exactly: {"error":"<friendly explanation in ${outputLang}, one sentence, suggest an alternative if possible>"}

If suitable, generate the events with these rules:
1. Every event must be real and verifiable with a confirmed year. BC = negative integer.
2. THEME FIDELITY - every event must be directly and specifically about the requested theme. Zero exceptions.
3. Event names: 4-8 words, Britannica article title style.
4. Descriptions: one declarative sentence, past tense, factually grounded.
5. Do not repeat events across sets.
6. Vary event types within each set.
7. LANGUAGE: Write all event names and descriptions in ${outputLang}.`;

    const specMap = {
      easy: 'Most famous, universally recognised events - introductory textbook level.',
      intermediate: 'Notable events requiring real knowledge - beyond headlines, but mainstream.',
      hard: 'Specific events requiring deep period knowledge - secondary battles, precise treaties.',
      grandmaster: 'Archival-level - edicts, minor sieges, court decisions that specialists debate.',
      preschooler: 'Most famous, universally recognised events - introductory textbook level.',
      student: 'Notable events requiring real knowledge - beyond headlines, but mainstream.',
      scholar: 'Specific events requiring deep period knowledge - secondary battles, precise treaties.',
    };

    const spanMap = {
      easy: 'Events must span many centuries - minimum 200 years between any two.',
      intermediate: 'Each set spans several decades to a century. No two events in the same year.',
      hard: 'Each set spans 5-30 years total. Year precision matters greatly.',
      grandmaster: 'Sets may span just a few years or the same year. Exact years are critical.',
      preschooler: 'Events must span many centuries - minimum 200 years between any two.',
      student: 'Each set spans several decades to a century. No two events in the same year.',
      scholar: 'Each set spans 5-30 years total. Year precision matters greatly.',
    };

    const needed = Math.min(rounds || 5, 8);
    const prompt = `Generate ${needed} sets of exactly 5 historical events, ALL specifically about: "${theme}".

Every event must be directly about "${theme}" - not the broader era, not related conflicts, not background context.

DIFFICULTY: ${diff.toUpperCase()}
Specificity: ${specMap[diff] || specMap.student}
Time span: ${spanMap[diff] || spanMap.student}

OUTPUT LANGUAGE: Write event names and descriptions in ${outputLang}.

Return ONLY valid JSON, no markdown:
{"sets":[[{"name":"Event name","year":1234,"desc":"One factual sentence."}]]}`;

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 3000,
          system: SYS,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      const data = await res.json();

      if (data.error || !data.content) {
        const msg = data.error?.message || JSON.stringify(data);
        return json({ error: 'API error: ' + msg }, 500);
      }

      const raw = data.content.map(b => b.text || '').join('');
      const clean = raw.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);

      if (parsed.error) {
        return json({ error: parsed.error }, 422);
      }

      return json(parsed, 200);

    } catch (err) {
      return json({ error: 'Generation failed: ' + err.message }, 500);
    }
  }
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    }
  });
}
