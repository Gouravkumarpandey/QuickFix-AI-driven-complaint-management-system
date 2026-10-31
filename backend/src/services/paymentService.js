import { findUserById } from '../models/User.js';
export function validatePaidSession(session) {
  const prices = { Pro: 49900, Premium: 99900 };
  if (session.payment_status !== 'paid' || !prices[session.metadata?.planType] || session.currency !== 'inr' || session.amount_total !== prices[session.metadata.planType] || !session.client_reference_id) throw new Error('Invalid paid checkout session');
}
export async function fulfillPayment(session) {
  validatePaidSession(session);
  const { user, model } = await findUserById(session.client_reference_id);
  if (!user) throw new Error('Payment user not found');
  const payment = { orderId: session.id, paymentId: session.payment_intent, amount: session.amount_total / 100, currency: session.currency, status: 'success', planType: session.metadata.planType, createdAt: new Date() };
  const updated = await model.findOneAndUpdate({ _id: user._id, 'paymentHistory.orderId': { $ne: session.id } }, {
    $set: { planType: session.metadata.planType, planExpiresAt: new Date((session.created * 1000) + 30 * 86400000) },
    $push: { paymentHistory: payment }
  }, { new: true, runValidators: true });
  return updated || (await model.findById(user._id));
}
