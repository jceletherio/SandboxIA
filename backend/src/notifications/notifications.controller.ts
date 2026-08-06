import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { UpdateNotificationSettingsDto } from './dto/update-notification-settings.dto';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('settings')
  getSettings() {
    return this.notifications.getSettings();
  }

  @Put('settings')
  updateSettings(@Body() dto: UpdateNotificationSettingsDto) {
    return this.notifications.updateSettings(dto);
  }

  /**
   * Dispara uma notificação de teste e devolve o resultado POR CANAL.
   * Um 200 aqui não quer dizer "chegou" — quer dizer "o canal aceitou"; é o
   * `results[].error` que diz por que o ntfy recusou (tópico errado, token, …).
   */
  @Post('test')
  async test() {
    const results = await this.notifications.sendTest();
    return { results, ok: results.every((result) => result.ok) };
  }
}
