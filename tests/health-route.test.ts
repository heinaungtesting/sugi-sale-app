import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadHealthRoute(prismaModule: unknown) {
  vi.resetModules();
  vi.doMock('@/lib/prisma', () => prismaModule as Record<string, unknown>);
  return import('@/app/api/health/route');
}

afterEach(() => {
  vi.doUnmock('@/lib/prisma');
  vi.resetModules();
});

describe('GET /api/health', () => {
  it('reports a successful Prisma health query', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ ok: 1 }]);
    const { GET } = await loadHealthRoute({ prisma: { $queryRaw: queryRaw } });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, database: 'ok' });
    expect(queryRaw).toHaveBeenCalledOnce();
  });

  it('reports an unexpected database result', async () => {
    const { GET } = await loadHealthRoute({ prisma: { $queryRaw: vi.fn().mockResolvedValue([]) } });

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, database: 'unexpected-result' });
  });

  it('reports connection failures without exposing the error', async () => {
    const queryRaw = vi.fn().mockRejectedValue(new Error('postgresql://secret@database/internal'));
    const { GET } = await loadHealthRoute({ prisma: { $queryRaw: queryRaw } });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const response = await GET();

      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body).toMatchObject({ ok: false, database: 'unreachable' });
      expect(JSON.stringify(body)).not.toContain('secret');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('returns a generic 503 when runtime Prisma configuration cannot load', async () => {
    const { GET } = await loadHealthRoute(() => {
      throw new Error('DATABASE_URL=postgresql://user:secret@database/internal');
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const response = await GET();

      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body).toMatchObject({ ok: false, database: 'unreachable' });
      expect(JSON.stringify(body)).not.toContain('secret');
    } finally {
      consoleError.mockRestore();
    }
  });
});
