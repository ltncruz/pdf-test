import type { DocumentState } from './document/state';
import type { Operation } from './operations/types';
import { applyOperation } from './operations/apply';
import { History } from './history/history';

export interface SessionSnapshot {
  readonly state: DocumentState;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly isDirty: boolean;
}

/**
 * Sessão de edição: estado atual + histórico. É a ÚNICA porta de escrita do documento.
 * Compatível com useSyncExternalStore (subscribe / getSnapshot com identidade estável entre mudanças).
 */
export class DocumentSession {
  #state: DocumentState;
  readonly #history: History;
  readonly #listeners = new Set<() => void>();
  /**
   * Modelo de "estado salvo": a posição LÓGICA (History.position) do último ponto salvo, ou null se esse
   * ponto deixou de existir na linha do tempo atual (foi descartado por uma ramificação). O documento inicial
   * é o primeiro ponto salvo (posição 0). Dirty <=> não estamos exatamente nesse ponto.
   */
  #savedPosition: number | null = 0;
  #snapshot: SessionSnapshot;

  constructor(initial: DocumentState, options: { maxHistory?: number } = {}) {
    this.#state = initial;
    this.#history = new History(options.maxHistory);
    this.#snapshot = this.#buildSnapshot();
  }

  getState = (): DocumentState => this.#state;
  getSnapshot = (): SessionSnapshot => this.#snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  get canUndo(): boolean {
    return this.#history.canUndo;
  }
  get canRedo(): boolean {
    return this.#history.canRedo;
  }
  /**
   * True se o estado atual não é o do último ponto salvo. Como a posição lógica sobrevive ao descarte de
   * entradas antigas, desfazer de volta até o ponto salvo deixa o documento limpo mesmo que a entrada
   * que o criou já tenha saído da pilha. Undo/redo/`revision` não interferem: só a posição importa.
   */
  get isDirty(): boolean {
    return this.#savedPosition === null || this.#savedPosition !== this.#history.position;
  }

  /** Aplica uma alteração. Lança OperationError (estado intacto) se a operação for inválida. */
  execute(op: Operation): void {
    const applied = applyOperation(this.#state, op); // pode lançar: nada foi alterado até aqui
    // Ramificação: se o ponto salvo estava no trecho de redo que esta operação vai descartar, ele deixa de
    // existir (a mesma posição numérica passaria a designar OUTRO conteúdo). Fica dirty até o próximo save.
    if (this.#savedPosition !== null && this.#savedPosition > this.#history.position) this.#savedPosition = null;
    this.#state = applied.state;
    this.#history.push({ forward: op, inverse: applied.inverse });
    this.#publish();
  }

  undo(): boolean {
    const entry = this.#history.peekUndo();
    if (!entry) return false;
    this.#state = applyOperation(this.#state, entry.inverse).state;
    this.#history.commitUndo();
    this.#publish();
    return true;
  }

  redo(): boolean {
    const entry = this.#history.peekRedo();
    if (!entry) return false;
    this.#state = applyOperation(this.#state, entry.forward).state;
    this.#history.commitRedo();
    this.#publish();
    return true;
  }

  /** Marca o estado atual como salvo/exportado (não altera o histórico). */
  markSaved(): void {
    this.#savedPosition = this.#history.position;
    this.#publish();
  }

  #buildSnapshot(): SessionSnapshot {
    return { state: this.#state, canUndo: this.canUndo, canRedo: this.canRedo, isDirty: this.isDirty };
  }

  #publish(): void {
    this.#snapshot = this.#buildSnapshot();
    for (const l of [...this.#listeners]) l();
  }
}
