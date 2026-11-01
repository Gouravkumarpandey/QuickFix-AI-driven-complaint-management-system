import {assertMFA} from './helpdesk/security.js';
import analyticsWorkspaceRoutes from './helpdesk/analytics.js';
import {securityRoutes,enterpriseSecurityRoutes,ssoPublicRoutes} from './helpdesk/security.js';
import indiaBillingRoutes,{razorpayWebhook} from './helpdesk/indiaBilling.js';
import mailboxRoutes from './helpdesk/mailbox.js';
import {semanticRoutes,publicAIRoutes} from './helpdesk/semantic.js';
import migrationRoutes from './helpdesk/migration.js';
import {channelAdmin,voiceRoutes,socialRoutes} from './helpdesk/omnichannel.js';
import readinessRoutes,{readiness} from './helpdesk/readiness.js';
import { keyRoutes, developerRoutes } from './helpdesk/developer.js';
import commerceRoutes from './helpdesk/commerce.js';
import helpdeskRoutes from './helpdesk/routes.js';
import portalRoutes from './helpdesk/portal.js';
import { connectorRoutes, channelRoutes } from './helpdesk/connectors.js';
import { billingRoutes } from './helpdesk/billing.js';
import attachmentRoutes from './helpdesk/attachments.js';
import helpdeskAI from './helpdesk/ai.js';
import { safeRequestPath } from './utils/requestLog.js';
// Load environment variables first, before any other imports
import dotenv from "dotenv";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Only load .env file in development - Render uses environment variables directly
if (process.env.NODE_ENV !== 'production') {
  const envPath = join(__dirname, '../.env');
  const result = dotenv.config({ path: envPath });

  if (result.error) {
    console.error('❌ Error loading .env file:', result.error);
  } else {
    console.log('✅ .env file loaded from:', envPath);
  }
} else {
  console.log('✅ Running in production - using Render environment variables');
}

// Log important environment variables (without exposing secrets)
console.log('Node environment:', process.env.NODE_ENV);
console.log('Server session ID:', `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
console.log('✅ DEEPSEEK_API_KEY present:', !!process.env.DEEPSEEK_API_KEY);
console.log('✅ MONGODB_URI present:', !!process.env.MONGODB_URI);
console.log('✅ JWT_SECRET present:', !!process.env.JWT_SECRET);
console.log('✅ GOOGLE_CLIENT_ID present:', !!process.env.GOOGLE_CLIENT_ID);
console.log('✅ STRIPE_SECRET_KEY present:', !!process.env.STRIPE_SECRET_KEY);

import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import connectDB from "./config/db.js";
// Redis disabled for now - uncomment to enable caching
// import { connectRedis, isRedisConnected } from "./config/redis.js";
import { handleConnection } from "./socket/socketHandlers.js";
import { User, findUserById } from "./models/User.js";
import { jwtSecret, verifyToken, sessionAllowed } from "./services/tokenService.js";
import { webhookHandler } from "./controllers/paymentController.js";
import { getHelmetCspConfig, cspReportHandler } from "./middleware/cspConfig.js";

// Add global error handlers to prevent silent crashes
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise);
  console.error('❌ Reason:', reason);
  // Don't exit in development, just log the error
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  console.error('❌ Stack:', error.stack);
  // Don't exit in development, just log the error
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
});

// Log system information on startup
console.log('=== QuickFix Complaint Management System ===');
console.log('Starting server with Socket.IO real-time updates');
console.log('Node environment:', process.env.NODE_ENV);

// Generate a unique server session ID on startup
// This is used to detect server restarts and force client re-authentication
global.SERVER_SESSION_ID = `session-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
console.log('Server session ID:', global.SERVER_SESSION_ID);

// Set a flag to track DB connection status
global.DB_CONNECTED = false;

// Connect to MongoDB
connectDB()
  .then(() => {
    global.DB_CONNECTED = true;
  })
  .catch(err => {
    console.log('⚠️ Starting server without database connection. Some features may be limited.');
    // In development mode, continue running the server even without DB
  });

jwtSecret(); // Fail closed before accepting traffic.
const app = express();
const server = createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: function (origin, callback) {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) return callback(null, true);

      // Allow localhost on any port for development
      if (origin && origin.match(/^http:\/\/localhost:\d+$/)) {
        return callback(null, true);
      }

      // Allow Vercel frontend domains (production)
      if (origin && origin.match(/^https:\/\/.*\.vercel\.app$/)) {
        return callback(null, true);
      }

      // Allow your specific origins
      const allowedOrigins = [
        ...(process.env.FRONTEND_URL ? [new URL(process.env.FRONTEND_URL).origin] : []),
        'http://localhost:3000',
        'http://localhost:5173',
        'http://localhost:5174',
        'http://localhost:4173',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:5174',
        'http://127.0.0.1:4173',
        // Production Vercel URLs
        'https://complain-beta.vercel.app',
        'https://complain-git-main-gouravs-projects-95bc4c63.vercel.app',
        'https://complain-mcfunqw1d-gouravs-projects-95bc4c63.vercel.app'
      ];

      if (allowedOrigins.indexOf(origin) !== -1) {
        return callback(null, true);
      }

      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling']
});

