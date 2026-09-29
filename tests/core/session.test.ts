import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DocumentSession, OperationError, type Operation } from '../../src/core';
import { makeDoc, makeText, pid, sansRevision } from './support';

const rotate = (n: number): Operation => ({ type: 'page/rotate', pageIds: [pid(n)], delta: 90 });
const del = (n: number): Operation => ({ type: 'page/delete', pageIds: [pid(n)] });

describe('DocumentSession: undo/redo', () => {
  it('undo e redo percorrem exatamente os estados intermediários', () => {
    const s0 = makeDoc();
    const session = new DocumentSession(s0);
    const states = [sansRevision(session.getState())];
    for (const op of [rotate(1), del(2), { type: 'object/add', pageId: pid(3), object: makeText(1) } as Operation]) {
      session.execute(op);
      states.push(sansRevision(session.getState()));
    }
    for (let i = states.length - 2; i >= 0; i--) {
      assert.ok(session.undo());
      assert.deepEqual(sansRevision(session.getState()), states[i]);
    }
    assert.equal(session.undo(), false, 'nada mais a desfazer');
    for (let i = 1; i < states.length; i++) {
      assert.ok(session.redo());
      assert.deepEqual(sansRevision(session.getState()), states[i]);
    }
    assert.equal(session.redo(), false, 'nada mais a refazer');
  });

  it('uma nova alteração descarta o redo', () => {
    const session = new DocumentSession(makeDoc());
    session.execute(rotate(1));
    session.undo();
    assert.ok(session.canRedo);
    session.execute(del(1));
    assert.equal(session.canRedo, false);
    assert.equal(session.redo(), false);
  });

  it('respeita o limite de histórico descartando as entradas mais antigas', () => {
    const session = new DocumentSession(makeDoc(), { maxHistory: 3 });
    for (let i = 0; i < 5; i++) session.execute(rotate(1));
    let undone = 0;
    while (session.undo()) undone++;
    assert.equal(undone, 3);
    assert.equal(session.getState().pages[pid(1)]?.rotation, 180, '5 rotações de 90, 3 desfeitas => 2 ficam aplicadas');
  });

  it('operação inválida lança e deixa estado, histórico e ouvintes intactos', () => {
    const session = new DocumentSession(makeDoc());
    session.execute(rotate(1));
    let calls = 0;
    session.subscribe(() => calls++);
    const before = session.getState();
    assert.throws(() => session.execute(del(99)), OperationError);
    assert.equal(session.getState(), before);
    assert.equal(calls, 0);
    assert.ok(session.undo(), 'o histórico anterior continua utilizável');
  });
});

describe('DocumentSession: dirty e subscribe', () => {
  it('isDirty acompanha a posição no histórico em relação ao ponto salvo', () => {
    const session = new DocumentSession(makeDoc());
    assert.equal(session.isDirty, false);
    session.execute(rotate(1));
    assert.equal(session.isDirty, true);
    session.markSaved();
    assert.equal(session.isDirty, false);
    session.undo();
    assert.equal(session.isDirty, true);
    session.redo();
    assert.equal(session.isDirty, false, 'voltar ao ponto salvo deixa o documento limpo');
    session.undo();
    session.execute(del(2));
    session.undo();
    assert.equal(session.isDirty, true, 'o ponto salvo foi descartado do histórico: permanece sujo');
  });

  it('notifica uma vez por execute/undo/redo/markSaved e mantém o snapshot estável entre mudanças', () => {
    const session = new DocumentSession(makeDoc());
    let calls = 0;
    const off = session.subscribe(() => calls++);
    const snap0 = session.getSnapshot();
    assert.equal(session.getSnapshot(), snap0);
    session.execute(rotate(1));
    session.undo();
    session.redo();
    session.markSaved();
    assert.equal(calls, 4);
    assert.notEqual(session.getSnapshot(), snap0);
    assert.equal(session.getSnapshot(), session.getSnapshot());
    off();
    session.undo();
    assert.equal(calls, 4, 'depois de cancelar a inscrição não notifica mais');
  });

  it('snapshot expõe canUndo/canRedo/isDirty coerentes', () => {
    const session = new DocumentSession(makeDoc());
    assert.deepEqual([session.getSnapshot().canUndo, session.getSnapshot().canRedo], [false, false]);
    session.execute(rotate(1));
    assert.deepEqual([session.getSnapshot().canUndo, session.getSnapshot().canRedo, session.getSnapshot().isDirty], [true, false, true]);
    session.undo();
    assert.deepEqual([session.getSnapshot().canUndo, session.getSnapshot().canRedo], [false, true]);
  });
});
