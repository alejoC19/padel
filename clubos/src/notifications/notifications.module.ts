import { Module } from '@nestjs/common';
import { NotificationsService } from './services/notifications.service';
import { ChannelDispatcher } from './services/channel-dispatcher.service';
import { WhatsappChannel } from './services/channels/whatsapp.channel';
import { EmailChannel } from './services/channels/email.channel';
import { NotificationWorker } from './services/notification.worker';
import { ReminderScheduler } from './services/reminder.scheduler';

/**
 * Notificaciones multicanal (WhatsApp, email).
 *
 * Exporta NotificationsService para que otros módulos (bookings, pagos)
 * ENCOLEN notificaciones. El worker y el scheduler corren solos por cron.
 *
 * Los @Cron se habilitan con ScheduleModule.forRoot(), registrado en
 * AppModule a nivel raíz (una sola vez para toda la app).
 */
@Module({
  providers: [
    NotificationsService,
    ChannelDispatcher,
    WhatsappChannel,
    EmailChannel,
    NotificationWorker,
    ReminderScheduler,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
