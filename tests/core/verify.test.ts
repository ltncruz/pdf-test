import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyOperation, buildExportPlan, verifyExport, type DocumentState, type InspectedDocument, type PdfInspector, type VerifyCode, type VerifyContext } from '../../src/core';
import { expectedItem, insp, item, makeDoc, makeText, pid } from './support';

const inspector = (doc: InspectedDocument): PdfInspector => ({ inspect: async () => doc });
const codes = (issues: { code: VerifyCode }[]): VerifyCode[] => issues.map((i) => i.code);

/** Documento de 2 páginas Carta; texto "texto 1" (12 pt, rect 10,20,100x50) na página 1. */
function docWithText(text = makeText(1)): DocumentState {
  return applyOperation(makeDoc(2), { type: 'object/add', pageId: pid(1), object: text }).state;
}
const okOutput = (): InspectedDocument => ({ pages: [insp({ items: [expectedItem('texto 1')] }), insp()] });
const run = (state: DocumentState, out: InspectedDocument, context?: VerifyContext) => verifyExport(new Uint8Array(), buildExportPlan(state), inspector(out), context);
/** Origem: 2 páginas, com textos distintos, para testar identidade de conteúdo. */
const sourceCtx = (pages = [insp({ items: [item('ORIGEM-A', 50, 700)] }), insp({ items: [item('ORIGEM-B', 50, 700)] })]): VerifyContext => ({ inspectSource: async () => ({ pages }) });
const withSource = (out: InspectedDocument['pages'][number][]): InspectedDocument => ({ pages: out });

describe('verifyExport: caminho correto', () => {
  it('saída conforme o plano não gera problemas', async () => {
    assert.deepEqual(await run(docWithText(), okOutput()), []);
  });
  it('conteúdo de origem + overlay na ordem certa, com contexto de origem, não gera problemas', async () => {
    const out = withSource([insp({ items: [item('ORIGEM-A', 50, 700), expectedItem('texto 1')] }), insp({ items: [item('ORIGEM-B', 50, 700)] })]);
    assert.deepEqual(await run(docWithText(), out, sourceCtx()), []);
  });
  it('desvios DENTRO da tolerância passam (0,9 pt de posição; 0,4% de fonte)', async () => {
    const out = { pages: [insp({ items: [expectedItem('texto 1', { x: 10.9, y: 759.1, fontSize: 12.04 })] }), insp()] };
    assert.deepEqual(await run(docWithText(), out), []);
  });
  it('texto quebrado em vários itens/linhas com a entrelinha esperada passa', async () => {
    const t = makeText(1, { text: 'primeira linha segunda linha', rect: { x: 10, y: 20, w: 60, h: 50 } });
    const out = { pages: [insp({ items: [item('primeira', 10, 760), item('linha', 10, 745.6), item('segunda', 10, 731.2), item('linha', 10, 716.8)] }), insp()] };
    assert.deepEqual(await run(docWithText(t), out), []);
  });
  it('linha em branco no meio (\\n\\n) dobra a entrelinha e é aceita', async () => {
    const t = makeText(1, { text: 'a\n\nb' });
    const out = { pages: [insp({ items: [item('a', 10, 760), item('b', 10, 760 - 2 * 14.4)] }), insp()] };
    assert.deepEqual(await run(docWithText(t), out), []);
  });
});

