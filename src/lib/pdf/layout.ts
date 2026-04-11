import type { jsPDF } from 'jspdf';
import { PDF_THEME } from './theme';

/** Shared rendering context passed down to every section. */
export interface PdfCtx {
  doc: jsPDF;
  sectionNumber: number;
  sectionTitle: string;
  periodLabel: string;
  generatedAt: string;
}

const T = PDF_THEME;

/** Convert a currency amount to "R$ 1.234,56". Small wrapper for jsPDF cell rendering. */
export function fmtBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

/** Set the active fill color from a [r,g,b] tuple. */
function setFill(doc: jsPDF, rgb: readonly [number, number, number]) {
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
}

/** Set the active text color. */
function setText(doc: jsPDF, rgb: readonly [number, number, number]) {
  doc.setTextColor(rgb[0], rgb[1], rgb[2]);
}

/** Set the active draw (stroke) color. */
function setDraw(doc: jsPDF, rgb: readonly [number, number, number]) {
  doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
}

/**
 * Draw the cover page (called once, first page).
 * Returns nothing — advances internal doc state.
 */
export function drawCover(
  doc: jsPDF,
  opts: { title: string; subtitle: string; period: string; generatedAt: string }
) {
  const { pageWidth, pageHeight } = T.layout;

  // Background
  setFill(doc, T.rgb.white);
  doc.rect(0, 0, pageWidth, pageHeight, 'F');

  // Top navy band
  setFill(doc, T.rgb.navy);
  doc.rect(0, 0, pageWidth, 55, 'F');

  // Brand in the navy band
  doc.setFont(T.font.family, 'normal');
  doc.setFontSize(9);
  setText(doc, T.rgb.white);
  doc.text(opts.title.toUpperCase(), T.layout.marginX, 20);

  // Amber accent rule under the brand
  setFill(doc, T.rgb.amber);
  doc.rect(T.layout.marginX, 24, 40, 1.2, 'F');

  // Subtitle in the navy band
  doc.setFontSize(11);
  doc.setFont(T.font.family, 'normal');
  setText(doc, T.rgb.white);
  doc.text(opts.subtitle, T.layout.marginX, 35);

  // Big report title centered in the page body
  setText(doc, T.rgb.navy);
  doc.setFont(T.font.family, 'bold');
  doc.setFontSize(T.font.sizeDisplay);
  const reportTitle = T.brand.reportTitle;
  const titleWidth = doc.getTextWidth(reportTitle);
  doc.text(reportTitle, (pageWidth - titleWidth) / 2, 120);

  // Amber rule under title
  setFill(doc, T.rgb.amber);
  doc.rect((pageWidth - 30) / 2, 125, 30, 1.5, 'F');

  // Period label
  doc.setFont(T.font.family, 'normal');
  doc.setFontSize(14);
  setText(doc, T.rgb.slate);
  const periodWidth = doc.getTextWidth(opts.period);
  doc.text(opts.period, (pageWidth - periodWidth) / 2, 140);

  // Footer band
  setFill(doc, T.rgb.zebra);
  doc.rect(0, pageHeight - 30, pageWidth, 30, 'F');

  doc.setFontSize(8);
  setText(doc, T.rgb.slate);
  doc.text(`Gerado em ${opts.generatedAt}`, T.layout.marginX, pageHeight - 17);
  doc.text(
    T.brand.name,
    pageWidth - T.layout.marginX,
    pageHeight - 17,
    { align: 'right' }
  );
}

/**
 * Draw the section header band at the top of a section's first page.
 * Returns the Y coordinate where content rendering should start.
 */
