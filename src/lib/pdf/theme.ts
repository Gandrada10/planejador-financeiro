/**
 * McKinsey-style print-ready theme for the consolidated PDF report.
 * Light background, navy primary, amber accent kept from the app brand.
 */

export const PDF_THEME = {
  colors: {
    white: '#ffffff',
    navy: '#0F1E3C',
    navySoft: '#1E3A5F',
    slate: '#475569',
    slateLight: '#94A3B8',
    zebra: '#F8FAFC',
    divider: '#E2E8F0',
    amber: '#F59E0B',
    green: '#059669',
    red: '#DC2626',
    callout: '#FEF3C7',
    calloutBorder: '#F59E0B',
  },
  rgb: {
    white: [255, 255, 255] as [number, number, number],
    navy: [15, 30, 60] as [number, number, number],
    navySoft: [30, 58, 95] as [number, number, number],
    slate: [71, 85, 105] as [number, number, number],
    slateLight: [148, 163, 184] as [number, number, number],
    zebra: [248, 250, 252] as [number, number, number],
    divider: [226, 232, 240] as [number, number, number],
    amber: [245, 158, 11] as [number, number, number],
    green: [5, 150, 105] as [number, number, number],
    red: [220, 38, 38] as [number, number, number],
    callout: [254, 243, 199] as [number, number, number],
  },
  font: {
    family: 'helvetica',
    sizeDisplay: 26,
    sizeTitle: 18,
    sizeSection: 14,
    sizeSubtitle: 11,
    sizeBody: 9,
    sizeSmall: 7.5,
    sizeTiny: 6,
  },
  layout: {
    pageWidth: 210, // A4 portrait mm
    pageHeight: 297,
    marginX: 15,
    marginTop: 22,
    marginBottom: 18,
    headerHeight: 14,
    footerHeight: 10,
  },
  brand: {
    name: 'Planejador Financeiro Familiar',
    reportTitle: 'RELATÓRIO FINANCEIRO',
  },
} as const;

export type PdfTheme = typeof PDF_THEME;
