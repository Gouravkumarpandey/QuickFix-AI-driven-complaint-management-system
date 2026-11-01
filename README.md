> New workspace helpdesk: see [features, setup and remaining scope](docs/WORKSPACE_HELPDESK.md). Open `/workspaces` after signing in.

> Security and setup changes: see [deployment and verification notes](docs/SECURITY_AND_COMPLETION.md). Public signup now creates customers only; use the administrator CLI to bootstrap an admin and the protected API to create staff.

# Agent Availability Management System

## Overview
Agent availability is **automatically managed** by the system based on ticket assignment and resolution. Agents **cannot manually** change their availability status.

## Availability States

### 1. **Available** (Free)
- Agent has no active tickets assigned
- Ready to receive new ticket assignments
- Automatically set when all tickets are resolved

### 2. **Busy**
- Agent has one or more active tickets
- Cannot receive automatic assignments (admin can still manually assign)
- Automatically set when a ticket is assigned

### 3. **Offline**
- Agent is not working (set by admin only)
- Cannot receive any assignments

## Automatic State Changes

### When Ticket is Assigned to Agent:
```javascript
// In complaints.js - Manual assignment endpoint
await updateAgentAvailability(agentId, 'busy');
```
**Result:** Agent status changes from "Available" â†’ "Busy"

### When Agent Resolves a Ticket:
```javascript
// In complaints.js - Status update endpoint
if (status === 'Resolved' || status === 'Closed') {
  const updatedAgent = await refreshAgentAvailability(complaint.assignedTo);
  // Checks if agent has any remaining active tickets
  // If no active tickets: status changes to "Available"
  // If active tickets remain: status stays "Busy"
}
```
**Result:** 
- If last ticket â†’ Agent status changes from "Busy" â†’ "Available"
- If more tickets remain â†’ Agent status stays "Busy"

## Backend Implementation

### 1. Protected Routes (Admin Only)
```javascript
// routes/agents.js

// ADMIN ONLY - agents cannot manually change availability
router.patch('/:agentId/availability', authenticate, authorize('admin'), ...)

// ADMIN ONLY - manual refresh
router.post('/:agentId/refresh-availability', authenticate, authorize('admin'), ...)
```

### 2. Agent Service Functions

**updateAgentAvailability(agentId, status)**
- Directly sets agent availability
- Used by system when assigning tickets
- Only callable by admins via API

**refreshAgentAvailability(agentId)**
- Checks agent's active complaint count
- Automatically determines correct status:
  - No active complaints â†’ "Available"
  - Has active complaints â†’ "Busy"
- Used by system when resolving tickets

### 3. Automatic Triggers

**Ticket Assignment:**
```javascript
// routes/complaints.js - PATCH /:id/assign
complaint.assignedTo = agentId;
await updateAgentAvailability(agentId, 'busy');
```

**Ticket Resolution:**
```javascript
// routes/complaints.js - PATCH /:id/status
if (status === 'Resolved' || status === 'Closed') {
  await complaint.save(); // Save first!
  const updatedAgent = await refreshAgentAvailability(complaint.assignedTo);
  // Broadcasts agent status via socket
}
```

## Frontend Implementation

### Agent Dashboard
Agents can **view** their availability status but **cannot change** it:

```tsx
// READ-ONLY Status Display
<div className="flex items-center gap-2 bg-gray-100 px-3 py-2 rounded-lg">
  {agentProfile.availability === 'available' && (
    <>
      <UserCheck className="w-4 h-4 text-green-600" />
      <span className="text-green-700 font-medium">Available</span>
    </>
  )}
  {/* ... other states ... */}
  <span className="text-xs text-gray-500 ml-2">(Auto)</span>
</div>
```

**Previous UI (Removed):**
- âŒ Available button (manual control)
- âŒ Busy button (manual control)
- âŒ Offline button (manual control)

**New UI:**
- âœ… Status badge (read-only indicator)
- âœ… "(Auto)" label to indicate automatic management

## Workflow Example

### Scenario: Agent Resolves Their Last Active Ticket

1. **Agent marks ticket as "Resolved"**
   ```
   PATCH /api/complaints/:id/status
   Body: { status: 'Resolved' }
   ```

2. **Backend saves complaint**
   ```javascript
   complaint.status = 'Resolved';
   await complaint.save();
   ```

3. **Backend sends resolution email to user**
   ```javascript
   await sendComplaintResolvedEmail(user.email, ...);
   ```

4. **Backend refreshes agent availability**
   ```javascript
   const updatedAgent = await refreshAgentAvailability(agentId);
   // Queries: "Does agent have other active tickets?"
   // Result: No â†’ Set to "Available"
   ```

5. **Backend broadcasts agent status**
   ```javascript
   io.emit('agent_status_update', {
     agentId: updatedAgent._id,
     availability: 'available'
   });
   ```

6. **Backend publishes SNS event**
   ```javascript
   await publishEvent('ticket.resolved', { ... });
   ```

7. **SQS Worker receives event**
   ```javascript
   // Finds next unassigned ticket
   // Assigns to now-available agent
   await updateAgentAvailability(agentId, 'busy');
   ```

8. **Agent receives new ticket notification**
   - Status automatically changes back to "Busy"
   - New ticket appears in dashboard

## Benefits

### 1. **Prevents Manual Errors**
- Agents cannot accidentally set themselves as "Available" while having active tickets
- No risk of agents staying "Busy" when they have no work

### 2. **Ensures Fair Distribution**
- Only truly available agents receive new assignments
- Auto-assignment system gets accurate availability data

### 3. **Real-time Accuracy**
- Status updates immediately when tickets are assigned/resolved
- No manual intervention required

### 4. **Audit Trail**
- All status changes are system-driven and logged
- Clear correlation between ticket actions and availability changes

## Admin Override