// Track connected sockets and their state
const connectedSockets = new Map();

// Add authentication middleware with enhanced error handling and rate limiting
io.use(async (socket, next) => {
  try {
    const socketId = socket.id;
    console.log('Socket connection attempt:', socketId);

    // Rate limiting
    const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    const recentAttempts = Array.from(connectedSockets.values())
      .filter(s => s.ip === clientIp && s.lastAttempt > Date.now() - 60000)
      .length;

    if (recentAttempts > 10) {
      console.warn('Rate limit exceeded for IP:', clientIp);
      return next(new Error('Too many connection attempts. Please try again later.'));
    }

    // Track connection attempt
    connectedSockets.set(socketId, {
      ip: clientIp,
      lastAttempt: Date.now(),
      authenticated: false,
      userId: null,
      connectTime: null
    });

    // Token validation - Check auth object first, then fall back to cookies
    let socketAuthToken = socket.handshake.auth?.token;

    // If no token in auth object, check cookies
    if (!socketAuthToken && socket.handshake.headers.cookie) {
      try {
        const cookies = socket.handshake.headers.cookie.split(';').reduce((acc, cookie) => {
          const [name, value] = cookie.trim().split('=');
          acc[name] = value;
          return acc;
        }, {});
        socketAuthToken = cookies.token;
      } catch (err) {
        console.warn('Failed to parse cookies from socket handshake');
      }
    }

    if (!socketAuthToken) {
      connectedSockets.delete(socketId);
      console.error('Socket auth failed: Missing token', socketId);
      socket.emit('connection_error', { message: 'Missing authentication token' });
      return next(new Error("Authentication failed: Missing token"));
    }

    try {
      // Log token format to help with debugging
      const tokenPreview = `${socketAuthToken.substring(0, 10)}...${socketAuthToken.substring(socketAuthToken.length - 5)}`;


      // Verify the token
      const decoded = verifyToken(socketAuthToken);
      console.log('Token decoded successfully for socket:', socketId);


      // Extract userId from different possible fields
      const userId = decoded.id || decoded.userId || decoded.sub;
      if (!userId) {
        connectedSockets.delete(socketId);
        console.error('Socket auth failed: Invalid token payload (no userId)', socketId, decoded);
        socket.emit('connection_error', { message: 'Invalid token payload - missing user ID' });
        return next(new Error("Authentication failed: Invalid token payload - missing user ID"));
      }

      // Check for duplicate connections from same user
      const existingConnection = Array.from(connectedSockets.entries())
        .find(([_, data]) => data.userId === userId && data.authenticated);

      if (existingConnection) {
        console.warn(`User ${userId} already has an active connection:`, existingConnection[0]);
        // Optional: Force disconnect the old connection
        io.sockets.sockets.get(existingConnection[0])?.disconnect(true);
      }

      // Look up the user in the database with timeout
      const userPromise = findUserById(userId).then(result => result.user);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Database lookup timeout')), 5000)
      );

      const user = await Promise.race([userPromise, timeoutPromise]);

      if (!sessionAllowed(user, decoded)) {
        connectedSockets.delete(socketId);
        console.error('Socket auth failed: User not found', userId, socketId);
        return next(new Error("Authentication failed: User not found"));
      }

      await assertMFA(user,decoded);
      // Update socket tracking
      connectedSockets.set(socketId, {
        ip: clientIp,
        lastAttempt: Date.now(),
        authenticated: true,
        userId: user._id.toString(),
        userRole: user.role,
        connectTime: Date.now(),
        userName: user.name
      });

      console.log('Socket authenticated successfully:', {
        socketId,
        userId: user._id,
        name: user.name,
        role: user.role
      });

      // Attach user to socket for later use
      socket.user = user;
      // Recheck expiry and revocation for every incoming event, including long-lived sockets.
      socket.use(async (_packet, done) => {
        try {
          const claims = verifyToken(socketAuthToken);
          const { user: current } = await findUserById(claims.id);
          if (!sessionAllowed(current, claims)) throw new Error('Session revoked');
          await assertMFA(current,claims);
          socket.user = current;
          done();
        } catch { socket.disconnect(true); done(new Error('Session expired or revoked')); }
      });

      // Setup disconnect handler
      socket.on('disconnect', (reason) => {
        console.log(`Socket ${socketId} disconnected:`, reason);
        connectedSockets.delete(socketId);
      });

      next();
    } catch (err) {
      connectedSockets.delete(socketId);
      console.error('Socket token verification error:', {
        socketId,
        error: err.message,
        stack: err.stack
      });

      // Return appropriate error based on type
      if (err.name === 'TokenExpiredError') {
        return next(new Error('Authentication failed: Token expired'));
      } else if (err.name === 'JsonWebTokenError') {
        return next(new Error('Authentication failed: Invalid token'));
      } else {
        return next(new Error(`Authentication failed: ${err.message}`));
      }
    }
  } catch (error) {
    console.error('Socket middleware critical error:', {
      socketId: socket.id,
      error: error.message,
      stack: error.stack
    });
    next(new Error("Server error during authentication"));
  }
});

