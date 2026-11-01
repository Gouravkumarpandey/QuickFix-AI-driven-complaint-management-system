import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import express from 'express';
import { User, AgentUser, AdminUser, AnalyticsUser } from '../src/models/User.js';
import { Complaint } from '../src/models/Complaint.js';
import { verifyToken, sessionAllowed } from '../src/services/tokenService.js';
import { canAccessComplaint, publicComplaint } from '../src/middleware/complaintAccess.js';
import { validatePaidSession } from '../src/services/paymentService.js';
import { toCSV } from '../src/utils/csv.js';
import authRoutes from '../src/routes/auth.js';
import complaintRoutes from '../src/routes/complaints.js';
import { initChatHandler } from '../src/socket/handlers/chatHandler.js';
process.env.JWT_SECRET = 'test-secret-with-more-than-thirty-two-characters';
const owner = '111111111111111111111111';
const agent = '222222222222222222222222';
const other = '333333333333333333333333';
const ticket = '444444444444444444444444';
const token = id => jwt.sign({ id, tokenType: 'access', issuedAt: Date.now() }, process.env.JWT_SECRET);
const paid = () => ({ id: 'cs_paid', payment_status: 'paid', metadata: { planType: 'Pro' }, amount_total: 49900, currency: 'inr', client_reference_id: owner, payment_intent: 'pi_test', created: Math.floor(Date.now()/1000) });

test('refresh tokens and legacy tokens cannot authorize API requests', () => {
  assert.throws(() => verifyToken(jwt.sign({ id: owner, tokenType: 'refresh' }, process.env.JWT_SECRET)));
  assert.throws(() => verifyToken(jwt.sign({ id: owner }, process.env.JWT_SECRET)));
});
test('JWT configuration fails closed', () => {
  const secret = process.env.JWT_SECRET; delete process.env.JWT_SECRET;
  assert.throws(() => verifyToken('anything'), /JWT_SECRET/); process.env.JWT_SECRET = secret;
});
test('logout invalidates older sessions and disabled accounts', () => {
  assert.equal(sessionAllowed({ tokensValidAfter: 100 }, { issuedAt: 99 }), false);
  assert.equal(sessionAllowed({ isActive: false }, { issuedAt: 101 }), false);
  assert.equal(sessionAllowed({ tokensValidAfter: 100 }, { issuedAt: 101 }), true);
});
test('ticket access handles populated owner IDs and enforces agent assignment', () => {
  const complaint = { user: { _id: owner }, assignedTo: agent };
  assert.equal(canAccessComplaint({ role: 'user', _id: owner }, complaint), true);
  assert.equal(canAccessComplaint({ role: 'user', _id: other }, complaint), false);
  assert.equal(canAccessComplaint({ role: 'agent', _id: other }, complaint), false);
  assert.equal(canAccessComplaint({ role: 'agent', _id: agent }, complaint), true);
});
test('customer responses strip nested internal notes without mutating original', () => {
  const source = { complaints: [{ updates: [{ message: 'public' }, { message: 'secret', isInternal: true }] }] };
  assert.equal(publicComplaint(source).complaints[0].updates.length, 1);
  assert.equal(source.complaints[0].updates.length, 2);
});
test('CSV escapes quotes, newlines and spreadsheet formulas', () => {
  assert.equal(toCSV([{ name: '=1+1', note: 'a,"b"\nc' }], ['name','note']), '"name","note"\r\n"\'=1+1","a,""b""\nc"');
});
test('payment fulfilment rejects unpaid, wrong-price, and wrong-currency sessions', () => {
  for (const change of [{ payment_status:'unpaid' }, {amount_total:1}, {currency:'usd'}, {metadata:{planType:'Admin'}}]) assert.throws(() => validatePaidSession({ ...paid(), ...change }));
});
test('user serialization does not disclose credentials or reset secrets', () => {
  const object = new User({ name:'Customer', email:'a@example.com', password:'secret', otp:'123', resetPasswordToken:'secret' }).toJSON();
  assert.equal(object.password, undefined); assert.equal(object.otp, undefined); assert.equal(object.resetPasswordToken, undefined);
});

