import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyOperation, OperationError, type Operation, type Page } from '../../src/core';
import { deepFreeze } from '../helpers';
import { makeDoc, makePage, makeText, oid, pid, sansRevision } from './support';

const frozen = (n = 3) => deepFreeze(makeDoc(n));
const throwsCode = (fn: () => unknown, code: string) =>
  assert.throws(fn, (e: unknown) => e instanceof OperationError && e.code === code);

describe('page/delete', () => {
  it('remove as páginas e o inverso restaura a ordem exata (seleção não contígua)', () => {
    const s = frozen(5);
    const r = applyOperation(s, { type: 'page/delete', pageIds: [pid(4), pid(2)] });
    assert.deepEqual(r.state.pageOrder, [pid(1), pid(3), pid(5)]);
    assert.equal(r.state.pages[pid(2)], undefined);
    const back = applyOperation(r.state, r.inverse);
    assert.deepEqual(sansRevision(back.state), sansRevision(s));
  });
  it('rejeita seleção vazia, página inexistente e repetida sem alterar o estado', () => {
    const s = frozen();
    throwsCode(() => applyOperation(s, { type: 'page/delete', pageIds: [] }), 'EMPTY_SELECTION');
    throwsCode(() => applyOperation(s, { type: 'page/delete', pageIds: [pid(9)] }), 'PAGE_NOT_FOUND');
    throwsCode(() => applyOperation(s, { type: 'page/delete', pageIds: [pid(1), pid(1)] }), 'DUPLICATE_ID');
  });
  it('permite excluir todas as páginas no modelo (o export é que recusa documento vazio)', () => {
    const r = applyOperation(frozen(2), { type: 'page/delete', pageIds: [pid(1), pid(2)] });
    assert.deepEqual(r.state.pageOrder, []);
  });
});

describe('page/rotate', () => {
  it('compõe rotações e o inverso volta ao estado anterior', () => {
    const s = frozen();
    const a = applyOperation(s, { type: 'page/rotate', pageIds: [pid(1)], delta: 270 });
    assert.equal(a.state.pages[pid(1)]?.rotation, 270);
    const b = applyOperation(a.state, { type: 'page/rotate', pageIds: [pid(1)], delta: 180 });
    assert.equal(b.state.pages[pid(1)]?.rotation, 90);
    assert.deepEqual(sansRevision(applyOperation(a.state, a.inverse).state), sansRevision(s));
  });
  it('não altera baseRotation nem as outras páginas (compartilhamento estrutural)', () => {
    const base = makeDoc();
    const pages: Record<string, Page> = { ...base.pages, [pid(2)]: makePage(2, { baseRotation: 90 }) };
    const s = deepFreeze({ ...base, pages });
    const r = applyOperation(s, { type: 'page/rotate', pageIds: [pid(2)], delta: 90 });
    assert.equal(r.state.pages[pid(2)]?.baseRotation, 90);
    assert.equal(r.state.pages[pid(1)], s.pages[pid(1)], 'página intocada mantém a mesma referência');
  });
  it('rejeita delta inválido', () => {
    throwsCode(() => applyOperation(frozen(), { type: 'page/rotate', pageIds: [pid(1)], delta: 45 as 90 }), 'INVALID_ROTATION');
  });
});

describe('page/insert', () => {
  it('insere em posições finais e o inverso exclui', () => {
    const s = frozen(2);
    const op: Operation = { type: 'page/insert', items: [{ page: makePage(10, { origin: { kind: 'blank' } }), index: 1 }, { page: makePage(11, { origin: { kind: 'blank' } }), index: 0 }] };
    const r = applyOperation(s, op);
    assert.deepEqual(r.state.pageOrder, [pid(11), pid(10), pid(1), pid(2)], 'index = posição FINAL de cada página inserida');
    assert.deepEqual(sansRevision(applyOperation(r.state, r.inverse).state), sansRevision(s));
  });
  it('rejeita id existente, índice inválido e lista vazia', () => {
    const s = frozen(2);
    throwsCode(() => applyOperation(s, { type: 'page/insert', items: [{ page: makePage(1), index: 0 }] }), 'DUPLICATE_ID');
    throwsCode(() => applyOperation(s, { type: 'page/insert', items: [{ page: makePage(9), index: 5 }] }), 'INVALID_INDEX');
    throwsCode(() => applyOperation(s, { type: 'page/insert', items: [{ page: makePage(9), index: -1 }] }), 'INVALID_INDEX');
    throwsCode(() => applyOperation(s, { type: 'page/insert', items: [] }), 'EMPTY_SELECTION');
  });
});

