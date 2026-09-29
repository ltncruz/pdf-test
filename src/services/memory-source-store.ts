import type { SourceId } from '../core/document/ids';
import type { SourceStore } from '../core/ports';

/** SourceStore em memória (v0.x). Desktop/OPFS/streaming entram atrás da mesma interface. */
export function createMemorySourceStore(): SourceStore & { readonly size: number } {
  const map = new Map<SourceId, Uint8Array>();
  return {
    get size() {
      return map.size;
    },
    async has(id) {
      return map.has(id);
    },
    async get(id) {
      const bytes = map.get(id);
      if (!bytes) throw new Error(`PDF de origem não encontrado: ${id}`);
      return bytes;
    },
    async put(id, bytes) {
      map.set(id, bytes);
    },
    async delete(id) {
      map.delete(id);
    },
  };
}
