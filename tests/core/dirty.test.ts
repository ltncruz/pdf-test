import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DocumentSession, type Operation } from '../../src/core';
import { makeDoc, pid } from './support';

/** Operações sempre válidas e distinguíveis: cada uma altera a rotação de uma página. */
const rot = (page: number, delta: 90 | 180 | 270 = 90): Operation => ({ type: 'page/rotate', pageIds: [pid(page)], delta });
const newSession = (maxHistory?: number) => new DocumentSession(makeDoc(3), maxHistory === undefined ? {} : { maxHistory });

describe('isDirty: casos básicos', () => {
  it('documento recém-aberto está limpo', () => {
    const s = newSession();
    assert.equal(s.isDirty, false);
    assert.equal(s.getSnapshot().isDirty, false);
  });
  it('operação → dirty', () => {
    const s = newSession();
    s.execute(rot(1));
    assert.equal(s.isDirty, true);
  });
  it('operação → salvar → limpo', () => {
    const s = newSession();
    s.execute(rot(1));
    s.markSaved();
    assert.equal(s.isDirty, false);
  });
  it('salvar → nova operação → dirty', () => {
    const s = newSession();
    s.execute(rot(1));
    s.markSaved();
    s.execute(rot(2));
    assert.equal(s.isDirty, true);
  });
  it('salvar → operação → undo → limpo', () => {
    const s = newSession();
    s.execute(rot(1));
    s.markSaved();
    s.execute(rot(2));
    s.undo();
    assert.equal(s.isDirty, false);
  });
  it('salvar → operação → undo → redo → dirty', () => {
    const s = newSession();
    s.execute(rot(1));
    s.markSaved();
    s.execute(rot(2));
    s.undo();
    s.redo();
    assert.equal(s.isDirty, true);
  });
  it('salvar sem nenhuma operação mantém limpo, e desfazer além do ponto salvo deixa dirty', () => {
    const s = newSession();
    s.markSaved();
    assert.equal(s.isDirty, false);
    const t = newSession();
    t.execute(rot(1));
    t.markSaved();
    t.undo(); // estado anterior ao salvo (inicial): difere do salvo
    assert.equal(t.isDirty, true);
    t.redo();
    assert.equal(t.isDirty, false);
  });
});

describe('isDirty: múltiplos ciclos de salvamento', () => {
  it('o ponto salvo mais recente é o que vale', () => {
    const s = newSession();
    s.execute(rot(1));
    s.markSaved(); // ponto 1
    s.execute(rot(2));
    s.markSaved(); // ponto 2
    assert.equal(s.isDirty, false);
    s.undo(); // ponto 1: era o salvo ANTERIOR, já não é o atual
    assert.equal(s.isDirty, true);
    s.redo();
    assert.equal(s.isDirty, false);
    s.undo();
    s.markSaved(); // agora o ponto 1 é o salvo
    assert.equal(s.isDirty, false);
    s.redo();
    assert.equal(s.isDirty, true);
    s.undo();
    assert.equal(s.isDirty, false);
  });
  it('markSaved é idempotente e não altera o histórico', () => {
    const s = newSession();
    s.execute(rot(1));
    s.markSaved();
    s.markSaved();
    assert.equal(s.canUndo, true);
    assert.equal(s.isDirty, false);
    s.undo();
    s.redo();
    assert.equal(s.isDirty, false);
  });
});

describe('isDirty: truncamento por maxHistory', () => {
  it('REPRODUÇÃO DO BUG: a entrada do ponto salvo sai da pilha, mas desfazer até lá volta logicamente ao estado salvo', () => {
    const s = newSession(3);
    s.execute(rot(1)); // A
    s.markSaved(); // estado salvo = depois de A
    const savedState = s.getState();
    s.execute(rot(2)); // B
    s.execute(rot(3)); // C
    s.execute(rot(1, 180)); // D: A sai fisicamente da pilha (limite 3)
    assert.equal(s.isDirty, true);
    s.undo(); // desfaz D
    s.undo(); // desfaz C
    s.undo(); // desfaz B  => estado lógico = depois de A
    assert.deepEqual({ ...s.getState(), revision: 0 }, { ...savedState, revision: 0 }, 'o documento voltou ao conteúdo salvo');
    assert.equal(s.canUndo, false, 'A já foi descartada: não há mais o que desfazer');
    assert.equal(s.isDirty, false, 'logo o documento deve estar limpo');
  });
  it('se o ponto salvo ficou ALÉM do que ainda dá para desfazer, o documento nunca volta a ficar limpo por undo', () => {
    const s = newSession(2);
    s.execute(rot(1)); // A
    s.markSaved();
    s.execute(rot(2)); // B
    s.execute(rot(3)); // C: pilha [B, C]
    s.execute(rot(1, 180)); // D: pilha [C, D]
    while (s.undo()) {
      /* desfaz tudo o que ainda é possível */
    }
    assert.equal(s.isDirty, true, 'o estado alcançável mais antigo (depois de B) não é o salvo (depois de A)');
    while (s.redo()) {
      /* refaz tudo */
    }
    assert.equal(s.isDirty, true);
  });
  it('ponto salvo dentro da janela continua funcionando depois que outras entradas mais antigas caem', () => {
    const s = newSession(2);
    s.execute(rot(1)); // A
    s.execute(rot(2)); // B
    s.execute(rot(3)); // C: A cai
    s.markSaved(); // salvo depois de C
    s.execute(rot(1, 180)); // D: B cai
    assert.equal(s.isDirty, true);
    s.undo();
    assert.equal(s.isDirty, false);
    s.redo();
    assert.equal(s.isDirty, true);
  });
  it('maxHistory = 1 funciona', () => {
    const s = newSession(1);
    s.execute(rot(1));
    s.markSaved();
    s.execute(rot(2));
    assert.equal(s.isDirty, true);
    s.undo();
    assert.equal(s.isDirty, false);
  });
});

