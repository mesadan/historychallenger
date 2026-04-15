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
      if (!events || !lang || lang === 'en') {
        return json({ events }, 200); // no-op for English
      }
      const outputLang = langNames[lang] || 'English';

      const prompt = `Translate the following historical event names and descriptions into ${outputLang}.
Keep the translation factually accurate and in the style of an encyclopaedia.
Do NOT change the year values.
Return ONLY valid JSON in exactly this format, no markdown:
{"events":[{"name":"...","year":0,"desc":"..."}]}

Events to translate:
${JSON.stringify(events)}`;

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
            max_tokens: 1000,
            messages: [{ role: 'user', content: prompt }]
          })
        });

        const data = await res.json();
        if (data.error || !data.content) {
          // On translation failure, return original English events
          return json({ events }, 200);
        }

        const raw = data.content.map(b => b.text || '').join('');
        const clean = raw.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);
        return json({ events: parsed.events }, 200);

      } catch (err) {
        // On any error, fall back to English silently
        return json({ events }, 200);
      }
    }

    // ── ROUTE: generate ───────────────────────────────────────────────
    const { theme, diff, rounds, lang } = body;
    if (!theme || !diff) return json({ error: 'Missing theme or difficulty.' }, 400);

    const outputLang = langNames[lang] || 'English';

    const themeRules = {
      disciple: `DIFFICULTY — DISCIPLE (theme mode): Select the 5 most famous, universally recognised events within this theme. Events should be as spread out in time as possible.`,
      master: `DIFFICULTY — MASTER (theme mode): Select notable but non-obvious events requiring real knowledge. Events should have moderate time gaps.`,
      keeper: `DIFFICULTY — KEEPER OF TIME (theme mode): Select specific, obscure events close together in time — same decade, campaign, or year.`
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
6. Vary event types within each set.
7. LANGUAGE: Write all event names and descriptions in ${outputLang}.
8. ${themeRules[diff] || themeRules.disciple}`;

    const needed = Math.min(rounds || 5, 8);
    const prompt = `Generate ${needed} sets of exactly 5 historical events, ALL specifically about: "${theme}".

DIFFICULTY: ${diff.toUpperCase()}
OUTPUT LANGUAGE: ${outputLang}

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
