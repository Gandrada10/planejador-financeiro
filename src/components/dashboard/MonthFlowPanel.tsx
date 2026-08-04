import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarClock } from 'lucide-react';
import { formatBRL0 } from '../../lib/utils';
import { CashFlowSankey } from './CashFlowSankey';
import { computeCategoryFlow, type FlowPeriod } from '../../lib/categoryFlow';
import type { Transaction, Category } from '../../types';
import { SegmentedControl } from '../shared/SegmentedControl';

interface Props {
  transactions: Transaction[];
  categories: Category[];
  monthYear: string;
  isMonthInProgress: boolean;
  /** Categoria em análise no painel lateral (o dashboard é o dono do estado). */
  selectedCategory: string | null;
  onSelectCategory: (id: string | null) => void;
  /** Despesas já lançadas com data no mês seguinte (parcelas contratadas). */
  nextMonthCommitted: number;
  nextMonthLabel: string;
}

/**
 * "Fluxo do dinheiro" — para onde foi, no mês selecionado ou na média dos
 * últimos 12 meses (a leitura estrutural). As duas janelas plotam a mesma
 * coisa, então dividem um card com seletor em vez de dois cards concorrentes;
 * foi assim que a "Composição do gasto · 12 meses" veio parar aqui.
 *
 * O diagrama é de NÍVEL ÚNICO (só categorias-mãe). Subcategoria mora no painel
 * de análise, que abre no clique: em lista ela cabe inteira, com valor, média e
 * Δ; dentro do Sankey virava nome cortado empurrando o resto do desenho.
 */
export function MonthFlowPanel({
  transactions,
  categories,
  monthYear,
  isMonthInProgress,
  selectedCategory,
  onSelectCategory,
  nextMonthCommitted,
  nextMonthLabel,
}: Props) {
  const [period, setPeriod] = useState<FlowPeriod>('month');

  const flow = useMemo(
    () => computeCategoryFlow(transactions, categories, monthYear, isMonthInProgress, period),
    [transactions, categories, monthYear, isMonthInProgress, period]
  );

  // Média mensal 12M por categoria, para o ▲▼ dos rótulos do Sankey.
  // Na visão "Média 12M" não existe delta: o valor exibido É a média.
  const averages = useMemo(() => {
    if (period !== 'month') return undefined;
    const m12 = computeCategoryFlow(transactions, categories, monthYear, isMonthInProgress, 'm12');
    const map = new Map<string, number>();
    for (const c of m12.categories) if (c.amount < 0) map.set(c.id, -c.amount);
    return map;
  }, [transactions, categories, monthYear, isMonthInProgress, period]);

  // Fatia sem categoria dentro das despesas do período — a base do aviso de
  // classificação, que veio do card "O que puxou o ano" ao migrar para o anual.
  const uncategorized = useMemo(() => {
    let spent = 0;
    let uncat = 0;
    for (const c of flow.categories) {
      if (c.amount >= 0) continue;
      spent += -c.amount;
      if (c.id === '__uncategorized') uncat += -c.amount;
    }
    return spent > 0 && uncat > 0 ? { value: uncat, share: uncat / spent } : null;
  }, [flow]);

  return (
    // Altura NATURAL: a coluna vizinha cresce sozinha quando a análise abre
    // ou quando entram mais metas/projetos, sem arrastar o diagrama junto.
    <div className="bg-bg-card border border-border rounded-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-title font-semibold text-text-primary">Fluxo do dinheiro</h3>
          <p className="text-caption text-ink-3 mt-0.5">
            {flow.label} · % sobre tudo que entrou
            {period === 'month' ? ' · ▲▼ vs média 12M' : ''} · toque numa categoria para ver a
            análise e as subcategorias
          </p>
        </div>

        <SegmentedControl
          ariaLabel="Período do fluxo"
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'month', label: 'Este mês' },
            { value: 'm12', label: 'Média 12M' },
          ]}
        />
      </div>

      <CashFlowSankey
        income={flow.income}
        balance={flow.balance}
        categories={flow.categories}
        unit={period === 'm12' ? '/mês' : ''}
        selectedId={selectedCategory}
        onSelectCategory={(id) => onSelectCategory(id === selectedCategory ? null : id)}
        averages={averages}
      />

      {flow.balance < 0 && (
        <p className="text-caption text-ink-3">
          Uso de reservas: o período gastou mais do que entrou — a diferença veio de reserva,
          investimento ou crédito (o app não sabe de qual).
        </p>
      )}

      {/* Este aviso morava no card "O que puxou o ano", que mudou para o
          dashboard anual. A cobrança precisa continuar no dia a dia — e aqui é
          o lugar natural: "Sem categoria" já aparece como fatia deste diagrama. */}
      {uncategorized !== null && uncategorized.share >= 0.05 && (
        <p className="text-caption text-text-secondary leading-snug flex items-start gap-1.5">
          <AlertTriangle size={12} className="flex-shrink-0 mt-0.5 text-status-warn" />
          <span>
            <span className="tnum text-status-warn">{formatBRL0(uncategorized.value)}</span> (
            {(uncategorized.share * 100).toFixed(0)}%) das despesas do período estão sem
            categoria — o fluxo fica em parte inexplicado até classificá-las.{' '}
            <Link
              to={`/transacoes?mes=${monthYear}&categoria=uncategorized`}
              className="text-accent hover:underline whitespace-nowrap"
            >
              Classificar
            </Link>
          </span>
        </p>
      )}

      {/* Curto prazo do planejamento: o que já está contratado para o mês que
          vem (as parcelas futuras que a importação grava adiantadas). */}
      {nextMonthCommitted > 0 && (
        <p className="text-caption text-ink-3 flex items-start gap-1.5">
          <CalendarClock size={12} className="flex-shrink-0 mt-0.5" />
          <span>
            <span className="tnum text-text-secondary">{formatBRL0(nextMonthCommitted)}</span> já
            comprometidos em {nextMonthLabel} — parcelas e lançamentos já registrados com data lá.
          </span>
        </p>
      )}
    </div>
  );
}

