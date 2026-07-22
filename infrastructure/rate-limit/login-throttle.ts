import { clearRateLimit, reserveRateLimit } from './postgres-rate-limit';

const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 10;
const SCOPE = 'login-failure';

// Reserve atomically before bcrypt runs. Failed attempts retain the slot; a valid
// login clears the window. This closes the check-then-increment race across instances.
export async function reserveLoginAttempt(subjectKey: string): Promise<boolean> {
  return reserveRateLimit(SCOPE, subjectKey, LOGIN_WINDOW_MS, MAX_FAILED_ATTEMPTS);
}

export async function clearFailedLogins(subjectKey: string): Promise<void> {
  await clearRateLimit(SCOPE, subjectKey);
}

export { MAX_FAILED_ATTEMPTS };