describe('object/add e object/remove', () => {
  it('adiciona ao final, o inverso remove; remover devolve o objeto na mesma posição (z-order)', () => {
    const s = frozen();
    const a = applyOperation(s, { type: 'object/add', pageId: pid(1), object: makeText(1) });
    const b = applyOperation(a.state, { type: 'object/add', pageId: pid(1), object: makeText(2) });
    const c = applyOperation(b.state, { type: 'object/add', pageId: pid(1), object: makeText(3) });
    const removed = applyOperation(c.state, { type: 'object/remove', pageId: pid(1), objectId: oid(2) });
    assert.deepEqual(removed.state.pages[pid(1)]?.objects.map((o) => o.id), [oid(1), oid(3)]);
    const restored = applyOperation(removed.state, removed.inverse);
    assert.deepEqual(sansRevision(restored.state), sansRevision(c.state));
    assert.deepEqual(sansRevision(applyOperation(a.state, a.inverse).state), sansRevision(s));
  });
  it('rejeita página/objeto inexistente, id duplicado e índice inválido', () => {
    const s = frozen();
    throwsCode(() => applyOperation(s, { type: 'object/add', pageId: pid(9), object: makeText(1) }), 'PAGE_NOT_FOUND');
    throwsCode(() => applyOperation(s, { type: 'object/remove', pageId: pid(1), objectId: oid(1) }), 'OBJECT_NOT_FOUND');
    const withObj = applyOperation(s, { type: 'object/add', pageId: pid(1), object: makeText(1) }).state;
    throwsCode(() => applyOperation(withObj, { type: 'object/add', pageId: pid(1), object: makeText(1) }), 'DUPLICATE_ID');
    throwsCode(() => applyOperation(s, { type: 'object/add', pageId: pid(1), object: makeText(1), index: 3 }), 'INVALID_INDEX');
  });
});

