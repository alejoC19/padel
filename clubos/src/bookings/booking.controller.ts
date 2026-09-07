import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { BookingService } from './services/booking.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CancelBookingDto,
  CollectPaymentDto,
  CreateBookingDto,
  NoShowDto,
  RescheduleBookingDto,
} from './dto/booking.dto';
import { ClubId, Ctx, RequirePermissions, UserId } from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';
import type { TenantContext } from '../tenancy/tenant-context';

@Controller('bookings')
export class BookingController {
  constructor(
    private readonly bookings: BookingService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @RequirePermissions(PERMISSIONS.BOOKING_CREATE)
  async create(
    @Body() dto: CreateBookingDto,
    @ClubId() clubId: string,
    @UserId() userId: string,
    @Ctx() ctx: TenantContext,
  ) {
    // Estas tres opciones saltean reglas de negocio. Se validan acá y no
    // en el guard porque dependen del cuerpo, no de la ruta: un
    // @RequirePermissions en el endpoint bloquearía las reservas normales.
    const overrides =
      dto.overridePrice !== undefined ||
      dto.allowOutsideHours ||
      dto.allowPast;

    if (overrides && !ctx.permissions.has(PERMISSIONS.BOOKING_OVERRIDE)) {
      throw new ForbiddenException(
        'No tenés permiso para forzar precio, horario o fecha pasada.',
      );
    }

    return this.bookings.create(dto, clubId, userId, ctx.membershipId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.BOOKING_VIEW)
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.db.booking.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        code: true,
        status: true,
        type: true,
        startsAt: true,
        endsAt: true,
        durationMinutes: true,
        playersCount: true,
        basePrice: true,
        discountAmount: true,
        totalPrice: true,
        paidAmount: true,
        paymentStatus: true,
        notes: true,
        checkInAt: true,
        checkOutAt: true,
        court: { select: { id: true, name: true, number: true, color: true } },
        client: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            accountBalance: true,
          },
        },
        instructor: { select: { id: true, firstName: true, lastName: true } },
        players: {
          select: {
            id: true,
            guestName: true,
            invitationStatus: true,
            shareAmount: true,
            paidAmount: true,
            client: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        payments: {
          select: {
            id: true,
            code: true,
            amount: true,
            paidAt: true,
            status: true,
            method: { select: { name: true, kind: true } },
          },
          orderBy: { paidAt: 'desc' },
        },
        statusHistory: {
          select: {
            fromStatus: true,
            toStatus: true,
            reason: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.BOOKING_CANCEL)
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelBookingDto,
    @ClubId() clubId: string,
    @UserId() userId: string,
    @Ctx() ctx: TenantContext,
  ) {
    return this.bookings.cancel(id, dto, clubId, userId, ctx.membershipId);
  }

  @Post(':id/reschedule')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.BOOKING_RESCHEDULE)
  async reschedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RescheduleBookingDto,
    @ClubId() clubId: string,
    @UserId() userId: string,
  ) {
    return this.bookings.reschedule(id, dto, clubId, userId);
  }

  @Post(':id/check-in')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.BOOKING_CHECKIN)
  async checkIn(
    @Param('id', ParseUUIDPipe) id: string,
    @ClubId() clubId: string,
    @UserId() userId: string,
  ) {
    return this.bookings.checkIn(id, clubId, userId);
  }

  @Post(':id/check-out')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.BOOKING_CHECKIN)
  async checkOut(
    @Param('id', ParseUUIDPipe) id: string,
    @ClubId() clubId: string,
    @UserId() userId: string,
  ) {
    return this.bookings.checkOut(id, clubId, userId);
  }

  @Post(':id/no-show')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.BOOKING_NO_SHOW)
  async noShow(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: NoShowDto,
    @ClubId() clubId: string,
    @UserId() userId: string,
  ) {
    return this.bookings.markNoShow(id, clubId, userId, dto.reason);
  }

  @Post(':id/collect')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.PAYMENT_CREATE)
  async collect(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CollectPaymentDto,
    @ClubId() clubId: string,
    @UserId() userId: string,
    @Ctx() ctx: TenantContext,
  ) {
    return this.bookings.collect(id, dto, clubId, userId, ctx.membershipId);
  }
}
