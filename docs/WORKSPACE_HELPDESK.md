# Workspace helpdesk

Open `/workspaces` after signing in to create a company workspace. Its public help centre is `/support/<slug>`. The console includes an inbox, customer directory, published knowledge base, team management, workflow tools, service settings, connectors, billing, reports and audit records.

This is a new, isolated data model. The original complaint dashboards remain available as legacy mode; their existing complaints, staff and subscriptions are not automatically migrated. A migration needs a separately reviewed mapping of each company's records and users. Workspace memberships, rather than legacy global roles, control access to the new console.

## Included workflows

- Company isolation, email-bound single-use invitations, owner/admin/agent/analyst/customer roles and protection of the last owner.
- Public and authenticated ticket intake, custom fields, search, saved views, private notes, canned replies, macros, safe condition/action automations, same-customer merges and optimistic update conflicts.
- Group and capacity routing, agent availability, short-lived viewer presence and duplicate-reply warnings. Presence warns about collisions; it does not lock replies.
- First/next response and resolution targets, priority policies, time zones, business hours, holidays, waiting-state pause/resume and an SLA monitoring worker. Policies are snapshotted when tickets are created.
- Published/draft knowledge articles and search, an embeddable help-centre widget, customer-token conversations and staff-triggered guest email verification.
- Private scanned PNG/JPEG/PDF attachments, internal-file visibility, reporting CSV, audit history, scoped expiring API keys and a durable delivery outbox with failed-job retries.
- Provider adapters for signed incoming email, outgoing SMTP, WhatsApp text, Slack notifications, outgoing signed webhooks, read-only Shopify orders and Shiprocket shipment tracking.
- Recurring Stripe workspace checkout, billing portal and subscription synchronization. Staff invitation and activation limits use the workspace's seat allowance. Downgrades do not automatically deactivate existing members; owners must remove excess staff.
- Human-reviewed AI draft suggestions with citations from this workspace's published articles. Retrieval uses keyword ranking, not embeddings or vector search. No supported article means no generated answer.

## Run and configure

Use Node 22 and a MongoDB replica set (Atlas works); multi-document transactions are required. Install both packages with `npm ci`. Start the API with `npm start --prefix backend`, the UI with `npm run dev --prefix frontend`, and **a separate persistent worker** with `npm run worker:helpdesk --prefix backend`. The worker checks SLA deadlines and drains deliveries every ten seconds. Keep its database and encryption settings identical to the API.

Set `FRONTEND_URL` to the deployed frontend origin and frontend `VITE_API_URL`/`VITE_SOCKET_SERVER_URL` to the API. Generate a unique 32-byte hex `INTEGRATION_ENCRYPTION_KEY` outside source control. Back it up securely: losing or changing it without re-encryption prevents use of saved provider credentials.

Provider credentials are entered through Connections and encrypted at rest. No live provider credentials are bundled. Configure these server-side settings as needed:

| Setting | Purpose |
| --- | --- |
| `INTEGRATION_ENCRYPTION_KEY` | Exactly 64 hexadecimal characters; connector and verification secrets |
| `EMAIL_USER`, `EMAIL_PASS`, `SMTP_HOST`, `SMTP_PORT` | SMTP replies and customer verification; default host smtp.gmail.com, port 587 |
| `PRIVATE_UPLOAD_DIR` | Durable private volume shared by API replicas; never serve it as a static directory |
| `CLAMAV_HOST`, `CLAMAV_PORT` | Trusted ClamAV INSTREAM service; uploads fail closed when unavailable |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe API and signed billing webhook |
| `STRIPE_WORKSPACE_PRO_PRICE_ID`, `STRIPE_WORKSPACE_ENTERPRISE_PRICE_ID` | Recurring per-seat Stripe prices |
| `ANTHROPIC_API_KEY` | Existing OpenRouter-backed AI service credentials |
| `WHATSAPP_GRAPH_VERSION` | Meta Graph API version; defaults to v23.0 |

Attachments are limited to 10 MB each. Free workspaces have a 100 MiB stored-file quota; paid workspaces have 10 GiB. Downloads require an active membership and ticket access. Internal uploads remain staff-only. Anonymous guest-token attachment upload/download is not implemented. Use a private durable filesystem, backup policy and a trusted network for ClamAV; the scanner TCP connection is not TLS.

