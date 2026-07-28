import { useMemo, useState } from 'react';
import { formatBRL, formatBRL0, getMonthYear, countsInTotals, isExpenseAmount, accountingDate } from '../../lib/utils';
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

/** Fatia da trilha que cabe ao orçado; o resto é a zona de estouro. */
const BUDGET_ZONE = 86;
/** Teto da zona de estouro: ela representa de 100% a 200% do orçado. */
const OVER_CAP = 200;
/** Piso visual do excedente — 102% precisa aparecer, não virar um fio. */
const MIN_OVER = 0.16;
/** A partir daqui o rótulo avisa que está perto de estourar. */
const NEAR = 85;

const MONTH_ABBR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const since = (d: Date) => `${MONTH_ABBR[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;

/**
 * Régua de orçamento no idioma do bullet chart, com ZONA DE ESTOURO
 * RESERVADA: a trilha reserva sempre uma faixa à direita para o excedente, e
 * a linha do 100% fica na MESMA posição em todas as linhas do card — é isso
 * que deixa os projetos comparáveis de relance.
 *
 * Enquanto não é atingida, a faixa é apenas translúcida (sem cor de alarme).
 * Ao estourar, o preenchimento do orçado vira cinza (deixou de ser progresso,
 * virou teto ultrapassado) e o excedente cresce dentro da faixa até 200% do
 * orçado; daí em diante ela satura hachurada — não cresce mais, só muda de
 * aparência, e o valor em reais ao lado carrega a magnitude real.
 */
function BudgetBar({ spent, budget, color }: { spent: number; budget: number | null; color: string }) {
  if (budget === null || budget <= 0) {
    return (
      <div className="h-2.5 rounded-full bg-elevated overflow-hidden">
        <div className="h-full w-full opacity-30" style={{ backgroundColor: color }} />
      </div>
    );
  }

  const pct = (spent / budget) * 100;
  const over = pct > 100;
  const overRatio = over ? Math.max(Math.min((pct - 100) / (OVER_CAP - 100), 1), MIN_OVER) : 0;
  const saturated = pct >= OVER_CAP;

  return (
    <div className="relative h-2.5">
      <div className="absolute inset-0 rounded-full overflow-hidden flex">
        <div className="h-full bg-elevated" style={{ width: `${BUDGET_ZONE}%` }}>
          <div
            className="h-full"
            style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: over ? '#8f8e89' : color }}
          />
        </div>
        {/* Zona reservada: translúcida enquanto intacta — sem alarme à toa. */}
        <div
          className="h-full"
          style={{ width: `${100 - BUDGET_ZONE}%`, backgroundColor: 'rgba(255,255,255,0.05)' }}
        >
          {over && (
            <div
              className="h-full"
              style={
                saturated
                  ? { width: '100%', backgroundImage: 'repeating-linear-gradient(135deg, #e05a4d 0 4px, #b8453a 4px 8px)' }
                  : { width: `${overRatio * 100}%`, backgroundColor: '#e05a4d' }
              }
            />
          )}
        </div>
      </div>
      {/* Marcador do 100%: mesma posição em toda linha do card. */}
      <div
        className="absolute top-[-2px] bottom-[-2px] w-[2px] rounded-full"
        style={{ left: `${BUDGET_ZONE}%`, backgroundColor: '#f5f4f2', opacity: 0.85 }}
      />
    </div>
  );
}

function budgetLabel(spent: number, budget: number | null) {
  if (budget === null || budget <= 0) return { text: 'sem orçamento', cls: 'text-ink-3' };
  const pct = (spent / budget) * 100;
  if (pct > 100) return { text: `estourou ${formatBRL0(spent - budget)}`, cls: 'text-negative font-semibold' };
  if (pct >= NEAR) return { text: `faltam ${formatBRL0(budget - spent)}`, cls: 'text-status-warn' };
  return { text: `faltam ${formatBRL0(budget - spent)}`, cls: 'text-ink-3' };
}

/**
 * Projetos do ANO do mês selecionado. "Em andamento" (status active) ocupa o
 * corpo do card; "Concluídos" (archived) colapsa numa linha que expande — era
 * a mesma tabela repetida com opacidade menor.
 *
 * Pertencer a um ano é decidido por cascata, porque startDate/endDate são
 * opcionais e nada os valida:
 *   início = startDate ?? 1º ano com lançamento ?? ano de criação
 *   fim    = endDate ?? (ativo ? ano corrente real : último ano com lançamento)
 * e, em qualquer caso, um ano com lançamento do projeto conta. Assim nenhum
 * projeto some da tela por falta de data.
 */
export function ProjectsPanel({ projects, transactions, excludedIds, monthYear }: Props) {
  const [showDone, setShowDone] = useState(false);

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

  const totalYear = active.reduce((s, p) => s + p.spentYear, 0);
  const doneYear = done.reduce((s, p) => s + p.spentYear, 0);

  return (
    <div className="bg-bg-card border border-border rounded-card p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-title font-semibold text-text-primary">Projetos · {year}</h3>
        {totalYear < 0 && (
          <p className="text-caption text-ink-3 tnum">{formatBRL0(-totalYear)} no ano</p>
        )}
      </div>

      {/* Duas seções rotuladas: em andamento é o que ainda consome dinheiro;
          concluído é histórico do ano, então vem depois e recolhido. */}
      <div className="space-y-2">
        <p className="text-caption font-semibold uppercase tracking-wider text-ink-3">
          Em andamento
        </p>
        {active.length === 0 ? (
          <p className="text-caption text-ink-3">Nenhum projeto em andamento em {year}.</p>
        ) : (
          <div className="space-y-3">
            {active.map((p) => (
              <Row key={p.id} p={p} />
            ))}
          </div>
        )}
      </div>

      {done.length > 0 && (
        <div className="pt-2 border-t border-border">
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            aria-expanded={showDone}
            className="tap w-full flex items-baseline gap-1.5 text-left text-caption font-semibold uppercase tracking-wider text-ink-3 hover:text-text-secondary transition-colors"
          >
            <span className="normal-case tracking-normal">{showDone ? '⌄' : '›'}</span>
            Concluídos em {year}
            <span className="font-normal normal-case tracking-normal">
              ({done.length}
              {doneYear < 0 && <> · <span className="tnum">{formatBRL0(-doneYear)}</span> no ano</>})
            </span>
          </button>
          {showDone && (
            <div className="space-y-3 mt-2.5">
              {done.map((p) => (
                <Row key={p.id} p={p} muted />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ p, muted }: { p: ProjectRow; muted?: boolean }) {
  // Gasto do projeto INTEIRO contra o orçamento: um orçamento de reforma não
  // se renova em janeiro. O "no ano" continua na linha de baixo.
  const spent = -p.spentTotal;
  const label = budgetLabel(spent, p.budget ?? null);
  const start = p.startDate ?? (p.firstYear ? new Date(p.firstYear, 0, 1) : p.createdAt);

  return (
    <div className="space-y-1" style={muted ? { opacity: 0.75 } : undefined}>
      <div className="flex items-baseline gap-2 min-w-0">
        <span
          className="w-0.5 h-3.5 rounded-full flex-shrink-0 self-center"
          style={{ backgroundColor: p.color }}
        />
        <span className="text-body text-text-primary font-medium truncate flex-1">{p.name}</span>
        <span className="text-caption text-ink-3 flex-shrink-0">
          desde {since(start)}
          {p.endDate && ` – ${since(p.endDate)}`}
        </span>
      </div>

      <BudgetBar spent={spent} budget={p.budget ?? null} color={p.color} />

      <div
        className="flex items-baseline gap-2 text-caption min-w-0"
        title={`Total do projeto: ${formatBRL(spent)}${p.budget ? ` de ${formatBRL(p.budget)}` : ''}`}
      >
        <span className="tnum text-text-primary flex-shrink-0">{formatBRL0(spent)}</span>
        <span className="text-ink-3 flex-shrink-0">
          {p.budget ? `de ${formatBRL0(p.budget)}` : 'gasto até aqui'}
        </span>
        <span className={`flex-1 text-right tnum truncate ${label.cls}`}>{label.text}</span>
        <span className="text-ink-3 tnum flex-shrink-0">
          {p.spentMonth < 0 ? `· ${formatBRL0(-p.spentMonth)} no mês` : '· sem gasto no mês'}
        </span>
      </div>
    </div>
  );
}
