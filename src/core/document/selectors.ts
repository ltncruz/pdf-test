import type { DocumentState } from './state';
import type { PageId } from './ids';
import type { Page } from '../pages/page';

export function getPage(state: DocumentState, id: PageId): Page {
  const page = state.pages[id];
  if (!page) throw new Error(`Página inexistente: ${id}`);
  return page;
}

export function getOrderedPages(state: DocumentState): Page[] {
  return state.pageOrder.map((id) => getPage(state, id));
}

export function pageCount(state: DocumentState): number {
  return state.pageOrder.length;
}
