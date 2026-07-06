import { useState, useMemo } from 'react';
import { X, Send, Copy, Check, MessageCircle } from 'lucide-react';
import { useCategorizationSessions } from '../../hooks/useCategorizationSession';
import { getMonthLabel } from '../../lib/utils';
import type { Transaction, Category, CategoryRule } from '../../types';

interface Props {
  transactions: Transaction[];
  categories: Category[];
  titulars: string[];
  monthFilter: string;
  onClose: () => void;
  /** Regras do dono, usadas para pré-calcular as sugestões da sessão. */
  rules?: CategoryRule[];
  /** Base completa de transações (todos os meses) — fonte do histórico de sugestões. */
  allTransactions?: Transaction[];
}

export function ShareCategorizationModal({ transactions, categories, titulars, monthFilter, onClose, rules = [], allTransactions }: Props) {
  const { createSession } = useCategorizationSessions();
  const [selectedTitular, setSelectedTitular] = useState(titulars[0] || '');
  const [generatedLink, setGeneratedLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // O seletor oferece o nome CANÔNICO do membro (allTitulars prioriza
  // familyMember). Uma transação guarda o membro em DOIS campos-texto:
  // `familyMember` (canônico, casado no import) e `titular` (string crua do
  // cartão/legado MDW). Comparar só com `titular` fazia o filtro "não achar"
  // (bug reportado). Casa contra os dois, normalizando caixa/espaços — igual ao
  // filtro da própria página de Transações.
  const matchesTitular = (t: Transaction, sel: string) => {
    if (!sel) return true;
    const s = sel.trim().toLowerCase();
    return (t.familyMember || '').trim().toLowerCase() === s ||
      (t.titular || '').trim().toLowerCase() === s;
  };

  const eligibleTx = useMemo(
    () => transactions.filter((t) => !t.categoryId && matchesTitular(t, selectedTitular)),
    [transactions, selectedTitular]
  );
  const uncategorizedCount = eligibleTx.length;
  const accountsPreview = useMemo(
    () => Array.from(new Set(eligibleTx.map((t) => t.account).filter(Boolean))).sort(),
    [eligibleTx]
  );
  const periodLabel = monthFilter && monthFilter !== 'all' ? getMonthLabel(monthFilter) : 'Todos os meses';

  async function handleGenerate() {
    setLoading(true);
    setError('');
    try {
      const filteredTx = selectedTitular
        ? transactions.filter((t) => matchesTitular(t, selectedTitular))
        : transactions;
      const token = await createSession(
        selectedTitular || 'Todos',
        filteredTx,
        categories,
        { monthFilter },
        rules,
        allTransactions ?? transactions
      );
      const link = `${window.location.origin}/categorizar/${token}`;
      setGeneratedLink(link);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao gerar link');
    }
    setLoading(false);
  }

  // Mensagem completa de compartilhamento (saudação + período + contas + link).
  // Fix jul/2026: o "Copiar" copiava só o link — a mensagem com a conta só
  // existia no botão WhatsApp. Agora TODO caminho compartilha o texto completo.
  function buildShareMessage(): string {
    const lines = [`Oi! Categoriza ${uncategorizedCount} lançamento${uncategorizedCount === 1 ? '' : 's'} por favor 😊`];
    lines.push(`📅 ${periodLabel}`);
    if (accountsPreview.length > 0) {
      lines.push(`💳 ${accountsPreview.join(' • ')}`);
    }
    lines.push('');
    lines.push(generatedLink);
    return lines.join('\n');
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(buildShareMessage());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleWhatsApp() {
    const text = encodeURIComponent(buildShareMessage());
    const win = window.open(`https://wa.me/?text=${text}`, '_blank');
    if (!win) {
      // Popup bloqueado (PWA standalone / desktop): não falha em silêncio —
      // cai para copiar a mensagem completa, pronta pra colar.
      void handleCopy();
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-bg-card border border-border rounded-lg w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
            <Send size={16} className="text-accent" />
            Enviar para Categorizar
          </h3>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {!generatedLink ? (
            <>
              <p className="text-xs text-text-secondary">
                Gere um link para alguem categorizar as transacoes sem precisar de login. O link expira em 48h.
              </p>

              <div>
                <label className="block text-[10px] text-text-secondary mb-1 uppercase tracking-wider">
                  Titular (filtrar transacoes de quem?)
                </label>
                <select
                  value={selectedTitular}
                  onChange={(e) => setSelectedTitular(e.target.value)}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-sm focus:outline-none focus:border-accent"
                >
                  <option value="">Todos</option>
                  {titulars.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div className="bg-bg-secondary rounded p-3 text-xs text-text-secondary">
                {uncategorizedCount > 0 ? (
                  <span><strong className="text-accent">{uncategorizedCount}</strong> transacoes sem categoria (despesas e receitas) serao enviadas.</span>
                ) : (
                  <span>Nenhuma transacao sem categoria encontrada{selectedTitular ? ` para ${selectedTitular}` : ''}.</span>
                )}
              </div>

              {error && (
                <div className="text-xs text-accent-red bg-accent-red/10 rounded p-2">{error}</div>
              )}

              <button
                onClick={handleGenerate}
                disabled={loading || uncategorizedCount === 0}
                className="w-full py-2 bg-accent text-bg-primary font-bold text-sm rounded hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? 'Gerando...' : 'Gerar Link'}
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-text-secondary">
                Link gerado! Copiar leva a mensagem pronta (período, contas e link) para colar no WhatsApp.
              </p>

              <div className="flex gap-2">
                <input
                  readOnly
                  value={generatedLink}
                  className="flex-1 px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-xs truncate"
                />
                <button
                  onClick={handleCopy}
                  title="Copiar mensagem completa"
                  aria-label="Copiar mensagem completa (período, contas e link)"
                  className="px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary hover:border-accent"
                >
                  {copied ? <Check size={16} className="text-accent-green" /> : <Copy size={16} />}
                </button>
              </div>

              <button
                onClick={handleWhatsApp}
                className="w-full py-2 bg-[#25D366] text-white font-bold text-sm rounded hover:opacity-90 flex items-center justify-center gap-2"
              >
                <MessageCircle size={16} />
                Enviar pelo WhatsApp
              </button>

              <button
                onClick={onClose}
                className="w-full py-2 bg-bg-secondary border border-border text-text-primary text-sm rounded hover:border-accent"
              >
                Fechar
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
