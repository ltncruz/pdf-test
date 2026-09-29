export type OpenErrorCode =
  | 'TOO_LARGE'
  | 'TOO_MANY_PAGES'
  | 'PAGE_TOO_LARGE'
  | 'INVALID_PAGE_BOX'
  | 'NO_PAGES'
  | 'PASSWORD_REQUIRED'
  | 'ENCRYPTED'
  | 'INVALID_PDF';

/** Falha controlada ao abrir um PDF. Nada é guardado nem alterado quando isto é lançado. */
export class OpenError extends Error {
  readonly code: OpenErrorCode;
  constructor(code: OpenErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'OpenError';
    this.code = code;
  }
}

/** Erro tipado que um SourceReader lança para o core traduzir em OpenError (sem expor exceções da biblioteca de PDF). */
export class SourceReadError extends Error {
  readonly code: Extract<OpenErrorCode, 'TOO_MANY_PAGES' | 'PASSWORD_REQUIRED' | 'INVALID_PDF'>;
  constructor(code: SourceReadError['code'], message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SourceReadError';
    this.code = code;
  }
}
