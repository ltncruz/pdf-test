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
export function createPdfJsRenderer(
  pdfjs: PdfJs,
  sources: SourceStore,
  options: PdfJsOptions = {},
  limits: Limits = DEFAULT_LIMITS
): PageRenderer {

  type LoadedDocument = {
    task?: PdfJsNamespace.PDFDocumentLoadingTask;
    promise: Promise<PdfJsNamespace.PDFDocumentProxy>;
  };


  const docs = new Map<SourceId, LoadedDocument>();

  const limiter = createConcurrencyLimiter(limits.maxConcurrentRenders);


  const open = (
    id: SourceId
  ): Promise<PdfJsNamespace.PDFDocumentProxy> => {

    const existing = docs.get(id);

    if (existing) {
      return existing.promise;
    }


    const loaded = {} as LoadedDocument;


    loaded.promise = sources.get(id).then((bytes) => {

      const task = pdfjs.getDocument({
        data: bytes.slice(),
        ...options,
      });


      loaded.task = task;


      return task.promise;

    });


    docs.set(id, loaded);


    loaded.promise.catch(() => {

      if (docs.get(id) === loaded) {
        docs.delete(id);
      }

    });


    return loaded.promise;
  };


  return {

    async render({ sourceId, index, rotation, scale, canvas, signal }) {

      let release: () => void;


      try {

        release = await limiter.acquire(signal);

      } catch {

        return null;

      }


      try {

        if (signal?.aborted) {
          return null;
        }


        const doc = await open(sourceId);

        const page = await doc.getPage(index + 1);


        try {

          if (signal?.aborted) {
            return null;
          }


          const viewport = page.getViewport({
            scale: clampRenderScale(scale, limits),
            rotation,
          });


          const dpr =
  (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1;


const plan = planCanvas(
  viewport.width,
  viewport.height,
  dpr,
  limits
);


          canvas.width = plan.width;
          canvas.height = plan.height;

          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;


          const task = page.render({
            canvas,
            viewport,
            transform:
              plan.outputScale === 1
                ? undefined
                : [
                    plan.outputScale,
                    0,
                    0,
                    plan.outputScale,
                    0,
                    0,
                  ],
          });


          const onAbort = (): void => task.cancel();


          signal?.addEventListener('abort', onAbort, {
            once: true,
          });


          try {

            await task.promise;

          } catch (error) {

            if (
              (error as { name?: string }).name ===
              'RenderingCancelledException'
            ) {
              return null;
            }

            throw error;

          } finally {

            signal?.removeEventListener('abort', onAbort);

          }


          return {
            reducedResolution: plan.reduced,
          };


        } finally {

          page.cleanup();

        }


      } finally {

        release();

      }

    },


    async release(sourceId) {

      const loaded = docs.get(sourceId);


      if (!loaded) {
        return;
      }


      docs.delete(sourceId);


      if (loaded.task) {

        await loaded.task
          .destroy()
          .catch(() => undefined);

      }

    },


    async dispose() {

      const all = [...docs.values()];


      docs.clear();


      await Promise.all(

        all.map((loaded) => {

          if (loaded.task) {

            return loaded.task
              .destroy()
              .catch(() => undefined);

          }


          return Promise.resolve();

        })

      );

    },

  };
}