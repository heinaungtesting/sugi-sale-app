import { saleRepository } from '@/repositories/sale-repository';
import { releaseSaleWrite, reserveSaleWrite } from '@/infrastructure/rate-limit/sale-write-budget';
import { incrementMetric, observeMetric } from '@/infrastructure/observability/metrics';
import { logEvent } from '@/infrastructure/logging/structured-logger';
import type { CreateSaleCommand } from './sale-policy';

export type CreateSaleResult =
  | { kind: 'created'; sale: NonNullable<Awaited<ReturnType<typeof saleRepository.create>>> }
  | { kind: 'rate_limited' }
  | { kind: 'not_found' }
  | { kind: 'failed' };

export async function createSale(
  userId: number,
  command: CreateSaleCommand,
  context: { requestId: string; queueAttempt?: number },
): Promise<CreateSaleResult> {
  const started = performance.now();
  if (!reserveSaleWrite(userId)) {
    incrementMetric('sale.rate_limited');
    logEvent('sale_rate_limited', { requestId: context.requestId, userId, productId: command.productId }, 'warn');
    return { kind: 'rate_limited' };
  }

  try {
    const sale = await saleRepository.create(
      userId,
      command.productId,
      command.quantity,
      command.variantId,
      command.soldDate,
      command.idempotencyKey,
    );
    if (!sale) {
      releaseSaleWrite(userId);
      incrementMetric('sale.not_found');
      return { kind: 'not_found' };
    }
    if (sale.idempotent_replay) {
      releaseSaleWrite(userId);
      incrementMetric('sale.replay');
    } else {
      incrementMetric('sale.created');
    }
    const durationMs = performance.now() - started;
    observeMetric('sale.create.duration_ms', durationMs);
    logEvent('sale_created', {
      requestId: context.requestId,
      userId,
      productId: command.productId,
      variantId: command.variantId,
      durationMs: Math.round(durationMs),
      queueAttempt: context.queueAttempt,
      result: sale.idempotent_replay ? 'replay' : 'success',
    });
    return { kind: 'created', sale };
  } catch (error) {
    releaseSaleWrite(userId);
    incrementMetric('sale.failed');
    const durationMs = performance.now() - started;
    observeMetric('sale.create.duration_ms', durationMs);
    logEvent('sale_create_failed', {
      requestId: context.requestId,
      userId,
      productId: command.productId,
      durationMs: Math.round(durationMs),
      error: error instanceof Error ? error.name : 'unknown',
    }, 'error');
    return { kind: 'failed' };
  }
}
