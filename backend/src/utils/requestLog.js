export function safeRequestPath(req) {
  const path = (req.originalUrl || req.url || '').split('?')[0];
  return path.replace(/(\/verify-reset-token\/)[^/]+/gi, '$1[redacted]');
}
