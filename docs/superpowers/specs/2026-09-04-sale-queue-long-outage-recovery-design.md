# Sale Queue Long-Outage Recovery Design

## Problem

Transient network and server failures eventually move a queued sale to `failed`.
The automatic drain only claims `pending` records, so the five-second recovery
timer can observe the failed record without ever replaying it after connectivity
or the database recovers.

## Design

- Keep transient failures retryable: network errors, timeouts, HTTP 408/429,
  database failures, and HTTP 5xx return the entry to `pending`.
- Keep permanent client/request failures in `failed` so a bad record does not
  retry forever.
- Preserve the existing stable idempotency key across every replay so a request
  whose response was lost cannot double-count a sale.
- During IndexedDB hydration, recover legacy/stuck `failed` records only when
  their stored error is classified as transient. Permanent failed records remain
  available for manual correction.
- Keep the current retry loop, health probe, service-worker replay, queue lease,
  and single-worker ordering behavior unchanged.

## Error Classification

Transient stored errors include `network`, `timeout`, `offline`, `database`,
HTTP 408, HTTP 429, and HTTP 5xx. Unknown historical infrastructure errors are
also recovered, while known permanent HTTP 4xx and validation errors remain
failed.

## Verification

- Add a regression test that exhausts multiple retry passes during an outage,
  restores the server, and proves the same idempotency key is sent until the
  entry becomes `synced`.
- Add hydration tests proving an already-stuck transient record becomes
  `pending` while a permanent record stays `failed`.
- Run the focused queue tests, then the complete test and production build
  checks.
