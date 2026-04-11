import type { jsPDF } from 'jspdf';
import {
  drawSectionHeader,
  drawKpiRow,
  drawChartImage,
  drawInsightBullets,
  drawSubtitle,
  fmtBRL,
  ensureSpace,
} from '../layout';
import type { ReportData } from '../types';
import type { RenderedChart } from '../renderCharts';

export function drawExecutiveSummarySection(
  doc: jsPDF,
  data: ReportData,
  sectionNumber: number,
  charts: { monthlyResult: RenderedChart | null }
) {
  const sectionTitle = 'Sumário Executivo';
  doc.addPage('a4', 'p');
  let y = drawSectionHeader(doc, {
    number: sectionNumber,
    title: sectionTitle,
    tagline: 'Visão geral dos principais indicadores do período',
    periodLabel: data.period.label,
  });

  y += 2;

  const savingsRatePct = (data.kpis.savingsRate * 100).toFixed(1);
  y = drawKpiRow(doc, y, [
    {
      label: 'Receitas',
      value: fmtBRL(data.kpis.totalEntries),
      tone: 'positive',
      hint: `${data.period.months.length} ${data.period.months.length === 1 ? 'mês' : 'meses'}`,
    },
    {
      label: 'Despesas',
      value: fmtBRL(data.kpis.totalExits),
      tone: 'negative',
      hint: `${data.kpis.transactionCount} lançamentos`,
    },
    {
      label: 'Saldo',
      value: fmtBRL(data.kpis.totalBalance),
      tone: data.kpis.totalBalance >= 0 ? 'positive' : 'negative',
    },
    {
      label: 'Poupança',
      value: `${savingsRatePct}%`,
      tone: data.kpis.savingsRate >= 0 ? 'accent' : 'negative',
      hint: 'saldo / receitas',
    },
  ]);

  y += 2;
  y = drawSubtitle(doc, y, 'Resultado mensal');

  if (charts.monthlyResult) {
    y = drawChartImage(
      doc,
      y,
      charts.monthlyResult.dataUrl,
      charts.monthlyResult.width,
      charts.monthlyResult.height,
      180
    );
  } else {
    y += 2;
  }

  y = ensureSpace(doc, y, 40, sectionTitle, data.period.label);
  y = drawSubtitle(doc, y, 'Destaques do período');
  drawInsightBullets(doc, y, data.insights.callouts);
}
