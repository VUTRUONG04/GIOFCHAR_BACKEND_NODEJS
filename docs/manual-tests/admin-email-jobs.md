# Admin Email Job Endpoints

All endpoints require an access token for an admin account.

## List events

```http
GET /api/admin/email-jobs?page=1&pageSize=20&status=failed
```

`page` defaults to `1`, `pageSize` defaults to `20` and is capped at `100`.
The optional `status` filter accepts `pending`, `processing`, `completed`, or
`failed`. The response contains event metadata and pagination; event payloads
are omitted from the list.

## Get event details

```http
GET /api/admin/email-jobs/:id
```

Returns the event payload and its current attempt count, most recent attempt
time, next retry time, and latest error.

## Manually retry a failed event

```http
POST /api/admin/email-jobs/:id/retry
```

Only eligible events with `failed` status can be manually retried. Recovered
processing-timeout events are not manually retryable. A successful request
changes the event to `pending`, sets `next_retry_at` to the current database
time, resets `attempt_count` to `0`, and clears the previous error so the
worker can claim it immediately. Requests for non-retryable events return
`409 Conflict`; unknown IDs return `404`.

Apply pending migrations before testing:

```bash
npm run db:migrate:test
```

Use the normal admin login flow to obtain an access token. Do not put a real
token in shell history or committed documentation.
