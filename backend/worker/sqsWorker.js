import 'dotenv/config';
import mongoose from 'mongoose';
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { Complaint } from '../src/models/Complaint.js';
import { refreshAgentAvailability } from '../src/services/agentService.js';
import { autoAssignToFreeAgent } from '../src/services/ticketAssignmentService.js';
await mongoose.connect(process.env.MONGODB_URI || process.env.DATABASE_URL);
const client = new SQSClient({ region: process.env.AWS_REGION });
const QueueUrl = process.env.SQS_QUEUE_URL;
if (!QueueUrl) throw new Error('SQS_QUEUE_URL is required');
let running = true;
process.on('SIGTERM', () => { running = false; });
process.on('SIGINT', () => { running = false; });
while (running) {
  try {
    const { Messages = [] } = await client.send(new ReceiveMessageCommand({ QueueUrl, MaxNumberOfMessages: 1, WaitTimeSeconds: 20, VisibilityTimeout: 120 }));
    for (const message of Messages) {
      try {
        const envelope = JSON.parse(message.Body);
        const event = envelope.Message ? JSON.parse(envelope.Message) : envelope;
        const type = event.eventType || event.type;
        const data = event.data || {};
        if (type === 'ticket.created') await autoAssignToFreeAgent(data.ticketId);
        if (type === 'ticket.resolved' && data.agentId) {
          const agent = await refreshAgentAvailability(data.agentId);
          if (agent.availability === 'available') {
            const next = await Complaint.findOne({ assignedTo: null, status: 'Open' }).sort({ createdAt: 1 });
            if (next) await autoAssignToFreeAgent(next._id);
          }
        }
        await client.send(new DeleteMessageCommand({ QueueUrl, ReceiptHandle: message.ReceiptHandle }));
      } catch (error) { console.error('Event failed; retained for retry:', error.message); }
    }
  } catch (error) { console.error('Queue receive failed:', error.message); await new Promise(resolve => setTimeout(resolve, 1000)); }
}
await mongoose.disconnect();