describe('verifyExport: testes negativos', () => {
  it('texto ausente => TEXT_MISSING', async () => {
    assert.deepEqual(codes(await run(docWithText(), { pages: [insp(), insp()] })), ['TEXT_MISSING']);
  });
  it('texto em página diferente => TEXT_WRONG_PAGE com a página onde apareceu', async () => {
    const out = { pages: [insp(), insp({ items: [expectedItem('texto 1')] })] };
    const issues = await run(docWithText(), out);
    assert.deepEqual(codes(issues), ['TEXT_WRONG_PAGE']);
    assert.match(issues[0]!.message, /página 2/);
    assert.equal(issues[0]!.pageIndex, 0);
  });
  it('rotação errada => PAGE_ROTATION', async () => {
    const out = { pages: [insp({ rotation: 90, items: [expectedItem('texto 1')] }), insp()] };
    assert.deepEqual(codes(await run(docWithText(), out)), ['PAGE_ROTATION']);
  });
  it('quantidade de páginas errada => PAGE_COUNT (e só isso)', async () => {
    assert.deepEqual(codes(await run(docWithText(), { pages: [insp()] })), ['PAGE_COUNT']);
    assert.deepEqual(codes(await run(docWithText(), { pages: [insp(), insp(), insp()] })), ['PAGE_COUNT']);
  });
  it('tamanho da página errado => PAGE_SIZE; origem da CropBox errada => PAGE_BOX', async () => {
    assert.deepEqual(codes(await run(docWithText(), { pages: [insp({ width: 600, items: [expectedItem('texto 1')] }), insp()] })), ['PAGE_SIZE']);
    assert.deepEqual(codes(await run(docWithText(), { pages: [insp({ x: 20, y: 30, items: [expectedItem('texto 1')] }), insp()] })), ['PAGE_BOX']);
  });
  it('posição do texto errada em x e em y => TEXT_POSITION', async () => {
    for (const bad of [{ x: 15 }, { y: 700 }, { x: 10, y: 761.5 }]) {
      const out = { pages: [insp({ items: [expectedItem('texto 1', bad)] }), insp()] };
      assert.deepEqual(codes(await run(docWithText(), out)), ['TEXT_POSITION'], JSON.stringify(bad));
    }
  });
  it('tamanho de fonte errado => TEXT_SIZE', async () => {
    const out = { pages: [insp({ items: [expectedItem('texto 1', { fontSize: 14 })] }), insp()] };
    assert.deepEqual(codes(await run(docWithText(), out)), ['TEXT_SIZE']);
  });
  it('entrelinha ou início de linha divergentes => TEXT_LAYOUT', async () => {
    const t = makeText(1, { text: 'linha um linha dois' });
    const badPitch = { pages: [insp({ items: [item('linha um', 10, 760), item('linha dois', 10, 750)] }), insp()] };
    assert.deepEqual(codes(await run(docWithText(t), badPitch)), ['TEXT_LAYOUT']);
    const badX = { pages: [insp({ items: [item('linha um', 10, 760), item('linha dois', 40, 745.6)] }), insp()] };
    assert.deepEqual(codes(await run(docWithText(t), badX)), ['TEXT_LAYOUT']);
  });
  it('salto de 2 entrelinhas SEM linha em branco no texto => TEXT_LAYOUT (não pode ser confundido com \\n\\n)', async () => {
    const t = makeText(1, { text: 'linha um\nlinha dois' });
    const out = { pages: [insp({ items: [item('linha um', 10, 760), item('linha dois', 10, 760 - 2 * 14.4)] }), insp()] };
    assert.deepEqual(codes(await run(docWithText(t), out)), ['TEXT_LAYOUT']);
  });
  it('texto com conteúdo diferente do plano (uma letra trocada) => TEXT_MISSING', async () => {
    const out = { pages: [insp({ items: [expectedItem('texto 2')] }), insp()] };
    assert.deepEqual(codes(await run(docWithText(), out)), ['TEXT_MISSING']);
  });
  it('com contexto: página de origem TROCADA (conteúdo do B na posição do A) => PAGE_CONTENT', async () => {
    const out = withSource([insp({ items: [item('ORIGEM-B', 50, 700), expectedItem('texto 1')] }), insp({ items: [item('ORIGEM-A', 50, 700)] })]);
    const issues = await run(docWithText(), out, sourceCtx());
    assert.deepEqual(codes(issues).filter((c) => c === 'PAGE_CONTENT'), ['PAGE_CONTENT', 'PAGE_CONTENT']);
  });
  it('com contexto: conteúdo original perdido ou alterado => PAGE_CONTENT', async () => {
    const lost = withSource([insp({ items: [expectedItem('texto 1')] }), insp({ items: [item('ORIGEM-B', 50, 700)] })]);
    assert.ok(codes(await run(docWithText(), lost, sourceCtx())).includes('PAGE_CONTENT'));
    const altered = withSource([insp({ items: [item('ORIGEM-X', 50, 700), expectedItem('texto 1')] }), insp({ items: [item('ORIGEM-B', 50, 700)] })]);
    assert.ok(codes(await run(docWithText(), altered, sourceCtx())).includes('PAGE_CONTENT'));
  });
  it('com contexto: texto extra no fim da página => UNEXPECTED_TEXT', async () => {
    const out = withSource([insp({ items: [item('ORIGEM-A', 50, 700), expectedItem('texto 1'), item('LIXO', 300, 300)] }), insp({ items: [item('ORIGEM-B', 50, 700)] })]);
    assert.deepEqual(codes(await run(docWithText(), out, sourceCtx())), ['UNEXPECTED_TEXT']);
  });
  it('com contexto: a mesma string já existente na ORIGEM não é aceita como se fosse o overlay', async () => {
    // A origem já contém "texto 1"; o overlay sumiu. Sem a verificação por posição na sequência, isso passaria.
    const src = sourceCtx([insp({ items: [item('texto 1', 50, 700)] }), insp()]);
    const out = withSource([insp({ items: [item('texto 1', 50, 700)] }), insp()]);
    assert.deepEqual(codes(await run(docWithText(), out, src)), ['TEXT_MISSING']);
  });
  it('com contexto: dois overlays na ordem trocada => detectado', async () => {
    const two = applyOperation(docWithText(), { type: 'object/add', pageId: pid(1), object: makeText(2, { rect: { x: 10, y: 100, w: 100, h: 50 } }) }).state;
    const swapped = withSource([insp({ items: [item('ORIGEM-A', 50, 700), item('texto 2', 10, 642), expectedItem('texto 1')] }), insp({ items: [item('ORIGEM-B', 50, 700)] })]);
    const issues = codes(await run(two, swapped, sourceCtx()));
    assert.ok(issues.length > 0, 'ordem trocada deve ser reportada');
  });
  it('origem ilegível é reportada, sem lançar', async () => {
    const ctx: VerifyContext = { inspectSource: async () => { throw new Error('origem corrompida'); } };
    const out = withSource([insp({ items: [expectedItem('texto 1')] }), insp()]);
    assert.ok(codes(await run(docWithText(), out, ctx)).includes('UNREADABLE_SOURCE'));
  });
  it('saída ilegível pelo parser => UNREADABLE_OUTPUT', async () => {
    const boom: PdfInspector = { inspect: async () => { throw new Error('xref quebrado'); } };
    assert.deepEqual(codes(await verifyExport(new Uint8Array(), buildExportPlan(docWithText()), boom)), ['UNREADABLE_OUTPUT']);
  });
  it('vários problemas na mesma página são todos reportados', async () => {
    const out = { pages: [insp({ rotation: 180, width: 100, items: [expectedItem('texto 1', { x: 99, fontSize: 30 })] }), insp()] };
    assert.deepEqual(new Set(codes(await run(docWithText(), out))), new Set(['PAGE_ROTATION', 'PAGE_SIZE', 'TEXT_POSITION', 'TEXT_SIZE']));
  });
});
