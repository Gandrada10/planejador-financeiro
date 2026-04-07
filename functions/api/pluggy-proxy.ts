interface Env {
  PLUGGY_CLIENT_ID?: string;
  PLUGGY_CLIENT_SECRET?: string;
}

interface PluggyRequest {
  action: 'auth_test' | 'items' | 'accounts' | 'transactions';
  clientId: string;
  clientSecret: string;
  itemId?: string;
  accountId?: string;
  from?: string; // YYYY-MM-DD
  to?: string;   // YYYY-MM-DD
  page?: number;
}

const PLUGGY_BASE = 'https://api.pluggy.ai';

async function getApiKey(clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(`${PLUGGY_BASE}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pluggy auth failed (${res.status}): ${text}`);
  }
  const data = await res.json() as { apiKey?: string; accessToken?: string };
  const apiKey = data.apiKey || data.accessToken;
  if (!apiKey) {
    throw new Error(`Pluggy auth OK mas sem apiKey. Resposta: ${JSON.stringify(data)}`);
  }
  return apiKey;
}

async function pluggyGet(apiKey: string, path: string): Promise<unknown> {
  const res = await fetch(`${PLUGGY_BASE}${path}`, {
    headers: { 'X-API-KEY': apiKey },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pluggy GET ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: PluggyRequest;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const clientId = body.clientId || context.env.PLUGGY_CLIENT_ID || '';
  const clientSecret = body.clientSecret || context.env.PLUGGY_CLIENT_SECRET || '';

  if (!clientId || !clientSecret) {
    return json({ error: 'Credenciais Pluggy nao configuradas. Vá em Configuracoes e informe seu CLIENT_ID e CLIENT_SECRET do Meu Pluggy.' }, 400);
  }

  try {
    const apiKey = await getApiKey(clientId, clientSecret);

    if (body.action === 'auth_test') {
      // Just verify credentials work — return list of items
      const data = await pluggyGet(apiKey, '/items') as { total: number; results: unknown[] };
      return json({ ok: true, itemCount: data.total });
    }

    if (body.action === 'items') {
      const data = await pluggyGet(apiKey, '/items') as { total: number; results: PluggyItem[] };
      return json({ items: data.results });
    }

    if (body.action === 'accounts') {
      if (!body.itemId) return json({ error: 'itemId obrigatorio' }, 400);
      const data = await pluggyGet(apiKey, `/accounts?itemId=${body.itemId}`) as { total: number; results: PluggyAccount[] };
      return json({ accounts: data.results });
    }

    if (body.action === 'transactions') {
      if (!body.accountId) return json({ error: 'accountId obrigatorio' }, 400);
      const from = body.from || '';
      const to = body.to || '';
      const page = body.page || 1;
      let url = `/transactions?accountId=${body.accountId}&pageSize=500&page=${page}`;
      if (from) url += `&from=${from}`;
      if (to) url += `&to=${to}`;
      const data = await pluggyGet(apiKey, url) as PluggyTransactionPage;
      return json({
        transactions: data.results,
        total: data.total,
        page: data.page,
        totalPages: data.totalPages,
      });
    }

    return json({ error: `Acao desconhecida: ${body.action}` }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 502);
  }
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── Pluggy types (subset used by this proxy) ────────────────────────────────

interface PluggyItem {
  id: string;
  connector: { name: string; institutionUrl: string; imageUrl: string | null };
  status: string;
  lastUpdatedAt: string | null;
  executionStatus: string;
  createdAt: string;
}

interface PluggyAccount {
  id: string;
  itemId: string;
  name: string;
  number: string | null;
  balance: number;
  currencyCode: string;
  type: 'BANK' | 'CREDIT';
  subtype: string;
  owner: string | null;
  taxNumber: string | null;
  creditData: {
    level: string | null;
    brand: string | null;
    balanceCloseDate: string | null;
    balanceDueDate: string | null;
    availableCreditLimit: number | null;
    balanceForeignCurrency: number | null;
    minimumPayment: number | null;
    creditLimit: number | null;
  } | null;
}

interface PluggyTransactionPage {
  total: number;
  page: number;
  totalPages: number;
  results: PluggyTransaction[];
}

interface PluggyTransaction {
  id: string;
  description: string;
  descriptionRaw: string | null;
  currencyCode: string;
  amount: number;
  amountInAccountCurrency: number | null;
  date: string;
  balance: number | null;
  accountId: string;
  providerCode: string | null;
  status: 'POSTED' | 'PENDING';
  type: 'DEBIT' | 'CREDIT';
  category: string | null;
  categoryId: string | null;
  paymentData: unknown | null;
  creditData: {
    purchaseDate: string | null;
    installmentNumber: number | null;
    totalInstallments: number | null;
    totalAmount: number | null;
  } | null;
  merchant: {
    name: string;
    businessName: string | null;
    cnpj: string | null;
    category: string | null;
  } | null;
}
