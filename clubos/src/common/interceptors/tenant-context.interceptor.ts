import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { tenantStorage, type TenantContext } from '../../tenancy/tenant-context';

/**
 * Abre el scope real de AsyncLocalStorage para el resto del pipeline de la
 * request (interceptores posteriores, pipes, el controller y todo lo que
 * ese controller `await`ea — incluidas las queries de Prisma varias capas
 * más abajo).
 *
 * TenantGuard ya resolvió el contexto y lo dejó en `req.tenantContext`
 * (los guards corren antes que los interceptores, así que todavía no hay
 * nada que abrir acá cuando ellos ejecutan). Este interceptor es el único
 * lugar del pipeline que llama a `tenantStorage.run()`: a diferencia de
 * `enterWith()` (lo que hacía la versión anterior de este mecanismo, desde
 * el guard), `run()` abre un scope propiamente aislado para ESTA cadena de
 * continuaciones async — no puede pisarlo ni ser pisado por otra request
 * concurrente, que es exactamente la garantía que un ALS mal alcanzado no
 * daba (ver el comentario largo en tenancy/tenant-context.ts).
 *
 * Rutas `@Public()` sin membership (login, registro, webhooks) nunca pasan
 * por `TenantGuard.mount()`, así que no tienen `req.tenantContext` — para
 * esas, `next.handle()` corre tal cual, sin envolver nada.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { tenantContext?: TenantContext }>();
    const ctx = req.tenantContext;

    if (!ctx) return next.handle();

    return new Observable((subscriber) => {
      tenantStorage.run(ctx, () => {
        next.handle().subscribe({
          next: (value) => subscriber.next(value),
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });
      });
    });
  }
}
