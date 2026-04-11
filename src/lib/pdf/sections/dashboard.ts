import type { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  drawSectionHeader,
  drawKpiRow,
  drawChartImage,
  drawSubtitle,
  fmtBRL,
  ensureSpace,
  PDF_THEME,
} from '../layout';
import type { ReportData } from '../types';
import type { RenderedChart } from '../renderCharts';

const T = PDF_THEME;

export function drawDashboardSection(
  doc: jsPDF,
  data: ReportData,
  sectionNumber: number,
  charts: { expensesDonut: RenderedChart | null }
) {
  const sectionTitle = 'Visão Geral';
  doc.addPage('a4', 'p');
  let y = drawSectionHeader(doc, {
    number: sectionNumber,
    title: sectionTitle,
    tagline: 'Dashboard consolidado — KPIs, orçamento e despesas por categoria',
    periodLabel: data.period.label,
  });

  y += 2;

  // KPIs: YTD / 12m / cash flow
  const biggestExpense = data.dashboard.expensesByCategory[0];
  y = drawKpiRow(doc, y, [
    {
      label: `Acumulado ${data.period.endMonth.slice(0, 4)}`,
      value: fmtBRL(data.kpis.ytdBalance),
      tone: data.kpis.ytdBalance >= 0 ? 'positive' : 'negative',
      hint: 'ano-calendário',
    },
    {
      label: 'Média mensal (12m)',
      value: fmtBRL(data.kpis.avg12Months),
      tone: data.kpis.avg12Months >= 0 ? 'positive' : 'negative',
    },
    {
      label: 'Maior despesa',
      value: biggestExpense ? biggestExpense.name : '—',
      tone: 'neutral',
      hint: biggestExpense ? `${biggestExpense.percentage.toFixed(1)}% do total` : undefined,
    },
    {
      label: 'Transações',
      value: String(data.kpis.transactionCount),
      tone: 'neutral',
      hint: 'no período',
    },
  ]);

  y += 2;
  y = drawSubtitle(doc, y, 'Despesas por categoria');

  if (charts.expensesDonut && data.dashboard.expensesByCategory.length > 0) {
    y = drawChartImage(
      doc,
      y,
      charts.expensesDonut.dataUrl,
      charts.expensesDonut.width,
      charts.expensesDonut.height,
      180
    );
  }

  // Top 10 category table
  y = ensureSpace(doc, y, 60, sectionTitle, data.period.label);
  y = drawSubtitle(doc, y, 'Top categorias de despesa');

  const top10 = data.dashboard.expensesByCategory.slice(0, 10);
  if (top10.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [['Categoria', 'Valor', '% do total']],
      body: top10.map((c) => [
        c.name,
        fmtBRL(c.amount),
        `${c.percentage.toFixed(1)}%`,
      ]),
      theme: 'plain',
      styles: {
        font: T.font.family,
        fontSize: 9,
        cellPadding: 2,
        textColor: T.rgb.navy as unknown as [number, number, number],
      },
      headStyles: {
        fillColor: T.rgb.navy as unknown as [number, number, number],
        textColor: T.rgb.white as unknown as [number, number, number],
        fontStyle: 'bold',
        fontSize: 8,
      },
      alternateRowStyles: {
        fillColor: T.rgb.zebra as unknown as [number, number, number],
      },
      columnStyles: {
        0: { cellWidth: 'auto' },
        1: { cellWidth: 40, halign: 'right' },
        2: { cellWidth: 25, halign: 'right' },
      },
      margin: { left: T.layout.marginX, right: T.layout.marginX },
    });
    // @ts-expect-error autoTable augments doc.lastAutoTable at runtime
    y = (doc.lastAutoTable?.finalY ?? y) + 4;
  }

  // Budgets
  if (data.dashboard.budgets.length > 0) {
    y = ensureSpace(doc, y, 50, sectionTitle, data.period.label);
    y = drawSubtitle(doc, y, 'Metas de despesas');

    autoTable(doc, {
      startY: y,
      head: [['Categoria', 'Limite', 'Realizado', '% utilizado']],
      body: data.dashboard.budgets.map((b) => [
        b.categoryName,
        fmtBRL(b.limit),
        fmtBRL(b.actual),
        `${b.pct.toFixed(0)}%`,
      ]),
      theme: 'plain',
      styles: {
        font: T.font.family,
        fontSize: 9,
        cellPadding: 2,
        textColor: T.rgb.navy as unknown as [number, number, number],
      },
      headStyles: {
        fillColor: T.rgb.navy as unknown as [number, number, number],
        textColor: T.rgb.white as unknown as [number, number, number],
        fontStyle: 'bold',
        fontSize: 8,
      },
      alternateRowStyles: {
        fillColor: T.rgb.zebra as unknown as [number, number, number],
      },
      columnStyles: {
        0: { cellWidth: 'auto' },
        1: { cellWidth: 35, halign: 'right' },
        2: { cellWidth: 35, halign: 'right' },
        3: { cellWidth: 25, halign: 'right' },
      },
      didParseCell: (hookData) => {
        if (hookData.section !== 'body') return;
        if (hookData.column.index === 3) {
          const pct = data.dashboard.budgets[hookData.row.index]?.pct ?? 0;
          if (pct > 100) {
            hookData.cell.styles.textColor = T.rgb.red as unknown as [number, number, number];
            hookData.cell.styles.fontStyle = 'bold';
          }
        }
      },
      margin: { left: T.layout.marginX, right: T.layout.marginX },
    });
  }
}
