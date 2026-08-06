import { LockableRedis, LockTimeoutError, withRedisLock } from './redis-lock';

/**
 * Redis de mentira com a semântica de `SET NX PX` e do script de release que o
 * lock depende — é a lógica que falha em silêncio (dois donos ao mesmo tempo
 * não dá erro, só estoura o teto de sessões lá na frente).
 */
function fakeRedis(): LockableRedis & { store: Map<string, string>; failSet?: boolean } {
  const store = new Map<string, string>();
  return {
    store,
    set: jest.fn(async function (this: any, key, value, _mode, _ttl, _nx) {
      if (this.failSet) throw new Error('ECONNREFUSED');
      if (store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
    eval: jest.fn(async (_script, _numKeys, key, owner) => {
      if (store.get(key) === owner) {
        store.delete(key);
        return 1;
      }
      return 0;
    }),
  };
}

describe('withRedisLock', () => {
  it('serializa dois donos: o segundo só entra depois que o primeiro solta', async () => {
    const redis = fakeRedis();
    const order: string[] = [];

    const first = withRedisLock(redis, 'k', { retryMs: 1 }, async () => {
      order.push('a:entra');
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push('a:sai');
    });
    const second = withRedisLock(redis, 'k', { retryMs: 1 }, async () => {
      order.push('b:entra');
    });

    await Promise.all([first, second]);
    expect(order).toEqual(['a:entra', 'a:sai', 'b:entra']);
  });

  it('libera a trava mesmo quando fn lança', async () => {
    const redis = fakeRedis();
    await expect(
      withRedisLock(redis, 'k', {}, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(redis.store.has('k')).toBe(false);
  });

  it('não apaga a trava de outro dono (a nossa expirou no meio)', async () => {
    const redis = fakeRedis();
    await withRedisLock(redis, 'k', {}, async () => {
      // Simula o TTL vencendo e outro processo assumindo a trava.
      redis.store.set('k', 'outro-dono');
    });
    expect(redis.store.get('k')).toBe('outro-dono');
  });

  it('desiste com LockTimeoutError quando a trava não vem', async () => {
    const redis = fakeRedis();
    redis.store.set('k', 'dono-eterno');
    await expect(
      withRedisLock(redis, 'k', { waitMs: 10, retryMs: 1 }, async () => 'nunca'),
    ).rejects.toBeInstanceOf(LockTimeoutError);
  });

  it('Redis fora do ar não bloqueia o trabalho — roda sem trava', async () => {
    const redis = fakeRedis();
    (redis as any).failSet = true;
    await expect(withRedisLock(redis, 'k', {}, async () => 'rodou')).resolves.toBe('rodou');
  });
});
