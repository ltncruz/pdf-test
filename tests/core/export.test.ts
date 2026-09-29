import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOperation, buildExportPlan, displaySize, effectiveRotation, exportDocument, ExportError, isWinAnsiText,
  modelRectToUserSpace, normalizeRotation, preflight, verifyExport,
  type DocumentState, type InspectedDocument, type PdfInspector, type PdfWriter, type SourceStore,
} from '../../src/core';
import { expectedItem, insp, makeDoc, makePage, makeText, NO_TRAITS, pid, SRC } from './support';

const storeWith = (has: boolean): SourceStore => ({ has: async () => has, get: async () => new Uint8Array([1]), put: async () => {}, delete: async () => {} });
const withObj = (s: DocumentState, obj = makeText(1)): DocumentState => applyOperation(s, { type: 'object/add', pageId: pid(1), object: obj }).state;

describe('geometria', () => {
  it('normaliza rotações e rejeita ângulos que não são múltiplos de 90', () => {
    assert.equal(normalizeRotation(-90), 270);
    assert.equal(normalizeRotation(450), 90);
    assert.throws(() => normalizeRotation(45), RangeError);
  });
  it('rotação efetiva = base + usuário; tamanho exibido troca w/h em 90/270', () => {
    const p = makePage(1, { baseRotation: 90, rotation: 90 });
    assert.equal(effectiveRotation(p), 180);
    assert.deepEqual(displaySize(p), { w: 612, h: 792 });
    assert.deepEqual(displaySize(makePage(1, { baseRotation: 90 })), { w: 792, h: 612 });
    assert.equal(effectiveRotation(makePage(1, { baseRotation: 90, rotation: 270 })), 0);
  });
  it('converte retângulo do modelo (topo-esquerda, y p/ baixo) para user space, respeitando CropBox deslocada', () => {
    const page = makePage(1, { crop: { x: 20, y: 30, w: 300, h: 400 } });
    assert.deepEqual(modelRectToUserSpace(page, { x: 10, y: 20, w: 100, h: 50 }), { x: 30, y: 360, w: 100, h: 50 });
  });
});

describe('buildExportPlan (função pura)', () => {
  it('reflete ordem, exclusões, rotação efetiva e textos em user space', () => {
    let s = makeDoc(3);
    s = applyOperation(s, { type: 'page/delete', pageIds: [pid(2)] }).state;
    s = applyOperation(s, { type: 'page/rotate', pageIds: [pid(3)], delta: 90 }).state;
    s = applyOperation(s, { type: 'object/add', pageId: pid(1), object: makeText(1, { rect: { x: 10, y: 20, w: 100, h: 50 } }) }).state;
    const plan = buildExportPlan(s);
    assert.equal(plan.pages.length, 2);
    assert.deepEqual(plan.pages.map((p) => p.source?.index), [0, 2]);
    assert.deepEqual(plan.pages.map((p) => p.rotation), [0, 90]);
    assert.deepEqual(plan.pages[0]?.texts[0]?.rect, { x: 10, y: 792 - 20 - 50, w: 100, h: 50 });
  });
  it('páginas em branco não têm origem', () => {
    const blank = makePage(7, { origin: { kind: 'blank' }, crop: { x: 0, y: 0, w: 595, h: 842 } });
    const s = applyOperation(makeDoc(1), { type: 'page/insert', items: [{ page: blank, index: 1 }] }).state;
    assert.equal(buildExportPlan(s).pages[1]?.source, null);
  });
});

describe('encoding WinAnsi', () => {
  it('aceita latin-1 e extras do cp1252; recusa CJK, emoji e controle', () => {
    for (const ok of ['Olá, Simply PDF — “teste” ção €', 'linha1\nlinha2']) assert.equal(isWinAnsiText(ok), true, ok);
    for (const bad of ['日本語', 'emoji 😀', 'tab\there', 'ā']) assert.equal(isWinAnsiText(bad), false, bad);
  });
});