export function drawSectionHeader(
  doc: jsPDF,
  opts: { number: number; title: string; tagline?: string; periodLabel: string }
): number {
  const { pageWidth } = T.layout;

  // Thin navy strip across top
  setFill(doc, T.rgb.navy);
  doc.rect(0, 0, pageWidth, 14, 'F');

  // Brand + period on the strip
  doc.setFont(T.font.family, 'normal');
  doc.setFontSize(7);
  setText(doc, T.rgb.white);
  doc.text(T.brand.name.toUpperCase(), T.layout.marginX, 9);
  doc.text(opts.periodLabel, pageWidth - T.layout.marginX, 9, { align: 'right' });

  // Section number (big amber numeral)
  setText(doc, T.rgb.amber);
  doc.setFont(T.font.family, 'bold');
  doc.setFontSize(28);
  const numText = String(opts.number).padStart(2, '0');
  doc.text(numText, T.layout.marginX, 34);

  // Section title next to the number
  setText(doc, T.rgb.navy);
  doc.setFont(T.font.family, 'bold');
  doc.setFontSize(T.font.sizeTitle);
  doc.text(opts.title, T.layout.marginX + 18, 30);

  // Tagline below
  if (opts.tagline) {
    doc.setFont(T.font.family, 'normal');
    doc.setFontSize(9);
    setText(doc, T.rgb.slate);
    doc.text(opts.tagline, T.layout.marginX + 18, 36);
  }

  // Amber divider under the header
  setFill(doc, T.rgb.amber);
  doc.rect(T.layout.marginX, 42, pageWidth - 2 * T.layout.marginX, 0.8, 'F');

  return 50; // start Y for content
}

export interface KpiCard {
  label: string;
  value: string;
  tone?: 'neutral' | 'positive' | 'negative' | 'accent';
  hint?: string;
}

/**
 * Draw a horizontal row of KPI cards. Returns the Y coordinate after the row.
 */
export function drawKpiRow(
  doc: jsPDF,
  y: number,
  cards: KpiCard[]
): number {
  const { pageWidth, marginX } = T.layout;
  const totalWidth = pageWidth - 2 * marginX;
  const gap = 3;
  const cardWidth = (totalWidth - gap * (cards.length - 1)) / cards.length;
  const cardHeight = 24;

  cards.forEach((card, i) => {
    const x = marginX + i * (cardWidth + gap);

    // Card background
    setFill(doc, T.rgb.zebra);
    doc.rect(x, y, cardWidth, cardHeight, 'F');

    // Left accent stripe
    const toneColor =
      card.tone === 'positive'
        ? T.rgb.green
        : card.tone === 'negative'
        ? T.rgb.red
        : card.tone === 'accent'
        ? T.rgb.amber
        : T.rgb.navy;
    setFill(doc, toneColor);
    doc.rect(x, y, 1.2, cardHeight, 'F');

    // Label
    doc.setFont(T.font.family, 'normal');
    doc.setFontSize(7);
    setText(doc, T.rgb.slate);
    doc.text(card.label.toUpperCase(), x + 4, y + 6);

    // Value
    doc.setFont(T.font.family, 'bold');
    doc.setFontSize(13);
    setText(doc, T.rgb.navy);
    doc.text(card.value, x + 4, y + 15);

    // Hint
    if (card.hint) {
      doc.setFont(T.font.family, 'normal');
      doc.setFontSize(6.5);
      setText(doc, T.rgb.slateLight);
      doc.text(card.hint, x + 4, y + 21);
    }
  });

  return y + cardHeight + 4;
}

/**
 * Draw a callout box with an amber left bar and wrapped text.
 * Returns Y after the callout.
 */
export function drawCallout(
  doc: jsPDF,
  y: number,
  text: string | string[]
): number {
  const { pageWidth, marginX } = T.layout;
  const boxX = marginX;
  const boxWidth = pageWidth - 2 * marginX;
  const innerPadding = 4;
  const barWidth = 1.5;

  doc.setFont(T.font.family, 'normal');
  doc.setFontSize(9);

  const lines = Array.isArray(text) ? text : [text];
  const wrapped: string[] = [];
  for (const line of lines) {
    // splitTextToSize may return string or string[] depending on input
    const split = doc.splitTextToSize(line, boxWidth - innerPadding * 2 - barWidth - 2);
    if (Array.isArray(split)) wrapped.push(...split);
    else wrapped.push(split);
  }
  const lineHeight = 4.5;
  const boxHeight = wrapped.length * lineHeight + innerPadding * 2;

  // Background
  setFill(doc, [255, 251, 235]); // very light amber
  doc.rect(boxX, y, boxWidth, boxHeight, 'F');

  // Amber left bar
  setFill(doc, T.rgb.amber);
  doc.rect(boxX, y, barWidth, boxHeight, 'F');

  // Text
  setText(doc, T.rgb.navy);
  doc.setFont(T.font.family, 'normal');
  doc.setFontSize(9);
  wrapped.forEach((line, i) => {
    doc.text(line, boxX + barWidth + innerPadding, y + innerPadding + 3 + i * lineHeight);
  });

  return y + boxHeight + 4;
}

