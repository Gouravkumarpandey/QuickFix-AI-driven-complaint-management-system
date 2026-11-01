# QuickFix operations and enterprise extension

The company console at `/workspaces` now opens an operations dashboard with a persistent desktop sidebar and a collapsible phone navigation menu. Summary cards open live ticket queues. The overview includes real workload, overdue targets, ticket creation trends, channel distribution, agent capacity, response/resolution duration and recent audit activity. Counts are not demo data. Agent dashboards are restricted to that agent's assignments; owners/admins/analysts see workspace metrics. The date range applies to creation trends and channel counts; backlog and lifetime timing averages are explicitly labelled separately. Custom widget selections and date ranges can be saved per member on Pro/Premium.

## Implemented areas and exact scope

| Area | Implemented | Account/operator dependency or limit |
| --- | --- | --- |
| MFA | Authenticator QR/manual enrollment, six-digit TOTP, hashed single-use recovery codes, replay protection, disable with proof | Requires the integration encryption key. Enforcement covers authenticated HTTP and legacy Socket.IO sessions; developer keys remain scoped machine credentials. |
| SSO | OpenID Connect discovery, state, nonce, PKCE, validated ID tokens, existing-account identity linking and one-time browser-bound sign-in exchange | Premium; operator-configured HTTPS identity provider. No automatic email-based linking and no SAML/SCIM provisioning. |
| Roles | Owner-created restriction roles, per-area read/write checks and audited member assignment | Premium. A custom role narrows its base role; it cannot create new owner privileges. API keys belonging to restricted members are refused. |
| Voice | Twilio signed inbound call tickets and forwarding; staff-initiated outbound calls | Premium; real Twilio account, owned number and agent destination. Provider charges apply. No browser softphone, recordings, transcription or IVR builder. |
| Social | Signed Instagram/Messenger text inboxes, asset-ID checks, deduplication and queued replies | Premium; Meta approval, page/account token, app secret and webhook subscription. Non-text social messages instruct agents to use the provider inbox. |
| Omnichannel identity | Explicit staff-verified linking of a provider sender/phone identity to a contact, with audit trail | Linking requires a verified guest email when applicable. Staff must independently verify ownership; identity is never inferred from a display name. |
| WhatsApp | Text, approved body-parameter templates, scanned image/PDF outbound media and incoming image/document downloads | Meta approval and service-window/template rules apply. Template approval management, buttons/headers, audio and video are not included. |
| Email | TLS IMAP sync with UIDVALIDITY/UID cursor, RFC 822 import, HTML-to-plain-text conversion, references threading and scanned incoming attachments | Pro/Premium; mailbox host must be in `IMAP_ALLOWED_HOSTS`. App passwords only; OAuth mailbox token refresh is not included. First sync imports from UID 1 in batches of 25. Outgoing HTML composition is not included. |
| INR billing | Razorpay server-created orders, checkout signature verification, captured amount/currency checks, webhook replay protection, prepaid 30-day access, full-refund revocation and invoice snapshots | Merchant account, configured prices and live/test credentials. UPI availability depends on the merchant account. This is not UPI AutoPay or automatic recurring billing. |
| GST records | Seller/buyer details, place of supply, rate, CGST/SGST or IGST split, fiscal-year sequential invoice draft number, print/export layout | Operator supplies applicable tax configuration and SAC. GST tax documents are **drafts for accounting review**. Digital signing, IRN/e-invoice generation, credit-note filing and GST returns are not implemented. |
| AI | Embedding index of published articles, cosine search, stale/draft exclusion, source citations, customer FAQ assistant, independent evidence check and logged evaluations | Pro/Premium; embedding and chat providers required. 500 articles/2,000 chunks maximum; exact in-process search, not a distributed vector database. FAQ only; no automated financial/account actions. Evidence checks and scores do not guarantee correctness. |
| Plans | Server-side feature entitlements, immediate seat access checks, deterministic owner-first suspension and restoration, unassignment of suspended staff | Free retains previously included workflows. Pro adds semantic AI, mailbox sync and saved dashboards; Premium adds SSO/custom roles/voice/social. Existing data stays intact after downgrade. |
| Migration | Ownership-checked preview, explicit confirmation, idempotent ticket/contact/history import, mapping to existing workspace staff by email, audit records | Source records remain unchanged. Legacy attachments require scanned re-upload. Passwords, staff privilege grants and old financial subscriptions are deliberately not copied. |
| Deployment | Container definitions, Mongo replica-set initialization, shared private upload volume, persistent worker, ClamAV, worker heartbeat and readiness screen/endpoint | Live hosting, DNS/TLS, backups, provider credentials and external acceptance tests require the operator. The supplied Compose is a local smoke environment, not a certified production deployment. |

## Run locally

Existing development commands remain valid: `npm start --prefix backend`, `npm run dev --prefix frontend`, `npm run worker:helpdesk --prefix backend`. Use a transactional MongoDB replica set and the same integration encryption key for API and worker. New dependencies use Node 22.

