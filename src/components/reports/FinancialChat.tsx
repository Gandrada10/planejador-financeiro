import { useState, useRef, useEffect } from 'react';
import { X, Send, Sparkles, Loader2 } from 'lucide-react';
import type { Transaction, Category, Budget } from '../../types';
import { formatBRL, getMonthYear, getMonthLabel, getMonthYearOffset } from '../../lib/utils';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  transactions: Transaction[];
  categories: Category[];
  budgets: Budget[];
}

function resolveCatName(id: string | null, categories: Category[]): string {
  if (!id) return 'Sem categoria';
  const cat = categories.find((c) => c.id === id);
  if (!cat) return 'Sem categoria';
  const parent = cat.parentId ? categories.find((c) => c.id === cat.parentId) : null;
  return parent ? `${parent.name} / ${cat.name}` : cat.name;
}

function buildContext(transactions: Transaction[], categories: Category[], budgets: Budget[]): string {
  if (transactions.length === 0) return 'Nenhum lancamento importado ainda.';

  const now = new Date();
  const currentMonth = getMonthYear(now);
  const fiveYearsAgo = getMonthYearOffset(currentMonth, -60);

  // All months with data within 5 years, sorted ascending
  const allMonths = [...new Set(transactions.map((t) => getMonthYear(t.date)))]
    .filter((m) => m >= fiveYearsAgo)
    .sort();

  // Per-month aggregates
  type MonthAgg = { income: number; expenses: number; count: number };
  const monthAgg = new Map<string, MonthAgg>();
  for (const m of allMonths) {
    const txs = transactions.filter((t) => getMonthYear(t.date) === m);
    monthAgg.set(m, {
      income: txs.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0),
      expenses: txs.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0),
      count: txs.length,
    });
  }

  // Yearly aggregates
  const yearAgg = new Map<string, MonthAgg>();
  for (const [m, v] of monthAgg) {
    const yr = m.slice(0, 4);
    const p = yearAgg.get(yr) || { income: 0, expenses: 0, count: 0 };
    yearAgg.set(yr, { income: p.income + v.income, expenses: p.expenses + v.expenses, count: p.count + v.count });
  }

  // All-time totals
  const allIncome = transactions.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const allExpenses = transactions.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);

  // All-time category totals (expenses)
  const catAllMap = new Map<string, number>();
  for (const t of transactions) {
    if (t.amount < 0) {
      const k = t.categoryId || '__uncat';
      catAllMap.set(k, (catAllMap.get(k) || 0) + Math.abs(t.amount));
    }
  }
  const topCatsAll = [...catAllMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([id, v]) => `  ${resolveCatName(id === '__uncat' ? null : id, categories)}: ${formatBRL(v)}`);

  // Category evolution by year (top 6 categories)
  const topCatIds = [...catAllMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id]) => id);
  const catByYear: string[] = [];
  for (const catId of topCatIds) {
    const name = resolveCatName(catId === '__uncat' ? null : catId, categories);
    const byYear = [...yearAgg.keys()].sort().map((yr) => {
      const v = Math.abs(transactions
        .filter((t) => t.amount < 0 && getMonthYear(t.date).startsWith(yr) && (t.categoryId || '__uncat') === catId)
        .reduce((s, t) => s + t.amount, 0));
      return v > 0 ? `${yr}:${formatBRL(v)}` : null;
    }).filter(Boolean).join(' | ');
    if (byYear) catByYear.push(`  ${name}: ${byYear}`);
  }

  // Per-member all-time totals
  const memberMap = new Map<string, number>();
  for (const t of transactions) {
    if (t.amount < 0) {
      const k = t.titular || t.familyMember || 'Sem identificacao';
      memberMap.set(k, (memberMap.get(k) || 0) + Math.abs(t.amount));
    }
  }
  const memberLines = [...memberMap.entries()].sort((a, b) => b[1] - a[1])
    .map(([name, v]) => `  ${name}: ${formatBRL(v)}`);

  // Current month detail
  const currentTxs = transactions.filter((t) => getMonthYear(t.date) === currentMonth);
  const cur = monthAgg.get(currentMonth) || { income: 0, expenses: 0, count: 0 };

  const catCurMap = new Map<string, number>();
  for (const t of currentTxs) {
    if (t.amount < 0) {
      const k = t.categoryId || '__uncat';
      catCurMap.set(k, (catCurMap.get(k) || 0) + Math.abs(t.amount));
    }
  }
  const topCatsCur = [...catCurMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([id, v]) => `  ${resolveCatName(id === '__uncat' ? null : id, categories)}: ${formatBRL(v)}`);

  const top5cur = [...currentTxs].filter((t) => t.amount < 0).sort((a, b) => a.amount - b.amount).slice(0, 5)
    .map((t) => `  ${t.description} (${resolveCatName(t.categoryId, categories)}): ${formatBRL(t.amount)}`);

  // Budget adherence current month
  const budgetLines = budgets.filter((b) => b.monthYear === currentMonth).map((b) => {
    const actual = Math.abs(currentTxs.filter((t) => t.categoryId === b.categoryId && t.amount < 0).reduce((s, t) => s + t.amount, 0));
    const pct = b.limitAmount > 0 ? ((actual / b.limitAmount) * 100).toFixed(0) : '0';
    const status = actual > b.limitAmount ? 'EXCEDIDO' : actual > b.limitAmount * 0.8 ? 'proximo do limite' : 'OK';
    return `  ${resolveCatName(b.categoryId, categories)}: ${formatBRL(actual)} / ${formatBRL(b.limitAmount)} (${pct}%) — ${status}`;
  });

  // Assemble
  const lines: string[] = [
    `Data: ${now.toLocaleDateString('pt-BR')} | Mes atual: ${getMonthLabel(currentMonth)}`,
    `Periodo de dados: ${getMonthLabel(allMonths[0])} ate ${getMonthLabel(allMonths[allMonths.length - 1])} (${transactions.length} lancamentos total)`,
    '',
    '=== RESUMO GERAL (todo o periodo) ===',
    `Receitas totais: ${formatBRL(allIncome)}`,
    `Despesas totais: ${formatBRL(Math.abs(allExpenses))}`,
    `Saldo acumulado: ${formatBRL(allIncome + allExpenses)}`,
    '',
    '=== RESUMO POR ANO ===',
    ...[...yearAgg.entries()].sort().map(([yr, v]) =>
      `  ${yr}: Receitas ${formatBRL(v.income)}, Despesas ${formatBRL(Math.abs(v.expenses))}, Saldo ${formatBRL(v.income + v.expenses)} (${v.count} lanc.)`
    ),
    '',
    '=== HISTORICO MENSAL COMPLETO ===',
    ...allMonths.map((m) => {
      const v = monthAgg.get(m)!;
      return `  ${getMonthLabel(m)}: +${formatBRL(v.income)} -${formatBRL(Math.abs(v.expenses))} =${formatBRL(v.income + v.expenses)}`;
    }),
    '',
    '=== TOP 10 CATEGORIAS (todo o periodo) ===',
    ...topCatsAll,
    '',
    '=== EVOLUCAO DAS PRINCIPAIS CATEGORIAS POR ANO ===',
    ...catByYear,
  ];

  if (memberLines.length > 0) {
    lines.push('', '=== GASTOS POR MEMBRO/TITULAR (todo o periodo) ===', ...memberLines);
  }

  lines.push(
    '',
    `=== MES ATUAL: ${getMonthLabel(currentMonth)} ===`,
    `Receitas: ${formatBRL(cur.income)} | Despesas: ${formatBRL(Math.abs(cur.expenses))} | Saldo: ${formatBRL(cur.income + cur.expenses)}`,
    '',
    'Categorias do mes:',
    ...topCatsCur,
  );

  if (top5cur.length > 0) {
    lines.push('', 'Maiores lancamentos do mes:', ...top5cur);
  }

  if (budgetLines.length > 0) {
    lines.push('', '=== ORCAMENTOS DO MES ===', ...budgetLines);
  }

  return lines.join('\n');
}

