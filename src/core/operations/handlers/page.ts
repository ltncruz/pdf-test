import type { DocumentState } from '../../document/state';
import type { PageId } from '../../document/ids';
import type { Operation } from '../types';
import { OperationError } from '../errors';
import { addRotation } from '../../pages/geometry';

type Op<T extends Operation['type']> = Extract<Operation, { type: T }>;
export interface Applied {
  readonly state: DocumentState;
  readonly inverse: Operation;
}

function uniqueExistingIds(state: DocumentState, ids: readonly PageId[]): Set<PageId> {
  if (ids.length === 0) throw new OperationError('EMPTY_SELECTION', 'Nenhuma página selecionada');
  const set = new Set<PageId>();
  for (const id of ids) {
    if (!state.pages[id]) throw new OperationError('PAGE_NOT_FOUND', `Página inexistente: ${id}`);
    if (set.has(id)) throw new OperationError('DUPLICATE_ID', `Página repetida na operação: ${id}`);
    set.add(id);
  }
  return set;
}

export function deletePages(state: DocumentState, op: Op<'page/delete'>): Applied {
  const ids = uniqueExistingIds(state, op.pageIds);
  // O inverso carrega as próprias páginas (imutáveis, estruturalmente compartilhadas: custo desprezível).
  const items = state.pageOrder.flatMap((id, index) => {
    const page = state.pages[id];
    return ids.has(id) && page ? [{ page, index }] : [];
  });
  const pages = { ...state.pages };
  for (const id of ids) delete pages[id];
  return {
    state: { ...state, pages, pageOrder: state.pageOrder.filter((id) => !ids.has(id)) },
    inverse: { type: 'page/insert', items },
  };
}

export function insertPages(state: DocumentState, op: Op<'page/insert'>): Applied {
  if (op.items.length === 0) throw new OperationError('EMPTY_SELECTION', 'Nada para inserir');
  const seen = new Set<PageId>();
  for (const { page } of op.items) {
    if (state.pages[page.id] || seen.has(page.id)) {
      throw new OperationError('DUPLICATE_ID', `Página já existe no documento: ${page.id}`);
    }
    seen.add(page.id);
  }
  const sorted = [...op.items].sort((a, b) => a.index - b.index);
  const order = [...state.pageOrder];
  const pages = { ...state.pages };
  for (const { page, index } of sorted) {
    if (!Number.isInteger(index) || index < 0 || index > order.length) {
      throw new OperationError('INVALID_INDEX', `Índice de inserção inválido: ${index}`);
    }
    order.splice(index, 0, page.id);
    pages[page.id] = page;
  }
  return {
    state: { ...state, pages, pageOrder: order },
    inverse: { type: 'page/delete', pageIds: op.items.map((i) => i.page.id) },
  };
}

export function rotatePages(state: DocumentState, op: Op<'page/rotate'>): Applied {
  if (op.delta !== 90 && op.delta !== 180 && op.delta !== 270) {
    throw new OperationError('INVALID_ROTATION', `Delta de rotação inválido: ${String(op.delta)}`);
  }
  const ids = uniqueExistingIds(state, op.pageIds);
  const pages = { ...state.pages };
  for (const id of ids) {
    const page = pages[id];
    if (page) pages[id] = { ...page, rotation: addRotation(page.rotation, op.delta) };
  }
  const inverseDelta = (360 - op.delta) as 90 | 180 | 270;
  return {
    state: { ...state, pages },
    inverse: { type: 'page/rotate', pageIds: op.pageIds, delta: inverseDelta },
  };
}
