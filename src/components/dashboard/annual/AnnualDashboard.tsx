import { useMemo } from 'react';
import { FileBarChart } from 'lucide-react';
import { useCategories } from '../../../hooks/useCategories';
import { useBudgets } from '../../../hooks/useBudgets';
import { useProjects } from '../../../hooks/useProjects';
import { YoyDeviationPanel } from '../YoyDeviationPanel';
import { AnnualVitalSigns } from './AnnualVitalSigns';
import { YearProgressCard } from './YearProgressCard';
import { CommitmentsPanel } from './CommitmentsPanel';
import { AnnualFlowChart } from './AnnualFlowChart';
import { AnnualCashFlowTable } from './AnnualCashFlowTable';
import { AnnualHeatmap } from './AnnualHeatmap';
import { AnnualGoalsPanel } from './AnnualGoalsPanel';
import { AnnualProjectsPanel } from './AnnualProjectsPanel';
import {
  resolveAnnualPeriod,
  computeAnnualStats,
  computeAnnualMatrix,
  computeGoalBehavior,
  computeAnnualProjects,
  computeYearProjection,
  computeCommitments,
} from '../../../lib/annualStats';
import type { Transaction } from '../../../types';

interface Props {
  transactions: Transaction[];
}

/**
 * A face ANUAL do dashboard, na ordem de uma narrativa:
 *
 *   1. onde eu estou      — indicadores dos 12 meses fechados (a régua)
 *   2. para onde vou      — ano corrente com projeção, e o que já está contratado
 *   3. como cheguei aqui  — o gráfico mês a mês e o fluxo de caixa
 *   4. onde o dinheiro foi — mapa de calor por categoria
 *   5. o que mudou        — comparação com o mesmo período do ano passado
 *   6. o plano            — metas e projetos
 *
 * Toda a tela é 12 meses móveis, com UMA exceção declarada: o card de ano
 * corrente e o "o que puxou o ano", que são leituras de ciclo. Isso é
 * deliberado — repetir as duas janelas em cada card dobraria a densidade e
 * faria a mesma métrica aparecer com dois valores diferentes na mesma tela.
 */
export function AnnualDashboard({ transactions }: Props) {
  const { categories } = useCategories();
  const { budgets } = useBudgets();
  const { projects } = useProjects();

  // A janela sai do relógio, não de estado: a chave do dashboard é só Mês/Ano.
  const period = useMemo(() => resolveAnnualPeriod(), []);

  const stats = useMemo(
    () => computeAnnualStats(transactions, categories, period),
    [transactions, categories, period]
  );

  const projection = useMemo(() => computeYearProjection(stats), [stats]);

  const commitments = useMemo(
    () => computeCommitments(transactions, categories),
    [transactions, categories]
  );

  const matrix = useMemo(
    () => computeAnnualMatrix(transactions, categories, period),
    [transactions, categories, period]
  );

  // `budgets` cru em vez de `getBudgetsForMonth`: o helper devolve um array novo
  // a cada render, o que quebraria a memoização de uma janela de 12 meses.
  const goals = useMemo(
    () => computeGoalBehavior(transactions, categories, budgets, period),
    [transactions, categories, budgets, period]
  );

  const projectRows = useMemo(
    () => computeAnnualProjects(projects, transactions, categories, period),
    [projects, transactions, categories, period]
  );

  if (!stats.hasData) {
    return (
      <div className="bg-bg-card border border-border rounded-card p-10 text-center space-y-2">
        <FileBarChart size={24} className="mx-auto text-ink-3" strokeWidth={1.5} />
        <p className="text-body text-text-primary">Sem histórico nos últimos 12 meses</p>
        <p className="text-caption text-ink-3">
          A leitura anual precisa de meses fechados ({period.label}). Conforme os meses forem
          fechando, esta tela se popula sozinha.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <AnnualVitalSigns stats={stats} />

      {/* O bloco do futuro: onde o ano termina, e o que já está contratado.
          Lado a lado porque são a mesma pergunta vista de dois ângulos —
          a projeção estima, os compromissos são certeza. */}
      {/* `min-w-0` nos filhos: sem isso um item de grid não encolhe abaixo da
          largura mínima do próprio conteúdo, e os wrappers `.scroll-x` de
          dentro dos cards nunca chegam a rolar — a página inteira é que estoura
          na horizontal. É a mesma razão das colunas do dashboard mensal. */}
      <div className="grid grid-cols-1 lg:grid-cols-[4fr_3fr] gap-4">
        <div className="min-w-0">
          <YearProgressCard projection={projection} ytdLabel={period.ytdLabel} />
        </div>
        <div className="min-w-0">
          <CommitmentsPanel commitments={commitments} />
        </div>
      </div>

      {/* O gráfico ACIMA do fluxo de caixa: a forma do ano primeiro, os números
          exatos depois — quem só quer a tendência para na primeira tela. */}
      <AnnualFlowChart stats={stats} />
      <AnnualCashFlowTable stats={stats} />

      <AnnualHeatmap matrix={matrix} period={period} />

      {/* "O que puxou o ano" veio do dashboard mensal: ele sempre comparou
          jan→último mês fechado contra o mesmo período do ano passado, uma
          leitura anual que estava na face errada. A matemática não mudou —
          só passa a receber o mês fechado da janela em vez do mês selecionado. */}
      <YoyDeviationPanel
        transactions={transactions}
        categories={categories}
        monthYear={period.endKey}
        isMonthInProgress={false}
        periodLabel={period.ytdRangeLabel}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[4fr_3fr] gap-4 items-start">
        <div className="min-w-0">
          <AnnualGoalsPanel goals={goals} period={period} />
        </div>
        <div className="min-w-0">
          <AnnualProjectsPanel rows={projectRows} period={period} />
        </div>
      </div>
    </div>
  );
}
