export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(200).json({ mapping: {} });

  const { newNames, existingNames } = req.body;
  if (!newNames?.length || !existingNames?.length) return res.status(200).json({ mapping: {} });

  const prompt = `You are normalising ingredient names for a recipe app used in Danish and English households.

Existing ingredient names already in the database:
${existingNames.map(n => `- ${n}`).join('\n')}

For each new ingredient name below, return the best matching existing name if they clearly refer to the same ingredient — accounting for different languages (Danish/English), spelling mistakes, capitalisation, or singular/plural. If there is no clear match, keep the new name unchanged.

New names:
${newNames.map(n => `- ${n}`).join('\n')}

Language examples to guide you:
- løg / løget = onion | hvidløg = garlic | smør = butter | mel = flour
- fløde = cream | mælk = milk | æg = egg | sukker = sugar | salt = salt
- tomat / tomater = tomato | kartofler = potato | gulerod / gulerødder = carrot
- olie = oil | olivenolie = olive oil | peber = pepper | persille = parsley

Rules:
- Only merge if you are confident they are the same ingredient
- Do NOT merge "cherry tomatoes" with "tomato" — specificity matters
- Prefer the existing name when merging
- Return ONLY a JSON object: {"new name": "canonical name", ...}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) return res.status(200).json({ mapping: {} });

    const result = await response.json();
    let text = result.content[0].text.trim();
    if (text.startsWith('```')) text = text.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '');
    return res.status(200).json({ mapping: JSON.parse(text) });
  } catch {
    return res.status(200).json({ mapping: {} }); // fail silently — never block a save
  }
}
