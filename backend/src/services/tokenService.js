import jwt from 'jsonwebtoken';
export function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters');
  return secret;
}
export function verifyToken(token, type = 'access') {
  const decoded = jwt.verify(token, jwtSecret(), { algorithms: ['HS256'] });
  if (decoded.tokenType !== type || !decoded.id) throw new Error('Invalid token type');
  return decoded;
}
export function sessionAllowed(user, decoded) {
  return Boolean(user && user.isActive !== false && decoded.issuedAt > (user.tokensValidAfter || 0));
}
