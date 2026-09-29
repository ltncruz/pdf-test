import type * as PdfJsNamespace from 'pdfjs-dist';
import type { SourceId } from '../core/document/ids';
import type { SourceStore } from '../core/ports';
import { DEFAULT_LIMITS, clampRenderScale, planCanvas, type Limits } from '../core/limits';
import { createConcurrencyLimiter } from '../services/concurrency-limiter';
import type { PdfJs, PdfJsOptions } from './pdfjs-reader';
import type { PageRenderer } from './renderer-port';

/**
 * Renderizador PDF.js. Guardrails: no máximo `limits.maxConcurrentRenders` renderizações simultâneas (fila FIFO,
 * cancelável), escala restrita à faixa permitida e canvas nunca acima de `limits.maxCanvasPixels`.
 */
export function createPdfJsRenderer(pdfjs: PdfJs, sources: SourceStore, options: PdfJsOptions = {}, limits: Limits = DEFAULT_LIMITS): PageRenderer {
  const docs = new Map<SourceId, Promise<PdfJsNamespace.PDFDocumentProxy>>();
  const limiter = createConcurrencyLimiter(limits.maxConcurrentRenders);
  const open = (id: SourceId): Promise<PdfJsNamespace.PDFDocumentProxy> => {
    let doc = docs.get(id);
    if (!doc) {
      doc = sources.get(id).then((bytes) => pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, ...options }).promise);
      // Se a abertura falhar, não deixar a promessa rejeitada em cache.
      doc.catch(() => docs.delete(id));
      docs.set(id, doc);
    }
    return doc;
  };

  return {
    async render({ sourceId, index, rotation, scale, canvas, signal }) {
      let release: () => void;
      try {
        release = await limiter.acquire(signal);
      } catch {
        return null; // cancelado enquanto esperava vaga
      }
      try {
        if (signal?.aborted) return null;
        const doc = await open(sourceId);
        const page = await doc.getPage(index + 1);
        try {
          if (signal?.aborted) return null;
          const viewport = page.getViewport({ scale: clampRenderScale(scale, limits), rotation });
          const dpr = (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1;
          const plan = planCanvas(viewport.width, viewport.height, dpr, limits);
          canvas.width = plan.width;
          canvas.height = plan.height;
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          const task = page.render({ canvas, viewport, transform: plan.outputScale === 1 ? undefined : [plan.outputScale, 0, 0, plan.outputScale, 0, 0] });
          const onAbort = (): void => task.cancel();
          signal?.addEventListener('abort', onAbort, { once: true });
          try {
            await task.promise;
          } catch (error) {
            if ((error as { name?: string }).name === 'RenderingCancelledException') return null;
            throw error;
          } finally {
            signal?.removeEventListener('abort', onAbort);
          }
          return { reducedResolution: plan.reduced };
        } finally {
          page.cleanup();
        }
      } finally {
        release();
      }
    },
    async release(sourceId) {
      const doc = docs.get(sourceId);
      docs.delete(sourceId);
      if (doc) await doc.then((d) => d.destroy()).catch(() => undefined);
    },
    async dispose() {
      const all = [...docs.values()];
      docs.clear();
      await Promise.all(all.map((d) => d.then((x) => x.destroy()).catch(() => undefined)));
    },
  };
}