For a container smoke environment, copy `deploy/.env.example` to `deploy/.env`, fill unique JWT/encryption values, then run:

```sh
docker compose -f deploy/compose.yml up --build -d
docker compose -f deploy/compose.yml ps
curl -f http://localhost:5000/api/ready
```

The web console is at `http://localhost:8080`. MongoDB and scanner ports stay on the container network. ClamAV's initial signature download may take several minutes and requires sufficient memory. Preserve all named volumes; deleting them deletes database or attachment data. For production, use authenticated managed MongoDB, HTTPS, a proper secret manager, an isolated scanner network, monitored workers and tested backups. Adapt the localhost bindings and frontend build arguments to your hosting rather than exposing this local environment unchanged.

## Provider configuration

All variables are server-side unless prefixed `VITE_`. Never add credentials to Git.

- **SSO:** `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, correct `BACKEND_URL` and `FRONTEND_URL`. Register callback `<BACKEND_URL>/api/sso/callback`. Enable SSO in Security, then have each existing member use “Link my SSO identity”. Company sign-in is `/sso`. API and frontend must use HTTPS in production so the secure exchange cookie works.
- **MFA:** Preserve `INTEGRATION_ENCRYPTION_KEY`. Save recovery codes before dismissing the one-time display. Disabling MFA requires a fresh unused TOTP or recovery code; it does not bypass password/SSO sign-in.
- **Mailbox:** Add approved hosts to `IMAP_ALLOWED_HOSTS`, then use Channels to attach host/user/app-password to an existing email connection. Only TLS port 993 and public IPv4 addresses are permitted; DNS is checked and the selected IP is pinned with hostname certificate verification. MIME source is capped at 20 MB and files at 10 MB. Executables and unsupported file signatures are not stored. A missing scanner retries instead of silently accepting a file.
- **Phone/social:** Use Channels to obtain the callback path. Twilio callbacks use the exact public `BACKEND_URL` for signature validation. Instagram uses `graph.instagram.com`, Messenger uses `graph.facebook.com`; the configured asset must match webhook entry IDs. `META_GRAPH_VERSION` defaults to v23.0; configure a version supported by your approved app.
- **WhatsApp:** Existing phone-number ID/token/app-secret connection configuration remains. Incoming images/PDFs are downloaded by the worker, scanned, quota checked and kept private. Only non-internal attachments from that same ticket can be sent outward. Use approved template name/language and body parameters in the ticket actions panel.
- **Razorpay:** Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `WORKSPACE_PRO_INR_PAISE` and `WORKSPACE_PREMIUM_INR_PAISE` (integer paise per staff seat per 30 days). Register `/api/razorpay/webhook` for `payment.captured`, `order.paid` and `refund.processed`. A browser success callback alone never grants access; the server verifies captured payment state and exact order/amount/currency. Repeated callbacks cannot extend access twice. An already-active Stripe subscription must be managed separately.
- **GST drafts:** Set `GST_SELLER_NAME`, `GST_SELLER_ADDRESS`, `GST_SELLER_GSTIN`, `GST_SELLER_STATE_CODE`, `GST_SELLER_STATE_NAME`, `GST_SERVICE_SAC` and `GST_RATE_BPS` (basis points; 0 means no tax). Have accounting determine the applicable treatment, rate, signing and e-invoice requirements. The software does not determine your registration status, GST applicability or filing obligations.
- **Embeddings:** Set `EMBEDDING_MODEL`, `EMBEDDING_API_KEY` (or the existing `ANTHROPIC_API_KEY`), then queue indexing from AI studio. Published article edits invalidate stale search chunks immediately; re-index to include changed content. The persistent worker handles indexing. Enable the customer assistant only after reviewing your knowledge and testing representative questions. Requests are limited and sensitive/unsupported questions route to support.

## Checks and verification boundaries

Run backend unit/integration suites, frontend TypeScript and production build, and the browser workflow suite. Integration tests use real ephemeral MongoDB and fake provider responses. Browser checks exercise the real API, dashboard, queues, conversations, knowledge, settings and responsive layouts. Provider credentials have not been supplied in this change; no paid calls, payments or live messages are sent by these tests.

The readiness screen distinguishes live core service checks from provider configuration flags. It does not certify credentials or replace provider acceptance testing. No deployment, IdP sign-in, live payment, live mailbox or production infrastructure is claimed as verified without that external setup.

References used for implementation: [Freshdesk dashboards](https://support.freshdesk.com/support/solutions/articles/50000011779-dashboards-in-freshdesk), [OpenID client](https://github.com/panva/openid-client), [ImapFlow](https://imapflow.com/docs/api/imapflow-client/), [MailParser](https://nodemailer.com/extras/mailparser), [OpenRouter embeddings](https://openrouter.ai/docs/api/reference/embeddings), [Twilio webhook security](https://www.twilio.com/docs/usage/webhooks/webhooks-security), [Razorpay checkout verification](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/), [CBIC Rule 46](https://taxinformation.cbic.gov.in/content-page/explore-rules/1000136/1000001).
