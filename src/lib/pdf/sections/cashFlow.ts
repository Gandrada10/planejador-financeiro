import type { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  drawSectionHeader,
  drawKpiRow,
  drawSubtitle,
  drawCallout,
  fmtBRL,
  PDF_THEME,
  drawContinuationHeader,
} from '../layout';
import type { ReportData } from '../types';

const T = PDF_THEME;

export function drawCashFlowSection(
  doc: jsPDF,
  data: ReportData,
  sectionNumber: number
) {
  const sectionTitle = 'Fluxo de Caixa';
  doc.addPage('a4', 'p');
  let y = drawSectionHeader(doc, {
    number: sectionNumber,
    title: sectionTitle,
    tagline: 'Entradas, saídas e saldo acumulado mês a mês',
    periodLabel: data.period.label,
  });

  y += 2;

  const totalResultado = data.cashFlow.totalEntradas + data.cashFlow.totalSaidas;
  const finalSaldo =
    data.cashFlow.rows.length > 0
      ? data.cashFlow.rows[data.cashFlow.rows.length - 1].saldo
      : data.cashFlow.saldoAnterior;

  y = drawKpiRow(doc, y, [
    {
      label: 'Entradas acumuladas',
      value: fmtBRL(data.cashFlow.totalEntradas),
      tone: 'positive',
    },
    {
      label: 'Saídas acumuladas',
      value: fmtBRL(data.cashFlow.totalSaidas),
      tone: 'negative',
    },
    {
      label: 'Resultado',
      value: fmtBRL(totalResultado),
      tone: totalResultado >= 0 ? 'positive' : 'negative',
    },
    {
      label: 'Saldo final',
      value: fmtBRL(finalSaldo),
      tone: finalSaldo >= 0 ? 'positive' : 'negative',
    },
  ]);

  y += 2;

  // Summary callout
  const positiveMonths = data.cashFlow.rows.filter((r) => r.resultado > 0).length;
  const negativeMonths = data.cashFlow.rows.filter((r) => r.resultado < 0).length;
  const monthsLabel = data.cashFlow.rows.length === 1 ? 'mês' : 'meses';
  y = drawCallout(
    doc,
    y,
    `Período com ${data.cashFlow.rows.length} ${monthsLabel}: ${positiveMonths} positivo${
      positiveMonths !== 1 ? 's' : ''
    } e ${negativeMonths} negativo${negativeMonths !== 1 ? 's' : ''}. Saldo anterior ao período: ${fmtBRL(
      data.cashFlow.saldoAnterior
    )}.`
  );

  y += 2;
  y = drawSubtitle(doc, y, 'Evolução mensal');

  const body: Array<(string | number)[]> = [];
  body.push(['Saldo anterior', '—', '—', '—', fmtBRL(data.cashFlow.saldoAnterior)]);
  for (const row of data.cashFlow.rows) {
    body.push([
      row.label,
      row.entradas > 0 ? fmtBRL(row.entradas) : '—',
      row.saidas < 0 ? fmtBRL(row.saidas) : '—',
      row.resultado !== 0 ? fmtBRL(row.resultado) : '—',
      fmtBRL(row.saldo),
    ]);
  }
  body.push([
    'Total',
    fmtBRL(data.cashFlow.totalEntradas),
    fmtBRL(data.cashFlow.totalSaidas),
    fmtBRL(totalResultado),
    '—',
  ]);

  const firstPageNumber = doc.getNumberOfPages();
  autoTable(doc, {
    startY: y,
    head: [['Período', 'Entradas', 'Saídas', 'Resultado', 'Saldo']],
    body,
    theme: 'plain',
    styles: {
      font: T.font.family,
      fontSize: 9,
      cellPadding: 2.2,
      textColor: T.rgb.navy as unknown as [number, number, number],
    },
    headStyles: {
      fillColor: T.rgb.navy as unknown as [number, number, number],
      textColor: T.rgb.white as unknown as [number, number, number],
      fontStyle: 'bold',
      fontSize: 8.5,
    },
    alternateRowStyles: {
      fillColor: T.rgb.zebra as unknown as [number, number, number],
    },
    columnStyles: {
      0: { cellWidth: 50 },
      1: { cellWidth: 33, halign: 'right' },
      2: { cellWidth: 33, halign: 'right' },
      3: { cellWidth: 33, halign: 'right' },
      4: { cellWidth: 33, halign: 'right' },
    },
    didParseCell: (hookData) => {
      if (hookData.section !== 'body') return;
      const rowIdx = hookData.row.index;
      const colIdx = hookData.column.index;
      const isFirst = rowIdx === 0; // saldo anterior
      const isLast = rowIdx === body.length - 1; // total
      if (isFirst || isLast) {
        hookData.cell.styles.fontStyle = 'bold';
        hookData.cell.styles.fillColor = [226, 232, 240] as [number, number, number];
      }
      // Color negatives/positives in numeric columns
      if (colIdx >= 1 && colIdx <= 4) {
        const raw = String(hookData.cell.raw ?? '');
        if (raw && raw !== '—') {
          // Entradas column is always positive (green), Saídas always negative (red).
          if (colIdx === 1) {
            hookData.cell.styles.textColor = T.rgb.green as unknown as [number, number, number];
          } else if (colIdx === 2) {
            hookData.cell.styles.textColor = T.rgb.red as unknown as [number, number, number];
          } else {
            // Resultado and Saldo: color by sign
            const isNegative = raw.includes('-');
            hookData.cell.styles.textColor = isNegative
              ? (T.rgb.red as unknown as [number, number, number])
              : (T.rgb.green as unknown as [number, number, number]);
          }
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
