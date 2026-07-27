import { useMemo } from 'react';
import { formatBRL, formatDate, getMonthYear, countsInTotals, isExpenseAmount, accountingDate } from '../../lib/utils';
import type { Project, Transaction } from '../../types';

interface Props {
  projects: Project[];
  transactions: Transaction[];
  excludedIds: Set<string>;
  monthYear: string;
}

interface ProjectRow extends Project {
  spentYear: number;
  spentMonth: number;
  spentTotal: number;
  countMonth: number;
  firstYear: number | null;
  lastYear: number | null;
}

/**
 * Projetos do ANO do mês selecionado, separados em "Em andamento" (status
 * active) e "Concluídos" (status archived — o mesmo rótulo "Encerrados" da tela
 * de Projetos).
 *
 * Pertencer a um ano é decidido por cascata, porque startDate/endDate são
 * opcionais e nada os valida:
 *   início = startDate ?? 1º ano com lançamento ?? ano de criação
 *   fim    = endDate ?? (ativo ? ano corrente real : último ano com lançamento)
 * e, em qualquer caso, um ano com lançamento do projeto conta. Assim nenhum
 * projeto some da tela por falta de data.
 */
export function ProjectsPanel({ projects, transactions, excludedIds, monthYear }: Props) {
  const { active, done, year } = useMemo(() => {
    const y = Number(monthYear.split('-')[0]);
    const realYear = new Date().getFullYear();

    // Passe único agrupando por projeto (evita filtrar a lista inteira por projeto).
    type Agg = {
      spentYear: number;
      spentMonth: number;
      spentTotal: number;
      countMonth: number;
      years: Set<number>;
    };
    const agg = new Map<string, Agg>();
    const blank = (): Agg => ({
      spentYear: 0,
      spentMonth: 0,
      spentTotal: 0,
      countMonth: 0,
      years: new Set(),
    });

    for (const t of transactions) {
      if (!t.projectId) continue;
      let entry = agg.get(t.projectId);
      if (!entry) {
        entry = blank();
        agg.set(t.projectId, entry);
      }
      const ad = accountingDate(t);
      entry.years.add(ad.getFullYear());

      const inMonth = getMonthYear(ad) === monthYear;
      if (inMonth) entry.countMonth += 1;

      if (!countsInTotals(t, excludedIds) || !isExpenseAmount(t)) continue;
      entry.spentTotal += t.amount;
      if (ad.getFullYear() === y) entry.spentYear += t.amount;
      if (inMonth) entry.spentMonth += t.amount;
    }

    const rows: ProjectRow[] = [];
    for (const p of projects) {
      const a = agg.get(p.id) ?? blank();
      const txYears = Array.from(a.years);
      const minTxYear = txYears.length > 0 ? Math.min(...txYears) : null;
      const maxTxYear = txYears.length > 0 ? Math.max(...txYears) : null;

      const spanStart =
        p.startDate?.getFullYear() ?? minTxYear ?? p.createdAt?.getFullYear() ?? y;
      const spanEnd =
        p.endDate?.getFullYear() ??
        (p.status === 'active'
          ? Math.max(realYear, maxTxYear ?? realYear)
          : (maxTxYear ?? spanStart));

      const belongs = (y >= spanStart && y <= spanEnd) || a.years.has(y);
      if (!belongs) continue;

      rows.push({
        ...p,
        spentYear: a.spentYear,
        spentMonth: a.spentMonth,
        spentTotal: a.spentTotal,
        countMonth: a.countMonth,
        firstYear: minTxYear,
        lastYear: maxTxYear,
      });
    }

    // Mais relevante primeiro: quem gastou mais no ano.
    rows.sort((a, b) => a.spentYear - b.spentYear || a.name.localeCompare(b.name, 'pt-BR'));

    return {
      active: rows.filter((r) => r.status === 'active'),
      done: rows.filter((r) => r.status === 'archived'),
      year: y,
    };
  }, [projects, transactions, excludedIds, monthYear]);

  return (
    <div className="bg-bg-card border border-border rounded-card p-4 space-y-3">
      <h3 className="text-title font-semibold text-text-primary">Projetos · {year}</h3>

      <Section
        title="Em andamento"
        rows={active}
        emptyLabel={`Nenhum projeto em andamento em ${year}.`}
        secondColLabel="No mês"
        secondColValue={(p) => (p.countMonth > 0 && p.spentMonth < 0 ? p.spentMonth : null)}
        subtitle={(p) => (p.startDate ? `Início: ${formatDate(p.startDate)}` : 'Sem data de início')}
      />

      {done.length > 0 && (
        <Section
          title="Concluídos"
          rows={done}
          secondColLabel="Total"
          secondColValue={(p) => (p.spentTotal < 0 ? p.spentTotal : null)}
          subtitle={(p) => {
            const start = p.startDate ? formatDate(p.startDate) : p.firstYear ? String(p.firstYear) : '—';
            const end = p.endDate ? formatDate(p.endDate) : p.lastYear ? String(p.lastYear) : '—';
            return `${start} – ${end}`;
          }}
          muted
        />
      )}
    </div>
  );
}

const GRID = 'grid grid-cols-[minmax(0,1fr)_repeat(2,minmax(76px,96px))] gap-2 items-center';

interface SectionProps {
  title: string;
  rows: ProjectRow[];
  emptyLabel?: string;
  secondColLabel: string;
  secondColValue: (p: ProjectRow) => number | null;
  subtitle: (p: ProjectRow) => string;
  muted?: boolean;
}

function Section({
  title,
  rows,
  emptyLabel,
  secondColLabel,
  secondColValue,
  subtitle,
  muted,
}: SectionProps) {
  if (rows.length === 0) {
    return emptyLabel ? (
      <div className="space-y-1.5">
        <p className="text-caption font-semibold uppercase tracking-wider text-ink-3">{title}</p>
        <p className="text-caption text-ink-3">{emptyLabel}</p>
      </div>
    ) : null;
  }

  return (
    <div className="space-y-1.5">
      <p className="text-caption font-semibold uppercase tracking-wider text-ink-3">{title}</p>

      <div className={`${GRID} text-caption uppercase tracking-wider text-ink-3`}>
        <span />
        <span className="text-right">No ano</span>
        <span className="text-right">{secondColLabel}</span>
      </div>

      {rows.map((p) => {
        const second = secondColValue(p);
        return (
          <div
            key={p.id}
            className={`${GRID} border-l-2 pl-2 py-0.5`}
            style={{ borderColor: p.color, opacity: muted ? 0.75 : 1 }}
            title={p.spentTotal < 0 ? `Total do projeto (todos os anos): ${formatBRL(p.spentTotal)}` : undefined}
          >
            <div className="min-w-0">
              <p className="text-body text-text-primary truncate font-medium">{p.name}</p>
              <p className="text-caption text-ink-3 mt-0.5 truncate">{subtitle(p)}</p>
            </div>
            <span
              className={`text-body tnum text-right ${p.spentYear < 0 ? 'text-negative' : 'text-ink-3'}`}
            >
              {p.spentYear < 0 ? formatBRL(p.spentYear) : '—'}
            </span>
            <span
              className={`text-body tnum text-right ${second !== null ? 'text-negative' : 'text-ink-3'}`}
            >
              {second !== null ? formatBRL(second) : '—'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
