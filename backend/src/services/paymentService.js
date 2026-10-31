import { findUserById } from '../models/User.js';
const DAY = 86400000;
export function validatePaidSession(session) {
  const prices = { Pro: 49900, Premium: 99900 };
  if (session.payment_status !== 'paid' || !prices[session.metadata?.planType] || session.currency !== 'inr' || session.amount_total !== prices[session.metadata.planType] || !/^[a-f0-9]{24}$/i.test(session.client_reference_id || '') || !Number.isFinite(session.created) || typeof session.id !== 'string' || typeof session.payment_intent !== 'string') throw new Error('Invalid paid checkout session');
}
const rank = path => ({ $switch: { branches: [{ case: { $eq: [path, 'Premium'] }, then: 2 }, { case: { $eq: [path, 'Pro'] }, then: 1 }], default: 0 } });
// One atomic user update merges monotonically increasing refund totals and recomputes access.
// No read-modify-save race between verification, webhook retries, refunds or old sessions.
export function paymentUpdatePipeline(session, amountRefunded = 0) {
  validatePaidSession(session);
  if (!Number.isInteger(amountRefunded) || amountRefunded < 0 || amountRefunded > session.amount_total) throw new Error('Invalid refund amount');
  const record = { orderId: session.id, paymentId: session.payment_intent, amount: session.amount_total / 100, currency: session.currency, status: amountRefunded >= session.amount_total ? 'refunded' : amountRefunded > 0 ? 'partially_refunded' : 'success', refundedAmount: amountRefunded / 100, planType: session.metadata.planType, createdAt: new Date(session.created*1000), expiresAt: new Date(session.created*1000+30*DAY) };
  const refund = { $max: [{ $ifNull: ['$$payment.refundedAmount', 0] }, record.refundedAmount] };
  return [
    { $set: { paymentHistory: { $cond: [
      { $in: [{ $literal: session.id }, { $ifNull: ['$paymentHistory.orderId', []] }] },
      { $map: { input: '$paymentHistory', as: 'payment', in: { $cond: [ { $eq: ['$$payment.orderId', { $literal: session.id }] },
        { $mergeObjects: ['$$payment', { refundedAmount: refund, status: { $cond: [{ $or: [{ $eq: ['$$payment.status','refunded'] }, { $gte: [refund, record.amount] }] }, 'refunded', { $cond: [{ $gt: [refund,0] }, 'partially_refunded','success'] }] }, expiresAt: record.expiresAt }] }, '$$payment' ] } } },
      { $concatArrays: [{ $ifNull: ['$paymentHistory', []] }, { $literal: [record] }] }
    ] } } },
    { $set: { _entitlement: { $reduce: { input: { $filter: { input: '$paymentHistory', as: 'payment', cond: { $and: [{ $in: ['$$payment.status',['success','partially_refunded']] }, { $gt: [{ $ifNull: ['$$payment.expiresAt', { $add: ['$$payment.createdAt',30*DAY] }] }, '$$NOW'] }] } } }, initialValue: { planType: 'Free', expiresAt: null }, in: { $cond: [
      { $or: [{ $gt: [rank('$$this.planType'),rank('$$value.planType')] }, { $and: [{ $eq: [rank('$$this.planType'),rank('$$value.planType')] }, { $gt: [{ $ifNull: ['$$this.expiresAt',{ $add: ['$$this.createdAt',30*DAY] }] },'$$value.expiresAt'] }] }] },
      { planType: '$$this.planType', expiresAt: { $ifNull: ['$$this.expiresAt',{ $add: ['$$this.createdAt',30*DAY] }] } }, '$$value'
    ] } } } } },
    { $set: { planType: '$_entitlement.planType', planExpiresAt: '$_entitlement.expiresAt' } },
    { $unset: '_entitlement' }
  ];
}
export async function fulfillPayment(session, amountRefunded = 0) {
  const pipeline = paymentUpdatePipeline(session, amountRefunded);
  const { user, model } = await findUserById(session.client_reference_id);
  if (!user) throw new Error('Payment user not found');
  return model.findOneAndUpdate({ _id: user._id }, pipeline, { new: true });
}
export async function processCheckout(stripe, session) {
  validatePaidSession(session);
  // Always read current provider state: webhook delivery order must not resurrect a refund.
  const intent = await stripe.paymentIntents.retrieve(session.payment_intent, { expand: ['latest_charge'] });
  const charge = intent.latest_charge;
  if (intent.status !== 'succeeded' || intent.currency !== session.currency || intent.amount_received !== session.amount_total || !charge || typeof charge !== 'object' || charge.amount !== session.amount_total || charge.currency !== session.currency || charge.payment_intent !== session.payment_intent || !charge.paid) throw new Error('Payment intent does not match checkout');
  return fulfillPayment(session, charge.amount_refunded || 0);
}
export async function processRefund(stripe, charge) {
  const paymentIntent = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
  if (!paymentIntent) throw new Error('Refund has no payment intent');
  const result = await stripe.checkout.sessions.list({ payment_intent: paymentIntent, limit: 100 });
  // Ignore unrelated charges from the same Stripe account, but process every matching checkout.
  for (const session of result.data) if (session.metadata?.planType && session.client_reference_id) await processCheckout(stripe, session);
}
