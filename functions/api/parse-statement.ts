interface Env {
  ANTHROPIC_API_KEY: string;
}

interface ParseRequest {
  rawText: string;
  fileName: string;
  apiKey?: string;
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
  let body: ParseRequest;
  try {
    body = await context.request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Accept key from: request body (user-configured in app) > env var (Cloudflare dashboard)
  const apiKey = body.apiKey || context.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key not configured. Configure sua chave Anthropic em Configuracoes > Chave API.' }), {
      status: 500,
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
- "titular": nome do titular responsavel pelo lancamento. Imagine que voce mantem uma variavel "titular_ativo" que começa vazia e so muda quando voce encontra um cabecalho de secao de titular. Cada transacao recebe o valor atual de "titular_ativo". Regras:

  QUANDO o titular_ativo MUDA:
  * Apenas quando aparece uma linha que e um cabecalho de secao de titular: nome proprio isolado (geralmente em maiusculas) seguido opcionalmente de "(final XXXX)", numero do cartao ou tipo ("CARTAO ADICIONAL"). Exemplos: "GUILHERME ANDRADA (final 4535)", "JULIANA KUHN - CARTAO ADICIONAL", "MARIA SILVA".
  * Isso pode ocorrer em qualquer posicao: no inicio do extrato, no meio de uma coluna, logo apos [COLUNA-DIREITA], ou no inicio de uma nova pagina. Sempre que aparecer, atualiza o titular_ativo.
  * Ignore sufixos como "CARTAO ADICIONAL", "ADICIONAL", "TITULAR" — use apenas o nome da pessoa.

  QUANDO o titular_ativo NAO muda (mantenha o titular anterior):
  * Ao encontrar o marcador [COLUNA-DIREITA]: e apenas uma quebra grafica de coluna, nao troca de titular.
  * Ao encontrar cabecalhos de tabela: "Lancamentos: compras e saques", "DATA ESTABELECIMENTO VALOR EM RS", "DATA LANCAMENTO VALOR" e similares sao cabecalhos de coluna — ignorar para fins de titular.
  * Ao encontrar subtotais: "Lancamentos no cartao (final XXXX): R$ YYY", totais de pagina, rodapes.
  * Ao iniciar nova pagina sem novo nome de titular.

  REGRA GERAL: o titular_ativo persiste ate ser explicitamente substituido por um novo nome de pessoa. Nao existe reset automatico por posicao, coluna ou pagina.

  Se o extrato nao tiver secoes por titular, use o nome do portador principal do cabecalho da fatura para todas as transacoes. Se impossivel identificar, use string vazia.
- "installmentNumber": numero da parcela atual se for compra parcelada (ex: 3 de "PARCELA 3/10"), senao null
- "totalInstallments": total de parcelas se for compra parcelada (ex: 10 de "PARCELA 3/10"), senao null
- "cardNumber": ultimos 4 digitos do cartao se visivel proximo ao lancamento ou cabecalho da secao, senao null

Regras CRITICAS sobre datas:
- A data ao lado de cada lancamento e a DATA DA COMPRA, nao confunda com datas de vencimento da fatura
- Em faturas de cartao, o mes/ano de vencimento aparece no cabecalho. A data de cada lancamento e quando a compra ocorreu, que pode ser em meses anteriores
- Se o lancamento mostra apenas DD/MM sem ano, deduza o ano pelo contexto (periodo da fatura, mes anterior ao vencimento, etc.)
- NUNCA use a data de vencimento da fatura como data da transacao
- Para compras parceladas (ex: PARCELA 12/12), a data ao lado e quando a compra ORIGINAL foi feita, nao quando a parcela esta sendo cobrada

Regras gerais:
- Detecte parcelas em qualquer formato: "PARC 3/10", "PARCELA 3 DE 10", "3/10", "(3/10)", "parcelado em 10x", etc.
- IMPORTANTE - parcelas compactas ao final da descricao: em extratos de CSV/Excel, e muito comum ver um marcador de parcela zero-padded colado no final do nome do estabelecimento, como "DA CAPO       02/02", "MERCADOLIVRE*MERCA05/05", "AMAZON PRIME BR         12/12", "COMPRA DE PONTOS L08/10". Sempre interprete esse "XX/YY" no final como parcela (installmentNumber=XX, totalInstallments=YY), NUNCA como data. Remova esse sufixo da "description" — a descricao limpa deve conter apenas o nome do estabelecimento (ex: "DA CAPO", "MERCADOLIVRE*MERCA", "AMAZON PRIME BR", "COMPRA DE PONTOS L"). Ja existe uma coluna de data separada na linha; o marcador XX/YY no final nao e data.
- Valores de debito/saida devem ser NEGATIVOS, credito/entrada POSITIVOS
- Ignore linhas de saldo, totais, cabecalhos, rodapes e linhas em branco
- Se o extrato for de cartao de credito, todas as compras sao negativas (despesas)
- Limpe descricoes removendo codigos internos mas mantendo o nome do estabelecimento
- Detecte datas em formatos: DD/MM/YYYY, DD/MM, YYYY-MM-DD, DD-MM-YYYY, DD.MM.YYYY
- Para PDFs, algumas linhas podem estar em ordem incorreta - use logica para reconstituir transacoes
- PROCESSE TODAS as transacoes do extrato, mesmo que sejam muitas (100+)
- CRUCIAL: siga rigorosamente a logica de "titular_ativo" descrita acima — o titular so muda com cabecalho de nome de pessoa, jamais por coluna, pagina ou cabecalho de tabela

Secoes especiais em faturas de cartao (CRITICO):
- ENCARGOS, SEGUROS, ANUIDADE, IOF, TAXAS, JUROS, MULTA: sao cobranças reais da fatura (despesas). Importe como transacoes NEGATIVAS normais. Pertencem ao titular PRINCIPAL do cartao (o primeiro da fatura) a menos que estejam explicitamente dentro de uma secao de outro titular.
- ESTORNO / REEMBOLSO / DEVOLUCAO / CASHBACK / ajuste-a-credito de uma compra: sao devolucoes reais de dinheiro ao cliente e REDUZEM a despesa do mes. Importe com amount POSITIVO. Atribua ao titular principal a menos que estejam dentro de secao de outro titular. ESTES sao os unicos valores positivos que entram.

>>> NAO IMPORTE — EXCLUA SEMPRE (nunca gere transacao para estas linhas, qualquer que seja o sinal) <<<
Estas linhas NAO sao movimento da fatura atual. No app, a "despesa mensal" e a SOMA de TODAS as linhas importadas — entao qualquer uma destas polui o total (como despesa duplica, como credito subtrai; os dois erram). Ignore-as por completo:
- PAGAMENTO DA FATURA / quitacao: qualquer linha cujo texto contenha "PAGAMENTO", "PGTO", "PAGTO", "PAG FATURA", "PAGAMENTO EFETUADO", "PAGAMENTO RECEBIDO", "PAGAMENTO DE FATURA", "PAGTO DEBITO CONTA", "PAGAMENTO ON LINE". E a quitacao da fatura ANTERIOR — NAO e estorno nem credito. Costuma ser a PRIMEIRA linha abaixo do cabecalho, com valor alto proximo ao total da fatura passada. NUNCA importe.
- SALDO ANTERIOR / "SALDO FATURA ANTERIOR" / "SALDO EM DD/MM": carry-over de fatura, nao e transacao. NUNCA importe.
- RESUMO / TOTAIS / SUBTOTAIS: "TOTAL DA FATURA", "TOTAL A PAGAR", "TOTAL DESTA FATURA", "SUBTOTAL", "TOTAL DE COMPRAS", "TOTAL OUTROS CREDITOS", "Lancamentos no cartao (final XXXX): R$ ...", totais de pagina e rodape. Sao agregados, nao lancamentos individuais. NUNCA importe.
- ROTULO/CABECALHO de secao NUNCA vira transacao: a propria expressao "OUTROS CREDITOS" (ou "CREDITOS", "PAGAMENTOS E CREDITOS") sozinha numa linha e apenas um titulo. Importe SO os itens individuais listados ABAIXO dela — e, mesmo assim, apenas os que forem estorno/reembolso real (positivo); se o item sob o titulo for PAGAMENTO ou SALDO ANTERIOR, exclua.
- COMPRAS DE FATURAS FUTURAS / LANCAMENTOS FUTUROS / "PROXIMAS FATURAS": compras que serao cobradas em faturas FUTURAS, nao na atual. NAO IMPORTE — ignore toda a secao.

REGRA-META: o conjunto importado deve conter APENAS compras reais (negativas) + estornos/reembolsos reais (positivos), e a soma de todas as linhas importadas tem de bater com a despesa liquida real do mes. Em duvida num valor POSITIVO: ESTORNO/REEMBOLSO/DEVOLUCAO/CASHBACK -> importe; PAGAMENTO/PGTO/SALDO ANTERIOR -> exclua.

Responda APENAS com um JSON object com quatro campos:
- "isCreditCard": boolean indicando se o extrato e de cartao de credito (fatura de cartao)
- "declaredTotal": em fatura de cartao, o valor total DECLARADO da fatura atual (procure "TOTAL DESTA FATURA", "TOTAL A PAGAR" ou "VALOR A PAGAR" no cabecalho/resumo), como numero POSITIVO. E um METADADO para conferencia — NAO e uma transacao e NAO entra no array. Se nao encontrar, use null.
- "accountDescriptor": identificacao da CONTA ou CARTAO no cabecalho do extrato — o nome/bandeira do cartao ou banco e os ultimos digitos, se houver. Exemplos: "Latam Pass Itau Black Mastercard final 4640", "Nubank Mastercard 1234", "Itau conta corrente Personalite". Copie o texto do cabecalho como esta; e usado so para SUGERIR a conta cadastrada, nunca vira transacao. String, ou null se nao houver.
- "transactions": array com as transacoes (apenas compras reais negativas e estornos reais positivos, conforme as regras acima)

Sem markdown, sem explicacao, sem code blocks.

Exemplo de EXCLUSAO — dado o trecho de entrada:
  PAGAMENTO EFETUADO      5.000,00
  SALDO ANTERIOR             0,00
  ESTORNO COMPRA LOJA X    120,00
  AMAZON                    -89,90
a saida NAO inclui "PAGAMENTO EFETUADO" nem "SALDO ANTERIOR"; INCLUI "ESTORNO COMPRA LOJA X" com amount +120.00 e "AMAZON" com amount -89.90.

Exemplo de formato de saida (dois titulares):
{"isCreditCard":true,"declaredTotal":239.80,"accountDescriptor":"Latam Pass Itau Black Mastercard final 4640","transactions":[{"date":"2025-01-23","purchaseDate":"2025-01-23","description":"MERCADO LIVRE","amount":-149.90,"titular":"JOAO SILVA","installmentNumber":3,"totalInstallments":10,"cardNumber":"1234"},{"date":"2025-01-20","purchaseDate":"2025-01-20","description":"AMAZON","amount":-89.90,"titular":"MARIA SILVA","installmentNumber":null,"totalInstallments":null,"cardNumber":"5678"}]}

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
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 16000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      const status = response.status;
      let userMessage = `API error: ${status}`;
      if (status === 401) {
        userMessage = 'Chave API Anthropic invalida ou expirada. Verifique a chave em Configuracoes > Chave API (deve comecar com "sk-ant-") e salve novamente.';
      } else if (status === 403) {
        userMessage = 'Chave API Anthropic sem permissao para este recurso. Verifique a chave em Configuracoes > Chave API.';
      } else if (status === 429) {
        userMessage = 'Limite de requisicoes da Anthropic atingido. Aguarde alguns instantes e tente novamente.';
      }
      return new Response(JSON.stringify({ error: userMessage, details: err }), {
        status: status === 401 || status === 403 || status === 429 ? status : 502,
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
    let declaredTotal: number | null = null;
    let accountDescriptor: string | null = null;
    try {
      const parsed = JSON.parse(cleanJson);
      if (Array.isArray(parsed)) {
        transactions = parsed;
      } else if (parsed && Array.isArray(parsed.transactions)) {
        transactions = parsed.transactions;
        isCreditCard = !!parsed.isCreditCard;
        declaredTotal = typeof parsed.declaredTotal === 'number' ? parsed.declaredTotal : null;
        accountDescriptor = typeof parsed.accountDescriptor === 'string' ? parsed.accountDescriptor : null;
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
            declaredTotal = typeof parsed.declaredTotal === 'number' ? parsed.declaredTotal : null;
            accountDescriptor = typeof parsed.accountDescriptor === 'string' ? parsed.accountDescriptor : null;
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

    // ─── Rede de seguranca deterministica (pos-parse) ───────────────────────────
    // O prompt ja exclui pagamento de fatura / saldo anterior, mas um modelo
    // pequeno pode deixar uma linha passar. Em fatura de cartao, um valor POSITIVO
    // cuja descricao parece pagamento/quitacao ou "saldo anterior" NAO e credito
    // real (estorno) — e a quitacao da fatura ANTERIOR e poluiria a despesa do mes.
    // Estornos/reembolsos (ESTORNO/REEMBOLSO/DEVOLUCAO/CASHBACK) tambem sao
    // positivos e DEVEM permanecer, por isso casamos so palavras de pagamento/saldo.
    const PAYMENT_LINE = /\b(PAGAMENTO|PGTO|PAGTO|PAG\.?\s*FATURA|PAGAMENTO\s+(RECEBIDO|EFETUADO)|SALDO\s+ANTERIOR)\b/i;
    // Estorno vence pagamento: uma linha que TAMBEM e reembolso real nunca e
    // descartada, mesmo contendo "PAGAMENTO" (ex.: "ESTORNO DE PAGAMENTO
    // DUPLICADO" — credito positivo legitimo). Elimina o falso-negativo que
    // sumiria o dado ANTES do modal, invisivel para o usuario readicionar.
    const REFUND_LINE = /ESTORNO|REEMBOLSO|DEVOLU|CASHBACK/i;
    let droppedPaymentLines = 0;
    if (isCreditCard) {
      transactions = transactions.filter((t) => {
        const desc = t.description || '';
        const isPaymentLike = t.amount > 0 && PAYMENT_LINE.test(desc) && !REFUND_LINE.test(desc);
        if (isPaymentLike) droppedPaymentLines++;
        return !isPaymentLike;
      });
    }
    // Log estruturado: SO a contagem — nunca valores nem descricoes (dado financeiro).
    if (droppedPaymentLines > 0) {
      console.log(JSON.stringify({
        service: 'parse-statement',
        event: 'dropped_payment_lines',
        count: droppedPaymentLines,
        ts: new Date().toISOString(),
      }));
    }

    return new Response(JSON.stringify({
      transactions,
      isCreditCard,
      declaredTotal,
      accountDescriptor,
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
