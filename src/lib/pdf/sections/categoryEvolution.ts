import type { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  drawSectionHeader,
  drawSubtitle,
  drawChartImage,
  fmtBRL,
  PDF_THEME,
  drawContinuationHeader,
} from '../layout';
import type { EvolutionRow, ReportData } from '../types';
import type { RenderedChart } from '../renderCharts';

const T = PDF_THEME;

type RowKind = 'section' | 'category' | 'subcategory' | 'resultado';

function sum(values: number[]): number {
  return values.reduce((s, v) => s + v, 0);
}

export function drawCategoryEvolutionSection(
  doc: jsPDF,
  data: ReportData,
  sectionNumber: number,
  charts: { topCategories: RenderedChart | null }
) {
  const sectionTitle = 'Evolução por Categoria';
  doc.addPage('a4', 'l'); // landscape for this section
  let y = drawSectionHeader(doc, {
    number: sectionNumber,
    title: sectionTitle,
    tagline: 'Receitas e despesas mês a mês, com média e total por categoria',
    periodLabel: data.period.label,
  });

  y += 2;

  // Line chart: top 5 categories
  if (charts.topCategories && data.insights.trendCategories.length > 0) {
    y = drawSubtitle(doc, y, 'Top 5 despesas ao longo do período');
    y = drawChartImage(
      doc,
      y,
      charts.topCategories.dataUrl,
      charts.topCategories.width,
      charts.topCategories.height,
      260
    );
  }

  y += 2;
  y = drawSubtitle(doc, y, 'Matriz categorias × meses');

  const months = data.evolution.months;
  const monthLabels = data.evolution.monthLabels;

  const header = ['Categoria', ...monthLabels, 'Média', 'Total'];

  const rows: Array<{ cells: (string | number)[]; kind: RowKind }> = [];

  const pushSection = (label: string, totals: Record<string, number>) => {
    const vals = months.map((m) => totals[m] ?? 0);
    const total = sum(vals);
    const average =
      vals.filter((v) => v !== 0).length > 0
        ? sum(vals.filter((v) => v !== 0)) / vals.filter((v) => v !== 0).length
        : 0;
    rows.push({
      cells: [
        label,
        ...vals.map((v) => (v !== 0 ? fmtBRL(v) : '—')),
        average !== 0 ? fmtBRL(average) : '—',
        total !== 0 ? fmtBRL(total) : '—',
      ],
      kind: 'section',
    });
  };

  const pushCategory = (row: EvolutionRow, kind: 'category' | 'subcategory' = 'category') => {
    const vals = months.map((m) => row.monthTotals[m] ?? 0);
    rows.push({
      cells: [
        kind === 'subcategory' ? `    ${row.label}` : row.label,
        ...vals.map((v) => (v !== 0 ? fmtBRL(v) : '—')),
        row.average !== 0 ? fmtBRL(row.average) : '—',
        row.total !== 0 ? fmtBRL(row.total) : '—',
      ],
      kind,
    });
    if (row.subs) {
      for (const sub of row.subs) {
        pushCategory(sub, 'subcategory');
      }
    }
  };

  // Receitas
  pushSection('RECEITAS', data.evolution.sectionTotals.receitas);
  for (const row of data.evolution.incomeRows) {
    pushCategory(row);
  }

  // Despesas
  pushSection('DESPESAS', data.evolution.sectionTotals.despesas);
  for (const row of data.evolution.expenseRows) {
    pushCategory(row);
  }

  // Resultado (row summing receitas + despesas by month)
  const resultadoByMonth: Record<string, number> = {};
  for (const m of months) {
    resultadoByMonth[m] =
      (data.evolution.sectionTotals.receitas[m] ?? 0) +
      (data.evolution.sectionTotals.despesas[m] ?? 0);
  }
  const resultadoVals = months.map((m) => resultadoByMonth[m]);
  const resultadoTotal = sum(resultadoVals);
  const resultadoAvg =
    resultadoVals.filter((v) => v !== 0).length > 0
      ? sum(resultadoVals.filter((v) => v !== 0)) / resultadoVals.filter((v) => v !== 0).length
      : 0;
  rows.push({
    cells: [
      'RESULTADO',
      ...resultadoVals.map((v) => (v !== 0 ? fmtBRL(v) : '—')),
      resultadoAvg !== 0 ? fmtBRL(resultadoAvg) : '—',
      resultadoTotal !== 0 ? fmtBRL(resultadoTotal) : '—',
    ],
    kind: 'resultado',
  });

  // Dynamic column widths — first col fixed, month cols share remaining space.
  const monthColCount = months.length;
  const firstColWidth = 45;
  const lastColsWidth = 22; // média + total each
  const pageBodyWidth = 297 - 2 * T.layout.marginX;
  const monthColWidth = Math.max(
    13,
    (pageBodyWidth - firstColWidth - lastColsWidth * 2) / monthColCount
  );

  const columnStyles: Record<number, { cellWidth: number; halign?: 'left' | 'right' }> = {
    0: { cellWidth: firstColWidth },
  };
  for (let i = 1; i <= monthColCount; i++) {
    columnStyles[i] = { cellWidth: monthColWidth, halign: 'right' };
  }
  columnStyles[monthColCount + 1] = { cellWidth: lastColsWidth, halign: 'right' };
  columnStyles[monthColCount + 2] = { cellWidth: lastColsWidth, halign: 'right' };

  const firstPageNumber = doc.getNumberOfPages();
  autoTable(doc, {
    startY: y,
    head: [header],
    body: rows.map((r) => r.cells),
    theme: 'plain',
    styles: {
      font: T.font.family,
      fontSize: monthColCount > 12 ? 6.5 : 7.5,
      cellPadding: 1.5,
      textColor: T.rgb.navy as unknown as [number, number, number],
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: T.rgb.navy as unknown as [number, number, number],
      textColor: T.rgb.white as unknown as [number, number, number],
      fontStyle: 'bold',
      fontSize: monthColCount > 12 ? 6.5 : 7.5,
    },
    alternateRowStyles: {
      fillColor: T.rgb.zebra as unknown as [number, number, number],
    },
    columnStyles,
    didParseCell: (hookData) => {
      if (hookData.section !== 'body') return;
      const row = rows[hookData.row.index];
      if (!row) return;
      if (row.kind === 'section') {
        hookData.cell.styles.fillColor = T.rgb.navy as unknown as [number, number, number];
        hookData.cell.styles.textColor = T.rgb.white as unknown as [number, number, number];
        hookData.cell.styles.fontStyle = 'bold';
      } else if (row.kind === 'resultado') {
        hookData.cell.styles.fillColor = [226, 232, 240] as [number, number, number];
        hookData.cell.styles.fontStyle = 'bold';
        if (hookData.column.index > 0) {
          const raw = String(hookData.cell.raw ?? '');
          if (raw && raw !== '—') {
            const isNegative = raw.includes('-');
            hookData.cell.styles.textColor = isNegative
              ? (T.rgb.red as unknown as [number, number, number])
              : (T.rgb.green as unknown as [number, number, number]);
          }
        }
      } else if (row.kind === 'category') {
        if (hookData.column.index === 0) {
          hookData.cell.styles.fontStyle = 'bold';
        }
        if (hookData.column.index > 0) {
          const raw = String(hookData.cell.raw ?? '');
          if (raw && raw !== '—') {
            const isNegative = raw.includes('-');
            hookData.cell.styles.textColor = isNegative
              ? (T.rgb.red as unknown as [number, number, number])
              : (T.rgb.green as unknown as [number, number, number]);
          }
        }
      } else if (row.kind === 'subcategory' && hookData.column.index > 0) {
        const raw = String(hookData.cell.raw ?? '');
        if (raw && raw !== '—') {
          const isNegative = raw.includes('-');
          hookData.cell.styles.textColor = isNegative
            ? (T.rgb.red as unknown as [number, number, number])
            : (T.rgb.green as unknown as [number, number, number]);
        }
      }
    },
    didDrawPage: (hookData) => {
      if (hookData.pageNumber > firstPageNumber) {
        drawContinuationHeader(doc, sectionTitle, data.period.label);
      }
    },
    margin: { top: 28, bottom: 20, left: T.layout.marginX, right: T.layout.marginX },
  });
}
