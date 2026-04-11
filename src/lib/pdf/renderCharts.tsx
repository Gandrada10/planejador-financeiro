import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';

/** Result of a rendered chart ready to embed in jsPDF. */
export interface RenderedChart {
  dataUrl: string;
  width: number;
  height: number;
}

/** Options to control the off-screen sandbox. */
export interface RenderChartOptions {
  /** CSS width of the container in pixels. Recharts will lay out charts inside this. */
  width: number;
  /** CSS height of the container in pixels. */
  height: number;
  /** Device pixel ratio multiplier for the output PNG. Higher = crisper, bigger. */
  pixelRatio?: number;
}

/**
 * Render a React chart off-screen and serialize it to a PNG data URL via
 * html-to-image. The sandbox enforces a light-theme (white bg, navy text) by
 * overriding the app's global CSS custom properties locally so the dark UI
 * theme doesn't bleed into the PDF output.
 *
 * Always await this inside a try/finally at the caller level so a failure
 * mid-generation doesn't leak a createRoot into the document body.
 */
export async function renderChartToPng(
  element: ReactElement,
  options: RenderChartOptions
): Promise<RenderedChart> {
  const { width, height, pixelRatio = 2 } = options;

  const sandbox = document.createElement('div');
  // Fixed off-screen position so the browser still lays it out (needed by
  // Recharts' ResponsiveContainer), but the user can't see it.
  sandbox.style.position = 'fixed';
  sandbox.style.top = '0';
  sandbox.style.left = '-10000px';
  sandbox.style.width = `${width}px`;
  sandbox.style.height = `${height}px`;
  sandbox.style.background = '#ffffff';
  sandbox.style.color = '#0F1E3C';
  sandbox.style.padding = '0';
  sandbox.style.margin = '0';
  sandbox.style.pointerEvents = 'none';
  sandbox.setAttribute('aria-hidden', 'true');
  // Override theme tokens so nothing from :root bleeds in.
  sandbox.style.setProperty('--color-bg-primary', '#ffffff');
  sandbox.style.setProperty('--color-bg-secondary', '#ffffff');
  sandbox.style.setProperty('--color-bg-card', '#ffffff');
  sandbox.style.setProperty('--color-text-primary', '#0F1E3C');
  sandbox.style.setProperty('--color-text-secondary', '#475569');
  sandbox.style.setProperty('--color-border', '#E2E8F0');

  document.body.appendChild(sandbox);

  let root: Root | null = null;
  try {
    root = createRoot(sandbox);
    root.render(element);

    // Wait for layout to settle — Recharts needs at least one paint cycle to
    // compute its internal dimensions from ResponsiveContainer.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    // Extra microtask flush for any pending promises.
    await Promise.resolve();

    // Lazy import so the main bundle stays small.
    const { toPng } = await import('html-to-image');
    const dataUrl = await toPng(sandbox, {
      pixelRatio,
      backgroundColor: '#ffffff',
      width,
      height,
      cacheBust: true,
    });

    return { dataUrl, width, height };
  } finally {
    // Unmount inside try/finally so a failed capture doesn't leak React roots.
    try {
      root?.unmount();
    } catch {
      // noop
    }
    if (sandbox.parentNode) {
      sandbox.parentNode.removeChild(sandbox);
    }
  }
}
