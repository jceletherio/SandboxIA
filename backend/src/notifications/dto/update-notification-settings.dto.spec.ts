import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateNotificationSettingsDto } from './update-notification-settings.dto';

/**
 * O DTO é a única barreira antes do banco: `main.ts` roda com `whitelist` +
 * `forbidNonWhitelisted`, então o que passa aqui é gravado.
 */
function errorsOf(payload: Record<string, unknown>): string[] {
  const dto = plainToInstance(UpdateNotificationSettingsDto, payload);
  return validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  }).flatMap((error) => Object.keys(error.constraints ?? {}).map(() => error.property));
}

describe('UpdateNotificationSettingsDto', () => {
  it('aceita patch parcial', () => {
    expect(errorsOf({ enabled: false })).toEqual([]);
    expect(errorsOf({})).toEqual([]);
  });

  it('recusa campo desconhecido', () => {
    expect(errorsOf({ campoInexistente: 1 })).toContain('campoInexistente');
  });

  it.each(['publicBaseUrl', 'ntfyServerUrl', 'webhookUrl'])(
    '%s exige protocolo — host pelado ia para o banco e só quebrava no fetch',
    (field) => {
      // Regressão: com só `require_tld: false`, isURL aceitava "nao-e-url".
      expect(errorsOf({ [field]: 'nao-e-url' })).toContain(field);
      expect(errorsOf({ [field]: 'ntfy.sh' })).toContain(field);
      expect(errorsOf({ [field]: 'ftp://ntfy.sh' })).toContain(field);
    },
  );

  it.each(['publicBaseUrl', 'ntfyServerUrl', 'webhookUrl'])(
    '%s aceita IP de LAN e host sem TLD — é o alvo real aqui',
    (field) => {
      expect(errorsOf({ [field]: 'http://192.168.1.48:3000' })).toEqual([]);
      expect(errorsOf({ [field]: 'http://orchestr.local:4000' })).toEqual([]);
      expect(errorsOf({ [field]: 'https://ntfy.sh' })).toEqual([]);
    },
  );

  it('publicBaseUrl e webhookUrl aceitam null e string vazia para limpar', () => {
    expect(errorsOf({ publicBaseUrl: null })).toEqual([]);
    expect(errorsOf({ publicBaseUrl: '' })).toEqual([]);
    expect(errorsOf({ webhookUrl: null })).toEqual([]);
    expect(errorsOf({ webhookUrl: '' })).toEqual([]);
  });

  it('dedupeWindowSec fica entre 0 e 3600', () => {
    expect(errorsOf({ dedupeWindowSec: 0 })).toEqual([]);
    expect(errorsOf({ dedupeWindowSec: 3600 })).toEqual([]);
    expect(errorsOf({ dedupeWindowSec: -1 })).toContain('dedupeWindowSec');
    expect(errorsOf({ dedupeWindowSec: 3601 })).toContain('dedupeWindowSec');
    expect(errorsOf({ dedupeWindowSec: 1.5 })).toContain('dedupeWindowSec');
  });

  it('flags de evento são booleanas', () => {
    expect(errorsOf({ notifyQuestion: 'sim' })).toContain('notifyQuestion');
    expect(errorsOf({ notifyQuestion: false })).toEqual([]);
  });
});
