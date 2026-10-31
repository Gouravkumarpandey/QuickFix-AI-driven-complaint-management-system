import rateLimit from 'express-rate-limit';
/**
 * AI API routes
 * Provides endpoints for AI-powered features and chatbot functionality
 */

import express from 'express';
import aiService from '../services/aiService.js';
import anthropicService from '../services/anthropicService.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false }));

const QUICKFIX_KB = `You are a helpful AI assistant for QuickFix, an enterprise-grade AI-powered complaint management system.

COMPREHENSIVE PROJECT INFORMATION:

🎯 OVERVIEW:
QuickFix is an enterprise-grade complaint management system that leverages artificial intelligence to enhance customer support operations. The platform provides real-time complaint tracking, intelligent ticket assignment, automated responses, sentiment analysis, and multi-channel communication. It is designed for scalability, security, and operational efficiency.

🏗️ SYSTEM ARCHITECTURE:
- Microservices architecture with event-driven design
- Frontend: React 18.3.1 + TypeScript + Vite + Material-UI + Tailwind CSS
- Backend API: Node.js 18+ + Express.js 4.18.2 + Socket.IO 4.8.1
- Database: MongoDB (Mongoose 7.5.0) + Redis 5.10.0 (caching)
- AI Service: Python FastAPI + Transformers + PyTorch + Sentence Transformers
- Event Processing: AWS SNS/SQS for asynchronous ticket assignment
- Authentication: JWT 9.0.2 + Passport.js 0.7.0 (OAuth - Google/Facebook)
- Payments: Stripe 17.5.0 integration
- Notifications: Nodemailer 7.0.12, Twilio SMS, WhatsApp Business API
- Real-time: Socket.IO for bidirectional WebSocket communication

✨ KEY FEATURES:

For Users:
- Submit complaints through user-friendly interface
- Real-time complaint status tracking
- Live chat support via integrated chatbot
- Multi-channel notifications (email, SMS, WhatsApp, in-app)
- Feedback system with ratings
- Personal dashboard with complaint history

For Agents:
- Manage and resolve assigned complaints
- AI-generated reply suggestions
- Performance metrics and analytics
- Real-time communication with users
- Automatic ticket assignment based on availability
- Comprehensive analytics dashboard

For Administrators:
- User, agent, and role management
- System analytics and performance monitoring
- Configuration and settings management
- Detailed report generation
- Subscription and billing management (Stripe)

🤖 AI CAPABILITIES:
- Automated complaint classification (product, billing, technical, etc.)
- Sentiment analysis for urgency detection (angry, neutral, happy)
- AI-powered response suggestions using Google Gemini and DeepSeek
- Text summarization for complaint summaries
- Semantic search and similarity matching with embeddings
- Dialogflow and Rasa chatbot integration
- Multi-language support with automatic detection

💰 PRICING PLANS:

1. Free Plan - ₹0/month
   - Up to 5 complaints/month
   - Basic tracking
   - Email notifications
   - Standard response time (48-72h)

2. Pro Plan - ₹499/month
   - Unlimited complaints
   - AI-powered diagnosis and classification
   - Priority support (24h response)
   - Analytics dashboard
   - Live chat support
   - SMS notifications

3. Premium Plan - ₹999/month
   - Everything in Pro
   - Team management (up to 10 users)
   - Advanced analytics and custom reports
   - Custom branding
   - Dedicated account manager
   - Video call support
   - Full API access
   - WhatsApp integration

🔄 EVENT-DRIVEN WORKFLOW:

Ticket Creation Flow:
1. User submits complaint via frontend
2. Backend API saves to MongoDB
3. Publishes "ticket.created" event to AWS SNS
4. SNS forwards to SQS Queue
5. Worker polls SQS and finds available agent
6. Assigns ticket and marks agent as BUSY
7. Sends real-time notification via Socket.IO

Ticket Resolution Flow:
1. Agent marks complaint as resolved
2. API updates MongoDB
3. Publishes "ticket.resolved" event to SNS
4. Worker marks agent as FREE
5. Auto-assigns next pending ticket if available
6. Sends notifications to user and agent

🔒 SECURITY FEATURES:
- JWT-based authentication with token expiration
- Role-based access control (User, Agent, Admin)
- Bcrypt password hashing with salt
- API rate limiting to prevent abuse
- Helmet.js for security headers (CSP, XSS protection)
- CORS configuration
- Input validation with Joi schemas
- MongoDB injection prevention via Mongoose ORM
- GDPR compliant data handling
- Regular security audits

IMPORTANT INSTRUCTIONS:
- Answer questions about QuickFix comprehensively using the above information.
- If the user asks about something NOT in this context (e.g. "Who is the president of France?"), SEARCH THE WEB (Google) to provide accurate results.
- Keep responses conversational, friendly, and helpful.
- Use plain text formatting.
`;


