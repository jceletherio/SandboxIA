import { CHANNELS } from '../redis/channels';
import { NOTIFIABLE_CHANNELS, buildNotification } from './notification-rules';

describe('buildNotification', () => {
  it('ignora canal que não é notificável', () => {
    expect(
      buildNotification(CHANNELS.SESSION_LOG, { sessionId: 'a', chunk: 'x' }),
    ).toBeNull();
  });

  it('ignora payload que não é objeto', () => {
    expect(buildNotification(CHANNELS.QUESTION_CREATED, null)).toBeNull();
    expect(buildNotification(CHANNELS.QUESTION_CREATED, 'texto')).toBeNull();
  });

  it('pergunta criada vira notificação alta com o texto da pergunta', () => {
    const payload = buildNotification(CHANNELS.QUESTION_CREATED, {
      id: 'q1',
      sessionId: 'abcdef1234',
      question: 'Posso sobrescrever o schema?',
      priority: 'high',
      status: 'pending',
    });

    expect(payload).toMatchObject({
      event: 'question',
      priority: 'high',
      tag: 'question:q1',
      path: '/questions',
      body: 'Posso sobrescrever o schema?',
    });
  });

  it('pergunta sem id não notifica — a tag de dedup ficaria sem chave', () => {
    expect(
      buildNotification(CHANNELS.QUESTION_CREATED, { question: 'oi' }),
    ).toBeNull();
  });

  it('decisão do Master só notifica quando escala', () => {
    expect(
      buildNotification(CHANNELS.MASTER_DECISION, {
        questionId: 'q1',
        action: 'answer',
      }),
    ).toBeNull();

    expect(
      buildNotification(CHANNELS.MASTER_DECISION, {
        questionId: 'q1',
        action: 'escalate',
        reason: 'confiança baixa',
      }),
    ).toMatchObject({ event: 'escalation', tag: 'escalation:q1', priority: 'high' });
  });

  it('sessão travada usa a razão do watchdog no corpo', () => {
    expect(
      buildNotification(CHANNELS.SESSION_STALLED, {
        sessionId: 'aaaaaaaabbbb',
        reason: 'orphaned_on_startup',
      }),
    ).toMatchObject({
      event: 'stalled',
      title: 'Sessão aaaaaaaa travada',
      body: 'orphaned_on_startup',
      tag: 'stalled:aaaaaaaabbbb',
    });
  });

  it('stage-failed e session:status=failed compartilham a tag da sessão', () => {
    const stage = buildNotification(CHANNELS.STAGE_FAILED, {
      sessionId: 's1',
      stage: 'implement',
      error: 'exit 1',
    });
    const status = buildNotification(CHANNELS.SESSION_STATUS, {
      sessionId: 's1',
      status: 'failed',
    });

    // Uma falha, uma vibração: a dedup do service depende dessa igualdade.
    expect(stage?.tag).toBe('failure:s1');
    expect(status?.tag).toBe('failure:s1');
  });

  it('session:status só notifica failed e timeout', () => {
    for (const status of ['running', 'stopped', 'paused', 'waiting']) {
      expect(
        buildNotification(CHANNELS.SESSION_STATUS, { sessionId: 's1', status }),
      ).toBeNull();
    }
    expect(
      buildNotification(CHANNELS.SESSION_STATUS, { sessionId: 's1', status: 'timeout' }),
    ).toMatchObject({ event: 'sessionFailed', priority: 'high' });
  });

  it('sessão concluída é low — sucesso informa, não interrompe', () => {
    expect(
      buildNotification(CHANNELS.SESSION_COMPLETED, { sessionId: 's1' }),
    ).toMatchObject({ event: 'sessionCompleted', priority: 'low' });
  });

  it('corpo de uma linha: quebra e espaço repetido colapsam, e trunca', () => {
    const payload = buildNotification(CHANNELS.QUESTION_CREATED, {
      id: 'q1',
      sessionId: 's1',
      question: `linha um\n\n   linha dois ${'x'.repeat(200)}`,
    });
    expect(payload!.body).not.toContain('\n');
    expect(payload!.body).toContain('linha um linha dois');
    expect(payload!.body.length).toBeLessThanOrEqual(140);
    expect(payload!.body.endsWith('…')).toBe(true);
  });

  it('todo canal notificável tem regra — lista e switch não podem divergir', () => {
    // Uma entrada na lista sem case no switch faria o service assinar um canal
    // que nunca produz nada; o inverso deixa evento notificável sem assinatura.
    const covered = NOTIFIABLE_CHANNELS.filter((channel) => {
      const probes = [
        { id: 'x', sessionId: 's1', question: 'q', action: 'escalate', questionId: 'x' },
        { sessionId: 's1', stage: 'implement', status: 'failed' },
      ];
      return probes.some((probe) => buildNotification(channel, probe) !== null);
    });
    expect(covered.sort()).toEqual([...NOTIFIABLE_CHANNELS].sort());
  });
});
