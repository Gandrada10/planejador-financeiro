import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { History, Trash2, ExternalLink, AlertTriangle, Check, RefreshCw } from 'lucide-react';
import { useTransactions } from '../../hooks/useTransactions';
import { formatBRL, formatDate } from '../../lib/utils';
import { groupImportBatches, type ImportBatchSummary } from '../../lib/importBatches';
import { ConfirmDialog } from '../shared/ConfirmDialog';

/**
 * Histórico de importações, com desfazer.
 *
 * Fecha o buraco que tornava a importação uma aposta: não havia como VER o
 * que uma importação tinha criado nem como voltar atrás. Cada linha aqui é um
 * lote (`importBatch`), com para onde foi, quanto somou e quantos
 * lançamentos ainda existem dele — e o botão que apaga o lote inteiro de uma
 * vez, em vez de caçar linha a linha na lista.
 *
 * A CONTAGEM é o dado mais útil da tela: se um lote entrou com 108 e mostra
 * 3, alguém apagou 105 à mão e sobraram 3 perdidos. Se mostra 108 depois de
 * uma limpeza que parecia ter funcionado, a limpeza não pegou.
 */
export function ImportBatches() {
  const { transactions, loading, batchDelete } = useTransactions();
  const navigate = useNavigate();
  const [target, setTarget] = useState<ImportBatchSummary | null>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState('');

  const batches = useMemo(() => groupImportBatches(transactions), [transactions]);

  async function undo(batch: ImportBatchSummary) {
    setTarget(null);
    setRunning(true);
    setError('');
    try {
      await batchDelete(batch.ids);
      setDone(`${batch.count} lançamento${batch.count !== 1 ? 's' : ''} da importação removido${batch.count !== 1 ? 's' : ''}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao desfazer a importação.');
    }
    setRunning(false);
  }

  if (loading) return null;

  return (
    <div className="bg-bg-card border border-border rounded-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <History size={16} className="text-accent" />
        <h3 className="text-title font-semibold text-text-primary">Importações</h3>
      </div>
      <p className="text-caption text-text-secondary">
        Cada importação de extrato ou fatura fica registrada aqui. Dá para conferir onde os
        lançamentos caíram e desfazer a importação inteira — útil quando ela vai para a conta
        errada. Só apaga lançamentos criados por aquela importação; nada mais é tocado.
      </p>

      {batches.length === 0 ? (
        <p className="text-body text-text-secondary">Nenhuma importação registrada.</p>
      ) : (
        <div className="space-y-2">
          {batches.map((b) => {
            // Conta vazia é o caso que mais dá trabalho de achar na lista, e é
            // justamente o que passa despercebido — destaca.
            const semConta = b.accounts.find((a) => a.name === '');
            return (
              <div key={b.id} className="bg-bg-secondary border border-border rounded-card p-3 space-y-1.5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-body font-semibold text-text-primary">
                      {b.at ? b.at.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : b.id}
                      <span className="text-text-secondary font-normal">
                        {' · '}{b.count} lançamento{b.count !== 1 ? 's' : ''} · {formatBRL(b.total)}
                      </span>
                    </p>
                    <p className="text-caption text-text-secondary">
                      {b.firstDate && b.lastDate && <>{formatDate(b.firstDate)}–{formatDate(b.lastDate)} · </>}
                      {b.accounts.map((a) => `${a.name || 'SEM CONTA'} (${a.count})`).join(' · ')}
                    </p>
                    <p className="text-caption text-ink-3 truncate">{b.sample.join(' · ')}</p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => navigate(`/transacoes?importacao=${b.id}&mes=all`)}
                      className="flex items-center gap-1.5 px-2.5 py-1 text-caption rounded-control border border-border text-text-secondary hover:border-accent hover:text-accent"
                    >
                      <ExternalLink size={12} /> Ver
                    </button>
                    <button
                      onClick={() => setTarget(b)}
                      disabled={running}
                      className="flex items-center gap-1.5 px-2.5 py-1 text-caption rounded-control border border-border text-text-secondary hover:border-accent-red/60 hover:text-accent-red disabled:opacity-40"
                    >
                      {running ? <RefreshCw size={12} className="animate-spin" /> : <Trash2 size={12} />} Desfazer
                    </button>
                  </div>
                </div>
                {semConta && (
                  <p className="flex items-center gap-1.5 text-caption text-status-warn">
                    <AlertTriangle size={12} className="shrink-0" />
                    {semConta.count} lançamento{semConta.count !== 1 ? 's' : ''} sem conta definida — em
                    Transações, filtre por "Sem conta" para corrigir.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {done && (
        <p className="flex items-center gap-1.5 text-caption text-accent-green">
          <Check size={13} /> {done}
        </p>
      )}
      {error && (
        <p role="alert" className="flex items-center gap-1.5 text-caption text-accent-red">
          <AlertTriangle size={13} /> {error}
        </p>
      )}

      {target && (
        <ConfirmDialog
          title="Desfazer esta importação?"
          message={`${target.count} lançamento${target.count !== 1 ? 's' : ''} serão apagados${
            target.accounts.length > 1 ? ` (em ${target.accounts.length} contas diferentes)` : ''
          }. Lançamentos que você já apagou à mão não voltam, e nada além deste lote é tocado. Não dá para desfazer.`}
          confirmLabel="Apagar lançamentos"
          destructive
          onConfirm={() => undo(target)}
          onCancel={() => setTarget(null)}
        />
      )}
    </div>
  );
}
