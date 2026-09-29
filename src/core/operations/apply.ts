import type { DocumentState } from '../document/state';
import type { Operation } from './types';
import type { Applied } from './handlers/page';
import { deletePages, insertPages, rotatePages } from './handlers/page';
import { addObject, removeObject, updateObject } from './handlers/object';

export type { Applied } from './handlers/page';

function applyInner(state: DocumentState, op: Operation): Applied {
  switch (op.type) {
    case 'page/delete':
      return deletePages(state, op);
    case 'page/insert':
      return insertPages(state, op);
    case 'page/rotate':
      return rotatePages(state, op);
    case 'object/add':
      return addObject(state, op);
    case 'object/remove':
      return removeObject(state, op);
    case 'object/update':
      return updateObject(state, op);
    case 'batch': {
      let current = state;
      const inverses: Operation[] = [];
      for (const inner of op.ops) {
        const r = applyInner(current, inner);
        current = r.state;
        inverses.push(r.inverse);
      }
      return { state: current, inverse: { type: 'batch', ops: inverses.reverse() } };
    }
    default: {
      const never: never = op;
      throw new Error(`Operação desconhecida: ${JSON.stringify(never)}`);
    }
  }
}

/**
 * Aplica uma operação de forma PURA e ATÔMICA: nunca muta `state`; se lançar, nada mudou.
 * Devolve o novo estado (com revision + 1) e a operação inversa, calculada no momento da aplicação.
 */
export function applyOperation(state: DocumentState, op: Operation): Applied {
  const { state: next, inverse } = applyInner(state, op);
  return { state: { ...next, revision: state.revision + 1 }, inverse };
}