describe('object/update (editar caixa de texto)', () => {
  const withText = () => applyOperation(frozen(), { type: 'object/add', pageId: pid(1), object: makeText(1) }).state;
  it('altera só as propriedades pedidas e o inverso restaura exatamente os valores anteriores', () => {
    const s = deepFreeze(withText());
    const r = applyOperation(s, { type: 'object/update', pageId: pid(1), objectId: oid(1), patch: { text: 'novo texto', fontSize: 20 } });
    const o = r.state.pages[pid(1)]!.objects[0]!;
    assert.deepEqual([o.text, o.fontSize, o.rect, o.color], ['novo texto', 20, s.pages[pid(1)]!.objects[0]!.rect, s.pages[pid(1)]!.objects[0]!.color]);
    assert.deepEqual(r.inverse, { type: 'object/update', pageId: pid(1), objectId: oid(1), patch: { text: 'texto 1', fontSize: 12 } });
    assert.deepEqual(sansRevision(applyOperation(r.state, r.inverse).state), sansRevision(s));
  });
  it('mantém id, kind e posição no z-order; não altera as outras páginas nem os outros objetos', () => {
    let s = withText();
    s = applyOperation(s, { type: 'object/add', pageId: pid(1), object: makeText(2) }).state;
    deepFreeze(s);
    const r = applyOperation(s, { type: 'object/update', pageId: pid(1), objectId: oid(1), patch: { rect: { x: 1, y: 2, w: 3, h: 4 } } });
    const objs = r.state.pages[pid(1)]!.objects;
    assert.deepEqual(objs.map((o) => o.id), [oid(1), oid(2)]);
    assert.equal(objs[1], s.pages[pid(1)]!.objects[1], 'o outro objeto mantém a mesma referência');
    assert.equal(r.state.pages[pid(2)], s.pages[pid(2)]);
  });
  it('rejeita página/objeto inexistente, patch vazio e propriedades imutáveis ou desconhecidas', () => {
    const s = frozen();
    const upd = (patch: object, pageId = pid(1), objectId = oid(1)) => ({ type: 'object/update', pageId, objectId, patch }) as Operation;
    const w = deepFreeze(withText());
    throwsCode(() => applyOperation(s, upd({ text: 'x' }, pid(9))), 'PAGE_NOT_FOUND');
    throwsCode(() => applyOperation(w, upd({ text: 'x' }, pid(1), oid(9))), 'OBJECT_NOT_FOUND');
    throwsCode(() => applyOperation(w, upd({})), 'INVALID_OBJECT');
    throwsCode(() => applyOperation(w, upd({ id: 'obj_x' })), 'INVALID_OBJECT');
    throwsCode(() => applyOperation(w, upd({ kind: 'image' })), 'INVALID_OBJECT');
    throwsCode(() => applyOperation(w, upd({ text: 'x', extra: 1 })), 'INVALID_OBJECT');
  });
  it('dentro de um batch é atômico junto com as demais operações', () => {
    const w = deepFreeze(withText());
    const op: Operation = { type: 'batch', ops: [
      { type: 'object/update', pageId: pid(1), objectId: oid(1), patch: { text: 'a' } },
      { type: 'object/update', pageId: pid(1), objectId: oid(99), patch: { text: 'b' } },
    ] };
    throwsCode(() => applyOperation(w, op), 'OBJECT_NOT_FOUND');
    assert.equal(w.pages[pid(1)]!.objects[0]!.text, 'texto 1');
    const ok: Operation = { type: 'batch', ops: [
      { type: 'object/update', pageId: pid(1), objectId: oid(1), patch: { text: 'a' } },
      { type: 'object/update', pageId: pid(1), objectId: oid(1), patch: { text: 'b' } },
    ] };
    const r = applyOperation(w, ok);
    assert.equal(r.state.pages[pid(1)]!.objects[0]!.text, 'b');
    assert.equal(applyOperation(r.state, r.inverse).state.pages[pid(1)]!.objects[0]!.text, 'texto 1');
  });
});

describe('batch', () => {
  it('aplica em ordem e o inverso desfaz tudo', () => {
    const s = frozen();
    const op: Operation = { type: 'batch', ops: [
      { type: 'page/rotate', pageIds: [pid(1)], delta: 90 },
      { type: 'object/add', pageId: pid(1), object: makeText(1) },
      { type: 'page/delete', pageIds: [pid(3)] },
    ] };
    const r = applyOperation(s, op);
    assert.equal(r.state.revision, s.revision + 1, 'batch conta como UMA revisão');
    assert.deepEqual(r.state.pageOrder, [pid(1), pid(2)]);
    assert.deepEqual(sansRevision(applyOperation(r.state, r.inverse).state), sansRevision(s));
  });
  it('é atômico: se uma operação interna falha, nada é aplicado', () => {
    const s = frozen();
    const op: Operation = { type: 'batch', ops: [
      { type: 'page/rotate', pageIds: [pid(1)], delta: 90 },
      { type: 'page/delete', pageIds: [pid(99)] },
    ] };
    throwsCode(() => applyOperation(s, op), 'PAGE_NOT_FOUND');
    assert.equal(s.pages[pid(1)]?.rotation, 0);
  });
});

describe('propriedades gerais', () => {
  it('cada operação incrementa revision em 1 e nunca muta a entrada (estado congelado)', () => {
    const s = frozen();
    const r = applyOperation(s, { type: 'page/rotate', pageIds: [pid(1)], delta: 90 });
    assert.equal(r.state.revision, 1);
    assert.equal(s.revision, 0);
  });
});
