import nodemailer from "nodemailer";
import { encrypt, decrypt } from "./connectors.js";
import { Connector } from "./models.js";
import { fail } from "./validation.js";
// Endpoints and client secrets are operator-owned; workspace input cannot redirect refresh requests.
export async function mailboxAccessToken(connector, fetcher = fetch) {
  const cfg = connector.config?.oauth;
  if (!cfg) return null;
  if (cfg.expiresAt > Date.now() + 60000 && cfg.accessToken)
    return decrypt(cfg.accessToken);
  const provider = cfg.provider;
  if (!["google", "microsoft"].includes(provider))
    throw fail("Unsupported mailbox OAuth provider");
  const prefix = provider === "google" ? "GOOGLE_MAIL" : "MICROSOFT_MAIL";
  const clientId = process.env[prefix + "_CLIENT_ID"],
    clientSecret = process.env[prefix + "_CLIENT_SECRET"];
  if (!clientId || !clientSecret)
    throw fail("Mailbox OAuth application is not configured", 503);
  const endpoint =
    provider === "google"
      ? "https://oauth2.googleapis.com/token"
      : "https://login.microsoftonline.com/common/oauth2/v2.0/token";
  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: decrypt(cfg.refreshToken),
  });
  if (provider === "microsoft")
    form.set(
      "scope",
      "https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access",
    );
  const response = await fetcher(endpoint, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw fail("Mailbox authorization expired; reconnect OAuth", 503);
  const tokens = await response.json();
  if (
    typeof tokens.access_token !== "string" ||
    !Number.isFinite(tokens.expires_in) ||
    tokens.expires_in <= 0
  )
    throw fail("Invalid OAuth token response", 502);
  const oauth = {
    ...cfg,
    accessToken: encrypt(tokens.access_token),
    expiresAt: Date.now() + Math.min(tokens.expires_in, 86400) * 1000,
    ...(tokens.refresh_token
      ? { refreshToken: encrypt(tokens.refresh_token) }
      : {}),
  };
  const updated = await Connector.updateOne(
    {
      _id: connector._id,
      workspace: connector.workspace,
      "config.oauth.refreshToken": cfg.refreshToken,
    },
    { $set: { "config.oauth": oauth } },
  );
  if (!updated.matchedCount)
    throw fail(
      "Mailbox credentials changed while refreshing; retry with the current connection",
      409,
    );
  connector.config.oauth = oauth;
  return tokens.access_token;
}
export async function replyTransport(connector) {
  const oauth = connector.config?.oauth;
  const accessToken = oauth && (await mailboxAccessToken(connector));
  if (!oauth && (!process.env.EMAIL_USER || !process.env.EMAIL_PASS))
    throw fail("SMTP is not configured", 503);
  const user = oauth ? connector.config.imap.user : process.env.EMAIL_USER;
  const port = oauth ? 587 : Number(process.env.SMTP_PORT || 587);
  return {
    user,
    mailer: nodemailer.createTransport({
      host: oauth
        ? oauth.provider === "google"
          ? "smtp.gmail.com"
          : "smtp.office365.com"
        : process.env.SMTP_HOST || "smtp.gmail.com",
      port,
      secure: port === 465,
      requireTLS: true,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 30000,
      auth: oauth
        ? { type: "OAuth2", user, accessToken }
        : { user, pass: process.env.EMAIL_PASS },
    }),
  };
}
