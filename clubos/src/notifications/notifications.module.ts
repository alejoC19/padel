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
  // EmailChannel también se exporta: AuthModule y TeamModule lo usan
  // directo para mails transaccionales de cuenta (reset de contraseña,
  // invitación de staff) que no son notificaciones de negocio ligadas a un
  // Client — no tiene sentido pasarlas por la cola de `Notification`
  // (tenant-scoped, pensada para clientes de un club).
  exports: [NotificationsService, EmailChannel],
})
export class NotificationsModule {}
