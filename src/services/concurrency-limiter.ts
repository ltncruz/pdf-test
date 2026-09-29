/**
 * Semáforo simples com fila FIFO e cancelamento: no máximo `max` tarefas ao mesmo tempo; as demais esperam.
 * Uma espera cancelada (AbortSignal) sai da fila sem nunca ter ocupado uma vaga.
 */
export interface ConcurrencyLimiter {
  /** Resolve com a função que libera a vaga (idempotente). Rejeita com AbortError se cancelado enquanto esperava. */
  acquire(signal?: AbortSignal): Promise<() => void>;
  readonly active: number;
  readonly queued: number;
}

function abortError(): Error {
  const e = new Error('Operação cancelada');
  e.name = 'AbortError';
  return e;
}

export function createConcurrencyLimiter(max: number): ConcurrencyLimiter {
  if (!Number.isInteger(max) || max < 1) throw new RangeError('max deve ser um inteiro >= 1');
  let active = 0;
  const queue: { grant: () => void; signal: AbortSignal | undefined; onAbort: () => void }[] = [];

  const makeRelease = (): (() => void) => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active--;
      drain();
    };
  };
  const drain = (): void => {
    while (active < max && queue.length > 0) {
      const next = queue.shift()!;
      next.signal?.removeEventListener('abort', next.onAbort);
      active++;
      next.grant();
    }
  };

  return {
    get active() {
      return active;
    },
    get queued() {
      return queue.length;
    },
    acquire(signal) {
      if (signal?.aborted) return Promise.reject(abortError());
      return new Promise<() => void>((resolve, reject) => {
        const release = makeRelease();
        const entry = {
          grant: () => resolve(release),
          signal,
          onAbort: () => {
            const i = queue.indexOf(entry);
            if (i >= 0) queue.splice(i, 1);
            reject(abortError());
          },
        };
        signal?.addEventListener('abort', entry.onAbort, { once: true });
        queue.push(entry);
        drain();
      });
    },
  };
}
