# Workflow review — 17 November 2026

## Corrections in this change

- The inbox now exposes every result through 30-ticket pages, with counts and previous/next controls. Filtering resets the page, and a shrinking result set returns to its last valid page.
- Ticket queries use an ID tie-breaker when update timestamps match. Offset pages are deterministic for a static result set; concurrent ticket updates can still move entries between pages.
- Agents start in their personal queue, matching the operations dashboard's assigned-ticket metrics. Staff may explicitly switch to the workspace queue. Personal scope intersects the unassigned queue rather than accidentally showing other tickets.
- Phone, Instagram and Messenger are accepted by server-side ticket filters and saved views, alongside web, chat, email and WhatsApp. The inbox exposes a channel selector.
- A delayed list response cannot replace a newer filter result. Delayed conversation responses cannot replace another selected ticket. Changing tickets clears private-note mode, AI sources, attachments and commerce context.
- Independent member/macro/view reads retain successful results if another read is denied by a custom role.
- Workspace view components reset their local state on company changes. Queue shortcuts also reset on company changes.
- Clearing an assignee is labelled “Unassigned,” matching the backend action.
- The Vite API and Socket.IO proxies use port 5000, matching the server and example environment.

## Validation

- Backend unit/security suite: 35 tests passed.
- Backend database integration suite: 52 tests passed against an isolated MongoDB replica set, including a new test for pagination, personal/unassigned intersection, phone/social saved views and workspace scope.
- Frontend TypeScript and production build passed. Existing bundle-size and stale Browserslist warnings remain.
- Browser workflow coverage was extended with a 31-ticket phone queue, next-page uniqueness, empty search and filter reset checks. Browser execution could not be completed here: Chromium failed to start because the environment denied its process-singleton socket. CI runs this suite; browser behavior is not claimed as verified by this local review.

## Status of the previously discussed scope

The existing code includes the workspace operations UI and backend implementations for tickets, contacts, knowledge, teams, workflows, roles, MFA/OIDC, email/WhatsApp/phone/social adapters, INR billing/GST drafts, semantic AI, migration, worker jobs and readiness. The integration suite exercises these with isolated data and synthetic/mocked provider responses. This change repairs the workflows above; it does not newly implement all those modules or certify full Freshdesk feature or visual parity.

| Area | Remaining external setup or product limit |
| --- | --- |
| Database, worker, files | Deploy a MongoDB replica set, persistent helpdesk worker, encryption key, shared private upload storage and ClamAV; verify readiness and backups. |
| Email and messaging | Configure SMTP/approved IMAP mailbox, Meta assets/tokens/webhooks and Twilio numbers. Test real inbound/outbound delivery, attachments, retries and provider permissions. |
| Payments | Configure Stripe/Razorpay credentials, prices and signed webhooks. Exercise test-mode checkout/refunds before live use. GST exports remain drafts for accounting review. |
| Enterprise login | Configure an HTTPS OIDC identity provider and callback; test linking and sign-in. SAML and SCIM are not implemented. |
| AI | Supply chat/embedding credentials, index published knowledge and evaluate representative questions. Evidence checks do not guarantee correct answers. |
| Product parity | Browser softphone/recordings/IVR, outgoing HTML email composition, full WhatsApp template management, recurring UPI AutoPay and GST filing/e-invoicing are outside the existing implementation. |
| Existing records | Run the ownership-checked migration preview and explicitly confirm the mapping. Legacy attachments need scanned re-upload; financial subscriptions and privileges are not automatically copied. |

See [the enterprise implementation scope](ENTERPRISE_HELPDESK.md) for configuration details. No live provider delivery, payment, deployment or exact Freshdesk UI equivalence was verified in this review.
