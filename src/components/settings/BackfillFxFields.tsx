import { useMemo, useState } from 'react';
import { Globe, Check, AlertTriangle, RefreshCw } from 'lucide-react';
import { useTransactions } from '../../hooks/useTransactions';
import { formatBRL, formatFx } from '../../lib/utils';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import type { Transaction } from '../../types';

/**
 * Backfill dos satélites de moeda estrangeira (`amountFx`/`currencyFx`/
 * `fxRate`) nas transações importadas ANTES desses campos existirem.
 *
 * Naquela versão o importador de extrato em moeda não tinha onde guardar o
 * valor original, então o anexava ao TEXTO da descrição: `"Sephora Paris |
 * EUR 192,75"`. O dado está lá, correto e completo — só preso num lugar de
 * onde nenhuma tela consegue somar. Este utilitário o resgata para os campos
 * próprios e devolve a descrição ao que ela deveria ser (só o nome do
 * estabelecimento), o que de quebra melhora o casamento das regras de
 * categoria, que agem sobre ela.
 *
 * A taxa é DERIVADA (`|amount| / |amountFx|`) em vez de estimada: como o
 * valor em reais foi apreçado pelo FIFO na importação, essa divisão devolve
 * exatamente a taxa do lote que aquele gasto consumiu.
 *
 * IDEMPOTENTE: só toca linhas que casam o padrão E ainda não têm
 * `currencyFx`. Rodar duas vezes não altera nada na segunda.
 */

/** Sufixo que o importador antigo anexava: ` | EUR 1.234,56` no FIM da
 *  descrição. Código de 3 letras maiúsculas + valor em pt-BR. Ancorado no
 *  fim (`$`) de propósito — um "| EUR" no meio do nome de um
 *  estabelecimento não é sufixo de importação e não deve ser tocado. */
const FX_SUFFIX = /\s*\|\s*([A-Z]{3})\s+([\d.]+,\d{2})\s*$/;

interface Candidate {
  id: string;
  before: string;
  after: string;
  amount: number;
  amountFx: number;
  currencyFx: string;
  fxRate: number;
}

function parsePtBr(raw: string): number | null {
  const n = Number(raw.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function toCandidate(t: Transaction): Candidate | null {
  // Já migrada (ou já nasceu com os campos): não mexe.
  if (t.currencyFx) return null;
  const m = FX_SUFFIX.exec(t.description);
  if (!m) return null;
  const magnitude = parsePtBr(m[2]);
  if (!magnitude || magnitude <= 0) return null;
  const clean = t.description.replace(FX_SUFFIX, '').trim();
  // Descrição que vira vazia significa que o "sufixo" era o texto inteiro —
  // não é o caso que este backfill cobre. Deixa quieto.
  if (!clean) return null;
  return {
    id: t.id,
    before: t.description,
    after: clean,
    amount: t.amount,
    // Mesmo sinal do valor em reais, como manda o contrato do campo.
    amountFx: t.amount < 0 ? -magnitude : magnitude,
    currencyFx: m[1],
    fxRate: Math.abs(t.amount) / magnitude,
  };
}

export function BackfillFxFields() {
  const { transactions, loading, batchUpdateVarying } = useTransactions();
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState('');

  const candidates = useMemo(
    () => transactions.map(toCandidate).filter((c): c is Candidate => c !== null),
    [transactions]
  );

  // Agrupa por moeda só para o resumo — o usuário quer saber "quanto de euro
  // vou recuperar", não a lista de 108 linhas.
  const byCurrency = useMemo(() => {
    const acc = new Map<string, { count: number; fx: number; brl: number }>();
    for (const c of candidates) {
      const cur = acc.get(c.currencyFx) ?? { count: 0, fx: 0, brl: 0 };
      cur.count += 1;
      cur.fx += Math.abs(c.amountFx);
      cur.brl += Math.abs(c.amount);
      acc.set(c.currencyFx, cur);
    }
    return [...acc.entries()].sort((a, b) => b[1].brl - a[1].brl);
  }, [candidates]);

  async function run() {
    setConfirming(false);
    setRunning(true);
    setError('');
    try {
      await batchUpdateVarying(
        candidates.map((c) => ({
          id: c.id,
          data: {
            description: c.after,
            amountFx: c.amountFx,
            currencyFx: c.currencyFx,
            fxRate: c.fxRate,
          },
        }))
      );
      setDone(candidates.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao aplicar o backfill.');
    }
    setRunning(false);
  }

  if (loading) return null;

  return (
    <div className="bg-bg-card border border-border rounded-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Globe size={16} className="text-accent" />
        <h3 className="text-title font-semibold text-text-primary">Resgatar moeda estrangeira das descrições</h3>
      </div>

      <p className="text-caption text-text-secondary">
        Lançamentos importados antes dos campos de moeda existirem guardam o valor original
        dentro do texto da descrição (<span className="text-text-primary">"Sephora Paris | EUR 192,75"</span>).
        Este utilitário move esse valor para os campos próprios — o que faz a aba Projetos
        conseguir somar o gasto em euro — e limpa a descrição. O valor em reais não é tocado.
      </p>

      {candidates.length === 0 ? (
        <p className="flex items-center gap-1.5 text-caption text-accent-green">
          <Check size={13} /> Nada a fazer — nenhum lançamento com valor preso na descrição.
        </p>
      ) : (
        <>
          <div className="bg-bg-secondary border border-border rounded-card p-3 space-y-1">
            {byCurrency.map(([cur, agg]) => (
              <p key={cur} className="text-body text-text-primary tnum">
                <b>{agg.count}</b> lançamento{agg.count !== 1 ? 's' : ''} em {cur} ·{' '}
                {formatFx(agg.fx, cur)} · {formatBRL(agg.brl)}
              </p>
            ))}
            <p className="text-caption text-ink-3 pt-1">
              Exemplo: <span className="line-through">{candidates[0].before}</span> →{' '}
              <span className="text-text-primary">{candidates[0].after}</span> +{' '}
              {formatFx(candidates[0].amountFx, candidates[0].currencyFx)} a{' '}
              {formatBRL(candidates[0].fxRate)}/{candidates[0].currencyFx}
            </p>
          </div>

          <button
            onClick={() => setConfirming(true)}
            disabled={running}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-bg-primary text-body font-bold rounded-control hover:opacity-90 disabled:opacity-50"
          >
            {running ? <><RefreshCw size={13} className="animate-spin" /> Aplicando...</> : <>Aplicar em {candidates.length} lançamentos</>}
          </button>
        </>
      )}

      {done !== null && (
        <p className="flex items-center gap-1.5 text-caption text-accent-green">
          <Check size={13} /> {done} lançamento{done !== 1 ? 's' : ''} atualizado{done !== 1 ? 's' : ''}.
        </p>
      )}
      {error && (
        <p role="alert" className="flex items-center gap-1.5 text-caption text-accent-red">
          <AlertTriangle size={13} /> {error}
        </p>
      )}

      {confirming && (
        <ConfirmDialog
          title="Resgatar moeda das descrições?"
          message={`${candidates.length} lançamentos terão a descrição limpa e ganharão os campos de moeda. O valor em reais não muda. A operação é idempotente — rodar de novo não faz nada.`}
          confirmLabel="Aplicar"
          onConfirm={run}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