// Socket connection monitoring and cleanup
const SOCKET_CLEANUP_INTERVAL = 60000; // 1 minute
const SOCKET_MAX_IDLE_TIME = 3600000; // 1 hour

// Monitor socket connections and cleanup idle ones
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;

  connectedSockets.forEach((data, socketId) => {
    // Check for idle sockets
    if (now - data.lastAttempt > SOCKET_MAX_IDLE_TIME) {
      console.log(`Cleaning up idle socket ${socketId}`, data);
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.disconnect(true);
      }
      connectedSockets.delete(socketId);
      cleaned++;
    }
  });

  if (cleaned > 0) {
    console.log(`Cleaned up ${cleaned} idle socket connections`);
  }

  // Log connection statistics
  const stats = {
    totalConnections: connectedSockets.size,
    authenticatedConnections: Array.from(connectedSockets.values()).filter(s => s.authenticated).length,
    connectionsByRole: Array.from(connectedSockets.values()).reduce((acc, curr) => {
      if (curr.userRole) {
        acc[curr.userRole] = (acc[curr.userRole] || 0) + 1;
      }
      return acc;
    }, {})
  };

  console.log('Socket connection stats:', stats);
}, SOCKET_CLEANUP_INTERVAL);

// Setup socket handlers
handleConnection(io);

// Make io and socket tracking available to routes
app.set('io', io);
app.set('connectedSockets', connectedSockets);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    server: 'QuickFix Backend API',
    version: '1.0.0'
  });
});

// Middleware
// Add request logger for debugging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${safeRequestPath(req)}`);
  next();
});

// CORS must be applied FIRST so all responses (including errors) have CORS headers
const corsOptions = {
  origin: [
    ...(process.env.FRONTEND_URL ? [new URL(process.env.FRONTEND_URL).origin] : []),
    "https://quickfix.innovexlabs.me",
    "https://innovexlabs.me",
    "http://localhost:5173",
    "http://localhost:3000",
    "http://localhost:5001",
    "https://complain-beta.vercel.app",
    // Add any Vercel preview deployments
    /^https:\/\/complain-.*\.vercel\.app$/
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'Idempotency-Key', 'X-Ticket-Token', 'X-File-Name', 'X-Attachment-Visibility'],
  exposedHeaders: ['Authorization']
};

// Handle preflight requests explicitly
app.options('*', cors(corsOptions));
app.use(cors(corsOptions));

// Apply production-ready CSP configuration (Helmet handles COOP/COEP)
const isDevelopment = process.env.NODE_ENV !== 'production';
app.use(
  helmet({
    ...getHelmetCspConfig(isDevelopment),
    crossOriginOpenerPolicy: false
  })
);

// Set COOP/COEP headers AFTER helmet to override for Google Sign-In compatibility
app.use((req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");
  next();
});

morgan.token('safe-url', safeRequestPath);
app.use(morgan(':remote-addr :method :safe-url :status :res[content-length] - :response-time ms'));
app.use(cookieParser());
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), webhookHandler);
app.use('/api/channels', channelRoutes);
app.use('/api/razorpay/webhook',razorpayWebhook);
app.use('/api/social',socialRoutes);
app.use('/api/voice',voiceRoutes);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint for uptime monitoring (before DB check middleware)
// This endpoint is lightweight and always responds, even if DB is down
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'complaint-management-backend',
    timestamp: new Date().toISOString()
  });
});

// Import database check middleware
import { dbConnectionCheck } from './middleware/dbCheck.js';
// Add database connection check for API routes
app.use(dbConnectionCheck);

