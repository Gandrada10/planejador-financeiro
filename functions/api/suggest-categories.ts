interface Env {
  ANTHROPIC_API_KEY: string;
}

interface CategoryInfo {
  id: string;
  name: string;
  parentName: string | null;
  type: 'receita' | 'despesa' | 'ambos';
}

interface SuggestRequest {
  descriptions: string[];
  categories: CategoryInfo[];
  apiKey?: string;
}

interface Suggestion {
  categoryId: string | null;
  confidence: number;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: SuggestRequest;
  try {
    body = await context.request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = body.apiKey || context.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { descriptions, categories } = body;
  if (!descriptions?.length || !categories?.length) {
    return new Response(JSON.stringify({ error: 'descriptions and categories are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Build category list for prompt
  const categoryList = categories.map((c) => {
    const label = c.parentName ? `${c.parentName} > ${c.name}` : c.name;
    return `- id:"${c.id}" | ${label} (${c.type})`;
  }).join('\n');

  const descriptionList = descriptions.map((d, i) => `${i + 1}. "${d}"`).join('\n');

  const prompt = `Voce e um classificador de transacoes financeiras brasileiras. Dada uma lista de descricoes de transacoes bancarias, sugira a categoria mais adequada para cada uma.

Categorias disponiveis:
${categoryList}

Descricoes para classificar:
${descriptionList}

Regras:
- Prefira subcategorias (que tem parentName) quando possivel
- Use o tipo da categoria (receita/despesa) para ajudar na decisao
- Se nao tiver certeza, use confidence baixo (< 0.5)
- Se nao conseguir classificar, use categoryId: null e confidence: 0

Responda APENAS com JSON, sem markdown. O formato deve ser um objeto onde cada chave e a descricao original:
{"DESCRICAO 1":{"categoryId":"id_aqui","confidence":0.85},"DESCRICAO 2":{"categoryId":null,"confidence":0}}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return new Response(JSON.stringify({ error: `API error: ${response.status}`, details: err }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json() as {
      content: Array<{ type: string; text?: string }>;
      usage: { input_tokens: number; output_tokens: number };
    };

    const textBlock = data.content.find((b) => b.type === 'text');
    let rawJson = textBlock?.text?.trim() || '{}';

    // Strip markdown code blocks if present
    if (rawJson.includes('```')) {
      rawJson = rawJson.replace(/```[a-z]*\n?/g, '').replace(/```/g, '').trim();
    }

    let suggestions: Record<string, Suggestion> = {};
    try {
      const parsed = JSON.parse(rawJson);
      // Validate structure
      for (const [key, val] of Object.entries(parsed)) {
        const v = val as Record<string, unknown>;
        if (v && typeof v.confidence === 'number') {
          const catId = typeof v.categoryId === 'string' ? v.categoryId : null;
          // Validate that categoryId exists in our list
          const valid = !catId || categories.some((c) => c.id === catId);
          suggestions[key] = {
            categoryId: valid ? catId : null,
            confidence: valid ? v.confidence : 0,
          };
        }
      }
    } catch {
      // Try to extract JSON object from response
      const match = rawJson.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          const parsed = JSON.parse(match[0]);
          for (const [key, val] of Object.entries(parsed)) {
            const v = val as Record<string, unknown>;
            if (v && typeof v.confidence === 'number') {
              suggestions[key] = {
                categoryId: typeof v.categoryId === 'string' ? v.categoryId : null,
                confidence: v.confidence,
              };
            }
          }
        } catch {
          // ignore
        }
      }
    }

    return new Response(JSON.stringify({ suggestions, usage: data.usage }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Request failed', details: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
