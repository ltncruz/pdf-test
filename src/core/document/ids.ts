/** IDs opacos (branded) para não misturar tipos de identificador por engano. */
export type Brand<T, B extends string> = T & { readonly __brand: B };
export type SourceId = Brand<string, 'SourceId'>;
export type PageId = Brand<string, 'PageId'>;
export type ObjectId = Brand<string, 'ObjectId'>;

export interface IdFactory {
  source(): SourceId;
  page(): PageId;
  object(): ObjectId;
}

/** Produção: UUIDs aleatórios (crypto.randomUUID existe no navegador e no Node >= 19). */
export function createRandomIdFactory(): IdFactory {
  const uuid = (): string => globalThis.crypto.randomUUID();
  return {
    source: () => `src_${uuid()}` as SourceId,
    page: () => `pg_${uuid()}` as PageId,
    object: () => `obj_${uuid()}` as ObjectId,
  };
}

/** Testes: IDs determinísticos e legíveis (src_1, pg_1, obj_1...). */
export function createSequentialIdFactory(): IdFactory {
  let s = 0;
  let p = 0;
  let o = 0;
  return {
    source: () => `src_${++s}` as SourceId,
    page: () => `pg_${++p}` as PageId,
    object: () => `obj_${++o}` as ObjectId,
  };
}
