import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {onRequest} from '../../functions/api/[[path]].js';

const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const js=read('cloud/web/crm.js'),hub=read('cloud/web/team-hub.js'),html=read('cloud/web/index.html'),sql=read('db/team-hub.sql');
const actor={member_id:1,role:'staff',name:'Kollegin'};
const snapshot={revision:'v1',session:actor,companies:[{id:1,name:'Musterbau'}],
 deals:[{id:1,company_id:1,title:'Website',stage:'interest',disposition:'active',value:897}],
 contacts:[],projects:[],tasks:[],appointments:[],activities:[],crm_members:[{id:1,name:'Kollegin',active:1}]};
test('12 dashboard status swatches are individually colored and labels preserved',()=>{
 const palette=js.match(/const STATUS_COLORS=\{([\s\S]*?)\};/);
 assert.ok(palette,'Missing central color tokens');
 const colors=[...palette[1].matchAll(/#[0-9a-fA-F]{6}\b/g)].map(m=>m[0].toLowerCase());
 assert.equal(colors.length,12);
 assert.equal(new Set(colors).size,12,'Every status requires its own unique color');
 assert.match(js,/tone:STATUS_COLORS\.stopped/);
 assert.match(js,/tone:STATUS_COLORS\.no_interest/);
 assert.match(js,/tone:STATUS_COLORS\.completed/);
});
test('team hub UI and lead claim slots exist in pipeline and company profiles',()=>{
 assert.match(html,/id="teamHubDrawer"/);
 assert.match(html,/id="teamHubOpen"/);
 assert.match(html,/team-hub\.js\?v=1/);
 assert.match(js,/data-team-lock-slot/);
 assert.match(js,/data-team-deal/);
 assert.match(js,/data-team-hub-link/);
 assert.match(hub,/teamHubMessages/);
});
test('private team chat schema uses identity verification with forbidden public access',()=>{
 assert.match(sql,/create table if not exists kaiser_crm\.team_messages/);
 assert.match(sql,/create table if not exists kaiser_crm\.lead_claims/);
 assert.match(sql,/pages_identity\(p_uid\)/);
 assert.match(sql,/revoke all on kaiser_crm\.team_messages from public, anon, authenticated/);
 assert.match(sql,/revoke all on kaiser_crm\.lead_claims from public, anon, authenticated/);
 assert.match(sql,/20 minutes/);
});
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'pub',SUPABASE_SECRET_KEY:'secret'};
const origin='https://crm.example.com';
function api(path,method='GET',body){
 return onRequest({env,request:new Request(origin+path,{method,headers:{cookie:'__Host-kaiser_session=session',origin,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})});
}
test('team chat endpoints authenticate identity, persist through RPC, and reject bad input',async()=>{
 const old=globalThis.fetch;let calls=[];
 globalThis.fetch=async (url,o)=>{
  const p=new URL(url).pathname;calls.push(p);
  if(p==='/auth/v1/user')return Response.json({id:'test-uid'});
  if(p.endsWith('/kaiser_team_hub_read'))return Response.json({messages:[],claims:[],member_id:1});
  if(p.endsWith('/kaiser_team_hub_send'))return Response.json({id:1,sender_name:'Kollegin',body:JSON.parse(o.body).p_body});
  if(p.endsWith('/kaiser_lead_claim'))return Response.json({ok:true,mine:true});
  if(p.endsWith('/kaiser_pages_read'))return Response.json(snapshot);
  if(p.endsWith('/kaiser_lead_lock_check'))return Response.json({allowed:true});
  if(p.endsWith('/kaiser_pages_apply'))return Response.json({ok:true});
  throw new Error('Unexpected RPC: '+p);
 };
 try{
  assert.equal((await api('/api/team/hub')).status,200);
  const msg=await api('/api/team/send','POST',{body:'Bearbeite den Auftrag gerade.'});
  assert.equal(msg.status,200);assert.equal((await msg.json()).body,'Bearbeite den Auftrag gerade.');
  assert.equal((await api('/api/team/send','POST',{body:''})).status,400);
  assert.equal((await api('/api/team/claim','POST',{deal_id:1,action:'claim',purpose:'Anruf'})).status,200);
  assert.equal((await api('/api/team/claim','POST',{deal_id:'whoops',action:'claim'})).status,400);
  assert.ok(calls.some(c=>c.endsWith('/kaiser_team_hub_read')));
  assert.ok(calls.some(c=>c.endsWith('/kaiser_team_hub_send')));
  assert.ok(calls.some(c=>c.endsWith('/kaiser_lead_claim')));
 }finally{globalThis.fetch=old}
});
test('server checks conflicts before mutating CRM data',async()=>{
 const old=globalThis.fetch;let applied=false;
 globalThis.fetch=async (url,o)=>{
  const p=new URL(url).pathname;
  if(p==='/auth/v1/user')return Response.json({id:'test-uid'});
  if(p.endsWith('/kaiser_pages_read'))return Response.json(snapshot);
  if(p.endsWith('/kaiser_lead_lock_check'))return Response.json({allowed:false,name:'Roman',purpose:'Kundenanruf'});
  if(p.endsWith('/kaiser_pages_apply')){applied=true;return Response.json({ok:true})}
  throw new Error('Unexpected request '+p);
 };
 try{
  const res=await api('/api/crm','POST',{revision:'v1',op:'pipeline',id:1,values:{status:'reached'}});
  assert.equal(res.status,409);
  assert.match((await res.json()).error,/Roman/);
  assert.equal(applied,false,'Conflicting updates must be rejected');
 }finally{globalThis.fetch=old}
});
