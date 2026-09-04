# Sale Queue Long-Outage Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure queued sales automatically resume after long transient outages without retrying permanently invalid requests.

**Architecture:** Centralize persisted-error classification in the client queue, retain transient entries as `pending`, and store an explicit retryability marker for future hydration. Mirror the same recovery rules in the service worker so either the page or background sync can revive records created by the old terminal-retry behavior.

**Tech Stack:** TypeScript, Vitest, IndexedDB (`idb`), browser Service Worker

**Spec:** `docs/superpowers/specs/2026-09-04-sale-queue-long-outage-recovery-design.md`

## Global Constraints

- Preserve each entry's existing `idempotencyKey` across every retry.
- Retry network, timeout, offline, HTTP 408/429, CSRF-refresh, database, and HTTP 5xx failures.
- Keep known permanent validation, ownership, authentication, and other non-retryable HTTP 4xx failures in `failed`.
- Do not change queue ordering, leasing, maximum size, or cross-user isolation.

---

### Task 1: Client retry classification and hydration recovery

**Files:**
- Modify: `tests/sale-queue-stuck-recovery.test.ts`
- Modify: `lib/sale-queue.ts:42-67,146-182,333-432`

**Interfaces:**
- Produces: `isRetryableStoredQueueError(error?: string): boolean`
- Produces: optional persisted `QueueEntry.retryable` classification

- [ ] **Step 1: Write failing classification and recovery tests**

Add table-driven assertions that `network`, `timeout`, `offline`, `invalid csrf token`, `http_408`, `http_429`, `http_500`, and `failed to log sale` are retryable, while `invalid product_id`, `product not found`, and `queued sale owner mismatch` are permanent. Add a persisted failed-entry test that initializes the queue and expects a transient record to become `pending` without changing its idempotency key.

```ts
expect(queue.isRetryableStoredQueueError('network')).toBe(true);
expect(queue.isRetryableStoredQueueError('http_503')).toBe(true);
expect(queue.isRetryableStoredQueueError('invalid product_id')).toBe(false);
expect(queue.getSnapshot().entries[0]).toMatchObject({
  idempotencyKey: 'persisted-transient-key',
  status: 'pending',
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- tests/sale-queue-stuck-recovery.test.ts`

Expected: FAIL because the classifier is not exported and failed records remain failed.

- [ ] **Step 3: Implement minimal client recovery**

Add `retryable?: boolean` to `QueueEntry`. Implement the classifier using known permanent errors and HTTP status parsing, defaulting unknown historical infrastructure errors to retryable. In `normalizeRecords`, convert a failed record to pending only when `retryable !== false` and its error is retryable. In `postOnce`/`sendEntry`, track the response's permanent classification directly and set `failed` only for permanent failures; all transient exhaustion returns to `pending`.

```ts
entry.retryable = !permanentFailure;
entry.status = permanentFailure ? 'failed' : 'pending';
```

- [ ] **Step 4: Run the focused tests**

Run: `npm test -- tests/sale-queue-stuck-recovery.test.ts tests/sale-queue-offline-behavior.test.ts tests/sale-queue-user-isolation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the client behavior**

```bash
git add lib/sale-queue.ts tests/sale-queue-stuck-recovery.test.ts
git commit -m "fix: keep transient sale failures retryable"
```

---

### Task 2: Service-worker recovery parity

**Files:**
- Modify: `tests/reliability-security-hardening.test.ts`
- Modify: `public/sw.js:127-145,192-249`

**Interfaces:**
- Consumes: persisted queue fields `lastError` and `retryable`
- Produces: `isRetryableStoredSaleError(error)` and background claim support for retryable legacy `failed` entries

- [ ] **Step 1: Write the failing service-worker contract test**

Assert that the worker recognizes retryable failed records, persists the retryability of HTTP failures, and clears the marker after success.

```ts
expect(worker).toContain("entry.status === 'failed' && isRetryableStoredSaleError(entry.lastError)");
expect(worker).toContain('entry.retryable = transient');
expect(worker).toContain('delete entry.retryable');
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm test -- tests/reliability-security-hardening.test.ts`

Expected: FAIL because the worker only claims pending and expired-sending records.

- [ ] **Step 3: Implement worker recovery**

Add the stored-error classifier, let `claimNextSaleQueueEntry` claim failed records marked retryable (or legacy records whose stored error classifies as retryable), write `retryable = transient` after HTTP errors, and remove `retryable` on success.

- [ ] **Step 4: Run the focused worker and queue tests**

Run: `npm test -- tests/reliability-security-hardening.test.ts tests/sale-queue-stuck-recovery.test.ts tests/sale-queue-online-recovery.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit worker parity**

```bash
git add public/sw.js tests/reliability-security-hardening.test.ts
git commit -m "fix: recover transient sales in background sync"
```

---

### Task 3: Long-outage regression and full verification

**Files:**
- Modify: `tests/sale-queue-stuck-recovery.test.ts`

**Interfaces:**
- Consumes: `enqueueSale`, `initSaleQueue`, `getSnapshot`
- Verifies: stable idempotency key and eventual `synced` state after more than four failed drain passes

- [ ] **Step 1: Write the failing long-outage regression test**

Mock `/api/sales` with HTTP 500 responses through multiple drain passes, then switch it to a successful response. Assert no terminal failed count, automatic eventual sync, and one unique idempotency key across all request bodies.

```ts
expect(queue.getSnapshot().failedCount).toBe(0);
serverRecovered = true;
await vi.advanceTimersByTimeAsync(20_000);
expect(queue.getSnapshot().entries[0]?.status).toBe('synced');
expect(new Set(sentKeys)).toEqual(new Set(['stuck-test-key-12345678']));
```

- [ ] **Step 2: Run the regression and verify failure before the final behavior is present**

Run: `npm test -- tests/sale-queue-stuck-recovery.test.ts`

Expected before implementation: FAIL with the queue entering `failed`; after Tasks 1-2: PASS.

- [ ] **Step 3: Run the complete verification suite**

Run: `npm test`

Expected: all tests pass.

Run: `npm run build`

Expected: Next.js production build completes successfully.

- [ ] **Step 4: Review the diff and commit the regression coverage**

```bash
git diff --check
git diff --stat HEAD~2
git add tests/sale-queue-stuck-recovery.test.ts
git commit -m "test: cover sale recovery after long outage"
```
