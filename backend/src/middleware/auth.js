import { verifyToken, sessionAllowed } from '../services/tokenService.js';
import jwt from 'jsonwebtoken';
import { User, findUserById } from '../models/User.js';

// Authenticate middleware
const authenticate = async (req, res, next) => {
  try {
    const token = req.cookies.token || req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    const decoded = verifyToken(token);

    // The token might use either 'userId' or 'id' field based on how it was generated
    const userId = decoded.userId || decoded.id;
    if (!userId) {
      return res.status(401).json({ error: 'Invalid token format.' });
    }

    // Search for user across all role-specific collections
    const { user } = await findUserById(userId);

    if (!sessionAllowed(user, decoded)) {
      return res.status(401).json({ error: 'Invalid token.' });
    }

    if (user.isActive === false) {  // Only check if explicitly false
      return res.status(401).json({ error: 'Account is deactivated.' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Authentication error:', error.message);
    res.status(401).json({ error: 'Invalid token.' });
  }
};

// Authorize middleware
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Access denied. User not authenticated.' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied. Insufficient permissions.' });
    }

    next();
  };
};

// Optional authentication middleware
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.cookies.token || req.header('Authorization')?.replace('Bearer ', '');
    if (token) {
      const decoded = verifyToken(token);

      // Search for user across all role-specific collections
      const { user } = await findUserById(decoded.userId || decoded.id);

      if (sessionAllowed(user, decoded)) {
        req.user = user;
      }
    }
    next();
  } catch (error) {
    // If token is invalid, continue without user (optional auth)
    next();
  }
};

// Export 'auth' and 'authenticateToken' as aliases for 'authenticate' for backward compatibility
export const auth = authenticate;
export const authenticateToken = authenticate;
export { authenticate, authorize, optionalAuth };