/**
 * @route POST /api/ai/classify
 * @desc Classify text using AI
 * @access Private
 */
router.post('/classify', authenticate, async (req, res) => {
  try {
    const { text, labels } = req.body;

    if (!text) {
      return res.status(400).json({
        success: false,
        message: 'Text is required for classification'
      });
    }

    try {
      const result = await aiService.classify(text, labels);

      return res.status(200).json({
        success: true,
        ...result
      });
    } catch (aiError) {
      console.warn('AI Service unavailable, using fallback classification:', aiError.message);

      // Fallback classification logic
      const textLower = text.toLowerCase();
      let category = 'General';
      let confidence = 0.7;

      // Simple keyword-based classification
      if (textLower.includes('password') || textLower.includes('login') || textLower.includes('access')) {
        category = 'Account';
        confidence = 0.85;
      } else if (textLower.includes('payment') || textLower.includes('bill') || textLower.includes('charge')) {
        category = 'Billing';
        confidence = 0.85;
      } else if (textLower.includes('slow') || textLower.includes('error') || textLower.includes('crash')) {
        category = 'Technical';
        confidence = 0.8;
      } else if (textLower.includes('delivery') || textLower.includes('shipping') || textLower.includes('order')) {
        category = 'Delivery';
        confidence = 0.8;
      }

      return res.status(200).json({
        success: true,
        top_label: category,
        confidence: confidence,
        fallback: true,
        model: 'keyword-based-fallback'
      });
    }
  } catch (error) {
    console.error('Error classifying text:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to classify text',
      error: error.message
    });
  }
});

/**
 * @route POST /api/ai/response
 * @desc Generate AI response (alias for /chat for backward compatibility)
 * @access Public
 */
router.post('/response', async (req, res) => {
  try {
    const { message, text, sessionId, context } = req.body;
    const inputText = message || text;

    if (!inputText) {
      return res.status(400).json({
        success: false,
        message: 'Message or text is required'
      });
    }

    // Use reply generation for general responses
    const result = await aiService.generateReply(inputText, context?.kb_context || [], context?.tone || 'polite');

    return res.status(200).json({
      success: true,
      response: result.draft_reply,
      confidence: result.confidence,
      ...result
    });
  } catch (error) {
    console.error('Error generating response:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate response',
      error: error.message
    });
  }
});

/**
 * @route POST /api/ai/chat
 * @desc Generate chatbot response
 * @access Public (no auth required for customer-facing chatbot)
 */
router.post('/chat', async (req, res) => {
  try {
    const { message, text, sessionId, context } = req.body;
    const inputText = message || text;

    if (!inputText) {
      return res.status(400).json({
        success: false,
        message: 'Message text is required'
      });
    }

    // Use Anthropic Claude for public chatbot
    const contextData = {
      userName: 'Guest',
      userRole: 'guest',
      systemInstruction: QUICKFIX_KB, // Pass the knowledge base
      ...context
    };

    const result = await anthropicService.chat(inputText, [], contextData);

    if (result.success) {
      return res.status(200).json({
        success: true,
        response: result.response,
        confidence: 0.9,
        sessionId,
        model: result.model,
        searchUsed: false
      });
    } else {
      throw new Error(result.error || 'Anthropic chat failed');
    }
  } catch (error) {
    console.error('Error generating chatbot response:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate chatbot response',
      error: error.message
    });
  }
});

/**
 * @route POST /api/ai/agent-response
 * @desc Generate agent assistance response
 * @access Private (agents only)
 */
router.post('/agent-response', authenticate, async (req, res) => {
  try {
    const { prompt, text, context } = req.body;
    const inputText = prompt || text;

    if (!inputText) {
      return res.status(400).json({
        success: false,
        message: 'Prompt is required'
      });
    }

    // Use reply generation for agent assistance
    const result = await aiService.generateReply(inputText, context?.kb_context || [], context?.tone || 'professional');

    return res.status(200).json({
      success: true,
      response: result.draft_reply,
      confidence: result.confidence,
      ...result
    });
  } catch (error) {
    console.error('Error generating agent response:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate agent response',
      error: error.message
    });
  }
});

export default router;