export function FinancialChat({ transactions, categories, budgets }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open && messages.length === 0) {
      // Welcome message when first opened
      setMessages([{
        role: 'assistant',
        content: `Olá! Sou seu planejador financeiro pessoal. Tenho acesso aos seus dados financeiros e posso ajudar com análises, insights e dúvidas sobre suas finanças. O que você gostaria de saber?`,
      }]);
    }
  }, [open, messages.length]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    const apiKey = localStorage.getItem('anthropic_api_key') || '';
    if (!apiKey) {
      setError('Configure sua chave Anthropic em Configuracoes > Chave API para usar o chat.');
      return;
    }

    setError('');
    setInput('');
    const userMsg: ChatMessage = { role: 'user', content: text };
    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setLoading(true);

    try {
      const context = buildContext(transactions, categories, budgets);
      const response = await fetch('/api/financial-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: messages.filter((m) => m.role !== 'assistant' || messages.indexOf(m) > 0),
          context,
          apiKey,
        }),
      });

      const data = await response.json() as { response?: string; error?: string };
      if (!response.ok || data.error) {
        throw new Error(data.error || `Erro ${response.status}`);
      }

      setMessages([...newHistory, { role: 'assistant', content: data.response || '' }]);
    } catch (err) {
      setMessages([...newHistory, {
        role: 'assistant',
        content: `Desculpe, ocorreu um erro: ${err instanceof Error ? err.message : String(err)}`,
      }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-full shadow-lg font-bold text-sm transition-all ${
          open
            ? 'bg-bg-secondary border border-border text-text-secondary'
            : 'bg-accent text-bg-primary hover:opacity-90'
        }`}
        title="Planejador IA"
      >
        {open ? <X size={18} /> : <Sparkles size={18} />}
        {!open && <span>Planejador IA</span>}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-20 right-6 z-50 w-[380px] h-[520px] bg-bg-card border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-bg-secondary">
            <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
              <Sparkles size={14} className="text-accent" />
            </div>
            <div>
              <p className="text-xs font-bold text-text-primary">Planejador Financeiro IA</p>
              <p className="text-[10px] text-text-secondary">Dados atualizados em tempo real</p>
            </div>
            <button
              onClick={() => setMessages([])}
              className="ml-auto text-[10px] text-text-secondary hover:text-text-primary"
              title="Limpar conversa"
            >
              Limpar
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[88%] px-3 py-2 rounded-xl text-xs leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-accent text-bg-primary rounded-br-sm'
                      : 'bg-bg-secondary text-text-primary rounded-bl-sm'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-bg-secondary px-3 py-2 rounded-xl rounded-bl-sm flex items-center gap-2">
                  <Loader2 size={12} className="text-accent animate-spin" />
                  <span className="text-[10px] text-text-secondary">Analisando seus dados...</span>
                </div>
              </div>
            )}
            {error && (
              <p className="text-[10px] text-accent-red text-center px-2">{error}</p>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick prompts */}
          {messages.length <= 1 && (
            <div className="px-3 pb-2 flex gap-1.5 flex-wrap">
              {[
                'Como estão meus gastos este mês?',
                'Onde posso economizar?',
                'Comparar com mês anterior',
                'Analise meu orçamento',
              ].map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => { setInput(prompt); setTimeout(() => inputRef.current?.focus(), 50); }}
                  className="px-2 py-1 text-[10px] bg-bg-secondary border border-border rounded-full text-text-secondary hover:text-text-primary hover:border-accent transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="p-3 border-t border-border flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Pergunte sobre suas finanças..."
              rows={1}
              className="flex-1 resize-none bg-bg-secondary border border-border rounded-lg px-3 py-2 text-xs text-text-primary placeholder-text-secondary focus:outline-none focus:border-accent max-h-24"
              style={{ minHeight: '36px' }}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || loading}
              className="p-2 bg-accent text-bg-primary rounded-lg hover:opacity-90 disabled:opacity-40 flex-shrink-0"
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
