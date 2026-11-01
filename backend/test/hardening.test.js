import test from 'node:test';
import assert from 'node:assert/strict';
import { emitComplaintEvent } from '../src/services/complaintEvents.js';
import { User } from '../src/models/User.js';
import { patchNotificationPreferences, getNotificationPreferences, notificationAllowed } from '../src/services/notificationPreferences.js';
import { accountListOptions } from '../src/services/accountService.js';
import { processCheckout } from '../src/services/paymentService.js';

test('internal events are delivered exclusively to staff rooms', () => {
  const sent=[];
  const io={to(room){const rooms=[room];return{to(next){rooms.push(next);return this;},emit(event,payload){sent.push({rooms,event,payload});}};}};
  emitComplaintEvent(io,{user:'customer',assignedTo:'agent'},'comment',{update:{message:'secret',isInternal:true}},true);
  assert.deepEqual(sent.map(entry=>entry.rooms),[['admin','agent:agent']]);
  assert.equal(sent.some(entry=>entry.rooms.includes('user:customer')),false);
});
test('public events redact internal history and target only the ticket owner', () => {
  const sent=[];
  const io={to(room){const rooms=[room];return{to(next){rooms.push(next);return this;},emit(event,payload){sent.push({rooms,event,payload});}};}};
  emitComplaintEvent(io,{user:{_id:'customer'},assignedTo:{_id:'agent'}},'updated',{complaint:{updates:[{message:'private',isInternal:true},{message:'public'}]}});
  const customer=sent.find(entry=>entry.rooms.includes('user:customer'));
  assert.equal(customer.payload.complaint.updates.length,1);
  assert.equal(sent[0].payload.complaint.updates.length,2);
});
test('granular preferences survive schema serialization and partial updates', async () => {
  const user=new User({name:'Person',email:'person@example.com',password:'secret'});
  patchNotificationPreferences(user,{email:{newComments:false}});
  patchNotificationPreferences(user,{sms:{complaintAssigned:true}});
  const restored=User.hydrate(user.toObject());
  assert.equal(getNotificationPreferences(restored).email.newComments,false);
  assert.equal(getNotificationPreferences(restored).email.complaintResolved,true);
  assert.equal(getNotificationPreferences(restored).sms.complaintAssigned,true);
  restored.preferences.emailNotifications=false;
  assert.equal(notificationAllowed(restored,'email','complaintResolved'),false);
  assert.throws(()=>patchNotificationPreferences(user,{email:{newComments:'false'}}));
  assert.throws(()=>patchNotificationPreferences(user,{admin:true}));
});
test('staff searches escape regex and reject unsafe query shapes',()=>{
  const parsed=accountListOptions({search:'a.*(b)',role:'agent',limit:'20'});
  assert.equal(parsed.limit,20);
  assert.equal(parsed.filter.$or[0].name.$regex,'a\\.\\*\\(b\\)');
  assert.throws(()=>accountListOptions({limit:0}));
  assert.throws(()=>accountListOptions({sortBy:'password'}));
  assert.throws(()=>accountListOptions({role:{$ne:'user'}}));
});
test('checkout processing rejects a provider intent belonging to a different charge',async()=>{
  const session={id:'cs_test',payment_intent:'pi_test',payment_status:'paid',client_reference_id:'111111111111111111111111',created:Math.floor(Date.now()/1000),metadata:{planType:'Pro'},currency:'inr',amount_total:49900};
  const stripe={paymentIntents:{retrieve:async()=>({status:'succeeded',currency:'inr',amount_received:49900,latest_charge:{amount:49900,currency:'inr',paid:true,payment_intent:'pi_someone_else'}})}};
  await assert.rejects(processCheckout(stripe,session),/does not match/);
});
test('request logging redacts reset credentials and drops query strings',async()=>{
  const { safeRequestPath }=await import('../src/utils/requestLog.js');
  assert.equal(safeRequestPath({originalUrl:'/api/auth/verify-reset-token/sensitive-reset-token?code=secret'}),'/api/auth/verify-reset-token/[redacted]');
  assert.equal(safeRequestPath({url:'/api/auth/callback?code=sensitive-oauth-code'}),'/api/auth/callback');
});
