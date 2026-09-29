import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createConcurrencyLimiter } from '../../src/services/concurrency-limiter';

const tick = () => new Promise<void>((r) => setImmediate(r));

describe('ConcurrencyLimiter', () => {
  it('nunca excede o máximo e libera em ordem FIFO', async () => {
    const lim = createConcurrencyLimiter(2);
    const order: number[] = [];
    let running = 0;
    let peak = 0;
    const job = async (n: number) => {
      const release = await lim.acquire();
      running++;
      peak = Math.max(peak, running);
      order.push(n);
      await tick();
      running--;
      release();
    };
    await Promise.all([1, 2, 3, 4, 5, 6].map(job));
    assert.equal(peak, 2);
    assert.deepEqual(order, [1, 2, 3, 4, 5, 6]);
    assert.equal(lim.active, 0);
    assert.equal(lim.queued, 0);
  });
  it('espera cancelada sai da fila, rejeita com AbortError e não ocupa vaga', async () => {
    const lim = createConcurrencyLimiter(1);
    const first = await lim.acquire();
    const ctrl = new AbortController();
    const waiting = lim.acquire(ctrl.signal);
    assert.equal(lim.queued, 1);
    ctrl.abort();
    await assert.rejects(waiting, (e: unknown) => (e as Error).name === 'AbortError');
    assert.equal(lim.queued, 0);
    first();
    assert.equal(lim.active, 0);
    const again = await lim.acquire();
    assert.equal(lim.active, 1);
    again();
  });
  it('signal já abortado rejeita imediatamente sem enfileirar', async () => {
    const lim = createConcurrencyLimiter(1);
    const ctrl = new AbortController();
    ctrl.abort();
    await assert.rejects(lim.acquire(ctrl.signal), (e: unknown) => (e as Error).name === 'AbortError');
    assert.equal(lim.queued, 0);
    assert.equal(lim.active, 0);
  });
  it('release é idempotente (chamar duas vezes não libera duas vagas)', async () => {
    const lim = createConcurrencyLimiter(1);
    const a = await lim.acquire();
    const b = lim.acquire();
    a();
    a();
    const rb = await b;
    assert.equal(lim.active, 1);
    const c = lim.acquire();
    await tick();
    assert.equal(lim.queued, 1, 'a segunda chamada de a() não pode ter liberado vaga para c');
    rb();
    (await c)();
    assert.equal(lim.active, 0);
  });
  it('erro dentro da tarefa (com finally) não trava a fila', async () => {
    const lim = createConcurrencyLimiter(1);
    const failing = (async () => { const r = await lim.acquire(); try { throw new Error('x'); } finally { r(); } })();
    await assert.rejects(failing);
    (await lim.acquire())();
  });
  it('rejeita max inválido', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) assert.throws(() => createConcurrencyLimiter(bad), RangeError);
  });
});
