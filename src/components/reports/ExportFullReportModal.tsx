import { useMemo, useState } from 'react';
import { X, FileBarChart, Loader2 } from 'lucide-react';
import { useTransactions } from '../../hooks/useTransactions';
import { useCategories } from '../../hooks/useCategories';
import { useBudgets } from '../../hooks/useBudgets';
import { useAccounts } from '../../hooks/useAccounts';
import { useProjects } from '../../hooks/useProjects';
import { getMonthYear, getMonthYearOffset, getMonthLabel } from '../../lib/utils';
import type { ReportPeriod } from '../../lib/pdf/types';

interface Props {
  open: boolean;
  onClose: () => void;
}

type PeriodKind = 'month' | 'quarter' | 'year' | 'custom';

export function ExportFullReportModal({ open, onClose }: Props) {
  const { transactions } = useTransactions();
  const { categories, rootCategories, subCategories } = useCategories();
  const { budgets } = useBudgets();
  const { accounts } = useAccounts();
  const { projects } = useProjects();

  const [kind, setKind] = useState<PeriodKind>('month');
  const [monthYear, setMonthYear] = useState(() => getMonthYear());
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [quarter, setQuarter] = useState<1 | 2 | 3 | 4>(() =>
    (Math.floor(new Date().getMonth() / 3) + 1) as 1 | 2 | 3 | 4
  );
  const [customStart, setCustomStart] = useState(() =>
    getMonthYearOffset(getMonthYear(), -5)
  );
  const [customEnd, setCustomEnd] = useState(() => getMonthYear());

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derive available months/years from transactions so the pickers only show
  // periods where data can reasonably exist.
  const availableMonths = useMemo(() => {
    const set = new Set(transactions.map((t) => getMonthYear(t.date)));
    set.add(getMonthYear());
    return Array.from(set).sort().reverse();
  }, [transactions]);

  const availableYears = useMemo(() => {
    const set = new Set(transactions.map((t) => getMonthYear(t.date).slice(0, 4)));
    set.add(String(new Date().getFullYear()));
    return Array.from(set)
      .map(Number)
      .sort((a, b) => b - a);
  }, [transactions]);

  // Build the ReportPeriod based on current picker state.
  function buildPeriod(): ReportPeriod {
    switch (kind) {
      case 'month':
        return { kind: 'month', monthYear };
      case 'quarter':
        return { kind: 'quarter', year, quarter };
      case 'year':
        return { kind: 'year', year };
      case 'custom':
        return { kind: 'custom', startMonth: customStart, endMonth: customEnd };
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const period = buildPeriod();
      // Validate custom range
      if (period.kind === 'custom' && period.startMonth > period.endMonth) {
        throw new Error('A data inicial deve ser anterior ou igual à data final.');
      }
      const { generateFullReport } = await import('../../lib/pdf/generateFullReport');
      await generateFullReport(
        {
          transactions,
          categories,
          rootCategories,
          subCategories,
          budgets,
          accounts,
          projects,
        },
        period
      );
      onClose();
    } catch (e) {
      console.error('[ExportFullReport] generation failed', e);
      setError(
        e instanceof Error ? e.message : 'Falha ao gerar o relatório. Tente novamente.'
      );
    } finally {
      setGenerating(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg-card border border-border rounded-lg w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <FileBarChart size={16} className="text-accent" />
            <h3 className="text-sm font-bold text-text-primary">
              Exportar Relatório Completo
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary transition-colors"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">
          <p className="text-xs text-text-secondary">
            Gera um PDF consolidado com capa, sumário executivo, dashboard e os 3
            relatórios (categorias, fluxo de caixa e evolução) no padrão McKinsey.
          </p>

          {/* Period kind selector */}
          <div>
            <label className="text-[10px] text-text-secondary uppercase tracking-wider font-bold mb-2 block">
              Período
            </label>
            <div className="grid grid-cols-4 gap-1">
              {(
                [
                  ['month', 'Mês'],
                  ['quarter', 'Trimestre'],
                  ['year', 'Ano'],
                  ['custom', 'Personalizado'],
                ] as [PeriodKind, string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setKind(value)}
                  className={`px-2 py-1.5 text-xs rounded border transition-colors ${
                    kind === value
                      ? 'bg-accent/10 text-accent border-accent/40'
                      : 'bg-bg-secondary border-border text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Kind-specific inputs */}
          {kind === 'month' && (
            <div>
              <label className="text-[10px] text-text-secondary uppercase tracking-wider font-bold mb-2 block">
                Mês
              </label>
              <select
                value={monthYear}
                onChange={(e) => setMonthYear(e.target.value)}
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-xs capitalize focus:outline-none focus:border-accent"
              >
                {availableMonths.map((m) => (
                  <option key={m} value={m} className="capitalize">
                    {getMonthLabel(m)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {kind === 'quarter' && (
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-text-secondary uppercase tracking-wider font-bold mb-2 block">
                  Ano
                </label>
                <select
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent"
                >
                  {availableYears.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-text-secondary uppercase tracking-wider font-bold mb-2 block">
                  Trimestre
                </label>
                <div className="grid grid-cols-4 gap-1">
                  {([1, 2, 3, 4] as const).map((q) => (
                    <button
                      key={q}
                      onClick={() => setQuarter(q)}
                      className={`px-2 py-1.5 text-xs rounded border transition-colors ${
                        quarter === q
                          ? 'bg-accent/10 text-accent border-accent/40'
                          : 'bg-bg-secondary border-border text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      Q{q}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {kind === 'year' && (
            <div>
              <label className="text-[10px] text-text-secondary uppercase tracking-wider font-bold mb-2 block">
                Ano
              </label>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent"
              >
                {availableYears.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          )}

          {kind === 'custom' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-text-secondary uppercase tracking-wider font-bold mb-2 block">
                  Início
                </label>
                <input
                  type="month"
                  value={customStart}
                  onChange={(e) => e.target.value && setCustomStart(e.target.value)}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="text-[10px] text-text-secondary uppercase tracking-wider font-bold mb-2 block">
                  Fim
                </label>
                <input
                  type="month"
                  value={customEnd}
                  onChange={(e) => e.target.value && setCustomEnd(e.target.value)}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent"
                />
              </div>
            </div>
          )}

          {error && (
            <div className="px-3 py-2 bg-accent-red/10 border border-accent-red/30 rounded text-xs text-accent-red">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button
            onClick={onClose}
            disabled={generating}
            className="px-4 py-2 text-xs text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleGenerate}
            disabled={generating || transactions.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-accent text-bg-primary text-xs font-bold rounded hover:bg-accent/90 transition-colors disabled:opacity-50"
          >
            {generating ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                Gerando...
              </>
            ) : (
              <>
                <FileBarChart size={13} />
                Gerar PDF
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