describe('preflight', () => {
  const codes = async (s: DocumentState, store = storeWith(true)) => (await preflight(s, store)).map((i) => `${i.severity}:${i.code}`);
  it('documento válido não gera problemas', async () => {
    assert.deepEqual(await codes(withObj(makeDoc(2))), []);
  });
  it('detecta documento vazio, origem ausente e página de origem fora do intervalo', async () => {
    const empty = applyOperation(makeDoc(1), { type: 'page/delete', pageIds: [pid(1)] }).state;
    assert.deepEqual(await codes(empty), ['error:EMPTY_DOCUMENT']);
    assert.deepEqual(await codes(makeDoc(1), storeWith(false)), ['error:SOURCE_MISSING']);
    const oob = { ...makeDoc(1), sources: { [SRC]: { id: SRC, name: 'x', byteLength: 1, pageCount: 0, traits: NO_TRAITS } } };
    assert.deepEqual(await codes(oob), ['error:SOURCE_PAGE_OUT_OF_RANGE']);
  });
  it('detecta texto vazio/não codificável, fonte e retângulo inválidos; objeto fora da página é só aviso', async () => {
    assert.deepEqual(await codes(withObj(makeDoc(1), makeText(1, { text: '   ' }))), ['error:TEXT_EMPTY']);
    assert.deepEqual(await codes(withObj(makeDoc(1), makeText(1, { text: '日本語' }))), ['error:TEXT_NOT_ENCODABLE']);
    assert.deepEqual(await codes(withObj(makeDoc(1), makeText(1, { fontSize: 0 }))), ['error:INVALID_FONT_SIZE']);
    assert.deepEqual(await codes(withObj(makeDoc(1), makeText(1, { rect: { x: 0, y: 0, w: Number.NaN, h: 5 } }))), ['error:INVALID_RECT']);
    assert.deepEqual(await codes(withObj(makeDoc(1), makeText(1, { rect: { x: 600, y: 0, w: 100, h: 20 } }))), ['warning:OBJECT_OUTSIDE_PAGE']);
  });
});

describe('exportDocument com dublês (core sem nenhuma biblioteca de PDF)', () => {
  const okDoc = (): InspectedDocument => ({ pages: [insp({ items: [expectedItem('texto 1')] })] });
  const writer = (calls: { n: number }, fail = false): PdfWriter => ({ materialize: async () => { calls.n++; if (fail) throw new Error('boom'); return new Uint8Array([37, 80, 68, 70]); } });
  /** A origem (1 byte) é uma página sem texto; a saída do writer dublê (4 bytes) é o documento informado. */
  const inspector = (doc: InspectedDocument): PdfInspector => ({ inspect: async (bytes) => (bytes.length === 1 ? { pages: [insp()] } : doc) });
  const state = () => withObj(makeDoc(1));

  it('caminho feliz devolve os bytes do writer e os avisos', async () => {
    const calls = { n: 0 };
    const r = await exportDocument(state(), { sources: storeWith(true), writer: writer(calls), inspector: inspector(okDoc()) });
    assert.equal(r.bytes.length, 4);
    assert.equal(calls.n, 1);
  });
  it('preflight com erro aborta ANTES de chamar o writer', async () => {
    const calls = { n: 0 };
    await assert.rejects(exportDocument(withObj(makeDoc(1), makeText(1, { text: '日本語' })), { sources: storeWith(true), writer: writer(calls), inspector: inspector(okDoc()) }), (e: unknown) => e instanceof ExportError && e.failure.stage === 'preflight');
    assert.equal(calls.n, 0);
  });
  it('falha do writer vira ExportError(write)', async () => {
    await assert.rejects(exportDocument(state(), { sources: storeWith(true), writer: writer({ n: 0 }, true), inspector: inspector(okDoc()) }), (e: unknown) => e instanceof ExportError && e.failure.stage === 'write');
  });
  it('divergência detectada na verificação descarta o arquivo (ExportError verify)', async () => {
    const bad: InspectedDocument = { pages: [insp({ rotation: 90, items: [expectedItem('outra coisa')] })] };
    await assert.rejects(exportDocument(state(), { sources: storeWith(true), writer: writer({ n: 0 }), inspector: inspector(bad) }), (e: unknown) => {
      return e instanceof ExportError && e.failure.stage === 'verify' && e.failure.issues.some((i) => i.code === 'PAGE_ROTATION') && e.failure.issues.some((i) => i.code === 'TEXT_MISSING');
    });
  });
  it('verifyExport detecta contagem e tamanho divergentes', async () => {
    const plan = buildExportPlan(state());
    assert.deepEqual((await verifyExport(new Uint8Array(), plan, inspector({ pages: [] }))).map((i) => i.code), ['PAGE_COUNT']);
    const wrongSize: InspectedDocument = { pages: [insp({ width: 500, items: [expectedItem('texto 1')] })] };
    assert.deepEqual((await verifyExport(new Uint8Array(), plan, inspector(wrongSize))).map((i) => i.code), ['PAGE_SIZE']);
  });
});