// Routes
import authRoutes from "./routes/auth.js";
import complaintsRoutes from "./routes/complaints.js";
import usersRoutes from "./routes/users.js";
import notificationsRoutes from "./routes/notifications.js";
import analyticsRoutes from "./routes/analytics.js";
import adminRoutes from "./routes/admin.js";
import agentsRoutes from "./routes/agents.js";
import aiRoutes from "./routes/ai.js";
import subscriptionsRoutes from "./routes/subscriptions.js";
import paymentsRoutes from "./routes/payments.js";
import smsRoutes from "./routes/sms.js";
// Redis cache routes disabled - uncomment when Redis is enabled
// import cacheRoutes from "./routes/cache.js";


app.get("/", (req, res) => {
  res.status(200).send("Backend is running ✅");
});

app.use("/api/auth", authRoutes);
app.use("/api/complaints", complaintsRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/agents", agentsRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/subscriptions", subscriptionsRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/api/sms", smsRoutes);
// app.use("/api/admin", cacheRoutes); // Redis cache routes disabled

app.use('/api/workspaces', helpdeskRoutes, connectorRoutes, billingRoutes, attachmentRoutes, helpdeskAI, commerceRoutes, keyRoutes);
app.use('/api/workspaces',analyticsWorkspaceRoutes,enterpriseSecurityRoutes,indiaBillingRoutes,mailboxRoutes,semanticRoutes,migrationRoutes,channelAdmin,readinessRoutes);
app.use('/api/security',securityRoutes);
app.use('/api/sso',ssoPublicRoutes);
app.get('/api/ready', async(req,res,next)=>{try{const state=await readiness();res.status(state.ready?200:503).json(state);}catch(error){next(error);}});
app.use('/api/developer', developerRoutes);
app.use('/api/help', publicAIRoutes,portalRoutes);

// CSP violation reporting endpoint
app.post("/api/csp-report", express.json({ type: 'application/csp-report' }), cspReportHandler);

// Enhanced Health check
app.get("/api/health", async (req, res) => {
  try {
    // Check database connection
    let dbStatus = "disconnected";
    try {
      if (global.DB_CONNECTED) {
        await User.findOne().select('_id').lean();
        dbStatus = "connected";
      }
    } catch (err) {
      dbStatus = "error";
    }

    // Get socket client count
    let socketStats = {
      connectedClients: io.engine.clientsCount,
      rooms: Object.keys(io.sockets.adapter.rooms).length
    };

    // Get system info
    const systemInfo = {
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      pid: process.pid,
      environment: process.env.NODE_ENV,
      memory: process.memoryUsage(),
      nodeVersion: process.version,
      serverSessionId: global.SERVER_SESSION_ID
    };

    res.status(200).json({
      status: "ok",
      message: "Server is running",
      dbStatus,
      socketStats,
      systemInfo
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      message: "Health check failed",
      error: process.env.NODE_ENV === 'production' ? undefined : err.message
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// Custom error handler
app.use((err, req, res, next) => {
  // Log error details
  console.error('Error occurred:', {
    timestamp: new Date().toISOString(),
    error: err.message,
    stack: err.stack,
    requestUrl: safeRequestPath(req),
    requestMethod: req.method,
    // Do not log credentials, cookies, tokens, or customer request bodies.
  });

  // Check for specific error types
  if (err instanceof SyntaxError && err.type === 'entity.parse.failed') {
    // Handle JSON parsing error
    return res.status(400).json({
      success: false,
      message: 'Invalid JSON format',
      code: 'INVALID_JSON'
    });
  }

  // Handle validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation Error',
      errors: Object.values(err.errors).map(e => ({
        field: e.path,
        message: e.message
      })),
      code: 'VALIDATION_ERROR'
    });
  }

  // Handle MongoDB related errors
  if (err.name === 'MongoError' || err.name === 'MongoServerError') {
    if (err.code === 11000) {
      // Duplicate key error
      return res.status(409).json({
        success: false,
        message: 'Duplicate entry error',
        code: 'DUPLICATE_ENTRY'
      });
    }
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: err.message,
      code: 'AUTH_ERROR'
    });
  }

  // Handle file upload errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      message: 'File is too large',
      code: 'FILE_TOO_LARGE'
    });
  }

  // Default error response
  const statusCode = err.statusCode || 500;
  const errorResponse = {
    success: false,
    message: process.env.NODE_ENV === 'production' ?
      'An internal server error occurred' :
      err.message || 'Something went wrong!',
    code: err.code || 'INTERNAL_ERROR'
  };

  // Include stack trace in development
  if (process.env.NODE_ENV !== 'production') {
    errorResponse.stack = err.stack;
    errorResponse.details = err.details || {};
  }

  res.status(statusCode).json(errorResponse);
});


const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log("Server running on", PORT);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔌 Socket.IO server initialized`);
});