Admins can still manually control agent availability if needed:

```bash
# Admin can manually set agent offline for vacation/sick leave
PATCH /api/agents/:agentId/availability
Authorization: Bearer <admin-token>
Body: { status: 'offline' }

# Admin can manually refresh if needed
POST /api/agents/:agentId/refresh-availability
Authorization: Bearer <admin-token>
```

This allows for exceptional cases like:
- Setting agent offline for vacation
- Emergency status corrections
- System maintenance

## Testing

### Verify Automatic Availability Management:

1. **Test Ticket Assignment:**
   ```bash
   # Assign ticket to available agent
   # Expected: Agent status changes to "busy"
   ```

2. **Test Ticket Resolution (Last Ticket):**
   ```bash
   # Agent resolves their only active ticket
   # Expected: Agent status changes to "available"
   ```

3. **Test Ticket Resolution (Multiple Tickets):**
   ```bash
   # Agent resolves one of multiple tickets
   # Expected: Agent status stays "busy"
   ```

4. **Test Agent Cannot Change Status:**
   ```bash
   # Agent tries to change their own availability
   # Expected: 403 Forbidden (not authorized)
   ```

5. **Test Admin Can Change Status:**
   ```bash
   # Admin sets agent to offline
   # Expected: 200 OK, status updated
   ```

## Summary

âœ… **Agents CANNOT manually change availability**  
âœ… **Automatic when ticket assigned** â†’ Busy  
âœ… **Automatic when all tickets resolved** â†’ Available  
âœ… **Admin can override** for special cases  
âœ… **Real-time socket updates** to all clients  
âœ… **Prevents manual errors** and ensures accuracy  
# ðŸš€ Event-Driven Architecture - QuickFix

## Overview
QuickFix now uses AWS SNS + SQS for event-driven ticket assignment and agent management.

## ðŸ“‹ Flow Diagram

### 1ï¸âƒ£ Ticket Creation Flow
```
User creates ticket â†’ API saves to MongoDB â†’ Publishes "ticket.created" event to SNS
                                                    â†“
                                            SNS â†’ SQS Queue
                                                    â†“
                                            Worker polls SQS
                                                    â†“
                        Find free agent â†’ Assign ticket â†’ Mark agent BUSY
                                                    â†“
                                        Send notification to agent
```

### 2ï¸âƒ£ Ticket Resolution Flow
```
Agent marks resolved â†’ API updates MongoDB â†’ Mark agent FREE â†’ Publish "ticket.resolved" to SNS
                                                                            â†“
                                                                    SNS â†’ SQS Queue
                                                                            â†“
                                                                    Worker polls SQS
                                                                            â†“
                    Check if agent has other active tickets â†’ If NO â†’ Find next unassigned ticket
                                                                            â†“
                                                    Assign to same agent â†’ Mark agent BUSY again
                                                                            â†“
                                                            Send notification + Update user dashboard
```

## ðŸ“ Architecture Components

### 1. SNS Publisher (`utils/snsPublisher.js`)
- Publishes events to AWS SNS Topic
- Events: `ticket.created`, `ticket.resolved`

### 2. SQS Worker (`worker/sqsWorker.js`)
- Polls SQS queue for messages
- Handles business logic:
  - **ticket.created**: Assign to free agent
  - **ticket.resolved**: Free agent + auto-assign next ticket

### 3. API Routes (`src/routes/complaints.js`)
- **POST /complaints**: Creates ticket â†’ publishes `ticket.created`
- **PATCH /complaints/:id/status**: Resolves ticket â†’ publishes `ticket.resolved`

## ðŸ”§ Setup Instructions

### Prerequisites
```bash
npm install @aws-sdk/client-sns @aws-sdk/client-sqs dotenv mongoose
```

### Environment Variables (.env)
```env
AWS_REGION=eu-north-1
SNS_TOPIC_ARN=arn:aws:sns:eu-north-1:426757726647:QuickFix
SQS_QUEUE_URL=https://sqs.eu-north-1.amazonaws.com/426757726647/QuickFix
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
MONGODB_URI=your_mongodb_connection_string
```

### AWS Setup
1. **Create SNS Topic**: `QuickFix`
2. **Create SQS Queue**: `QuickFix`
3. **Subscribe Queue to Topic**: Enable **Raw Message Delivery = true**
4. **Set IAM Permissions**: `sns:Publish`, `sqs:ReceiveMessage`, `sqs:DeleteMessage`

## ðŸš¦ Running the System

### Terminal 1: Start Backend API
```bash
cd backend
npm run dev
```

### Terminal 2: Start Event Worker
```bash
cd backend
node worker/sqsWorker.js
```

## ðŸ§ª Testing

### Test 1: Create a ticket via API
```bash
# Create a ticket (API will publish ticket.created event)
curl -X POST http://localhost:5001/api/complaints \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "title": "Test Ticket",
    "description": "Testing event-driven assignment",
    "category": "Technical"
  }'
```

**Expected Behavior:**
1. âœ… Ticket saved in MongoDB
2. ðŸ“¡ `ticket.created` event published to SNS
3. ðŸ“¬ Worker receives event from SQS
4. ðŸŽ¯ Worker assigns ticket to free agent
5. ðŸ“Œ Agent marked as BUSY
6. ðŸ”” Notification sent to agent

### Test 2: Resolve a ticket
```bash
# Agent resolves ticket
curl -X PATCH http://localhost:5001/api/complaints/{id}/status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer AGENT_TOKEN" \
  -d '{
    "status": "Resolved",
    "message": "Issue fixed!"
  }'
```

