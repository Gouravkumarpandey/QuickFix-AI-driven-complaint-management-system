# QuickFix feature validation — 17 November 2026

Scope: the email-first workspace implementation, existing account/complaint APIs and optional AI microservice. Automated tests run against isolated MongoDB replica sets and browser fixtures. No customer messages, payments, phone calls or government registrations are sent during this review.

## Defects corrected

- Verified portal customers could see reply text but could not download the public attachments referenced by that reply. The portal now lists and downloads only files attached to public messages in that verified ticket. Internal files, staging uploads, other tickets/workspaces and requests without the verified token are denied.
- Outgoing emails had a Message-ID but did not persist its connection/reference on the message. Replies with a changed subject could create duplicate tickets. The SMTP outbox now saves the stable Message-ID and connection, enabling reference-based threading while preserving sender matching.
- `python ai-service/main.py` referenced missing Flask blueprints/classes and disagreed with the documented FastAPI entry point. Both entry points now run the same app. Health/startup no longer imports/downloads every inference model. Input bounds and explicit unavailable responses are tested. The former print-only smoke script now fails on assertions and covers all five API contracts.

## Validation coverage

| Area | Automated checks | Live boundary |
| --- | --- | --- |
| Account security | Signup role restrictions, password reset, JWT/logout revocation, MFA/recovery, membership and custom role restrictions | Real mail delivery and company identity-provider acceptance |
| Company isolation and team | Invitations, seat concurrency, groups/SCIM, deactivation, migration ownership | Real IdP provisioning and production data migration |
| Ticket lifecycle | Intake, assignment/capacity, statuses, queues/search/pagination, bulk edits, merge privacy, SLA/business hours, feedback | Production volume/load acceptance |
| Email-first support | Server OTP expiry/attempts/replay/resend limits, verified access, private-note isolation, SMTP replies and changed-subject inbound threading | Sending mailbox, inbound gateway/IMAP/OAuth and DNS deliverability |
| Attachments | Scanner requirement/rejection, staff access, verified portal shared-file download, private/staged file denial | Live ClamAV and durable private storage |
| Knowledge and productivity | Article publishing/draft privacy, macros, automations, saved views, custom fields, collisions | Live AI indexing/provider credentials |
| Analytics and billing | Dashboard/report calculations and CSV safety; payment amount/signature/idempotency/refund checks; invoice escaping, credit bounds, e-invoice sandbox/unknown outcomes | Stripe/Razorpay/ClearTax credentials and real settlement/IRN acceptance; GST return filing remains separate |
| Optional channels | Signed/deduplicated Twilio, WhatsApp and social callbacks; voice grants/availability; transcript privacy; media/template outbox payloads | Actual calls/audio, Meta approvals/windows, provider credentials |
| AI | Workspace-scoped retrieval/evaluation contracts; Python classify/sentiment/embed/summarize/reply API validation and unavailable behavior | Actual model weights, model quality, paid API configuration and latency |
| Browser | Desktop/mobile inbox, queues/bulk actions, rich replies, article creation/publishing, administration views, OTP conversation access, shared-file download, invoice download and MFA recovery | Production URLs and live external providers |

The Python tests use model-adapter fixtures, and provider integration tests use simulated responses. Passing these tests does not certify end-to-end delivery through unconfigured services. Check Deployment readiness and Advanced setup, configure the required mailbox, worker, scanner and secrets, then perform live acceptance on the deployed application.
