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

function buildContext(transactions: Transaction[], categories: Category[], budgets: Budget[]): string {
  const now = new Date();
  const currentMonth = getMonthYear(now);

  // Last 6 months summary
  const monthLines: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const m = getMonthYearOffset(currentMonth, -i);
    const txs = transactions.filter((t) => getMonthYear(t.date) === m);
    const income = txs.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const expenses = txs.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);
    if (txs.length > 0) {
      monthLines.push(
        `  ${getMonthLabel(m)}: Receitas ${formatBRL(income)}, Despesas ${formatBRL(Math.abs(expenses))}, Saldo ${formatBRL(income + expenses)} (${txs.length} lancamentos)`
      );
    }
  }

  // Current month details
  const currentTxs = transactions.filter((t) => getMonthYear(t.date) === currentMonth);
  const currentIncome = currentTxs.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const currentExpenses = currentTxs.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);

  // Top spending categories this month
  const catTotals = new Map<string, number>();
  for (const t of currentTxs) {
    if (t.amount < 0 && t.categoryId) {
      catTotals.set(t.categoryId, (catTotals.get(t.categoryId) || 0) + Math.abs(t.amount));
    }
  }
  const topCats = Array.from(catTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, total]) => {
      const cat = categories.find((c) => c.id === id);
      const parent = cat?.parentId ? categories.find((c) => c.id === cat.parentId) : null;
      const name = parent ? `${parent.name} / ${cat!.name}` : (cat?.name || 'Sem categoria');
      return `  ${name}: ${formatBRL(total)}`;
    });

  // Uncategorized amount
  const uncatTotal = Math.abs(currentTxs.filter((t) => t.amount < 0 && !t.categoryId).reduce((s, t) => s + t.amount, 0));
  if (uncatTotal > 0) topCats.push(`  Sem categoria: ${formatBRL(uncatTotal)}`);

  // Budget adherence this month
  const monthBudgets = budgets.filter((b) => b.monthYear === currentMonth);
  const budgetLines = monthBudgets.map((b) => {
    const cat = categories.find((c) => c.id === b.categoryId);
    const actual = Math.abs(currentTxs.filter((t) => t.categoryId === b.categoryId && t.amount < 0).reduce((s, t) => s + t.amount, 0));
    const pct = b.limitAmount > 0 ? ((actual / b.limitAmount) * 100).toFixed(0) : '0';
    const status = actual > b.limitAmount ? 'EXCEDIDO' : actual > b.limitAmount * 0.8 ? 'proximo do limite' : 'OK';
    return `  ${cat?.name || '?'}: gasto ${formatBRL(actual)} de ${formatBRL(b.limitAmount)} (${pct}%) — ${status}`;
  });

  // By member
  const memberTotals = new Map<string, number>();
  for (const t of currentTxs) {
    if (t.amount < 0) {
      const key = t.titular || t.familyMember || 'Sem identificacao';
      memberTotals.set(key, (memberTotals.get(key) || 0) + Math.abs(t.amount));
    }
  }
  const memberLines = Array.from(memberTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, total]) => `  ${name}: ${formatBRL(total)}`);

  // Largest individual expenses this month
  const top5 = [...currentTxs]
    .filter((t) => t.amount < 0)
    .sort((a, b) => a.amount - b.amount)
    .slice(0, 5)
    .map((t) => {
      const cat = categories.find((c) => c.id === t.categoryId);
      return `  ${t.description} (${cat?.name || 'sem cat.'}): ${formatBRL(t.amount)}`;
    });

  const lines = [
    `Data de referencia: ${now.toLocaleDateString('pt-BR')} — Mes atual: ${getMonthLabel(currentMonth)}`,
    '',
    '=== HISTORICO 6 MESES ===',
    ...monthLines,
    '',
    `=== MES ATUAL: ${getMonthLabel(currentMonth)} ===`,
    `Total receitas: ${formatBRL(currentIncome)}`,
    `Total despesas: ${formatBRL(Math.abs(currentExpenses))}`,
    `Saldo do mes: ${formatBRL(currentIncome + currentExpenses)}`,
    '',
    'Gastos por categoria:',
    ...topCats,
  ];

  if (memberLines.length > 1) {
    lines.push('', 'Gastos por membro/titular:', ...memberLines);
  }

  if (top5.length > 0) {
    lines.push('', 'Maiores lancamentos do mes:', ...top5);
  }

  if (budgetLines.length > 0) {
    lines.push('', '=== ORCAMENTOS ===', ...budgetLines);
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