/**
 * Draw a bullet list of insight strings. Uses the callout box styling but
 * each bullet gets a compact line.
 */
export function drawInsightBullets(
  doc: jsPDF,
  y: number,
  bullets: string[]
): number {
  if (bullets.length === 0) return y;
  const prefixed = bullets.map((b) => `• ${b}`);
  return drawCallout(doc, y, prefixed);
}

/**
 * Draw the footer with page number + brand on the CURRENT page.
 * Called in a second pass after all pages are laid out so we know the total.
 */
export function drawFooter(
  doc: jsPDF,
  pageNum: number,
  totalPages: number,
  generatedAt: string
) {
  const { pageWidth, pageHeight, marginX } = T.layout;

  // Skip the cover (page 1) — it has its own footer
  if (pageNum === 1) return;

  // Thin divider above the footer
  setDraw(doc, T.rgb.divider);
  doc.setLineWidth(0.2);
  doc.line(marginX, pageHeight - 12, pageWidth - marginX, pageHeight - 12);

  doc.setFont(T.font.family, 'normal');
  doc.setFontSize(7);
  setText(doc, T.rgb.slate);
  doc.text(`${T.brand.name} · gerado em ${generatedAt}`, marginX, pageHeight - 7);
  doc.text(
    `Pág. ${pageNum} / ${totalPages}`,
    pageWidth - marginX,
    pageHeight - 7,
    { align: 'right' }
  );
}

/**
 * Ensure there's at least `needed` mm of space left on the current page.
 * If not, add a new page and re-draw a lightweight continuation header.
 * Returns the Y coordinate to continue at.
 */
export function ensureSpace(
  doc: jsPDF,
  currentY: number,
  needed: number,
  sectionTitle: string,
  periodLabel: string
): number {
  const { pageHeight, marginBottom } = T.layout;
  if (currentY + needed <= pageHeight - marginBottom - 12) {
    return currentY;
  }
  doc.addPage('a4', 'p');
  return drawContinuationHeader(doc, sectionTitle, periodLabel);
}

/**
 * Lightweight header drawn on continuation pages (not section intros).
 * Slimmer than drawSectionHeader so the content gets more room.
 */
export function drawContinuationHeader(
  doc: jsPDF,
  sectionTitle: string,
  periodLabel: string
): number {
  const { pageWidth } = T.layout;

  // Thin navy strip
  setFill(doc, T.rgb.navy);
  doc.rect(0, 0, pageWidth, 10, 'F');

  doc.setFont(T.font.family, 'normal');
  doc.setFontSize(7);
  setText(doc, T.rgb.white);
  doc.text(T.brand.name.toUpperCase(), T.layout.marginX, 6.5);
  doc.text(periodLabel, pageWidth - T.layout.marginX, 6.5, { align: 'right' });

  // Section label under the strip
  doc.setFontSize(9);
  doc.setFont(T.font.family, 'bold');
  setText(doc, T.rgb.navy);
  doc.text(sectionTitle.toUpperCase(), T.layout.marginX, 18);

  setFill(doc, T.rgb.amber);
  doc.rect(T.layout.marginX, 21, 25, 0.6, 'F');

  return 28;
}

/** Title for a subsection within a page. Returns Y after the title. */
export function drawSubtitle(doc: jsPDF, y: number, text: string): number {
  doc.setFont(T.font.family, 'bold');
  doc.setFontSize(10);
  setText(doc, T.rgb.navy);
  doc.text(text, T.layout.marginX, y);
  setFill(doc, T.rgb.amber);
  doc.rect(T.layout.marginX, y + 1.5, 10, 0.6, 'F');
  return y + 7;
}

/**
 * Draw a chart image keeping aspect ratio based on natural pixel dimensions.
 * Returns Y after the chart.
 */
export function drawChartImage(
  doc: jsPDF,
  y: number,
  dataUrl: string,
  naturalWidth: number,
  naturalHeight: number,
  targetWidthMm: number
): number {
  const { marginX } = T.layout;
  const aspect = naturalHeight / naturalWidth;
  const targetHeightMm = targetWidthMm * aspect;
  doc.addImage(dataUrl, 'PNG', marginX, y, targetWidthMm, targetHeightMm, undefined, 'FAST');
  return y + targetHeightMm + 4;
}

export { T as PDF_THEME };
