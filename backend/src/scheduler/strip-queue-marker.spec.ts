import { stripQueueMarker } from './session-governor.service';

/**
 * Limpeza da marca de fila (MT-12). Falha silenciosa clássica: sobrando um
 * `metadata.queue` de uma reserva morta, a task reaparece na fila e na UI como
 * "aguardando slot" sem ninguém ter pedido — e o resto do `metadata`
 * (`origin`, `backlog`, `autoStart`) não pode ir embora junto no processo.
 */
describe('stripQueueMarker', () => {
  it('remove só a marca de fila e preserva o resto do metadata', () => {
    const metadata = {
      queue: { reason: 'global', queuedAt: '2026-08-03T10:00:00.000Z' },
      origin: { macroTaskId: 'mt-7' },
      autoStart: false,
    };

    const result = stripQueueMarker(metadata);

    expect(result.wasQueued).toBe(true);
    expect(result.metadata).toEqual({ origin: { macroTaskId: 'mt-7' }, autoStart: false });
  });

  it('não muta a entrada', () => {
    const metadata = { queue: { reason: 'resource' }, origin: { macroTaskId: 'mt-10' } };

    stripQueueMarker(metadata);

    expect(metadata.queue).toEqual({ reason: 'resource' });
  });

  it('sinaliza que não havia nada a limpar — quem chama pula o UPDATE', () => {
    expect(stripQueueMarker({ origin: { macroTaskId: 'mt-2' } })).toEqual({
      metadata: { origin: { macroTaskId: 'mt-2' } },
      wasQueued: false,
    });
  });

  it('aceita metadata ausente ou de tipo errado sem lançar', () => {
    // `MacroTask.metadata` é Json?: null, string e array são todos possíveis no
    // banco, e nenhum deles pode derrubar um update_macro_task.
    for (const podre of [null, undefined, 'texto', 42, ['queue']]) {
      expect(stripQueueMarker(podre)).toEqual({ metadata: {}, wasQueued: false });
    }
  });
});
