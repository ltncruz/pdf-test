import type { DocumentState } from './state';
import type { IdFactory } from './ids';
import type { Page } from '../pages/page';
import type { SourceReader, SourceStore } from '../ports';
import { createEmptyDocument } from './state';
import { OpenError, SourceReadError } from './errors';
import { DEFAULT_LIMITS, type Limits } from '../limits';

export { OpenError, SourceReadError } from './errors';

const MIB = 1024 * 1024;

/** Chame ANTES de ler o arquivo para a memória (por exemplo com `File.size`). */
export function assertFileSizeAllowed(byteLength: number, name: string, limits: Limits = DEFAULT_LIMITS): void {
  if (byteLength > limits.maxFileBytes) {
    throw new OpenError('TOO_LARGE', `"${name}" tem ${(byteLength / MIB).toFixed(1)} MiB; o limite é ${(limits.maxFileBytes / MIB).toFixed(0)} MiB`);
  }
}

/**
 * Abre um PDF: valida limites, lê a estrutura (via SourceReader), guarda os bytes no SourceStore e devolve o
 * DocumentState inicial (1 página do modelo por página do PDF, sem alterações).
 * Atomicidade: TODA validação acontece antes de `sources.put`; se lançar, nada foi guardado.
 */
export async function openDocument(
  input: { name: string; bytes: Uint8Array },
  deps: { reader: SourceReader; sources: SourceStore; ids: IdFactory; limits?: Limits },
): Promise<DocumentState> {
  const limits = deps.limits ?? DEFAULT_LIMITS;
  const { name } = input;
  assertFileSizeAllowed(input.bytes.byteLength, name, limits);

  let info;
  try {
    info = await deps.reader.read(input.bytes, { maxPages: limits.maxPages });
  } catch (cause) {
    if (cause instanceof SourceReadError) {
      const message: Record<SourceReadError['code'], string> = {
        PASSWORD_REQUIRED: `"${name}" exige senha para abrir; PDFs protegidos por senha ainda não são suportados`,
        INVALID_PDF: `Não foi possível abrir "${name}": arquivo inválido ou corrompido`,
        TOO_MANY_PAGES: `"${name}" tem páginas demais; o limite é ${limits.maxPages}`,
      };
      throw new OpenError(cause.code, message[cause.code], { cause });
    }
    throw new OpenError('INVALID_PDF', `Não foi possível abrir "${name}": arquivo inválido ou corrompido`, { cause });
  }

  if (info.encrypted) {
    throw new OpenError('ENCRYPTED', `"${name}" é criptografado (com restrições de permissão); a exportação não conseguiria preservar a proteção, então este PDF não é suportado nesta versão`);
  }
  if (info.pages.length === 0) throw new OpenError('NO_PAGES', `"${name}" não tem páginas`);
  if (info.pages.length > limits.maxPages) {
    throw new OpenError('TOO_MANY_PAGES', `"${name}" tem ${info.pages.length} páginas; o limite é ${limits.maxPages}`);
  }
  info.pages.forEach((p, i) => {
    const { w, h } = p.crop;
    if (![p.crop.x, p.crop.y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) {
      throw new OpenError('INVALID_PAGE_BOX', `"${name}": a página ${i + 1} tem dimensões inválidas`);
    }
    if (w > limits.maxPageDimensionPt || h > limits.maxPageDimensionPt) {
      throw new OpenError('PAGE_TOO_LARGE', `"${name}": a página ${i + 1} mede ${Math.round(w)}x${Math.round(h)} pt; o limite é ${limits.maxPageDimensionPt} pt por lado`);
    }
  });

  const sourceId = deps.ids.source();
  await deps.sources.put(sourceId, input.bytes);

  const pages: Record<string, Page> = {};
  const pageOrder = info.pages.map((p, index) => {
    const id = deps.ids.page();
    pages[id] = { id, origin: { kind: 'source', sourceId, index }, crop: p.crop, baseRotation: p.rotation, rotation: 0, objects: [] };
    return id;
  });

  const empty = createEmptyDocument(name);
  return {
    ...empty,
    sources: { [sourceId]: { id: sourceId, name, byteLength: input.bytes.byteLength, pageCount: info.pages.length, traits: { acroForm: info.acroForm, xfa: info.xfa, signatures: info.signatures } } },
    pages,
    pageOrder,
  };
}