describe('isDirty: ramificação (branching) depois de undo', () => {
  it('nova operação após undo descarta o redo; se o ponto salvo estava no redo descartado, fica dirty para sempre (até novo save)', () => {
    const s = newSession();
    s.execute(rot(1));
    s.execute(rot(2));
    s.markSaved(); // ponto 2
    s.undo(); // ponto 1
    s.execute(rot(3, 180)); // ramo novo: também no ponto 2 numérico, mas conteúdo DIFERENTE do salvo
    assert.equal(s.isDirty, true, 'mesma posição numérica, estado diferente: não pode ficar limpo');
    s.undo();
    assert.equal(s.isDirty, true);
    s.redo();
    assert.equal(s.isDirty, true);
    s.markSaved();
    assert.equal(s.isDirty, false, 'um novo save reestabelece o ponto de referência');
  });
  it('ramificar ACIMA do ponto salvo mantém o ponto salvo alcançável', () => {
    const s = newSession();
    s.execute(rot(1));
    s.markSaved(); // ponto 1
    s.execute(rot(2));
    s.undo(); // ponto 1 (redo tem B)
    s.execute(rot(3, 180)); // ramo novo a partir do ponto 1 (o ponto salvo NÃO estava no redo descartado)
    assert.equal(s.isDirty, true);
    s.undo();
    assert.equal(s.isDirty, false, 'voltou exatamente ao ponto salvo');
  });
  it('ramificar exatamente NO ponto salvo (após undo) também mantém o salvo alcançável', () => {
    const s = newSession();
    s.execute(rot(1));
    s.markSaved();
    s.undo();
    s.redo();
    s.execute(rot(2));
    s.undo();
    assert.equal(s.isDirty, false);
  });
});

describe('isDirty com subscribe / useSyncExternalStore', () => {
  it('cada mudança de isDirty é publicada e o snapshot só muda quando algo muda', () => {
    const s = newSession(3);
    const seen: boolean[] = [];
    s.subscribe(() => seen.push(s.getSnapshot().isDirty));
    const snap0 = s.getSnapshot();
    assert.equal(s.getSnapshot(), snap0);
    s.execute(rot(1)); // true
    s.markSaved(); // false
    s.execute(rot(2)); // true
    s.undo(); // false
    s.redo(); // true
    assert.deepEqual(seen, [true, false, true, false, true]);
    assert.notEqual(s.getSnapshot(), snap0);
    assert.equal(s.getSnapshot(), s.getSnapshot());
  });
  it('a leitura do snapshot bate com o getter em todo momento (incluindo após truncamento)', () => {
    const s = newSession(2);
    const check = () => assert.equal(s.getSnapshot().isDirty, s.isDirty);
    check();
    for (let i = 0; i < 6; i++) {
      s.execute(rot(1 + (i % 3)));
      check();
      if (i === 1) s.markSaved();
      check();
    }
    while (s.undo()) check();
    while (s.redo()) check();
  });
});

/** PRNG determinístico (mulberry32). */
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

/**
 * ORÁCULO independente: modela a linha do tempo como uma lista de versões com id único (sem nenhum
 * limite físico), aplica o limite de histórico só como "até onde dá para desfazer", e define
 * dirty = (versão atual !== versão salva). Ramificar cria versões novas com ids novos.
 */
describe('isDirty: propriedade contra um oráculo (sequências aleatórias com maxHistory pequeno)', () => {
  for (let seed = 1; seed <= 400; seed++) {
    it(`seed ${seed}`, () => {
      const r = rng(seed);
      const max = 1 + Math.floor(r() * 4);
      const s = newSession(max);
      const path = [0];
      let cur = 0;
      let lo = 0;
      let nextVersion = 1;
      let saved = 0;
      const steps = 5 + Math.floor(r() * 40);
      for (let i = 0; i < steps; i++) {
        const dice = r();
        let action: string;
        if (dice < 0.45) {
          action = 'execute';
          s.execute(rot(1 + Math.floor(r() * 3), ([90, 180, 270] as const)[Math.floor(r() * 3)] as 90 | 180 | 270));
          path.length = cur + 1;
          path.push(nextVersion++);
          cur++;
          if (cur - lo > max) lo++;
        } else if (dice < 0.7) {
          action = 'undo';
          const can = cur > lo;
          assert.equal(s.undo(), can);
          if (can) cur--;
        } else if (dice < 0.9) {
          action = 'redo';
          const can = cur < path.length - 1;
          assert.equal(s.redo(), can);
          if (can) cur++;
        } else {
          action = 'markSaved';
          s.markSaved();
          saved = path[cur] as number;
        }
        assert.equal(s.isDirty, path[cur] !== saved, `passo ${i} (${action}), max=${max}, cur=${cur}, lo=${lo}, saved=${saved}`);
        assert.equal(s.getSnapshot().isDirty, s.isDirty);
        assert.equal(s.canUndo, cur > lo);
        assert.equal(s.canRedo, cur < path.length - 1);
      }
    });
  }
});