**Expected Behavior:**
1. âœ… Ticket status updated to "Resolved" in MongoDB
2. ðŸ†“ Agent marked as FREE (if no other active tickets)
3. ðŸ“¡ `ticket.resolved` event published to SNS
4. ðŸ“¬ Worker receives event from SQS
5. ðŸ” Worker finds next unassigned ticket
6. ðŸŽ¯ Worker assigns it to the now-free agent
7. ðŸ“Œ Agent marked as BUSY again
8. ðŸ”” Notification sent to agent
9. ðŸ“± User dashboard updated via Socket.IO

## ðŸ“Š Event Payloads

### ticket.created
```json
{
  "eventType": "ticket.created",
  "timestamp": "2026-01-17T12:00:00.000Z",
  "data": {
    "ticketId": "67892fd1a2b3c4e5f6789012",
    "complaintId": "COMP-12345",
    "userId": "user_id",
    "title": "Internet issue",
    "category": "Technical",
    "priority": "High",
    "assignedTo": null
  }
}
```

### ticket.resolved
```json
{
  "eventType": "ticket.resolved",
  "timestamp": "2026-01-17T12:30:00.000Z",
  "data": {
    "ticketId": "67892fd1a2b3c4e5f6789012",
    "complaintId": "COMP-12345",
    "agentId": "agent_id",
    "resolvedBy": "agent_id",
    "resolvedAt": "2026-01-17T12:30:00.000Z",
    "userId": "user_id",
    "title": "Internet issue",
    "priority": "High"
  }
}
```

## ðŸ”„ Agent Availability States

| State | Description | Triggers |
|-------|-------------|----------|
| `available` | Agent has no active tickets | Ticket resolved + no other active tickets |
| `busy` | Agent has 1+ active tickets | Ticket assigned to agent |
| `offline` | Agent is not working | Manual toggle |

## ðŸ“ˆ Benefits

1. **Scalability**: Worker can be scaled independently
2. **Reliability**: SQS ensures messages are processed
3. **Decoupling**: API and business logic are separated
4. **Async Processing**: Non-blocking operations
5. **Auto-Assignment**: Agents get new tickets automatically
6. **Real-time Updates**: User dashboard updates via Socket.IO

## ðŸ› Troubleshooting

### Worker not receiving messages
- Check SQS queue URL in `.env`
- Verify SNS subscription to SQS (Raw Message Delivery = true)
- Check IAM permissions

### Agent not getting assigned
- Ensure at least one agent has `availability: 'available'`
- Check MongoDB connection in worker
- Verify event payload contains valid ObjectIds

### User dashboard not updating
- Ensure Socket.IO is properly initialized
- Check that `io.to('user:${userId}')` rooms are joined
- Verify frontend is listening for `complaintUpdated` event

## ðŸŽ¯ Next Steps

- [ ] Add retry logic for failed assignments
- [ ] Implement DLQ (Dead Letter Queue) for failed events
- [ ] Add metrics/analytics for event processing
- [ ] Scale workers horizontally
- [ ] Add event replay capability
# Complaint Management System - Backend

A comprehensive Node.js backend API for managing customer complaints with AI-powered classification, real-time updates, and advanced analytics.

## Features

- **User Management**: Registration, authentication, role-based access control
- **Complaint Management**: Create, track, update, and resolve complaints
- **AI Classification**: Automatic categorization, sentiment analysis, and priority assignment
- **Real-time Updates**: WebSocket support for live notifications and updates
- **Analytics Dashboard**: Comprehensive reporting and metrics
- **SLA Management**: Automatic tracking and breach notifications
- **Multi-role Support**: Different interfaces for users, agents, administrators, and analytics managers

## Tech Stack

- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: JWT (JSON Web Tokens)
- **Real-time**: Socket.IO
- **Validation**: Joi
- **Security**: Helmet, CORS, Rate limiting
- **Email**: Nodemailer (for notifications)

## Prerequisites

- Node.js (v16 or higher)
- MongoDB (v4.4 or higher)
- npm or yarn package manager

## Installation

