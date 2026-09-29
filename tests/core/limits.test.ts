import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LIMITS, OpenError, SourceReadError, assertFileSizeAllowed, clampRenderScale, createSequentialIdFactory, openDocument, planCanvas, resolveLimits,
  type SourceInfo, type SourceReader, type SourceStore, type SourceId, type Limits,
} from '../../src/core';

describe('Limits centralizados', () => {
  it('valores iniciais documentados e imutáveis', () => {
    assert.equal(DEFAULT_LIMITS.maxFileBytes, 100 * 1024 * 1024);
    assert.equal(DEFAULT_LIMITS.maxPages, 2000);
    assert.equal(DEFAULT_LIMITS.maxPageDimensionPt, 14_400);
    assert.equal(DEFAULT_LIMITS.maxCanvasPixels, 16_777_216);
    assert.equal(DEFAULT_LIMITS.maxConcurrentRenders, 3);
    assert.ok(Object.isFrozen(DEFAULT_LIMITS));
    assert.ok(Object.isFrozen(resolveLimits()));
  });
  it('resolveLimits aplica overrides e recusa valores inválidos', () => {
    assert.equal(resolveLimits({ maxPages: 10 }).maxPages, 10);
    assert.equal(resolveLimits({ maxPages: 10 }).maxFileBytes, DEFAULT_LIMITS.maxFileBytes);
    for (const bad of [{ maxPages: 0 }, { maxPages: -1 }, { maxPages: 1.5 }, { maxFileBytes: Number.NaN }, { maxCanvasPixels: Infinity }, { maxConcurrentRenders: 0 }, { minRenderScale: 9, maxRenderScale: 8 }] as Partial<Limits>[]) {
      assert.throws(() => resolveLimits(bad), RangeError, JSON.stringify(bad));
    }
  });
  it('clampRenderScale restringe à faixa e recusa lixo', () => {
    assert.equal(clampRenderScale(1, DEFAULT_LIMITS), 1);
    assert.equal(clampRenderScale(0.001, DEFAULT_LIMITS), DEFAULT_LIMITS.minRenderScale);
    assert.equal(clampRenderScale(500, DEFAULT_LIMITS), DEFAULT_LIMITS.maxRenderScale);
    for (const bad of [0, -1, Number.NaN, Infinity]) assert.throws(() => clampRenderScale(bad, DEFAULT_LIMITS), RangeError);
  });
  it('planCanvas mantém o dpr quando cabe e reduz a resolução (não o tamanho CSS) quando não cabe', () => {
    const fits = planCanvas(800, 1000, 2, DEFAULT_LIMITS);
    assert.deepEqual([fits.outputScale, fits.width, fits.height, fits.reduced], [2, 1600, 2000, false]);
    const huge = planCanvas(14_400, 14_400, 2, DEFAULT_LIMITS);
    assert.equal(huge.reduced, true);
    assert.ok(huge.width * huge.height <= DEFAULT_LIMITS.maxCanvasPixels, `${huge.width}x${huge.height}`);
    assert.ok(huge.width > 3000, 'ainda usa quase todo o orçamento de pixels');
    // Proporção preservada
    assert.ok(Math.abs(huge.width / huge.height - 1) < 0.001);
    const tall = planCanvas(100, 20_000, 1, DEFAULT_LIMITS);
    assert.ok(tall.width * tall.height <= DEFAULT_LIMITS.maxCanvasPixels);
    assert.ok(tall.width >= 1 && tall.height >= 1);
  });
  it('planCanvas recusa dimensões inválidas', () => {
    for (const args of [[0, 10, 1], [10, -1, 1], [Number.NaN, 10, 1], [10, 10, 0]] as const) assert.throws(() => planCanvas(args[0], args[1], args[2], DEFAULT_LIMITS), RangeError);
  });
  it('para qualquer combinação, o canvas nunca passa de maxCanvasPixels', () => {
    for (const w of [1, 300, 612, 5000, 14_400]) for (const h of [1, 400, 792, 9000, 14_400]) for (const dpr of [1, 1.5, 2, 3]) {
      const p = planCanvas(w * 3, h * 3, dpr, DEFAULT_LIMITS);
      assert.ok(p.width * p.height <= DEFAULT_LIMITS.maxCanvasPixels, `${w}x${h}@${dpr}`);
    }
  });
});

