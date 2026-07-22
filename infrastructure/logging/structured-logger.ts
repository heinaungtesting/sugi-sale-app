import { randomUUID } from 'node:crypto';

type Scalar = string | number | boolean | null | undefined;
export type LogFields = Record<string, Scalar>;

export function requestId(req?: Request): string {
  return req?.headers.get('x-request-id')?.slice(0, 128) || randomUUID();
}

export function logEvent(event: string, fields: LogFields = {}, level: 'info' | 'warn' | 'error' = 'info'): void {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    service: 'sugi-sale-app',
    ...fields,
  };
  const line = JSON.stringify(payload);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}