1. **Clone the repository and navigate to backend directory**
   ```bash
   cd backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Configuration**
   ```bash
   cp .env.example .env
   ```
   
   Update the `.env` file with your configuration:
   ```env
   NODE_ENV=development
   PORT=5000
   MONGODB_URI=mongodb://localhost:27017/complaint_management
   JWT_SECRET=your-super-secure-jwt-secret-key-here
   JWT_EXPIRES_IN=7d
   ```

4. **Start MongoDB**
   Make sure MongoDB is running on your system

5. **Start the development server**
   ```bash
   npm run dev
   ```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login
- `POST /api/auth/refresh` - Refresh JWT token
- `POST /api/auth/logout` - User logout

### Users
- `GET /api/users/profile` - Get current user profile
- `PATCH /api/users/profile` - Update user profile
- `PATCH /api/users/password` - Change password
- `GET /api/users` - Get all users (admin only)
- `GET /api/users/:id` - Get user by ID (admin only)
- `PATCH /api/users/:id` - Update user (admin only)

### Complaints
- `GET /api/complaints` - Get complaints (filtered by role)
- `GET /api/complaints/:id` - Get complaint by ID
- `POST /api/complaints` - Create new complaint
- `PATCH /api/complaints/:id/status` - Update complaint status
- `PATCH /api/complaints/:id/assign` - Assign complaint to agent
- `POST /api/complaints/:id/updates` - Add comment/update
- `PATCH /api/complaints/:id/escalate` - Escalate complaint
- `POST /api/complaints/:id/feedback` - Submit feedback

### Analytics
- `GET /api/analytics/dashboard` - Get dashboard analytics
- `GET /api/analytics/team-performance` - Get team performance metrics
- `GET /api/analytics/trends/category` - Get category trends
- `GET /api/analytics/sla-compliance` - Get SLA compliance report

### Admin
- `GET /api/admin/stats` - Get system statistics
- `GET /api/admin/users` - Get all users with admin access
- `PATCH /api/admin/users/bulk` - Bulk update users
- `GET /api/admin/complaints` - Get all complaints with admin access
- `PATCH /api/admin/complaints/bulk-assign` - Bulk assign complaints
- `PATCH /api/admin/complaints/bulk-close` - Bulk close complaints
- `GET /api/admin/config` - Get system configuration
- `PATCH /api/admin/config` - Update system configuration

### Notifications
- `GET /api/notifications` - Get user notifications
- `PATCH /api/notifications/:id/read` - Mark notification as read
- `PATCH /api/notifications/read-all` - Mark all notifications as read
- `GET /api/notifications/preferences` - Get notification preferences
- `PATCH /api/notifications/preferences` - Update notification preferences

### Payments (Stripe Integration)
- `GET /api/payments/key` - Get Stripe publishable key
- `POST /api/payments/create-checkout-session` - Create Stripe checkout session
- `POST /api/payments/verify` - Verify payment and upgrade user plan
- `GET /api/payments/history` - Get payment history
- `POST /api/payments/webhook` - Stripe webhook handler
- `POST /api/payments/refund` - Refund payment (admin only)
- `GET /api/payments/all` - Get all payments (admin only)

## User Roles

### User (Customer)
- Create and track complaints
- View their own complaints
- Add comments and attachments
- Submit feedback for resolved complaints

### Agent (Support Staff)
- View assigned complaints
- Update complaint status
- Add internal and external comments
- Escalate complaints when needed
- View team dashboard

### Admin (Administrator)
- Full system access
- User management
- System configuration
- Advanced analytics
- Bulk operations

## AI Classification

The system includes an AI service that automatically:
- **Categorizes complaints** into predefined categories (Billing, Technical, Service, Product, General)
- **Analyzes sentiment** (Positive, Neutral, Negative)
- **Assigns priority** levels (Low, Medium, High, Urgent)
- **Extracts keywords** for better searchability

## Real-time Features

Using Socket.IO, the system provides:
- Live complaint updates
- Real-time notifications
- Typing indicators
- Status change notifications
- SLA breach alerts
- Assignment notifications

## Database Schema

### Users Collection
```javascript
{
  firstName: String,
  lastName: String,
  email: String (unique),
  password: String (hashed),
  role: String (user|agent|admin|analytics),
  department: String,
  isActive: Boolean,
  profile: Object,
  preferences: Object,
  createdAt: Date,
  updatedAt: Date
}
```

### Complaints Collection
```javascript
{
  userId: ObjectId (ref: User),
  title: String,
  description: String,
  category: String,
  priority: String,
  status: String,
  sentiment: String,
  assignedTo: ObjectId (ref: User),
  assignedTeam: String,
  slaTarget: Date,
  isEscalated: Boolean,
  escalationReason: String,
  feedback: Object,
  aiAnalysis: Object,
  metrics: Object,
  updates: Array,
  createdAt: Date,
  updatedAt: Date
}
```

## Security Features

- JWT-based authentication
- Password hashing with bcrypt
- Rate limiting to prevent abuse
- CORS configuration
- Helmet for security headers
- Input validation with Joi
- Role-based access control

## Error Handling

The API includes comprehensive error handling:
- Mongoose validation errors
- JWT authentication errors
- Database connection errors
- Custom business logic errors
- Detailed error messages in development
- Generic error messages in production

## Testing

Run the test suite:
```bash
npm test
```

## Production Deployment

1. **Build the application**
   ```bash
   npm run build
   ```

2. **Set production environment variables**
   ```env
   NODE_ENV=production
   MONGODB_URI=your-production-mongodb-uri
   JWT_SECRET=your-production-jwt-secret
   ```

3. **Start the production server**
   ```bash
   npm start
   ```

## API Documentation

For detailed API documentation, you can:
1. Import the API collection into Postman
2. Use tools like Swagger/OpenAPI (can be added)
3. Refer to the route files in `src/routes/`

## Stripe Payment Integration

### Prerequisites

- A Stripe account (sign up at https://stripe.com)
- Node.js and npm installed
- Backend server running

### Setup Steps

#### 1. Get Stripe API Keys

1. Log in to your [Stripe Dashboard](https://dashboard.stripe.com)
2. Go to **Developers** â†’ **API keys**
3. Copy your **Publishable key** (starts with `pk_test_` for test mode)
4. Copy your **Secret key** (starts with `sk_test_` for test mode)

#### 2. Configure Environment Variables

Add the following to your `.env` file in the backend directory:

```env
# Stripe Payment Gateway
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key_here
STRIPE_PUBLISHABLE_KEY=pk_test_your_stripe_publishable_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here