test('HTTP security boundaries and saved-comment regression', async t => {
  const models = [User, AgentUser, AdminUser, AnalyticsUser];
  const originals = models.map(Model => Model.findById);
  const oldComplaint = Complaint.findById;
  const oldFind = Complaint.find;
  let saved = 0;
  const doc = new Complaint({ _id:ticket, user:owner, assignedTo:agent, title:'A test', description:'Description', category:'Billing' });
  doc.save = async () => { saved++; return doc; };
  Complaint.findById = () => ({ populate(){return this;}, then(resolve,reject){return Promise.resolve(doc).then(resolve,reject);} });
  models.forEach((Model,index) => { Model.findById = id => Promise.resolve(index === 0 && [owner,agent,other].includes(String(id)) ? { _id:id, role:id === owner ? 'user':'agent', name:'Tester', isActive:true, save:async()=>{} } : null); });
  const app = express(); app.use(express.json()); app.use((req,res,next)=>{ req.cookies={};next(); });
  const io = { to(){return this;},emit(){},in(){return this;},disconnectSockets(){} }; app.set('io',io);
  app.use('/auth',authRoutes); app.use('/complaints',complaintRoutes);
  app.use((err,req,res,next)=>res.status(500).json({error:err.message}));
  const server=app.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const call=(path,method='GET',body,id=agent)=>fetch(base+path,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token(id)}`},...(body?{body:JSON.stringify(body)}:{})});
  try {
    await t.test('public signup rejects staff roles before creating accounts', async()=>{
      for (const path of ['/auth/signup','/auth/google-signup','/auth/facebook-signup']) assert.equal((await call(path,'POST',{name:'Attacker',email:'a@example.com',password:'test-password',role:'admin'})).status,403);
    });
    await t.test('unassigned agent cannot read or comment on another ticket',async()=>{
      assert.equal((await call(`/complaints/${ticket}`,'GET',null,other)).status,403);
      assert.equal((await call(`/complaints/${ticket}/updates`,'POST',{message:'Injected'},other)).status,403);
    });
    await t.test('encoded ticket IDs and malformed IDs cannot bypass ownership',async()=>{
      for (const id of ['%34444444444444444444444', '%34%3444444444444444444444', '%253444444444444444444444']) {
        const result = await call(`/complaints/${id}`,'GET',null,other);
        assert.ok([400,403].includes(result.status), `Unexpected status ${result.status}`);
      }
    });
    await t.test('agent cannot bulk-edit or reassign tickets',async()=>{
      assert.equal((await call('/complaints/bulk/status','PATCH',{complaintIds:[ticket],status:'Resolved'})).status,403);
      assert.equal((await call(`/complaints/${ticket}/assign`,'PATCH',{agentId:other})).status,403);
    });
    await t.test('customer comment succeeds after save and excludes internal comments',async()=>{
      let result=await call(`/complaints/${ticket}/updates`,'POST',{message:'Customer reply'},owner); assert.equal(result.status,200); assert.equal(saved,1);
      result=await call(`/complaints/${ticket}/updates`,'POST',{message:'hidden',isInternal:true},owner);assert.equal(result.status,403);assert.equal(saved,1);
    });
    await t.test('invalid status and unbounded pagination are rejected',async()=>{
      assert.equal((await call(`/complaints/${ticket}/status`,'PATCH',{status:'Anything'})).status,400);
      assert.equal((await call('/complaints?limit=100000')).status,400);
    });
    await t.test('agent filter cannot be overridden through assignedTo',async()=>{
      let captured; Complaint.find=filter=>{captured=filter; return {populate(){return this;},sort(){return this;},skip(){return this;},limit:async()=>[]};};
      const oldCount=Complaint.countDocuments; Complaint.countDocuments=async()=>0;
      try { assert.equal((await call(`/complaints?assignedTo=${other}`)).status,200);assert.equal(captured.assignedTo,agent); } finally { Complaint.countDocuments=oldCount; }
    });
  } finally { await new Promise(resolve=>server.close(resolve)); models.forEach((Model,index)=>Model.findById=originals[index]);Complaint.findById=oldComplaint;Complaint.find=oldFind; }
});
test('customer chat uses schema-compatible ownership and message fields',async()=>{
  const old=Complaint.findById;
  const complaint=new Complaint({_id:ticket,user:owner,assignedTo:agent,title:'Test',description:'Test',category:'Billing'});
  complaint.save=async()=>{await complaint.validate();return complaint;};Complaint.findById=async()=>complaint;
  const handlers={};const events=[];const deliveryRooms=[];
  const io={on(_event,callback){callback({user:{_id:owner,name:'Customer',role:'user'},on(event,handler){handlers[event]=handler;},join(room){events.push(room);},emit(event,payload){events.push({event,payload});}});},to(room){deliveryRooms.push(room);return this;},emit(){}};
  // Avoid notification writes in this focused chat persistence test.
  complaint.assignedTo=null;
  try {initChatHandler(io);await handlers.join_chat({complaintId:ticket});await handlers.send_message({complaintId:ticket,message:'Hello support'});assert.equal(complaint.messages[0].text,'Hello support');assert.ok(events.includes(`chat:${ticket}`));assert.equal(events.some(x=>x.event==='error'),false);assert.equal(deliveryRooms.some(room=>room.startsWith('chat:')),false);assert.ok(deliveryRooms.includes(`user:${owner}`));}
  finally{Complaint.findById=old;}
});

test('settings validate input and persist for later reads', async()=>{
  const { SystemSettings } = await import('../src/models/SystemSettings.js');
  const { saveSettings, getSettings } = await import('../src/services/settingsService.js');
  const oldRead=SystemSettings.findById,oldWrite=SystemSettings.findOneAndUpdate;
  let value={};
  SystemSettings.findOneAndUpdate=async(filter,update)=>{assert.equal(filter._id,'global');for(const [key,entry]of Object.entries(update.$set))value[key.slice(6)]=entry;return{value};};
  SystemSettings.findById=()=>({lean:async()=>({value})});
  try {
    await assert.rejects(saveSettings({slaTargets:{High:-1}}));
    await assert.rejects(saveSettings({unknown:true}));
    await saveSettings({autoAssignment:{enabled:false},slaTargets:{High:12}});
    assert.deepEqual(await getSettings(),{autoAssignment:{enabled:false},slaTargets:{High:12}});
  } finally{SystemSettings.findById=oldRead;SystemSettings.findOneAndUpdate=oldWrite;}
});
test('automatic assignment claims an agent once under concurrent ticket creation',async()=>{
  const { SystemSettings }=await import('../src/models/SystemSettings.js');
  const { autoAssignToFreeAgent }=await import('../src/services/ticketAssignmentService.js');
  const { Notification }=await import('../src/models/Notification.js');
  const old={settings:SystemSettings.findById,find:AgentUser.find,claim:AgentUser.findOneAndUpdate,ticket:Complaint.findById,count:Complaint.countDocuments,update:Complaint.findOneAndUpdate,save:Notification.prototype.save};
  let busy=false,assigned=0;
  SystemSettings.findById=()=>({lean:async()=>null});
  AgentUser.find=()=>({lean:async()=>[{_id:agent,name:'Agent',email:'agent@example.com'}]});
  AgentUser.findOneAndUpdate=async()=>{if(busy)return null;busy=true;return{_id:agent,name:'Agent'};};
  Complaint.findById=async id=>({_id:id,assignedTo:null,status:'Open'});
  Complaint.countDocuments=async()=>0;
  Complaint.findOneAndUpdate=async(filter,update)=>{assert.equal(filter.assignedTo,null);assert.equal(filter.status,'Open');assigned++;return{_id:filter._id,complaintId:'COMP-1',...update.$set};};
  Notification.prototype.save=async function(){return this;};
  try{await Promise.all([autoAssignToFreeAgent(ticket),autoAssignToFreeAgent(other)]);assert.equal(assigned,1);}
  finally{SystemSettings.findById=old.settings;AgentUser.find=old.find;AgentUser.findOneAndUpdate=old.claim;Complaint.findById=old.ticket;Complaint.countDocuments=old.count;Complaint.findOneAndUpdate=old.update;Notification.prototype.save=old.save;}
});