## Channel setup

**Email:** Create an email connection, copy its webhook path and one-time secret, and configure your inbound mail gateway to POST normalized JSON:

```json
{"messageId":"unique-provider-id","threadId":"stable-conversation-id","email":"buyer@example.com","name":"Buyer","subject":"Order question","description":"Plain-text message"}
```

Sign the exact raw request bytes with HMAC-SHA256 using the connection secret. Send `X-QuickFix-Signature: sha256=<hex digest>`. Provider message IDs deduplicate retries. A stable thread ID, or a `[QF-...]` ticket number in the subject, threads messages only when the sender matches the ticket contact. Configure the gateway to authenticate sender identity before forwarding; this endpoint trusts its signed gateway. SMTP delivery requires the worker. DNS/mailbox provisioning, IMAP polling, HTML email parsing and email attachments are not included.

**WhatsApp:** Enter Meta phone-number ID, access token, app secret and verification token; configure the displayed callback with Meta. Incoming signatures and phone-number IDs are checked. This adapter handles text only. Meta's customer-service window and template requirements still apply; template management is not implemented.

**Slack:** Enter an incoming webhook from `hooks.slack.com`. Ticket lifecycle notifications are queued; private notes are not included.

**Outgoing webhooks:** Enter a public HTTPS endpoint on port 443. Deliveries include `X-QuickFix-Signature` (HMAC-SHA256 of exact JSON bytes) and `X-QuickFix-Event-Id`. Receivers must verify signatures and deduplicate IDs. Private/reserved addresses, redirects and DNS results containing private addresses are rejected; delivery currently requires public IPv4 DNS. Payloads contain ticket metadata, not conversation bodies.

**Shopify:** Enter the `.myshopify.com` domain and a token with the necessary order and customer-data permissions. Context is read-only and matches the ticket contact's email. Guest email must be verified first. **Shiprocket:** Enter its API bearer token for AWB tracking. Label creation, returns and order mutation are not included.

**Billing:** Configure recurring workspace price IDs and Stripe's signed `/api/payments/webhook` endpoint. Subscribe to checkout completion, subscription updates/deletion and invoice paid/payment-failed events. Verify the exact webhook path in the server's payment routes when configuring the deployment. Existing customer subscriptions and new workspace subscriptions are separate.

## Identity, API and delivery guarantees

Guest intake returns a private access token, stored by the UI in session storage. Possession authorizes that guest conversation, but does not prove ownership of the supplied email. Until verified, guest tickets cannot be merged with customer conversations or used for commerce context. Staff can queue a verification email; proof expires after 30 minutes, can be used once, and rotates the guest access token. The recipient explicitly confirms the link in the help centre. The original browser token stops working after verification.

Owners/admins can create 90-day developer keys with `tickets:read`, `tickets:write`, `contacts:read` and `articles:read` scopes. Use `Authorization: Bearer <key>` against `/api/developer/<workspaceId>/...`. Only hashes are stored; the full token is displayed once. Revocation and current staff membership are checked on each request.

Outgoing jobs use locks and exponential retry, with five delivery attempts before failure. Delivery is at least once: a crash after provider acceptance may cause a duplicate. Inspect and retry failed deliveries in Connections. No provider account has been connected or live delivery certified by this code change.

## Validation and remaining scope

Run `npm test --prefix backend`, `npm run test:integration --prefix backend`, frontend TypeScript/build checks and `npm run test:browser --prefix backend`. Browser testing requires Chromium or `PLAYWRIGHT_CHROMIUM_EXECUTABLE`; CI uses the runner's Chrome and uploads desktop/mobile screenshots. Integration tests use a real ephemeral MongoDB replica set and mock external providers.

Enterprise SSO/MFA, custom roles, phone/social inboxes, full omnichannel threading, WhatsApp templates, vector retrieval, advanced analytics, complete plan gating, India payment gateways/UPI/GST billing, regional hosting and formal compliance certification are not included. This batch is a foundation for an Indian helpdesk product, not complete Freshdesk parity.
