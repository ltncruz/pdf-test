export type OperationErrorCode =
  | 'EMPTY_SELECTION'
  | 'DUPLICATE_ID'
  | 'PAGE_NOT_FOUND'
  | 'OBJECT_NOT_FOUND'
  | 'INVALID_INDEX'
  | 'INVALID_ROTATION'
  | 'INVALID_OBJECT';

/** Erro de operação inválida. A aplicação é atômica: se lançar, o estado original permanece intacto. */
export class OperationError extends Error {
  readonly code: OperationErrorCode;
  constructor(code: OperationErrorCode, message: string) {
    super(message);
    this.name = 'OperationError';
    this.code = code;
  }
}
