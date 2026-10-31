import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import express from 'express';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { User, AdminUser, AgentUser, AnalyticsUser } from '../../src/models/User.js';
import { Complaint } from '../../src/models/Complaint.js';
import { Notification } from '../../src/models/Notification.js';
import { mutateAccounts } from '../../src/services/accountService.js';
import { fulfillPayment, processCheckout, processRefund } from '../../src/services/paymentService.js';
import { autoAssignToFreeAgent } from '../../src/services/ticketAssignmentService.js';
import usersRoutes from '../../src/routes/users.js';
import adminRoutes from '../../src/routes/admin.js';
import complaintRoutes from '../../src/routes/complaints.js';
import notificationRoutes from '../../src/routes/notifications.js';

const PASSWORD='Test-Password-123!';
process.env.JWT_SECRET='integration-test-secret-more-than-thirty-two-characters';
process.env.STRIPE_SECRET_KEY='sk_test_local_fixture_not_a_real_key';
process.env.STRIPE_WEBHOOK_SECRET='whsec_local_fixture';
const { default: paymentRoutes } = await import('../../src/routes/payments.js');
const { webhookHandler } = await import('../../src/controllers/paymentController.js');
const { stripe } = await import('../../src/services/stripeClient.js');
let mongo,server,base,admin,agent,other,customer,events;
const create=(Model,name,role)=>Model.create({name,email:`${name.toLowerCase()}@example.com`,password:PASSWORD,role,isVerified:true});
const auth=user=>jwt.sign({id:String(user._id),tokenType:'access',issuedAt:Date.now()+1},process.env.JWT_SECRET);
const request=(user,path,method='GET',body,token)=>fetch(base+path,{method,headers:{Authorization:`Bearer ${token||auth(user)}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
const session=(user,plan='Pro',id='cs_checkout',ageDays=0)=>({id,payment_intent:`pi_${id}`,payment_status:'paid',client_reference_id:String(user._id),metadata:{planType:plan},currency:'inr',amount_total:plan==='Premium'?99900:49900,created:Math.floor((Date.now()-ageDays*86400000)/1000)});
before(async()=>{
  mongo=await MongoMemoryReplSet.create({binary:{version:'7.0.14'},replSet:{count:1,args:['--nounixsocket','--setParameter','diagnosticDataCollectionEnabled=false']}});
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map(Model=>Model.init()));
  const app=express();app.post('/payments/webhook',express.raw({type:'application/json'}),webhookHandler);app.use(express.json());app.use((req,res,next)=>{req.cookies={};next();});
  const io={to(room){const rooms=[room];return{to(next){rooms.push(next);return this;},emit(event,payload){events.push({rooms,event,payload});}};},in(room){return{disconnectSockets(){events.push({disconnect:room});}};}};
  app.set('io',io);app.use('/users',usersRoutes);app.use('/admin',adminRoutes);app.use('/complaints',complaintRoutes);app.use('/notifications',notificationRoutes);app.use('/payments',paymentRoutes);
  app.use((error,req,res,next)=>res.status(error.statusCode || 500).json({error:error.message}));
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;
});
beforeEach(async()=>{
  for(const Model of Object.values(mongoose.models))await Model.deleteMany({});events=[];
  [admin,agent,other,customer]=await Promise.all([create(AdminUser,'Administrator','admin'),create(AgentUser,'Assigned','agent'),create(AgentUser,'Other','agent'),create(User,'Customer','user')]);
});
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();if(mongo)await mongo.stop();});

test('decoded parameter authorization protects every complaint operation',async()=>{
  const complaint=await Complaint.create({user:customer._id,assignedTo:agent._id,title:'Private complaint',description:'Private details',category:'Billing'});
  const encoded='%'+String(complaint._id).charCodeAt(0).toString(16)+String(complaint._id).slice(1);
  for(const id of [String(complaint._id),encoded])for(const [path,method,body]of [['','GET'],['/updates','POST',{message:'Unauthorized comment'}],['/internal-notes','GET'],['/escalate','PATCH',{reason:'Unauthorized'}],['/generate-summary','POST',{}]]){
    assert.equal((await request(other,`/complaints/${id}${path}`,method,body)).status,403,`${method} ${path}`);
  }
  assert.equal((await request(customer,`/complaints/${encoded}`)).status,200);
});
test('internal comments persist but never reach customer sockets or responses',async()=>{
  const complaint=await Complaint.create({user:customer._id,assignedTo:agent._id,title:'Ticket',description:'Description',category:'Billing'});
  assert.equal((await request(agent,`/complaints/${complaint._id}/updates`,'POST',{message:'Staff only',isInternal:true})).status,200);
  assert.equal(events.some(item=>item.rooms?.includes(`user:${customer._id}`)),false);
  assert.equal(events.some(item=>item.rooms?.includes('admin')),true);
  const result=await request(customer,`/complaints/${complaint._id}`);const body=await result.json();assert.equal(body.updates.length,0);
  assert.equal((await Complaint.findById(complaint._id)).updates.length,1);
});
test('admin lists and account lookup include every role collection',async()=>{
  for(const path of ['/users','/users/all','/admin/users']){
    const result=await request(admin,path);assert.equal(result.status,200);const body=await result.json();assert.equal(body.pagination.total,4);assert.equal(body.users.length,4);assert.ok(body.users.every(user=>!user.password && !user.tokensValidAfter));
  }
  assert.equal((await request(admin,`/users/${agent._id}`)).status,200);
  const stats=await (await request(admin,'/admin/stats')).json();assert.equal(stats.agentsCount,2);assert.equal(stats.adminsCount,1);
});
test('deactivation works for staff, revokes sessions and requeues active tickets',async()=>{
  const complaint=await Complaint.create({user:customer._id,assignedTo:agent._id,status:'In Progress',title:'Ticket',description:'Description',category:'Billing'});
  const oldToken=auth(agent);
  const result=await request(admin,`/users/${agent._id}`,'DELETE');assert.equal(result.status,200,JSON.stringify(await result.json()));
  assert.equal((await AgentUser.findById(agent._id)).isActive,false);
  const changed=await Complaint.findById(complaint._id);assert.equal(changed.assignedTo,null);assert.equal(changed.status,'Open');
  assert.equal((await request(agent,'/users/profile','GET',undefined,oldToken)).status,401);
});
test('role changes migrate the account atomically without rehashing the password',async()=>{
  const oldHash=agent.password,oldToken=auth(agent);
  const result=await request(admin,`/users/${agent._id}/role`,'PATCH',{role:'analytics'});assert.equal(result.status,200,JSON.stringify(await result.json()));
  assert.equal(await AgentUser.findById(agent._id),null);
  const migrated=await AnalyticsUser.findById(agent._id);assert.equal(migrated.password,oldHash);assert.equal(await migrated.matchPassword(PASSWORD),true);
  assert.equal((await request(agent,'/users/profile','GET',undefined,oldToken)).status,401);
});
test('all admin mutation paths protect the last administrator and whitelist fields',async()=>{
  for(const [path,body]of [[`/users/${admin._id}`,{isActive:false}],[`/users/${admin._id}/role`,{role:'user'}],['/admin/users/bulk',{userIds:[String(admin._id)],updates:{isActive:false}}],['/users/bulk/activate',{userIds:[String(admin._id)],isActive:false}]]){
    const result=await request(admin,path,'PATCH',body);assert.equal(result.status,409,JSON.stringify(await result.json()));
  }
  assert.equal((await request(admin,'/admin/users/bulk','PATCH',{userIds:[String(agent._id)],updates:{password:'plaintext'}})).status,400);
  assert.equal((await AdminUser.findById(admin._id)).isActive,true);
});
test('concurrent administrator removal cannot deactivate both admins',async()=>{
  const second=await create(AdminUser,'Second','admin');
  const results=await Promise.allSettled([mutateAccounts([String(admin._id)],{isActive:false},second._id),mutateAccounts([String(second._id)],{isActive:false},admin._id)]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(await AdminUser.countDocuments({isActive:{$ne:false}}),1);
});
test('notification preferences persist through HTTP, merge patches and reject invalid data',async()=>{
  assert.equal((await request(customer,'/notifications/preferences','PATCH',{email:{newComments:false}})).status,200);
  assert.equal((await request(customer,'/notifications/preferences','PATCH',{sms:{complaintAssigned:true}})).status,200);
  const saved=await (await request(customer,'/notifications/preferences')).json();assert.equal(saved.email.newComments,false);assert.equal(saved.email.complaintResolved,true);assert.equal(saved.sms.complaintAssigned,true);
  assert.equal((await request(customer,'/notifications/preferences','PATCH',{email:{newComments:'false'}})).status,400);
});
test('concurrent checkout replay creates one payment and preserves the original expiry',async()=>{
  const paid=session(customer);
  await Promise.all(Array.from({length:8},()=>fulfillPayment(paid)));
  const saved=await User.findById(customer._id);assert.equal(saved.paymentHistory.length,1);assert.equal(saved.planType,'Pro');assert.equal(saved.planExpiresAt.getTime(),paid.created*1000+30*86400000);
});
test('full refund revokes access, stale checkout replay cannot restore it, partial refunds retain access',async()=>{
  const paid=session(customer);
  await fulfillPayment(paid);await fulfillPayment(paid,10000);
  let saved=await User.findById(customer._id);assert.equal(saved.planType,'Pro');assert.equal(saved.paymentHistory[0].status,'partially_refunded');
  await Promise.all([fulfillPayment(paid,49900),fulfillPayment(paid,0),fulfillPayment(paid,10000)]);
  saved=await User.findById(customer._id);assert.equal(saved.planType,'Free');assert.equal(saved.paymentHistory[0].status,'refunded');assert.equal(saved.paymentHistory[0].refundedAmount,499);
});
test('refunds preserve unrelated paid entitlement and old checkout replay cannot downgrade Premium',async()=>{
  const pro=session(customer,'Pro','cs_pro',2),premium=session(customer,'Premium','cs_premium');
  await fulfillPayment(pro);await fulfillPayment(premium);await fulfillPayment(pro);
  assert.equal((await User.findById(customer._id)).planType,'Premium');
  await fulfillPayment(pro,49900);assert.equal((await User.findById(customer._id)).planType,'Premium');
  await fulfillPayment(premium,99900);assert.equal((await User.findById(customer._id)).planType,'Free');
});
test('refund-before-checkout delivery uses current provider state and never grants paid access',async()=>{
  const paid=session(customer),charge={payment_intent:paid.payment_intent,amount:49900,currency:'inr',amount_refunded:49900,paid:true};
  const stripe={checkout:{sessions:{list:async()=>({data:[paid]})}},paymentIntents:{retrieve:async()=>({status:'succeeded',currency:'inr',amount_received:49900,latest_charge:charge})}};
  await processRefund(stripe,charge);await processCheckout(stripe,paid);
  const saved=await User.findById(customer._id);assert.equal(saved.planType,'Free');assert.equal(saved.paymentHistory.length,1);assert.equal(saved.paymentHistory[0].status,'refunded');
});
test('automatic assignment handles simultaneous tickets against real MongoDB',async()=>{
  await AgentUser.updateOne({_id:other._id},{$set:{availability:'offline'}});
  const tickets=await Complaint.create([{user:customer._id,title:'Ticket one',description:'Description',category:'Billing'},{user:customer._id,title:'Ticket two',description:'Description',category:'Billing'}]);
  await Promise.all(tickets.map(ticket=>autoAssignToFreeAgent(ticket._id)));
  assert.equal(await Complaint.countDocuments({assignedTo:agent._id}),1);assert.equal((await AgentUser.findById(agent._id)).availability,'busy');
  assert.equal((await AgentUser.findById(other._id)).availability,'offline');
});

test('signed Stripe webhook updates refunds and rejects invalid signatures',async()=>{
  const paid=session(customer),charge={id:'ch_fixture',payment_intent:paid.payment_intent,amount:49900,currency:'inr',amount_refunded:49900,paid:true};
  await fulfillPayment(paid);
  const oldList=stripe.checkout.sessions.list,oldIntent=stripe.paymentIntents.retrieve;
  stripe.checkout.sessions.list=async()=>({data:[paid]});
  stripe.paymentIntents.retrieve=async()=>({status:'succeeded',currency:'inr',amount_received:49900,latest_charge:charge});
  const payload=JSON.stringify({id:'evt_refund',type:'charge.refunded',data:{object:charge}});
  const signature=stripe.webhooks.generateTestHeaderString({payload,secret:process.env.STRIPE_WEBHOOK_SECRET});
  try{
    let result=await fetch(base+'/payments/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':'invalid'},body:payload});assert.equal(result.status,400);
    for(let attempt=0;attempt<2;attempt++){
      result=await fetch(base+'/payments/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':signature},body:payload});assert.equal(result.status,200,await result.text());
    }
    const saved=await User.findById(customer._id);assert.equal(saved.planType,'Free');assert.equal(saved.paymentHistory.length,1);assert.equal(saved.paymentHistory[0].status,'refunded');
  }finally{stripe.checkout.sessions.list=oldList;stripe.paymentIntents.retrieve=oldIntent;}
});
test('refund API requires idempotency, validates amounts and uses provider refund state',async()=>{
  const paid=session(customer);await fulfillPayment(paid);
  const charge={id:'ch_fixture',payment_intent:paid.payment_intent,amount:49900,currency:'inr',amount_refunded:49900,paid:true};
  const oldList=stripe.checkout.sessions.list,oldIntent=stripe.paymentIntents.retrieve,oldRefund=stripe.refunds.create;
  let usedKey,refundCalls=0;
  stripe.checkout.sessions.list=async()=>({data:[paid]});stripe.paymentIntents.retrieve=async()=>({status:'succeeded',currency:'inr',amount_received:49900,latest_charge:charge});
  stripe.refunds.create=async(params,options)=>{usedKey=options.idempotencyKey;refundCalls++;return{id:'re_fixture',amount:49900,status:'succeeded',created:Math.floor(Date.now()/1000)};};
  try{
    assert.equal((await request(admin,'/payments/refund','POST',{paymentIntentId:paid.payment_intent})).status,400);
    assert.equal((await request(admin,'/payments/refund','POST',{paymentIntentId:paid.payment_intent,amount:-1})).status,400);
    const result=await fetch(base+'/payments/refund',{method:'POST',headers:{Authorization:`Bearer ${auth(admin)}`,'Content-Type':'application/json','Idempotency-Key':'refund-operation-123'},body:JSON.stringify({paymentIntentId:paid.payment_intent})});
    assert.equal(result.status,200,await result.text());assert.equal(refundCalls,1);assert.ok(usedKey.endsWith('refund-operation-123'));assert.equal((await User.findById(customer._id)).planType,'Free');
  }finally{stripe.checkout.sessions.list=oldList;stripe.paymentIntents.retrieve=oldIntent;stripe.refunds.create=oldRefund;}
});
test('bulk complaint routes are reachable by admins and reject agent requests',async()=>{
  const complaint=await Complaint.create({user:customer._id,title:'Bulk test',description:'Description',category:'Billing'});
  let result=await request(admin,'/complaints/bulk/assign','PATCH',{complaintIds:[String(complaint._id)],assignedTo:String(agent._id)});
  assert.equal(result.status,200,await result.text());assert.equal(String((await Complaint.findById(complaint._id)).assignedTo),String(agent._id));
  result=await request(agent,'/complaints/bulk/status','PATCH',{complaintIds:[String(complaint._id)],status:'Resolved'});assert.equal(result.status,403);
  result=await request(admin,'/complaints/bulk/status','PATCH',{complaintIds:[String(complaint._id)],status:'Resolved'});assert.equal(result.status,200,await result.text());
  const saved=await Complaint.findById(complaint._id);assert.equal(saved.status,'Resolved');assert.equal(saved.updates.length,2);assert.ok(saved.resolution.resolvedAt);assert.equal((await AgentUser.findById(agent._id)).availability,'available');
});
test('resolved complaint feedback is validated and actually persisted',async()=>{
  const complaint=await Complaint.create({user:customer._id,assignedTo:agent._id,status:'Resolved',title:'Feedback test',description:'Description',category:'Billing'});
  assert.equal((await request(customer,`/complaints/${complaint._id}/feedback`,'POST',{rating:3.5})).status,400);
  assert.equal((await request(other,`/complaints/${complaint._id}/feedback`,'POST',{rating:5})).status,403);
  const result=await request(customer,`/complaints/${complaint._id}/feedback`,'POST',{rating:5,comment:'Helpful support'});assert.equal(result.status,200,await result.text());
  const saved=await Complaint.findById(complaint._id);assert.equal(saved.customerSatisfaction.rating,5);assert.equal(saved.resolution.feedback,'Helpful support');
});
test('analytics exports reject operator injection and exclude private complaint content',async()=>{
  const { default: analyticsRoutes }=await import('../../src/routes/analytics.js');
  const app=express();app.use(express.json());app.use((req,res,next)=>{req.cookies={};next();});app.use('/analytics',analyticsRoutes);
  const extra=app.listen(0,'127.0.0.1');await new Promise(resolve=>extra.once('listening',resolve));
  const analyst=await create(AnalyticsUser,'Analyst','analytics');
  await Complaint.create({user:customer._id,title:'Sensitive title',description:'Private customer details',category:'Billing',updates:[{message:'Internal secret',isInternal:true,updatedBy:admin._id}]});
  const call=body=>fetch(`http://127.0.0.1:${extra.address().port}/analytics/export-report`,{method:'POST',headers:{Authorization:`Bearer ${auth(analyst)}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  try{
    assert.equal((await call({reportType:'complaints',filters:{$where:'malicious'}})).status,400);
    const result=await call({reportType:'complaints'});assert.equal(result.status,200);const body=await result.json();assert.equal(body.length,1);assert.equal(body[0].description,undefined);assert.equal(body[0].updates,undefined);assert.equal(body[0].user,undefined);
    const csv=await call({reportType:'complaints',format:'csv'});assert.equal(csv.status,200);assert.ok((await csv.text()).startsWith('"complaintId","category"'));
  }finally{await new Promise(resolve=>extra.close(resolve));}
});