# Frontend URL (required for payment redirects)
FRONTEND_URL=http://localhost:5173
```

#### 3. Set Up Webhooks (Optional but Recommended)

Webhooks allow Stripe to notify your server about payment events.

1. Go to **Developers** â†’ **Webhooks** in your Stripe Dashboard
2. Click **Add endpoint**
3. Set the endpoint URL to: `https://yourdomain.com/api/payments/webhook`
   - For local testing, use a tool like [Stripe CLI](https://stripe.com/docs/stripe-cli) or [ngrok](https://ngrok.com/)
4. Select events to listen to:
   - `checkout.session.completed`
   - `payment_intent.payment_failed`
   - `charge.refunded`
5. Copy the **Signing secret** (starts with `whsec_`) and add it to your `.env` file as `STRIPE_WEBHOOK_SECRET`

#### 4. Test the Integration

##### Local Testing with Stripe CLI

1. Install the [Stripe CLI](https://stripe.com/docs/stripe-cli)
2. Login: `stripe login`
3. Forward webhooks to your local server:
   ```bash
   stripe listen --forward-to localhost:5000/api/payments/webhook
   ```
4. The CLI will provide a webhook signing secret. Update your `.env` file with it.

##### Test Card Numbers

Use these test card numbers in test mode:

- **Successful payment**: `4242 4242 4242 4242`
- **Payment requires authentication**: `4000 0025 0000 3155`
- **Payment is declined**: `4000 0000 0000 9995`

Use any future expiry date, any 3-digit CVC, and any postal code.

### Plan Pricing

Current plan pricing (in USD):
- **Pro Plan**: $4.99/month
- **Premium Plan**: $9.99/month

To modify pricing, update the `planPrices` object in `src/controllers/paymentController.js`.

### Frontend Integration

The frontend needs to be updated to use Stripe Checkout. Here's a basic flow:

1. Fetch the publishable key from `/api/payments/key`
2. Create a checkout session by calling `/api/payments/create-checkout-session`
3. Redirect to the Stripe Checkout page using the `url` from the response
4. After payment, Stripe redirects to your success URL with the `session_id`
5. Call `/api/payments/verify` with the `session_id` to complete the process

Example frontend code:
```javascript
// 1. Create checkout session
const response = await fetch('/api/payments/create-checkout-session', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ planType: 'Pro' })
});

const { url } = await response.json();

// 2. Redirect to Stripe Checkout
window.location.href = url;

// 3. On success page, verify payment
const urlParams = new URLSearchParams(window.location.search);
const sessionId = urlParams.get('session_id');

await fetch('/api/payments/verify', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ sessionId })
});
```

### Going Live

When ready to go live:

1. Switch to live API keys in your Stripe Dashboard
2. Update your `.env` file with live keys (they start with `sk_live_` and `pk_live_`)
3. Set up webhooks for your production domain
4. Update the `FRONTEND_URL` in `.env` to your production URL
5. Test thoroughly with real cards before launching

### Security Best Practices

- âœ… **Never expose your secret key** - it should only be in your `.env` file on the server
- âœ… **Always verify webhook signatures** - this is already implemented
- âœ… **Use HTTPS in production** - required for PCI compliance
- âœ… **Verify payment status** - always check `payment_status === 'paid'` before granting access
- âœ… **Handle errors gracefully** - provide clear error messages to users

### Troubleshooting

#### "Invalid API Key" Error
- Check that your `.env` file has the correct `STRIPE_SECRET_KEY`
- Make sure you're using test keys for development and live keys for production
- Restart your server after updating environment variables

#### Webhook Signature Verification Failed
- Verify the `STRIPE_WEBHOOK_SECRET` in your `.env` file
- If using Stripe CLI for local testing, use the secret provided by `stripe listen`
- Check that the webhook endpoint receives raw body (not JSON parsed)

#### Payment Succeeds but User Plan Not Updated
- Check the server logs for errors
- Verify that the `client_reference_id` in the session matches the user ID
- Ensure the webhook is properly set up and receiving events
- Check that the user exists in the database

### Stripe Support

- Stripe Documentation: https://stripe.com/docs
- Stripe API Reference: https://stripe.com/docs/api
- Stripe Testing: https://stripe.com/docs/testing

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## License

This project is licensed under the MIT License.

## Support

For support and questions, please refer to the documentation or create an issue in the repository.
# SMS Notification System Documentation

## Overview
The SMS Notification System is a comprehensive backend feature that sends SMS messages to users when specific events occur in the QuickFix Complaint Management System.

## Features
- âœ… International phone number support (all country formats)
- âœ… Automatic SMS triggers for various events
- âœ… Dynamic and personalized messages
- âœ… Delivery status tracking in database
- âœ… Error handling and logging
- âœ… Bulk SMS support
- âœ… SMS statistics and analytics

## Setup Instructions

### 1. Install Dependencies
```bash
cd backend
npm install
```

This will install:
- `twilio` - SMS service provider
- `libphonenumber-js` - International phone number validation

### 2. Configure Environment Variables

Add the following to your `.env` file in the `backend` directory:

```env
# Twilio SMS Configuration
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+1234567890

# Application Name (for SMS messages)
APP_NAME=QuickFix
```

#### Getting Twilio Credentials:
1. Sign up at [https://www.twilio.com](https://www.twilio.com)
2. Get a free trial account (includes $15 credit)
3. From the Twilio Console Dashboard:
   - **Account SID** - Found on the dashboard
   - **Auth Token** - Click "Show" next to Auth Token
   - **Phone Number** - Get a phone number from "Phone Numbers" section

### 3. Database Model
The system automatically creates an `SMSLog` collection to track all SMS messages:

```javascript
{
  userId: ObjectId,
  phoneNumber: String,
  message: String,
  eventType: String,
  status: String, // 'pending', 'sent', 'delivered', 'failed'
  messageSid: String,
  deliveryStatus: String,
  sentAt: Date,
  errorCode: String,
  errorMessage: String
}
```

## Phone Number Format

### Supported Formats
The system accepts phone numbers in multiple formats:

- **International format with +**: `+1234567890`, `+919876543210`
- **International format with spaces**: `+1 234 567 8900`
- **National format** (if country is detected): `(234) 567-8900`

### Important Notes
- Phone numbers are automatically validated and converted to E.164 format (`+1234567890`)
- Invalid phone numbers are rejected during signup
- All SMS are sent to E.164 formatted numbers

### Example Phone Numbers by Country
```javascript
USA:        +1234567890
India:      +919876543210
UK:         +447911123456
Canada:     +14165551234
Australia:  +61412345678
```

## API Endpoints

### 1. Send Single SMS
```http
POST /api/sms/send
Authorization: Bearer <token>
Content-Type: application/json

{
  "userName": "John Doe",
  "phoneNumber": "+1234567890",
  "eventType": "REMINDER",
  "eventData": {
    "reminderText": "Your appointment is tomorrow at 3 PM"
  }
}
```

### 2. Send Bulk SMS
```http
POST /api/sms/send-bulk
Authorization: Bearer <token>
Content-Type: application/json

{
  "recipients": [
    {
      "userName": "John Doe",
      "phoneNumber": "+1234567890",
      "userId": "user_id_1"
    },
    {
      "userName": "Jane Smith",
      "phoneNumber": "+919876543210",
      "userId": "user_id_2"
    }
  ],
  "eventType": "STATUS_UPDATE",
  "commonEventData": {
    "complaintId": "12345",
    "status": "Resolved"
  }
}
```

### 3. Get SMS Status
```http
GET /api/sms/status/:messageSid
Authorization: Bearer <token>
```

### 4. Get User SMS Logs
```http
GET /api/sms/logs?limit=50&skip=0&eventType=SIGNUP
Authorization: Bearer <token>
```

### 5. Get SMS Statistics (Admin)
```http
GET /api/sms/stats?startDate=2024-01-01&endDate=2024-12-31
Authorization: Bearer <token>
```

### 6. Test SMS Configuration
```http
POST /api/sms/test
Authorization: Bearer <token>
Content-Type: application/json

{
  "phoneNumber": "+1234567890"
}
```

## SMS Event Types

The system supports the following event types:

| Event Type | Description | Trigger |
|------------|-------------|---------|
| `SIGNUP` | User registration | When user creates account |
| `OTP_GENERATION` | OTP verification | When OTP is generated |
| `INTERVIEW_SCHEDULED` | Interview notification | When interview is scheduled |
| `REMINDER` | General reminders | Custom reminders |
| `COMPLAINT_CREATED` | Complaint registered | When complaint is created |
| `COMPLAINT_ASSIGNED` | Complaint assigned to agent | When agent is assigned |
| `COMPLAINT_RESOLVED` | Complaint resolved | When complaint is closed |
| `STATUS_UPDATE` | Status change | When status changes |
| `PASSWORD_RESET` | Password reset | When password reset is requested |
| `PAYMENT_SUCCESS` | Payment successful | After successful payment |
| `PAYMENT_FAILED` | Payment failed | When payment fails |

## Message Templates

All messages follow this format:
```
Hello {UserName}, this is a notification from {AppName}. {EventMessage}. Thank you.
```

### Example Messages

**Signup:**
```
Hello John, this is a notification from QuickFix. Welcome to QuickFix! Thank you for signing up, John. We're excited to have you on board. Thank you.
```

**OTP Generation:**
```
Hello John, this is a notification from QuickFix. Your OTP for QuickFix is: 123456. Valid for 10 minutes. Do not share this code. Thank you.
```

**Complaint Created:**
```
Hello John, this is a notification from QuickFix. Your complaint #12345 has been registered successfully. We'll update you soon. Thank you.
```

## Automatic SMS Triggers

### Integration in Your Code

#### 1. Signup SMS (Already Integrated)
```javascript
import { triggerSignupSMS } from '../services/smsTriggers.js';

// In your signup controller
const user = await User.create(userData);
await triggerSignupSMS(user);
```

#### 2. OTP Generation
```javascript
import { triggerOTPSMS } from '../services/smsTriggers.js';

const otp = generateOTP();
await triggerOTPSMS(user, otp, 10); // 10 minutes expiry
```

#### 3. Complaint Created
```javascript
import { triggerComplaintCreatedSMS } from '../services/smsTriggers.js';

const complaint = await Complaint.create(complaintData);
await triggerComplaintCreatedSMS(user, complaint._id);
```

#### 4. Complaint Assigned
```javascript
import { triggerComplaintAssignedSMS } from '../services/smsTriggers.js';

await triggerComplaintAssignedSMS(user, complaintId, agentName);
```

#### 5. Payment Success
```javascript
import { triggerPaymentSuccessSMS } from '../services/smsTriggers.js';

await triggerPaymentSuccessSMS(user, amount, currency, transactionId);
```

## User Signup with Phone Number

### Frontend Integration

```javascript
// Signup form data
const signupData = {
  name: "John Doe",
  email: "john@example.com",
  password: "securePassword123",
  phoneNumber: "+1234567890", // International format recommended
  role: "user"
};

// API call
const response = await fetch('http://localhost:5000/api/auth/register', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(signupData)
});

const result = await response.json();
```

### Phone Number Input Component (React Example)

```jsx
import React, { useState } from 'react';

function PhoneNumberInput({ value, onChange }) {
  const [phoneNumber, setPhoneNumber] = useState(value || '');
  const [countryCode, setCountryCode] = useState('+1');

  const handlePhoneChange = (e) => {
    const number = e.target.value;
    setPhoneNumber(number);
    
    // Combine country code with phone number
    const fullNumber = number.startsWith('+') ? number : `${countryCode}${number}`;
    onChange(fullNumber);
  };

  return (
    <div className="flex gap-2">
      <select
        value={countryCode}
        onChange={(e) => setCountryCode(e.target.value)}
        className="w-24 px-3 py-2 border rounded"
      >
        <option value="+1">ðŸ‡ºðŸ‡¸ +1</option>
        <option value="+91">ðŸ‡®ðŸ‡³ +91</option>
        <option value="+44">ðŸ‡¬ðŸ‡§ +44</option>
        <option value="+61">ðŸ‡¦ðŸ‡º +61</option>
        <option value="+81">ðŸ‡¯ðŸ‡µ +81</option>
        <option value="+86">ðŸ‡¨ðŸ‡³ +86</option>
      </select>
      
      <input
        type="tel"
        value={phoneNumber}
        onChange={handlePhoneChange}
        placeholder="Enter phone number"
        className="flex-1 px-3 py-2 border rounded"
      />
    </div>
  );
}
```

## Error Handling

### Common Errors and Solutions

#### 1. Twilio Not Configured
```json
{
  "success": false,
  "error": "Twilio is not configured. Please add TWILIO credentials to .env file"
}
```
**Solution:** Add Twilio credentials to `.env` file

#### 2. Invalid Phone Number
```json
{
  "success": false,
  "error": "Invalid phone number format",
  "hint": "Please provide phone number in international format (e.g., +1234567890)"
}
```
**Solution:** Ensure phone number includes country code with + prefix

#### 3. SMS Delivery Failed
```json
{
  "success": false,
  "error": "Failed to send SMS",
  "errorCode": "21211"
}
```
**Solution:** Check Twilio error codes at [https://www.twilio.com/docs/api/errors](https://www.twilio.com/docs/api/errors)

## Monitoring and Analytics

### View SMS Statistics
```http
GET /api/sms/stats
```

Response:
```json
{
  "success": true,
  "data": {
    "total": 1250,
    "sent": 1180,
    "failed": 70,
    "pending": 0,
    "successRate": "94.40"
  }
}
```

### View Event Statistics
```http
GET /api/sms/stats/events
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "eventType": "SIGNUP",
      "count": 450,
      "sent": 445,
      "failed": 5,
      "successRate": 98.89
    },
    {
      "eventType": "COMPLAINT_CREATED",
      "count": 320,
      "sent": 315,
      "failed": 5,
      "successRate": 98.44
    }
  ]
}
```

## Database Queries

### Find all SMS for a user
```javascript
const logs = await SMSLog.find({ userId: user._id })
  .sort({ sentAt: -1 })
  .limit(50);
```

### Find failed SMS
```javascript
const failedSMS = await SMSLog.find({ status: 'failed' })
  .sort({ sentAt: -1 });
```

### Get SMS count by event type
```javascript
const stats = await SMSLog.aggregate([
  {
    $group: {
      _id: '$eventType',
      count: { $sum: 1 }
    }
  }
]);
```

## Testing

### Test with Twilio Trial Account
1. Sign up for Twilio trial account
2. Verify your phone number (trial accounts can only send to verified numbers)
3. Use the test endpoint:

```bash
curl -X POST http://localhost:5000/api/sms/test \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "+1234567890"}'
```

## Production Considerations

1. **Rate Limiting**: Add rate limiting to prevent SMS spam
2. **Cost Management**: Monitor SMS usage to control costs
3. **User Preferences**: Allow users to opt-out of SMS notifications
4. **Compliance**: Follow TCPA, GDPR, and other regulations
5. **Security**: Never log phone numbers in plain text in production logs

## Alternative SMS Providers

The system is designed to work with Twilio, but you can integrate other providers:

- **Fast2SMS** (India)
- **MSG91** (India)
- **AWS SNS** (Global)
- **Nexmo/Vonage** (Global)

To switch providers, modify `backend/src/services/smsService.js`

## Support

For issues or questions:
1. Check Twilio dashboard for delivery status
2. Review SMS logs in database
3. Check application logs for errors
4. Verify environment variables are correctly set

## Files Created

1. `backend/src/services/smsService.js` - Main SMS service
2. `backend/src/services/smsTriggers.js` - Event-based triggers
3. `backend/src/models/SMSLog.js` - Database model
4. `backend/src/controllers/smsController.js` - API controllers
5. `backend/src/routes/sms.js` - API routes
6. `backend/src/utils/phoneValidation.js` - Phone number validation utilities
7. `backend/SMS_NOTIFICATION_SYSTEM.md` - This documentation

## License
MIT
# Testing Guide: Ticket Resolution & Agent Availability

## ðŸ§ª How to Test the Complete Flow

### Setup (Run these in separate terminals):

**Terminal 1 - Backend API:**
```bash
cd backend
npm start
```

**Terminal 2 - Event Worker:**
```bash
cd backend
node worker/sqsWorker.js
```

**Terminal 3 - Frontend:**
```bash
cd frontend
npm run dev
```

---

## âœ… Test Scenario 1: Agent Resolves Ticket

### Steps:
1. **Login as Agent** at `localhost:5173`
2. **Go to Agent Dashboard** â†’ My Tickets
3. **Select an In Progress ticket**
4. **Click "Mark as Resolved"** button
5. **Enter resolution message** (e.g., "Issue has been fixed")
6. **Submit**

### Expected Results:

**âœ… Backend Console:**
```
ðŸ”„ Refreshed agent availability after complaint marked as Resolved
ðŸ“¡ SNS Event published: ticket.resolved for COMP-12345
   Event will trigger worker to mark agent as free and auto-assign next ticket
ðŸ”” Socket events emitted:
   - complaintUpdated to user:67892fd1a2b3c4e5f6789def
   - complaint_status_updated to user:67892fd1a2b3c4e5f6789def
   - complaintStatusChanged (broadcast)
   Status: Resolved
```

**âœ… Worker Console:**
```
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
ðŸ“¬ Event Received: ticket.resolved
ðŸ“Œ Data: { ticketId: '...', agentId: '...', ... }
â° Timestamp: 2026-01-17T...
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

âœ… Processing ticket.resolved event
   Ticket ID: COMP-12345
   Agent ID: 692f1f4d36d5cbf8b64c045b
ðŸ‘¤ Processing for agent: Gourav Kumar Pandey (gouravkumarpandey292@gmail.com)
ðŸ“Š Agent Gourav Kumar Pandey has 0 active tickets remaining
âœ… Agent Gourav Kumar Pandey marked as AVAILABLE
ðŸŽ¯ Found unassigned ticket: COMP-12346
   Title: Next Issue
   Priority: Medium
   Created: 2026-01-17T...
âœ… Ticket COMP-12346 assigned to Gourav Kumar Pandey
ðŸ“Œ Agent Gourav Kumar Pandey marked as BUSY again
ðŸ”” Notification sent to agent Gourav Kumar Pandey

âœ… AUTO-ASSIGNMENT COMPLETE
   Previous Ticket: COMP-12345 (Resolved)
   New Ticket: COMP-12346 (Assigned)
   Agent: Gourav Kumar Pandey (gouravkumarpandey292@gmail.com)
   Status: Agent marked BUSY

ðŸ—‘ï¸  Message deleted from queue
```

**âœ… User Dashboard (original complaint creator):**
- Complaint status changes to **"Resolved"** âœ…
- Green badge shows "Resolved"
- Browser notification: "Complaint Resolved! ðŸŽ‰"
- Complaint moves to "Resolved" tab automatically

**âœ… Agent Dashboard:**
- Old ticket disappears from "Active" list
- New ticket appears immediately
- Notification: "New Ticket Auto-Assigned"
- Agent status shows "BUSY"

---

## âœ… Test Scenario 2: No Unassigned Tickets Available

### Steps:
1. Make sure there are **NO open unassigned tickets** in the system
2. Agent resolves their last active ticket
3. Observe the behavior

### Expected Results:

**âœ… Worker Console:**
```
âœ… Processing ticket.resolved event
   Ticket ID: COMP-12345
   Agent ID: 692f1f4d36d5cbf8b64c045b
ðŸ‘¤ Processing for agent: Gourav Kumar Pandey
ðŸ“Š Agent Gourav Kumar Pandey has 0 active tickets remaining
âœ… Agent Gourav Kumar Pandey marked as AVAILABLE
â„¹ï¸  No unassigned tickets available for auto-assignment
   Agent Gourav Kumar Pandey remains AVAILABLE for manual assignment
```

**âœ… Agent Dashboard:**
- Agent status changes to **"AVAILABLE"** âœ…
- No active tickets shown
- Ready to receive new assignments

---

## âœ… Test Scenario 3: Agent Has Multiple Active Tickets

### Steps:
1. Assign **2+ tickets** to the same agent
2. Agent resolves **one ticket**
3. Observe the behavior

### Expected Results:

**âœ… Worker Console:**
```
âœ… Processing ticket.resolved event
   Ticket ID: COMP-12345
   Agent ID: 692f1f4d36d5cbf8b64c045b
ðŸ‘¤ Processing for agent: Gourav Kumar Pandey
ðŸ“Š Agent Gourav Kumar Pandey has 1 active tickets remaining
ðŸ“Œ Agent Gourav Kumar Pandey still has 1 active tickets
   Agent status remains BUSY - not available for auto-assignment
```

**âœ… Agent Dashboard:**
- Agent status remains **"BUSY"** âœ…
- Resolved ticket disappears
- Other active tickets still visible
- No new assignment (agent still has work to do)

---

## ðŸ› Debugging

### If User Dashboard Doesn't Update:

1. **Check Browser Console:**
   ```
   Look for: "âœ… complaintUpdated socket event received:"
   ```

2. **Check Backend Console:**
   ```
   Look for: "ðŸ”” Socket events emitted:"
   ```

3. **Verify Socket Connection:**
   - Open browser DevTools â†’ Network â†’ WS tab
   - Should see active WebSocket connection
   - Check for "connection_success" message

### If Agent Doesn't Get Freed:

1. **Check Backend Console:**
   ```
   Look for: "ðŸ”„ Refreshed agent availability after complaint marked as Resolved"
   ```

2. **Check Database:**
   ```javascript
   // MongoDB query
   db.users.findOne({_id: ObjectId("agent_id")})
   // Check: availability field should be "available" or "busy"
   ```

3. **Check Worker Console:**
   ```
   Worker should receive "ticket.resolved" event within 1-10 seconds
   ```

### If Auto-Assignment Fails:

1. **Verify Unassigned Tickets Exist:**
   ```javascript
   // MongoDB query
   db.complaints.find({
     assignedTo: null,
     status: "Open"
   })
   ```

2. **Check Worker Database Connection:**
   ```
   Worker should show: "âœ… MongoDB connected for worker"
   ```

3. **Verify Agent ObjectId:**
   ```
   Event data should contain valid MongoDB ObjectId for agentId
   ```

---

## ðŸ“ Summary of Fixes

### What Was Fixed:

1. âœ… **Socket Event Emission** - Now emits to correct room (`user:${userId}`)
2. âœ… **Multiple Event Names** - Listens for both `complaintUpdated` and `complaint_status_updated`
3. âœ… **Complete Complaint Data** - Socket events include full complaint object
4. âœ… **User Room Joining** - Backend joins `user:${userId}` room on connection
5. âœ… **Dashboard Auto-Refresh** - Immediately refreshes on status change
6. âœ… **Browser Notifications** - Shows notification when complaint is resolved
7. âœ… **Agent Availability** - Properly marks agent as free/busy
8. âœ… **Auto-Assignment** - Worker assigns next ticket to newly-free agent
9. âœ… **Event Logging** - Better console logs for debugging

### Files Modified:

- `backend/src/routes/complaints.js` - Socket emission & data population
- `backend/src/socket/handlers/connectionHandler.js` - Room joining
- `frontend/src/contexts/SocketContext.tsx` - Event listeners
- `frontend/src/components/dashboard/UserDashboard.tsx` - Event handling
- `backend/worker/sqsWorker.js` - Enhanced business logic

---

## ðŸŽ¯ Success Criteria

âœ… User dashboard shows "Resolved" status immediately  
âœ… Agent gets marked as FREE when no active tickets remain  
âœ… Agent automatically receives next ticket if available  
âœ… Browser notification appears for resolved complaints  
âœ… No manual refresh needed for status updates  
âœ… Socket events logged in console for debugging  
âœ… Worker processes events within 1-10 seconds  

**Your system is now fully event-driven with real-time updates!** ðŸš€
