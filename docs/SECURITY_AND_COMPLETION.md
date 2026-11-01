# Security fixes and completed workflows

This branch replaces exposed administrator authentication, restricts public signup to customers, and adds shared ticket ownership checks. It also completes settings persistence, CSV exports, customer profile persistence, and actual password changes.

## Deployment steps

1. Rotate the exposed administrator password and every real credential previously committed in environment files. Removing files from the latest commit does not remove them from Git history. This branch does not rewrite history or rotate provider keys.
2. Configure a new random JWT_SECRET of at least 32 characters. All legacy tokens are rejected because access/refresh types are now required. Existing users must sign in again.
3. Copy backend/.env.example and frontend/.env.example to local .env files. Production services must receive environment variables through the hosting provider, including VITE_SOCKET_SERVER_URL and VITE_API_URL during frontend build. Never commit filled environment files.
4. Run `npm ci` in backend and frontend. Run `npm test` and `npm run test:integration` in backend, then `npm run build` in frontend. Integration tests download an isolated MongoDB test binary; they never connect to your configured production database.
5. Set BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD (at least 12 characters), and optionally BOOTSTRAP_ADMIN_NAME in the backend shell environment. Run `npm run admin:bootstrap`, then remove bootstrap variables. This is an operator-only CLI, not a public HTTP endpoint. It can reset an existing administrator's password and revoke that account's sessions.
6. Account administration now requires MongoDB Atlas or a replica set (transactions protect role migration, staff deactivation, audit records, and the last administrator). Standalone local MongoDB still serves ordinary flows, but account mutations return 503 until a replica set is configured. Sign in through the administrator login. Create staff with authenticated POST /api/users/create using name, email, password, role (agent/analytics/admin), organization and optional department. Public signup and OAuth signup only create customers. Review existing privileged accounts created before this fix.
7. Configure Stripe's webhook at /api/payments/webhook. Signature verification now receives raw bytes. Test checkout, webhook delivery/retry, refunds and expiry using Stripe test mode before accepting real payments. Refund requests now require an `Idempotency-Key` header; reuse the same key when retrying one refund. The frontend helper supplies this header and accepts an optional key for caller retries.
8. For event processing, configure SNS_TOPIC_ARN, SQS_QUEUE_URL, AWS_REGION and AWS credentials/IAM role; run `npm run worker`. Configure an SQS dead-letter queue and visibility timeout suitable for processing. The worker retains failed messages for retry and uses the same assignment service as the API.

## Implemented behavior

- Hashed-password administrator login; no fixed administrator credentials or known JWT fallback.
- Access/refresh token separation, session revocation at logout/password reset/password change, and socket revalidation. Legacy sessions intentionally stop working.
- Customer and assigned-agent ticket access; agents cannot override list ownership or perform bulk updates. Administrators retain bulk operations.
- Internal comments are removed from customer HTTP responses and customer status-update events. Private comments and online-user details are no longer broadcast globally.
- Staff Socket.IO authentication resolves all role-specific collections.
- Chat uses the actual complaint owner and message schema fields; notification handlers use the notification model's user field.
- Comments no longer call a disabled cache function after saving. Assignment/escalation audit records use schema field names; duplicate escalation route removed.
- Checkout fulfilment uses an atomic condition on paymentHistory.orderId shared by verification and webhooks. It validates paid status, currency, amount and plan. Subscription expiry is anchored to checkout creation, so replay cannot move it forward. The older unverified subscription-upgrade endpoint returns 409.
- Validated admin config/settings persist in MongoDB. Automatic-assignment enabled and SLA target settings are consumed by runtime paths. Other saved UI flags are persisted, not a replacement for individual feature implementations or provider configuration.
- Real CSV exports escape CSV cells and spreadsheet formula prefixes.
- Automatic assignment only selects active, available agents with zero active tickets, atomically claims the agent and ticket, and releases the claim on failure. Manual administrator assignment remains an explicit override. Offline agents remain offline when workload is refreshed.
- Customer profile name, international phone, organization and preferences persist in the backend. Password changes verify the current password and revoke sessions. Passwords are excluded from the browser settings cache and user JSON.
- Public AI/auth routes have request limits; direct SMS sending/testing/status lookup is administrator-only. Customer access to staff analytics is blocked.

## Second review hardening

- Ticket ownership uses Express's decoded `id` parameter, so encoded URLs cannot skip checks. Analytics accounts cannot access ticket-management routes.
- Chat delivery targets the current owner/assigned-agent rooms rather than persistent chat memberships, so a previously assigned agent cannot keep receiving chat messages after reassignment.
- Internal comments are sent only to administrator/assigned-agent socket rooms. Customer event payloads pass through the same private-note redaction as HTTP responses.
- All user-management aliases list/search across users/admin/agent/analytics. Staff lookups, role changes, bulk updates and deactivation share one service. Mutations run in transactions, validate allowed fields, revoke sessions, disconnect affected sockets, and record an audit event. Role changes move the original ID and existing password hash into the correct collection. Deactivating/demoting staff requeues active tickets. A serialized administrator guard prevents concurrent removal of the last active admin. Requeued tickets are picked up by subsequent automatic assignment or the admin assignment action.
- Refund reconciliation reads current Stripe payment-intent/charge state, validates it against the checkout, and atomically updates refund totals and entitlement. Full refunds revoke the associated purchase; partial refunds retain its access. Other valid purchases remain effective. Duplicate, stale and out-of-order checkout/refund events do not duplicate history, resurrect a refund, or downgrade a valid Premium purchase. Expiry remains anchored to checkout creation. Manual subscription grants are separate from purchase history and may be replaced when payment reconciliation recomputes entitlements.
- Granular notification preferences are schema-backed, validated, and merged on partial updates. Master notification switches and complaint-level opt-outs govern ordinary complaint emails/SMS. Verification and password-reset delivery remain transactional. Browser-push implementation is separate; this change does not add a Web Push service.
- Static bulk ticket routes precede dynamic routes; ticket/audit updates are written together per document and availability is refreshed. Resolved-ticket feedback now writes real schema fields and validates ratings/comments.
- Analytics export filters reject MongoDB operators; complaint exports include only reporting fields and return at most 10,000 rows. CSV output is real and escaped. Account searches escape regular-expression input.
- OTP generation uses cryptographic randomness, request logs redact reset tokens/query strings, and explicit bearer credentials take precedence over stale cookies.
- Removed the duplicate non-unique complaintId index declaration that conflicted with its unique index during fresh database initialization.

## Verification and limitations

`npm test` runs 25 fast regression tests. `npm run test:integration` runs 18 tests against an isolated, actual MongoDB replica set. The integration suite exercises Express routes, account collection migration/password preservation, last-admin concurrency, deactivation/session rejection, encoded ticket URLs, socket event targets, notification preference persistence, bulk operations, feedback, report privacy, atomic checkout replay/refunds, and concurrent assignment. Stripe webhook tests use real signature verification with synthetic events; provider responses are mocked.

Frontend production build, TypeScript checks, backend JavaScript syntax checks, and diff whitespace checks pass. Build retains bundle-size and Browserslist warnings. CI runs both backend suites plus frontend checks.

Live Stripe/AWS/OAuth/email/SMS delivery and deployment credentials still require staging verification. Credential rotation from the first review remains an operator task. This does not certify the application production-ready or add tenant isolation, a full plan-feature enforcement audit, provider delivery monitoring, or broad frontend browser automation.
