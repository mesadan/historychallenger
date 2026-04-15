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

    const { theme, diff, rounds, lang } = body;
    if (!theme || !diff) return json({ error: 'Missing theme or difficulty.' }, 400);

    const langNames = { en:'English', fr:'French', de:'German', es:'Spanish' };
    const outputLang = langNames[lang] || 'English';

    const eraRules = {
      disciple: `ERA RULE — DISCIPLE: At least 3 of the 5 events MUST come from clearly distinct historical eras. Use at least 3 of these: Ancient (before 500 AD), Medieval (500-1400), Early Modern (1400-1700), Modern (1700-1900), Contemporary (1900-present). Events should span millennia where possible. Spacing tolerance is forgiving (±180 years).`,
      master: `ERA RULE — MASTER: Exactly 3 events must share the same historical era (e.g. all three from the Napoleonic period, or all three from medieval Europe). The other 2 events must come from entirely different eras — one much earlier, one much later. This creates a challenging mix of clustered and outlier events. Spacing tolerance is moderate (±60 years).`,
      keeper: `ERA RULE — KEEPER OF TIME: ALL 5 events must fall within the same tight historical era or period — for example all from the French Revolutionary Wars, all from the Roman Republic's final decades, or all from World War I. Events may be separated by only years or months. Spacing tolerance is tight (±20 years).`
    };

    const SYS = `You are a historical fact database modelled on the Encyclopaedia Britannica, with a content moderation role.

First, evaluate whether the requested theme is suitable for a history quiz game. Reject it if it is:
- Offensive, rude, or inappropriate
- Not a real historical topic (fictional, nonsensical, or absurd)
- So hyper-specific that 5 distinct verifiable events cannot be found
- A living person or very recent event (post-2000)

If the theme is unsuitable, return exactly: {"error":"<friendly explanation in ${outputLang}, one sentence, suggest an alternative if possible>"}

If suitable, generate the events following ALL of these rules:
1. Every event must be real and verifiable with a confirmed year. BC = negative integer.
2. THEME FIDELITY — every event must be directly and specifically about the requested theme.
3. Event names: 4-8 words, Britannica article title style.
4. Descriptions: one declarative sentence, past tense, factually grounded.
5. Do not repeat events across sets.
6. Vary event types within each set (battles, treaties, political acts, deaths, discoveries).
7. LANGUAGE: Write all event names and descriptions in ${outputLang}.
8. ${eraRules[diff] || eraRules.disciple}`;

    const needed = Math.min(rounds || 5, 8);
    const prompt = `Generate ${needed} sets of exactly 5 historical events, ALL specifically about: "${theme}".

DIFFICULTY: ${diff.toUpperCase()}
OUTPUT LANGUAGE: ${outputLang}

Return ONLY valid JSON, no markdown, no explanation:
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
        return json({ error: 'API error: ' + (data.error?.message || JSON.stringify(data)) }, 500);
      }

      const raw = data.content.map(b => b.text || '').join('');
      const clean = raw.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);

      if (parsed.error) return json({ error: parsed.error }, 422);
      return json(parsed, 200);

    } catch (err) {
      return json({ error: 'Generation failed: ' + err.message }, 500);
    }
  }
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
