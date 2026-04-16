import { useState, useMemo } from 'react';
import { X, Send, Copy, Check, MessageCircle } from 'lucide-react';
import { useCategorizationSessions } from '../../hooks/useCategorizationSession';
import { getMonthLabel } from '../../lib/utils';
import type { Transaction, Category } from '../../types';

interface Props {
  transactions: Transaction[];
  categories: Category[];
  titulars: string[];
  monthFilter: string;
  onClose: () => void;
}

export function ShareCategorizationModal({ transactions, categories, titulars, monthFilter, onClose }: Props) {
  const { createSession } = useCategorizationSessions();
  const [selectedTitular, setSelectedTitular] = useState(titulars[0] || '');
  const [generatedLink, setGeneratedLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const eligibleTx = useMemo(
    () => transactions.filter(
      (t) => !t.categoryId && (!selectedTitular || t.titular === selectedTitular)
    ),
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
        ? transactions.filter((t) => t.titular === selectedTitular)
        : transactions;
      const token = await createSession(
        selectedTitular || 'Todos',
        filteredTx,
        categories,
        { monthFilter }
      );
      const link = `${window.location.origin}/categorizar/${token}`;
      setGeneratedLink(link);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao gerar link');
    }
    setLoading(false);
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(generatedLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleWhatsApp() {
    const lines = [`Oi! Categoriza ${uncategorizedCount} lançamento${uncategorizedCount === 1 ? '' : 's'} por favor 😊`];
    lines.push(`📅 ${periodLabel}`);
    if (accountsPreview.length > 0) {
      lines.push(`💳 ${accountsPreview.join(' • ')}`);
    }
    lines.push('');
    lines.push(generatedLink);
    const text = encodeURIComponent(lines.join('\n'));
    window.open(`https://wa.me/?text=${text}`, '_blank');
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
                Link gerado! Envie para quem vai categorizar.
              </p>

              <div className="flex gap-2">
                <input
                  readOnly
                  value={generatedLink}
                  className="flex-1 px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-xs font-mono truncate"
                />
                <button
                  onClick={handleCopy}
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
