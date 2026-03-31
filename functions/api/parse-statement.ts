interface Env {
  ANTHROPIC_API_KEY: string;
}

interface ParseRequest {
  rawText: string;
  fileName: string;
}

interface ParsedTransaction {
  date: string;
  purchaseDate: string | null;
  description: string;
  amount: number;
  titular: string;
  installmentNumber: number | null;
  totalInstallments: number | null;
  cardNumber: string | null;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const apiKey = context.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: ParseRequest;
  try {
    body = await context.request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { rawText, fileName } = body;
  if (!rawText || rawText.length < 10) {
    return new Response(JSON.stringify({ error: 'No text content provided' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Truncate to ~15000 chars to stay within reasonable token limits
  const truncatedText = rawText.slice(0, 15000);

  const prompt = `Voce e um parser de extratos bancarios brasileiros. Analise o texto abaixo extraido de um arquivo "${fileName}" e retorne APENAS um JSON array com as transacoes encontradas.

Para cada transacao, extraia:
- "date": data do lancamento na fatura no formato "YYYY-MM-DD" (a data que aparece no extrato)
- "purchaseDate": data original da compra no formato "YYYY-MM-DD", se diferente da data do lancamento (ex: compra parcelada feita em mes anterior). Se for igual a date ou nao identificavel, retorne null
- "description": descricao da transacao (limpa, sem codigos internos desnecessarios)
- "amount": valor numerico (negativo para debitos/despesas, positivo para creditos/receitas)
- "titular": nome do titular do cartao se identificavel no extrato, senao string vazia
- "installmentNumber": numero da parcela atual se for compra parcelada (ex: 3 de "PARCELA 3/10"), senao null
- "totalInstallments": total de parcelas se for compra parcelada (ex: 10 de "PARCELA 3/10"), senao null
- "cardNumber": ultimos 4 digitos do cartao se visivel no extrato, senao null

Regras importantes:
- Detecte parcelas em qualquer formato: "PARC 3/10", "PARCELA 3 DE 10", "3/10", "(3/10)", "parcelado em 10x", etc.
- Valores de debito/saida devem ser NEGATIVOS
- Valores de credito/entrada devem ser POSITIVOS
- Ignore linhas de saldo, totais, cabecalhos, rodapes e linhas em branco
- Se o extrato for de cartao de credito, todas as compras sao negativas (despesas)
- Limpe descricoes removendo codigos internos mas mantendo o nome do estabelecimento
- Detecte datas em formatos: DD/MM/YYYY, YYYY-MM-DD, DD-MM-YYYY, DD.MM.YYYY
- Para PDFs, algumas linhas podem estar em ordem incorreta - use logica para reconstituir transacoes

Responda APENAS com o JSON array, sem markdown, sem explicacao, sem code blocks. Exemplo:
[{"date":"2026-01-15","purchaseDate":"2025-11-15","description":"MERCADO LIVRE","amount":-149.90,"titular":"JOAO SILVA","installmentNumber":3,"totalInstallments":10,"cardNumber":"1234"}]

Texto do extrato (pode estar desformatado, PDFs frequentemente tem quebras estranhas):
${truncatedText}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 8000,
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
    const rawJson = textBlock?.text || '[]';

    // Try to parse the JSON - Claude might wrap it in markdown
    let cleanJson = rawJson.trim();
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
    }

    let transactions: ParsedTransaction[];
    try {
      transactions = JSON.parse(cleanJson);
    } catch (e) {
      console.error('JSON parse error:', e, 'Raw response:', rawJson);
      return new Response(JSON.stringify({
        error: 'Failed to parse AI response. The AI might not have found transactions in the file.',
        raw: rawJson.slice(0, 500)
      }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!Array.isArray(transactions)) {
      return new Response(JSON.stringify({
        error: 'Invalid response format. Expected array of transactions.',
        raw: rawJson.slice(0, 500)
      }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      transactions,
      usage: data.usage,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Request failed', details: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
