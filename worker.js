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

    // Theme-specific difficulty rules — era mixing is irrelevant, focus on specificity and spacing
    const themeRules = {
      disciple: `DIFFICULTY — DISCIPLE (theme mode): Select the 5 most famous, universally recognised events within this theme — the ones anyone with basic knowledge would know. Events should be as spread out in time as possible within the theme to make spacing forgiving.`,
      master: `DIFFICULTY — MASTER (theme mode): Select notable but non-obvious events within this theme — significant moments that require real knowledge beyond just headlines. Events should have moderate time gaps between them.`,
      keeper: `DIFFICULTY — KEEPER OF TIME (theme mode): Select specific, obscure events within this theme that only an expert would know. Events should be as close together in time as possible — same decade, same campaign, or even the same year. Precision is everything.`
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
2. THEME FIDELITY — every event must be directly and specifically about the requested theme. Zero exceptions.
3. Event names: 4-8 words, Britannica article title style.
4. Descriptions: one declarative sentence, past tense, factually grounded.
5. Do not repeat events across sets.
6. Vary event types within each set (battles, treaties, political acts, deaths, discoveries).
7. LANGUAGE: Write all event names and descriptions in ${outputLang}.
8. ${themeRules[diff] || themeRules.disciple}`;

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
