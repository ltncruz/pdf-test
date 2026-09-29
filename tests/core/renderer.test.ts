/**
 * Testa o renderizador PDF.js com um PDF.js FALSO (sem canvas real): concorrência máxima, cancelamento,
 * limite de pixels e liberação de documentos.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLimits, type SourceId } from '../../src/core';
import { createPdfJsRenderer } from '../../src/pdf/pdfjs-renderer';
import type { PdfJs } from '../../src/pdf/pdfjs-reader';
import { createMemorySourceStore } from '../../src/services/memory-source-store';

const SRC = 'src_1' as SourceId;
const tick = () => new Promise<void>((r) => setTimeout(r, 5));

function fakePdfJs(pageW = 612, pageH = 792) {
  const stats = { running: 0, peak: 0, started: 0, cancelled: 0, destroyed: 0, opened: 0, lastTransform: undefined as number[] | undefined };
  const pdfjs = {
    getDocument: () => {
      stats.opened++;
      return {
        promise: Promise.resolve({
          getPage: async () => ({
            getViewport: ({ scale }: { scale: number }) => ({ width: pageW * scale, height: pageH * scale }),
            cleanup: () => {},
            render: ({ transform }: { transform?: number[] }) => {
              stats.started++;
              stats.running++;
              stats.peak = Math.max(stats.peak, stats.running);
              stats.lastTransform = transform;
              let done = false;
              let reject!: (e: unknown) => void;
              let resolve!: () => void;
              const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
              const finish = () => { if (!done) { done = true; stats.running--; } };
              setTimeout(() => { finish(); resolve(); }, 20);
              return { promise, cancel: () => { if (done) return; stats.cancelled++; finish(); reject(Object.assign(new Error('cancelado'), { name: 'RenderingCancelledException' })); } };
            },
          }),
          destroy: async () => { stats.destroyed++; },
        }),
      };
    },
  };
  return { pdfjs: pdfjs as unknown as PdfJs, stats };
}
const canvas = () => ({ width: 0, height: 0, style: {} as Record<string, string> }) as unknown as HTMLCanvasElement;
async function setup(limits = resolveLimits({ maxConcurrentRenders: 2 }), page: [number, number] = [612, 792]) {
  const sources = createMemorySourceStore();
  await sources.put(SRC, new Uint8Array([1]));
  const fake = fakePdfJs(...page);
  (globalThis as { devicePixelRatio?: number }).devicePixelRatio = 2;
  return { ...fake, renderer: createPdfJsRenderer(fake.pdfjs, sources, {}, limits) };
}

describe('renderer: guardrails', () => {
  it('nunca executa mais renderizações simultâneas que maxConcurrentRenders (e todas terminam)', async () => {
    const { renderer, stats } = await setup();
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => renderer.render({ sourceId: SRC, index: i, rotation: 0, scale: 1, canvas: canvas() })));
    assert.equal(stats.peak, 2);
    assert.equal(stats.started, 10);
    assert.ok(results.every((r) => r !== null));
    assert.equal(stats.opened, 1, 'o documento é aberto uma vez por origem');
  });
  it('cancelamento na fila: a renderização nem começa; durante a execução: chama cancel()', async () => {
    const { renderer, stats } = await setup(resolveLimits({ maxConcurrentRenders: 1 }));
    const running = new AbortController();
    const queued = new AbortController();
    const a = renderer.render({ sourceId: SRC, index: 0, rotation: 0, scale: 1, canvas: canvas(), signal: running.signal });
    const b = renderer.render({ sourceId: SRC, index: 1, rotation: 0, scale: 1, canvas: canvas(), signal: queued.signal });
    const c = renderer.render({ sourceId: SRC, index: 2, rotation: 0, scale: 1, canvas: canvas() });
    await tick();
    queued.abort();
    running.abort();
    assert.equal(await a, null);
    assert.equal(await b, null);
    assert.notEqual(await c, null);
    assert.equal(stats.cancelled, 1);
    assert.equal(stats.started, 2, 'a renderização cancelada na fila nunca foi iniciada');
    assert.equal(stats.running, 0);
  });
  it('página enorme: o canvas respeita maxCanvasPixels, o CSS mantém o tamanho e reducedResolution = true', async () => {
    const { renderer, stats } = await setup(resolveLimits(), [14_400, 14_400]);
    const c = canvas();
    const r = await renderer.render({ sourceId: SRC, index: 0, rotation: 0, scale: 1, canvas: c });
    assert.equal(r?.reducedResolution, true);
    assert.ok(c.width * c.height <= 16_777_216, `${c.width}x${c.height}`);
    assert.equal(c.style.width, '14400px');
    assert.ok(stats.lastTransform && stats.lastTransform[0]! < 1);
  });
  it('página normal com dpr 2: resolução total e sem redução', async () => {
    const { renderer } = await setup();
    const c = canvas();
    const r = await renderer.render({ sourceId: SRC, index: 0, rotation: 0, scale: 1, canvas: c });
    assert.equal(r?.reducedResolution, false);
    assert.deepEqual([c.width, c.height], [1224, 1584]);
  });
  it('escala absurda é restringida à faixa (não cria canvas descomunal)', async () => {
    const { renderer } = await setup();
    const c = canvas();
    await renderer.render({ sourceId: SRC, index: 0, rotation: 0, scale: 1000, canvas: c });
    assert.equal(c.style.width, `${612 * 8}px`);
    assert.ok(c.width * c.height <= 16_777_216);
    await assert.rejects(renderer.render({ sourceId: SRC, index: 0, rotation: 0, scale: Number.NaN, canvas: canvas() }), RangeError);
  });
  it('release e dispose destroem os documentos abertos; falha em um render libera a vaga', async () => {
    const { renderer, stats } = await setup(resolveLimits({ maxConcurrentRenders: 1 }));
    await assert.rejects(renderer.render({ sourceId: SRC, index: 0, rotation: 0, scale: -1, canvas: canvas() }), RangeError);
    const ok = await renderer.render({ sourceId: SRC, index: 0, rotation: 0, scale: 1, canvas: canvas() });
    assert.notEqual(ok, null, 'a vaga foi liberada após o erro');
    await renderer.release(SRC);
    assert.equal(stats.destroyed, 1);
    await renderer.render({ sourceId: SRC, index: 0, rotation: 0, scale: 1, canvas: canvas() });
    assert.equal(stats.opened, 2, 'depois de release o documento é reaberto sob demanda');
    await renderer.dispose();
    assert.equal(stats.destroyed, 2);
  });
});
