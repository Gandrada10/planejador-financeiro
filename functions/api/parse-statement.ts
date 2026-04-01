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

  // Truncate to ~60000 chars to handle larger PDF invoices
  const truncatedText = rawText.slice(0, 60000);

  const prompt = `Voce e um parser de extratos bancarios brasileiros. Analise o texto abaixo extraido de um arquivo "${fileName}" e retorne APENAS um JSON com as transacoes encontradas.

Para cada transacao, extraia:
- "date": data da compra original no formato "YYYY-MM-DD". Em faturas de cartao, cada lancamento tem uma data ao lado (geralmente DD/MM) que indica QUANDO a compra foi feita. Use essa data. O ano deve ser deduzido do contexto da fatura.
- "purchaseDate": mesma data da compra (igual a "date"). So use valor diferente se houver explicitamente duas datas distintas no mesmo lancamento.
- "description": descricao da transacao (limpa, sem codigos internos desnecessarios)
- "amount": valor numerico (negativo para debitos/despesas, positivo para creditos/receitas)
- "titular": nome do titular do cartao se identificavel no extrato, senao string vazia
- "installmentNumber": numero da parcela atual se for compra parcelada (ex: 3 de "PARCELA 3/10"), senao null
- "totalInstallments": total de parcelas se for compra parcelada (ex: 10 de "PARCELA 3/10"), senao null
- "cardNumber": ultimos 4 digitos do cartao se visivel no extrato, senao null

Regras CRITICAS sobre datas:
- A data ao lado de cada lancamento e a DATA DA COMPRA, nao confunda com datas de vencimento da fatura
- Em faturas de cartao, o mes/ano de vencimento aparece no cabecalho. A data de cada lancamento e quando a compra ocorreu, que pode ser em meses anteriores
- Se o lancamento mostra apenas DD/MM sem ano, deduza o ano pelo contexto (periodo da fatura, mes anterior ao vencimento, etc.)
- NUNCA use a data de vencimento da fatura como data da transacao
- Para compras parceladas (ex: PARCELA 12/12), a data ao lado e quando a compra ORIGINAL foi feita, nao quando a parcela esta sendo cobrada

Regras gerais:
- Detecte parcelas em qualquer formato: "PARC 3/10", "PARCELA 3 DE 10", "3/10", "(3/10)", "parcelado em 10x", etc.
- Valores de debito/saida devem ser NEGATIVOS, credito/entrada POSITIVOS
- Ignore linhas de saldo, totais, cabecalhos, rodapes e linhas em branco
- Se o extrato for de cartao de credito, todas as compras sao negativas (despesas)
- Limpe descricoes removendo codigos internos mas mantendo o nome do estabelecimento
- Detecte datas em formatos: DD/MM/YYYY, DD/MM, YYYY-MM-DD, DD-MM-YYYY, DD.MM.YYYY
- Para PDFs, algumas linhas podem estar em ordem incorreta - use logica para reconstituir transacoes
- PROCESSE TODAS as transacoes do extrato, mesmo que sejam muitas (100+)

Responda APENAS com um JSON object com dois campos:
- "isCreditCard": boolean indicando se o extrato e de cartao de credito (fatura de cartao)
- "transactions": array com as transacoes

Sem markdown, sem explicacao, sem code blocks. Exemplo:
{"isCreditCard":true,"transactions":[{"date":"2025-01-23","purchaseDate":"2025-01-23","description":"MERCADO LIVRE","amount":-149.90,"titular":"JOAO SILVA","installmentNumber":3,"totalInstallments":10,"cardNumber":"1234"}]}

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
        max_tokens: 16000,
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

    // Try to parse the JSON - Claude might wrap it in markdown or add extra text
    let cleanJson = rawJson.trim();

    // Strip markdown code blocks
    if (cleanJson.includes('```')) {
      cleanJson = cleanJson.replace(/```[a-z]*\n?/g, '').replace(/```/g, '').trim();
    }

    // Try direct parse first
    let transactions: ParsedTransaction[] | null = null;
    let isCreditCard = false;
    try {
      const parsed = JSON.parse(cleanJson);
      if (Array.isArray(parsed)) {
        transactions = parsed;
      } else if (parsed && Array.isArray(parsed.transactions)) {
        transactions = parsed.transactions;
        isCreditCard = !!parsed.isCreditCard;
      }
    } catch {
      // Try to extract JSON from anywhere in the response
      const objectMatch = cleanJson.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        try {
          const parsed = JSON.parse(objectMatch[0]);
          if (Array.isArray(parsed.transactions)) {
            transactions = parsed.transactions;
            isCreditCard = !!parsed.isCreditCard;
          }
        } catch {
          // ignore
        }
      }
      if (!transactions) {
        const arrayMatch = cleanJson.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          try {
            const parsed = JSON.parse(arrayMatch[0]);
            transactions = Array.isArray(parsed) ? parsed : null;
          } catch {
            // ignore
          }
        }
      }
    }

    if (!transactions) {
      console.error('JSON parse failed. Raw response:', rawJson.slice(0, 1000));
      return new Response(JSON.stringify({
        error: 'Failed to parse AI response',
        raw: rawJson.slice(0, 800)
      }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      transactions,
      isCreditCard,
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
