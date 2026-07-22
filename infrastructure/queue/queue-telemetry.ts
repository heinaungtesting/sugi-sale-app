'use client';

import { csrfFetch } from '../../lib/csrf-client';

export function reportQueueTelemetry(snapshot: { pendingCount: number; failedCount: number; storageBackend: string }): void {
  void csrfFetch('/api/telemetry/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pending: snapshot.pendingCount,
      failed: snapshot.failedCount,
      storage: snapshot.storageBackend,
    }),
    keepalive: true,
  }).catch(() => undefined);
}
