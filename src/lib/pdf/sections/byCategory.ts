import type { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatDate } from '../../utils';
import {
  drawSectionHeader,
  drawKpiRow,
  drawSubtitle,
  fmtBRL,
  PDF_THEME,
  drawContinuationHeader,
} from '../layout';
import type { ReportData } from '../types';

const T = PDF_THEME;

type RowKind = 'category' | 'subcategory' | 'transaction';

export function drawByCategorySection(
  doc: jsPDF,
  data: ReportData,
  sectionNumber: number
) {
  const sectionTitle = 'Detalhamento por Categoria';
  doc.addPage('a4', 'p');
  let y = drawSectionHeader(doc, {
    number: sectionNumber,
    title: sectionTitle,
    tagline: 'Hierarquia de categorias, subcategorias e lançamentos',
    periodLabel: data.period.label,
  });

  y += 2;

  y = drawKpiRow(doc, y, [
    {
      label: 'Receitas',
      value: fmtBRL(data.byCategory.totalEntries),
      tone: 'positive',
    },
    {
      label: 'Despesas',
      value: fmtBRL(data.byCategory.totalExits),
      tone: 'negative',
    },
    {
      label: 'Saldo',
      value: fmtBRL(data.byCategory.totalBalance),
      tone: data.byCategory.totalBalance >= 0 ? 'positive' : 'negative',
    },
  ]);

  y += 2;
  y = drawSubtitle(doc, y, 'Lançamentos agrupados');

  if (data.byCategory.groups.length === 0) {
    doc.setFont(T.font.family, 'normal');
    doc.setFontSize(9);
    doc.setTextColor(T.rgb.slate[0], T.rgb.slate[1], T.rgb.slate[2]);
    doc.text('Nenhum lançamento no período.', T.layout.marginX, y + 4);
    return;
  }

  // Flat body with a row-kind marker we can read back in didParseCell.
  const body: Array<{ cells: string[]; kind: RowKind }> = [];

  for (const group of data.byCategory.groups) {
    body.push({
      cells: [
        '',
        `${group.label} (${group.percentage.toFixed(1)}%)`,
        '',
        '',
        fmtBRL(group.total),
      ],
      kind: 'category',
    });

    for (const sub of group.subs) {
      const showSubHeader = group.subs.length > 1 || sub.label !== group.label;
      if (showSubHeader) {
        body.push({
          cells: [
            '',
            `    ${sub.label} (${sub.percentage.toFixed(1)}%)`,
            '',
            '',
            fmtBRL(sub.total),
          ],
          kind: 'subcategory',
        });
      }

      for (const t of sub.transactions) {
        const parcelLabel = t.totalInstallments
          ? ` (${t.installmentNumber}/${t.totalInstallments})`
          : '';
        const titular = t.titular ? ` · ${t.titular}` : '';
        body.push({
          cells: [
            formatDate(t.date),
            `        ${t.description}${parcelLabel}`,
            t.account,
            titular.replace(' · ', ''),
            fmtBRL(t.amount),
          ],
          kind: 'transaction',
        });
      }
    }
  }

  const firstPageNumber = doc.getNumberOfPages();
  autoTable(doc, {
    startY: y,
    head: [['Data', 'Descrição', 'Conta', 'Titular', 'Valor']],
    body: body.map((r) => r.cells),
    theme: 'plain',
    styles: {
      font: T.font.family,
      fontSize: 7.5,
      cellPadding: 1.8,
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
      0: { cellWidth: 20 },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 28 },
      3: { cellWidth: 28 },
      4: { cellWidth: 28, halign: 'right' },
    },
    didParseCell: (hookData) => {
      if (hookData.section !== 'body') return;
      const row = body[hookData.row.index];
      if (!row) return;
      if (row.kind === 'category') {
        hookData.cell.styles.fillColor = T.rgb.navy as unknown as [number, number, number];
        hookData.cell.styles.textColor = T.rgb.white as unknown as [number, number, number];
        hookData.cell.styles.fontStyle = 'bold';
      } else if (row.kind === 'subcategory') {
        hookData.cell.styles.fillColor = [226, 232, 240] as [number, number, number]; // divider
        hookData.cell.styles.textColor = T.rgb.navy as unknown as [number, number, number];
        hookData.cell.styles.fontStyle = 'bold';
      } else if (row.kind === 'transaction' && hookData.column.index === 4) {
        // Color the amount column green/red for transactions
        const amountStr = row.cells[4];
        const isNegative = amountStr.includes('-');
        hookData.cell.styles.textColor = isNegative
          ? (T.rgb.red as unknown as [number, number, number])
          : (T.rgb.green as unknown as [number, number, number]);
      }
    },
    didDrawPage: (hookData) => {
      // Re-draw continuation header on pages added by autoTable pagination
      if (hookData.pageNumber > firstPageNumber) {
        drawContinuationHeader(doc, sectionTitle, data.period.label);
      }
    },
    margin: { top: 28, bottom: 20, left: T.layout.marginX, right: T.layout.marginX },
  });
}
