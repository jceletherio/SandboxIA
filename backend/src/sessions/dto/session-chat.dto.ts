import { IsString, IsNotEmpty } from 'class-validator';

/**
 * Body de `POST /sessions/:id/chat`.
 * ATENÇÃO: o `ValidationPipe` global roda com `forbidNonWhitelisted: true` —
 * qualquer campo novo enviado pelo frontend precisa ser declarado E decorado
 * aqui, senão a request morre com 400 em silêncio.
 */
export class SendSessionChatDto {
  @IsString()
  @IsNotEmpty()
  message: string;
}
