import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createSequentialIdFactory, exportDocument, openDocument, DocumentSession } from '../src/core';
import type { DocumentState, ExportDeps, IdFactory } from '../src/core';
import { createMemorySourceStore } from '../src/services/memory-source-store';
import { createPdfJsInspector, createPdfJsSourceReader, type PdfJs } from '../src/pdf/pdfjs-reader';
import { createPdfLibWriter } from '../src/pdf/pdflib-writer';

// Build "legacy" do PDF.js no Node (sem canvas: só leitura/extração, o que basta para os testes).
export const nodePdfJs = pdfjs as unknown as PdfJs;
const pdfJsOptions = { standardFontDataUrl: new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).pathname };

export interface TestEnv extends ExportDeps {
  readonly ids: IdFactory;
  readonly reader: ReturnType<typeof createPdfJsSourceReader>;
  readonly sources: ReturnType<typeof createMemorySourceStore>;
}

export function createTestEnv(): TestEnv {
  return {
    ids: createSequentialIdFactory(),
    sources: createMemorySourceStore(),
    reader: createPdfJsSourceReader(nodePdfJs, pdfJsOptions),
    inspector: createPdfJsInspector(nodePdfJs, pdfJsOptions),
    writer: createPdfLibWriter(),
  };
}

export async function openSample(env: TestEnv, bytes: Uint8Array, name = 'sample.pdf'): Promise<DocumentState> {
  return openDocument({ name, bytes }, env);
}

export { DocumentSession, exportDocument };

/** Congela recursivamente: qualquer mutação acidental dentro do core vira TypeError nos testes. */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

export const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
import { createHash } from 'node:crypto';