describe('openDocument: guardrails e atomicidade', () => {
  const page = { crop: { x: 0, y: 0, w: 612, h: 792 }, rotation: 0 as const };
  const info = (over: Partial<SourceInfo> = {}): SourceInfo => ({ pages: [page], encrypted: false, acroForm: false, xfa: false, signatures: false, ...over });
  const readerOf = (result: SourceInfo | Error, seen: { maxPages?: number } = {}): SourceReader => ({
    read: async (_bytes, options) => { seen.maxPages = options.maxPages; if (result instanceof Error) throw result; return result; },
  });
  function store() {
    const puts: SourceId[] = [];
    const s: SourceStore = { has: async () => false, get: async () => new Uint8Array(), put: async (id) => { puts.push(id); }, delete: async () => {} };
    return { s, puts };
  }
  const bytes = (n = 10) => new Uint8Array(n);
  const open = (reader: SourceReader, st: SourceStore, over: { bytes?: Uint8Array; limits?: Limits } = {}) =>
    openDocument({ name: 'x.pdf', bytes: over.bytes ?? bytes() }, { reader, sources: st, ids: createSequentialIdFactory(), ...(over.limits ? { limits: over.limits } : {}) });
  const rejects = async (p: Promise<unknown>, code: string): Promise<OpenError> => {
    try { await p; } catch (e) { assert.ok(e instanceof OpenError, String(e)); assert.equal(e.code, code); return e; }
    return assert.fail(`esperava OpenError(${code})`);
  };

  it('arquivo acima do limite: falha ANTES de chamar o leitor e sem guardar nada', async () => {
    const { s, puts } = store();
    let called = false;
    const reader: SourceReader = { read: async () => { called = true; return info(); } };
    const e = await rejects(open(reader, s, { bytes: bytes(2000), limits: resolveLimits({ maxFileBytes: 1000 }) }), 'TOO_LARGE');
    assert.match(e.message, /limite/);
    assert.equal(called, false);
    assert.deepEqual(puts, []);
  });
  it('assertFileSizeAllowed permite exatamente o limite e recusa 1 byte a mais', () => {
    const l = resolveLimits({ maxFileBytes: 1000 });
    assert.doesNotThrow(() => assertFileSizeAllowed(1000, 'a.pdf', l));
    assert.throws(() => assertFileSizeAllowed(1001, 'a.pdf', l), (e: unknown) => e instanceof OpenError && e.code === 'TOO_LARGE');
  });
  it('o limite de páginas é entregue ao leitor (para que ele pare antes de percorrer as páginas)', async () => {
    const seen: { maxPages?: number } = {};
    await open(readerOf(info(), seen), store().s, { limits: resolveLimits({ maxPages: 7 }) });
    assert.equal(seen.maxPages, 7);
  });
  it('erros tipados do leitor viram OpenError com o mesmo código e mensagem clara', async () => {
    for (const [code, re] of [['PASSWORD_REQUIRED', /senha/], ['INVALID_PDF', /inválido|corrompido/], ['TOO_MANY_PAGES', /limite/]] as const) {
      const { s, puts } = store();
      const e = await rejects(open(readerOf(new SourceReadError(code, 'x')), s), code);
      assert.match(e.message, re);
      assert.deepEqual(puts, []);
    }
  });
  it('exceção desconhecida do leitor vira INVALID_PDF (nunca vaza o erro cru da biblioteca)', async () => {
    await rejects(open(readerOf(new TypeError('boom')), store().s), 'INVALID_PDF');
  });
  it('defesa em profundidade: leitor que devolve páginas demais também é barrado', async () => {
    const { s, puts } = store();
    await rejects(open(readerOf(info({ pages: [page, page, page] })), s, { limits: resolveLimits({ maxPages: 2 }) }), 'TOO_MANY_PAGES');
    assert.deepEqual(puts, []);
  });
  it('PDF criptografado (mesmo sem senha de abertura) é rejeitado com mensagem específica', async () => {
    const { s, puts } = store();
    const e = await rejects(open(readerOf(info({ encrypted: true })), s), 'ENCRYPTED');
    assert.match(e.message, /criptografad/);
    assert.deepEqual(puts, []);
  });
  it('sem páginas, página gigante e caixa inválida são rejeitados sem guardar nada', async () => {
    const cases: [SourceInfo, string][] = [
      [info({ pages: [] }), 'NO_PAGES'],
      [info({ pages: [{ crop: { x: 0, y: 0, w: 14_401, h: 100 }, rotation: 0 }] }), 'PAGE_TOO_LARGE'],
      [info({ pages: [{ crop: { x: 0, y: 0, w: 100, h: 99_999 }, rotation: 0 }] }), 'PAGE_TOO_LARGE'],
      [info({ pages: [{ crop: { x: 0, y: 0, w: 0, h: 100 }, rotation: 0 }] }), 'INVALID_PAGE_BOX'],
      [info({ pages: [{ crop: { x: 0, y: 0, w: Number.NaN, h: 100 }, rotation: 0 }] }), 'INVALID_PAGE_BOX'],
      [info({ pages: [page, { crop: { x: 0, y: 0, w: -5, h: 100 }, rotation: 0 }] }), 'INVALID_PAGE_BOX'],
    ];
    for (const [i, code] of cases) {
      const { s, puts } = store();
      await rejects(open(readerOf(i), s), code);
      assert.deepEqual(puts, [], code);
    }
  });
  it('a página no limite exato (14 400 pt) é aceita', async () => {
    const st = store();
    const state = await open(readerOf(info({ pages: [{ crop: { x: 0, y: 0, w: 14_400, h: 14_400 }, rotation: 0 }] })), st.s);
    assert.equal(state.pageOrder.length, 1);
    assert.equal(st.puts.length, 1);
  });
  it('os traços (formulário, XFA, assinatura) são gravados na SourceRef', async () => {
    const state = await open(readerOf(info({ acroForm: true, signatures: true })), store().s);
    assert.deepEqual(Object.values(state.sources)[0]?.traits, { acroForm: true, xfa: false, signatures: true });
  });
  it('falha do SourceStore.put propaga e não devolve estado parcial', async () => {
    const s: SourceStore = { has: async () => false, get: async () => new Uint8Array(), put: async () => { throw new Error('disco cheio'); }, delete: async () => {} };
    await assert.rejects(open(readerOf(info()), s), /disco cheio/);
  });
});
