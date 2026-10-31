# Security fixes and completed workflows

This branch replaces exposed administrator authentication, restricts public signup to customers, and adds shared ticket ownership checks. It also completes settings persistence, CSV exports, customer profile persistence, and actual password changes.

## Deployment steps

1. Rotate the exposed administrator password and every real credential previously committed in environment files. Removing files from the latest commit does not remove them from Git history. This branch does not rewrite history or rotate provider keys.
2. Configure a new random JWT_SECRET of at least 32 characters. All legacy tokens are rejected because access/refresh types are now required. Existing users must sign in again.
3. Copy backend/.env.example and frontend/.env.example to local .env files. Production services must receive environment variables through the hosting provider, including VITE_SOCKET_SERVER_URL and VITE_API_URL during frontend build. Never commit filled environment files.
4. Run `npm ci` in backend and frontend. Run `npm test` in backend and `npm run build` in frontend.
5. Set BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD (at least 12 characters), and optionally BOOTSTRAP_ADMIN_NAME in the backend shell environment. Run `npm run admin:bootstrap`, then remove bootstrap variables. This is an operator-only CLI, not a public HTTP endpoint. It can reset an existing administrator's password and revoke that account's sessions.
6. Sign in through the administrator login. Create staff with authenticated POST /api/users/create using name, email, password, role (agent/analytics/admin), organization and optional department. Public signup and OAuth signup only create customers. Review existing privileged accounts created before this fix.
7. Configure Stripe's webhook at /api/payments/webhook. Signature verification now receives raw bytes. Test checkout, webhook delivery/retry, refunds and expiry using Stripe test mode before accepting real payments.
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

## Verification and limitations

`npm test` runs 19 regression tests: token misuse/revocation, ownership and filtering, signup permissions, bulk restrictions, comment saves, private-note redaction, chat schema persistence, checkout replay/concurrency, settings persistence, assignment concurrency, credential serialization, and CSV escaping. HTTP tests run real Express routes with stubbed database methods; they do not prove MongoDB transaction behavior or external provider delivery.

Frontend production build and TypeScript checks pass. Build warns about a large JavaScript bundle and an older Browserslist dataset.

Live MongoDB, Stripe, AWS, OAuth, email, SMS, and Python model downloads have not been exercised here. The Python AI service remains separate from the Node/OpenRouter execution path. The project is not certified production-ready; tenant isolation, full end-to-end provider tests, plan-feature enforcement across every route, and broader frontend automated coverage remain follow-up work.
