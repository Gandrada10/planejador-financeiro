import { computeReportData } from './computeReportData';
import { drawCover, drawFooter, PDF_THEME } from './layout';
import { drawExecutiveSummarySection } from './sections/executiveSummary';
import { drawDashboardSection } from './sections/dashboard';
import { drawByCategorySection } from './sections/byCategory';
import { drawCashFlowSection } from './sections/cashFlow';
import { drawCategoryEvolutionSection } from './sections/categoryEvolution';
import { renderChartToPng, type RenderedChart } from './renderCharts';
import type { ReportDeps, ReportPeriod } from './types';

export interface GenerateFullReportOptions {
  /** File name without extension. Defaults to "relatorio_<period>". */
  filename?: string;
  /**
   * When true, returns a Blob instead of triggering a download.
   * Useful for testing / custom handling.
   */
  returnBlob?: boolean;
}

/**
 * Main entry: generate the McKinsey-style consolidated PDF report.
 *
 * High-level flow:
 *   1. Compute report data (pure functions, no React).
 *   2. Pre-render the three Recharts charts off-screen to PNG data URLs.
 *   3. Instantiate jsPDF and draw each section in order.
 *   4. Two-pass footer drawing: stamp page numbers after all pages exist.
 *   5. Save or return blob.
 */
export async function generateFullReport(
  deps: ReportDeps,
  period: ReportPeriod,
  options: GenerateFullReportOptions = {}
): Promise<Blob | void> {
  const data = computeReportData(deps, period);

  // 1. Pre-render charts (React off-screen → PNG). Done before we create the
  //    PDF so any failure short-circuits early without partial documents.
  const charts = await renderAllCharts(data);

  // 2. Lazy-import jsPDF so the main bundle stays unaffected.
  const { default: jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const generatedAt = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date());

  // PDF metadata (accessibility + searchability)
  doc.setProperties({
    title: `${PDF_THEME.brand.reportTitle} — ${data.period.label}`,
    author: PDF_THEME.brand.name,
    subject: 'Relatório financeiro consolidado',
    keywords: 'relatório, financeiro, planejador, dashboard, fluxo de caixa, categorias',
    creator: PDF_THEME.brand.name,
  });

  // 3. Cover page (first page, no addPage call)
  drawCover(doc, {
    title: PDF_THEME.brand.name,
    subtitle: data.period.label,
    period: data.period.label,
    generatedAt,
  });

  // 4. Sections in order
  drawExecutiveSummarySection(doc, data, 1, { monthlyResult: charts.monthlyResult });
  drawDashboardSection(doc, data, 2, { expensesDonut: charts.expensesDonut });
  drawByCategorySection(doc, data, 3);
  drawCashFlowSection(doc, data, 4);
  drawCategoryEvolutionSection(doc, data, 5, { topCategories: charts.topCategories });

  // 5. Second pass: stamp footer + page numbers on every page.
  // @ts-expect-error jsPDF's types don't fully expose internal.getNumberOfPages
  const totalPages: number = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    drawFooter(doc, i, totalPages, generatedAt);
  }

  // 6. Save or return
  const filename =
    options.filename ||
    `relatorio_completo_${data.period.startMonth}_${data.period.endMonth}.pdf`;

  if (options.returnBlob) {
    return doc.output('blob');
  }
  doc.save(filename);
}

async function renderAllCharts(
  data: ReturnType<typeof computeReportData>
): Promise<{
  monthlyResult: RenderedChart | null;
  expensesDonut: RenderedChart | null;
  topCategories: RenderedChart | null;
}> {
  // Lazy-import each chart component so they only ship when the report runs.
  const [
    { MonthlyResultPdf },
    { ExpensesDonutPdf },
    { TopCategoriesPdf },
  ] = await Promise.all([
    import('./charts/MonthlyResultPdf'),
    import('./charts/ExpensesDonutPdf'),
    import('./charts/TopCategoriesPdf'),
  ]);
  const { createElement } = await import('react');

  // Sizes in CSS px — jsPDF will scale these down when embedding.
  const CHART_WIDTH = 720;
  const CHART_HEIGHT = 320;

  let monthlyResult: RenderedChart | null = null;
  let expensesDonut: RenderedChart | null = null;
  let topCategories: RenderedChart | null = null;

  try {
    if (data.insights.monthlyResult.length > 0) {
      monthlyResult = await renderChartToPng(
        createElement(MonthlyResultPdf, {
          data: data.insights.monthlyResult,
          width: CHART_WIDTH,
          height: CHART_HEIGHT,
        }),
        { width: CHART_WIDTH, height: CHART_HEIGHT }
      );
    }
  } catch (e) {
    console.warn('[pdf] Failed to render monthly result chart', e);
  }

  try {
    if (data.dashboard.expensesByCategory.length > 0) {
      expensesDonut = await renderChartToPng(
        createElement(ExpensesDonutPdf, {
          data: data.dashboard.expensesByCategory,
          width: CHART_WIDTH,
          height: CHART_HEIGHT,
        }),
        { width: CHART_WIDTH, height: CHART_HEIGHT }
      );
    }
  } catch (e) {
    console.warn('[pdf] Failed to render expenses donut chart', e);
  }

  try {
    if (
      data.insights.trendCategories.length > 0 &&
      data.insights.topExpenseTrend.length > 0
    ) {
      topCategories = await renderChartToPng(
        createElement(TopCategoriesPdf, {
          data: data.insights.topExpenseTrend,
          categories: data.insights.trendCategories,
          width: CHART_WIDTH,
          height: CHART_HEIGHT,
        }),
        { width: CHART_WIDTH, height: CHART_HEIGHT }
      );
    }
  } catch (e) {
    console.warn('[pdf] Failed to render top categories chart', e);
  }

  return { monthlyResult, expensesDonut, topCategories };
}
