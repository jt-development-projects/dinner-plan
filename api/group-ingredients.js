export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ canonical: {} });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(200).json({ canonical: {} });

  const { names } = req.body;
  if (!names?.length) return res.status(200).json({ canonical: {} });

  const prompt = `You are grouping ingredient names from recipes written in Danish and English.

Some names refer to the same ingredient but differ in language, spelling, capitalisation, or minor wording.

Ingredient names:
${names.map(n => `- ${n}`).join('\n')}

For every name, return the single best canonical English name. Names that clearly refer to the same ingredient must map to the same canonical name. Preserve specificity — "cherry tomatoes" and "tomatoes" are different ingredients.

Return ONLY a JSON object mapping each original name to its canonical name:
{"original name": "canonical name"}

Mapping guidance (Danish → English):
- løg = onion, hvidløg = garlic, smør = butter, mel = flour, æg = egg
- mælk = milk, fløde = cream, sukker = sugar, salt = salt, peber = pepper
- olie = oil, olivenolie = olive oil, persille = parsley, tomat/tomater = tomato
- "salt og peber" / "salt and pepper" / "salt and fresh ground pepper" / "salt og friskkværnet peber" → "salt and pepper"`;

  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 15000);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) return res.status(200).json({ canonical: {} });

    const result = await response.json();
    let text = result.content[0].text.trim();
    if (text.startsWith('```')) text = text.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '');
    return res.status(200).json({ canonical: JSON.parse(text) });
  } catch {
    return res.status(200).json({ canonical: {} }); // fail silently
  }
}
