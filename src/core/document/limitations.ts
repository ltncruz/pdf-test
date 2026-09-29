import type { DocumentState } from './state';
import type { SourceId } from './ids';

export interface Limitation {
  readonly code: 'FORM_NOT_PRESERVED' | 'SIGNATURE_NOT_PRESERVED';
  readonly sourceId: SourceId;
  readonly message: string;
}

/**
 * Limitações CONHECIDAS da exportação atual para as origens que ainda têm páginas no documento.
 * Não bloqueiam a exportação (não há corrupção), mas o usuário precisa ser avisado ANTES e DEPOIS de exportar.
 */
export function sourceLimitations(state: DocumentState): Limitation[] {
  const used = new Set<SourceId>();
  for (const id of state.pageOrder) {
    const origin = state.pages[id]?.origin;
    if (origin?.kind === 'source') used.add(origin.sourceId);
  }
  const out: Limitation[] = [];
  for (const sourceId of used) {
    const ref = state.sources[sourceId];
    if (!ref) continue;
    if (ref.traits.acroForm || ref.traits.xfa) {
      out.push({ code: 'FORM_NOT_PRESERVED', sourceId, message: `"${ref.name}" contém formulário interativo: os campos NÃO são preservados na exportação (a aparência é mantida, mas deixam de ser editáveis)` });
    }
    if (ref.traits.signatures) {
      out.push({ code: 'SIGNATURE_NOT_PRESERVED', sourceId, message: `"${ref.name}" contém assinatura digital: o arquivo exportado é um novo documento e a assinatura NÃO é preservada` });
    }
  }
  return out;
}
