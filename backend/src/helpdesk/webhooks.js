import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import { fail } from "./validation.js";
export function publicIPv4(ip) {
  if (net.isIP(ip) !== 4) return false;
  const [a, b, c] = ip.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || b === 2)) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}
export function webhookURL(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw fail("Invalid webhook URL");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    url.hostname.includes(":") ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".local") ||
    (net.isIP(url.hostname) && !publicIPv4(url.hostname))
  )
    throw fail("Webhooks require a public HTTPS address on port 443");
  return url;
}
export async function sendWebhook(
  value,
  body,
  headers = {},
  resolver = dns.resolve4,
) {
  const url = webhookURL(value),
    addresses = net.isIP(url.hostname)
      ? [url.hostname]
      : await resolver(url.hostname);
  if (!addresses.length || addresses.some((ip) => !publicIPv4(ip)))
    throw new Error("Webhook resolves to a private or reserved address");
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "POST",
        family: 4,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          ...headers,
        },
        lookup(_host, _options, callback) {
          callback(null, addresses[0], 4);
        },
      },
      (response) => {
        response.resume();
        response.on("end", () =>
          response.statusCode >= 200 && response.statusCode < 300
            ? resolve()
            : reject(
                new Error(
                  `Webhook delivery failed (${response.statusCode}); redirects are not followed`,
                ),
              ),
        );
      },
    );
    request.setTimeout(15000, () =>
      request.destroy(new Error("Webhook timed out")),
    );
    request.on("error", reject);
    request.end(body);
  });
}
