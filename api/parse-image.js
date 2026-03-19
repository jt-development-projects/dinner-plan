export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const { image, mediaType } = req.body;
  if (!image) return res.status(400).json({ error: 'No image provided' });

  const prompt = `Extract the recipe from this image and return ONLY a valid JSON object with this exact structure:
{
  "name": "Recipe Name",
  "serves": 4,
  "cook_time": 45,
  "ingredients": [
    { "name": "Ingredient", "amount": 100, "unit": "g" }
  ],
  "steps": [
    "Step one description",
    "Step two description"
  ]
}

Rules:
- serves must be a number (default to 4 if not shown)
- cook_time is total cook time in minutes as a number — add prep + cook time if both shown. Omit the field (do not include it) if not mentioned
- amount must be a number (default to 1 if unclear)
- unit must be one of exactly: g, kg, ml, dl, l, tsp, tbsp, cup, pcs, pinch, slices, bunch — or empty string if none. Always normalise to these abbreviations regardless of the language in the image (e.g. spsk → tbsp, stk → pcs, knivspids → pinch, dl is already canonical, dåse/dose/boks → pcs)
- ingredient names: keep them in the SAME language as the recipe image. Do NOT translate. If the recipe is in Danish, ingredient names must stay in Danish.
- steps should be plain text sentences in the same language as the recipe
- Return ONLY the JSON, no markdown, no explanation`;

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
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: image } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic API error:', err);
      return res.status(502).json({ error: 'Claude API error — check your API key and credits.' });
    }

    const result = await response.json();
    let text = result.content[0].text.trim();
    if (text.startsWith('```')) {
      text = text.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '');
    }
    return res.status(200).json(JSON.parse(text));
  } catch (e) {
    console.error('Parse error:', e);
    return res.status(500).json({ error: `Failed to parse recipe: ${e.message}` });
  }
}
