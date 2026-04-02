interface Env {
  ANTHROPIC_API_KEY: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRequest {
  message: string;
  history: ChatMessage[];
  context: string;
  apiKey?: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: ChatRequest;
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
    return new Response(JSON.stringify({ error: 'API key not configured. Configure em Configuracoes > Chave API.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const systemPrompt = `Voce e um planejador financeiro pessoal inteligente, empático e direto ao ponto. Tem acesso aos dados financeiros reais da familia do usuario e deve:
- Responder perguntas sobre as financas de forma clara e personalizada
- Dar insights proativos sobre padroes de gastos e tendencias
- Identificar oportunidades de economia e alertar sobre excessos
- Comparar periodos quando relevante
- Sugerir acoes concretas e realistas baseadas nos dados reais
- Ser objetivo: prefira numeros e percentuais a generalizacoes

Responda SEMPRE em portugues brasileiro informal mas profissional. Seja conciso — maximo 4 paragrafos por resposta, exceto quando o usuario pedir analise detalhada.

DADOS FINANCEIROS DA FAMILIA (atualizados em tempo real):
${body.context}`;

  const messages: ChatMessage[] = [
    ...(body.history || []),
    { role: 'user', content: body.message },
  ];

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
        max_tokens: 1024,
        system: systemPrompt,
        messages,
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
    };

    const text = data.content.find((b) => b.type === 'text')?.text || '';

    return new Response(JSON.stringify({ response: text }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Request failed', details: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
