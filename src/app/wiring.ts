// Build "legacy" do PDF.js: inclui polyfills (ex.: Map.prototype.getOrInsertComputed) que o build padrão 5.x
// exige do navegador e que o Chromium do teste E2E não tem. Vale também para navegadores mais antigos.
import * as pdfjsModule from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createRandomIdFactory, resolveLimits, type ExportDeps, type IdFactory, type Limits, type SourceReader } from '../core';
import { createMemorySourceStore } from '../services/memory-source-store';
import { createPdfJsInspector, createPdfJsSourceReader, type PdfJs } from '../pdf/pdfjs-reader';
import { createPdfJsRenderer } from '../pdf/pdfjs-renderer';
import { createPdfLibWriter } from '../pdf/pdflib-writer';
import type { PageRenderer } from '../pdf/renderer-port';

const pdfjs = pdfjsModule as unknown as PdfJs;

export interface Services extends ExportDeps {
  readonly ids: IdFactory;
  readonly reader: SourceReader;
  readonly renderer: PageRenderer;
  readonly limits: Limits;
}

/** Composição das dependências (única camada que conhece as implementações concretas). */
export function createServices(limitOverrides: Partial<Limits> = {}): Services {
  const limits = resolveLimits(limitOverrides);
  (pdfjsModule as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.mjs', document.baseURI).href;
  const options = { standardFontDataUrl: new URL('./standard_fonts/', document.baseURI).href };
  const sources = createMemorySourceStore();
  return {
    ids: createRandomIdFactory(),
    sources,
    reader: createPdfJsSourceReader(pdfjs, options),
    inspector: createPdfJsInspector(pdfjs, options),
    writer: createPdfLibWriter(),
    renderer: createPdfJsRenderer(pdfjs, sources, options, limits),
    limits,
  };
}
