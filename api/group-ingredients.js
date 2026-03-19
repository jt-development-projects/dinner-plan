export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ canonical: {} });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(200).json({ canonical: {} });

  const { names } = req.body;
  if (!names?.length) return res.status(200).json({ canonical: {} });

  const prompt = `You are grouping ingredient names from a shopping list. Recipes may be in Danish, English, or mixed.

Ingredient names to group:
${names.map(n => `- ${n}`).join('\n')}

Task: for each name, decide which single name from the list best represents that ingredient. Names that refer to the same ingredient must all map to the same representative name. The representative name MUST be one of the names from the list above — do not invent new names or translate.

Rules:
- Pick the most specific/descriptive name as the canonical one when merging
- Merge across languages: "oksebouillon", "Beef bouillon", "Beef broth", "Beef stock", "oksefond" → pick whichever appears in the list
- Merge across specificity when clearly the same thing: "hakkede dåsetomater", "Canned chopped tomatoes", "canned tomatoes", "dåsetomater" → pick the most specific one from the list
- "dose", "dåse", "boks", "can", "tin" all mean the same container unit — treat as equivalent
- Merge spelling variants and capitalisation differences
- Keep things separate when genuinely different: "cherry tomater" ≠ "tomater", "fløde" ≠ "mælk"
- If a name has no match, map it to itself

Return ONLY a valid JSON object:
{"original name": "chosen name from list", ...}`;

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
