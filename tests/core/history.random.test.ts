import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DocumentSession, type DocumentState, type Operation, type Page } from '../../src/core';
import { deepFreeze } from '../helpers';
import { makeDoc, makePage, makeText, sansRevision } from './support';

/** PRNG determinístico (mulberry32): falhas são reproduzíveis pela seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomOp(state: DocumentState, r: () => number, counters: { page: number; obj: number }): Operation | null {
  const ids = state.pageOrder;
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(r() * arr.length)] as T;
  const subset = (): typeof ids => ids.filter(() => r() < 0.5).slice(0, Math.max(1, ids.length));
  const kinds = ['insert', 'rotate', 'delete', 'add', 'remove', 'update', 'batch'] as const;
  switch (pick(kinds)) {
    case 'insert': {
      const page: Page = makePage(++counters.page + 1000, { origin: { kind: 'blank' } });
      return { type: 'page/insert', items: [{ page, index: Math.floor(r() * (ids.length + 1)) }] };
    }
    case 'rotate': {
      const sel = subset();
      return sel.length ? { type: 'page/rotate', pageIds: sel, delta: pick([90, 180, 270] as const) } : null;
    }
    case 'delete': {
      const sel = subset();
      return sel.length ? { type: 'page/delete', pageIds: sel } : null;
    }
    case 'add': {
      if (!ids.length) return null;
      return { type: 'object/add', pageId: pick(ids), object: makeText(++counters.obj) };
    }
    case 'remove': {
      const withObjs = ids.filter((id) => (state.pages[id]?.objects.length ?? 0) > 0);
      if (!withObjs.length) return null;
      const pageId = pick(withObjs);
      const objs = state.pages[pageId]?.objects ?? [];
      return { type: 'object/remove', pageId, objectId: pick(objs).id };
    }
    case 'update': {
      const withObjs = ids.filter((id) => (state.pages[id]?.objects.length ?? 0) > 0);
      if (!withObjs.length) return null;
      const pageId = pick(withObjs);
      const target = pick(state.pages[pageId]?.objects ?? []);
      const patch = r() < 0.5 ? { text: `editado ${Math.floor(r() * 1000)}` } : { fontSize: 8 + Math.floor(r() * 20), rect: { x: Math.floor(r() * 50), y: 5, w: 80, h: 30 } };
      return { type: 'object/update', pageId, objectId: target.id, patch };
    }
    case 'batch': {
      if (!ids.length) return null;
      const pageId = pick(ids);
      return { type: 'batch', ops: [
        { type: 'page/rotate', pageIds: [pageId], delta: 90 },
        { type: 'object/add', pageId, object: makeText(++counters.obj) },
      ] };
    }
  }
}

describe('propriedade: undo total = estado inicial; redo total = estado final', () => {
  for (let seed = 1; seed <= 300; seed++) {
    it(`seed ${seed}`, () => {
      const r = rng(seed);
      const session = new DocumentSession(deepFreeze(makeDoc(1 + Math.floor(r() * 5))));
      const snapshots = [sansRevision(session.getState())];
      const counters = { page: 0, obj: 0 };
      const steps = 1 + Math.floor(r() * 25);
      for (let i = 0; i < steps; i++) {
        const op = randomOp(session.getState(), r, counters);
        if (!op) continue;
        session.execute(deepFreeze(op));
        snapshots.push(sansRevision(session.getState()));
        // Toda página presente em pageOrder existe em pages e vice-versa.
        const s = session.getState();
        assert.deepEqual([...s.pageOrder].sort(), Object.keys(s.pages).sort(), 'pageOrder e pages divergiram');
      }
      for (let i = snapshots.length - 2; i >= 0; i--) {
        assert.ok(session.undo());
        assert.deepEqual(sansRevision(session.getState()), snapshots[i], `undo divergiu no passo ${i}`);
      }
      assert.equal(session.canUndo, false);
      for (let i = 1; i < snapshots.length; i++) {
        assert.ok(session.redo());
        assert.deepEqual(sansRevision(session.getState()), snapshots[i], `redo divergiu no passo ${i}`);
      }
      assert.equal(session.canRedo, false);
    });
  }
});
