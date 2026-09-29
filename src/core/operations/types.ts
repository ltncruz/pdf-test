import type { ObjectId, PageId } from '../document/ids';
import type { Page, PageObject, TextObjectPatch } from '../pages/page';

/**
 * Operações são DADOS (serializáveis): base do histórico, do autosave futuro,
 * dos testes e do Simply Automate. Nenhuma referência a funções ou a bytes pesados.
 */
export type Operation =
  | { readonly type: 'page/delete'; readonly pageIds: readonly PageId[] }
  /**
   * Insere páginas (blank, restauração de exclusão, duplicação, merge).
   * `index` é a posição FINAL da página no pageOrder; itens são aplicados em ordem crescente de index.
   */
  | { readonly type: 'page/insert'; readonly items: readonly { readonly page: Page; readonly index: number }[] }
  | { readonly type: 'page/rotate'; readonly pageIds: readonly PageId[]; readonly delta: 90 | 180 | 270 }
  | { readonly type: 'object/add'; readonly pageId: PageId; readonly object: PageObject; readonly index?: number }
  | { readonly type: 'object/remove'; readonly pageId: PageId; readonly objectId: ObjectId }
  /** Altera propriedades de um objeto (ex.: editar o texto de uma caixa). O inverso restaura os valores anteriores. */
  | { readonly type: 'object/update'; readonly pageId: PageId; readonly objectId: ObjectId; readonly patch: TextObjectPatch }
  /** Agrupa operações em uma única entrada de histórico (atômica). */
  | { readonly type: 'batch'; readonly ops: readonly Operation[] };

export type OperationType = Operation['type'];
