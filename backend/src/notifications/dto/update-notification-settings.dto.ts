import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

/**
 * Patch parcial da config de notificação.
 *
 * `forbidNonWhitelisted` é global (main.ts), então todo campo aceito precisa
 * estar declarado aqui — um campo novo no schema sem entrada neste DTO devolve
 * 400 em vez de gravar.
 */
/**
 * `require_protocol: true` é o que faz a validação valer: sem ele, `isURL` com
 * `require_tld: false` aceita `"nao-e-url"` como host pelado e a string ia para
 * o banco — o `fetch` do sink só descobria na hora de entregar. `require_tld`
 * segue `false` porque os alvos reais aqui são IP de LAN e host `.local`.
 */
const URL_RULES = {
  require_tld: false,
  require_protocol: true,
  protocols: ['http', 'https'],
};

export class UpdateNotificationSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** `''` limpa o valor; qualquer outra coisa tem que ser URL http(s). */
  @IsOptional()
  @ValidateIf((_object, value) => value !== null && value !== '')
  @IsUrl(URL_RULES)
  publicBaseUrl?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  // Teto de 1h: janela maior engoliria um travamento novo depois de o anterior
  // já ter sido resolvido.
  @Max(3600)
  dedupeWindowSec?: number;

  @IsOptional()
  @IsBoolean()
  ntfyEnabled?: boolean;

  @IsOptional()
  @IsUrl(URL_RULES)
  ntfyServerUrl?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  ntfyTopic?: string | null;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  ntfyToken?: string | null;

  @IsOptional()
  @IsBoolean()
  webhookEnabled?: boolean;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null && value !== '')
  @IsUrl(URL_RULES)
  webhookUrl?: string | null;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  webhookSecret?: string | null;

  @IsOptional()
  @IsBoolean()
  notifyQuestion?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyEscalation?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyStalled?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyStageFailed?: boolean;

  @IsOptional()
  @IsBoolean()
  notifySessionFailed?: boolean;

  @IsOptional()
  @IsBoolean()
  notifySessionCompleted?: boolean;
}
