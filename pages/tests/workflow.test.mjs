import test from 'node:test';
import assert from 'node:assert/strict';
import {command,tables} from '../commands.mjs';

const now=new Date('2026-11-19T12:00:00.000Z');
const admin={member_id:1,role:'admin',name:'Ivan'},staff={member_id:2,role:'staff',name:'Kollegin'};
const defaults={
 deals:{disposition:'active',stage:'new',do_not_contact:0,next_follow_up:'',next_follow_up_time:'',next_action:''},
 tasks:{status:'open',kind:'task'},activities:{metadata:'{}'}
};
function fixture(){
 const s=Object.fromEntries(tables.map(k=>[k,[]]));
 s.companies=[{id:1,name:'Dachdeckerei',do_not_contact:0}];
 s.crm_members=[{id:1,name:'Ivan',active:1},{id:2,name:'Kollegin',active:1}];
 return s;
}
function execute(s,actor,op,id,values){
 const patches=command(s,actor,{op,id,values},now).patches;
 for(const p of patches){
  if(p.action==='insert')s[p.table].push({...defaults[p.table],...p.values});
  else if(p.action==='update')Object.assign(s[p.table].find(x=>x.id===p.id),p.values);
  else throw Error('Unsupported patch: '+p.action);
 }
 return patches;
}
test('company -> won client -> back to lead -> won again reuses project and preserves data',()=>{
 const s=fixture();
 execute(s,admin,'customer_win',1,{confirmed:'yes',service_type:'website',value:'1499',notes:'Zusage per Telefon'});
 assert.equal(s.deals.length,1);
 assert.equal(s.deals[0].stage,'won');
 assert.equal(s.projects.length,1);
 assert.equal(s.projects[0].value,1499);
 assert.equal(s.projects[0].service_type,'website');
 const projectId=s.projects[0].id;
 assert.throws(()=>execute(s,admin,'customer_reopen',1,{confirmed:'yes'}),/Grund/);
 assert.equal(s.deals[0].stage,'won');
 execute(s,staff,'customer_reopen',1,{confirmed:'yes',stage:'interest',reason:'Kunde doch noch unentschlossen'});
 assert.equal(s.deals[0].stage,'interest');
 assert.equal(s.projects[0].status,'archived');
 execute(s,admin,'customer_win',1,{confirmed:'yes',service_type:'app',value:'1600'});
 assert.equal(s.deals[0].stage,'won');
 assert.equal(s.projects.length,1);
 assert.equal(s.projects[0].id,projectId);
 assert.equal(s.projects[0].status,'active');
 assert.equal(s.projects[0].service_type,'app');
 assert.equal(s.projects[0].value,1600);
 assert.match(s.activities.at(-1).subject,/gewonnen/);
});
test('an individual project can be archived then restored as paused, with value retained',()=>{
 const s=fixture();
 execute(s,admin,'customer_win',1,{confirmed:'yes',service_type:'social_media',value:'540'});
 execute(s,staff,'project_archive',1,{confirmed:'yes',reason:'Falsche Zuweisung'});
 assert.equal(s.projects[0].status,'archived');
 assert.equal(s.deals[0].stage,'won','project archive must not silently remove won client');
 assert.throws(()=>execute(s,staff,'project',1,{name:'Changed',status:'active'}),/erst wiederherstellen/);
 execute(s,staff,'project_restore',1,{confirmed:'yes'});
 assert.equal(s.projects[0].status,'on_hold');
 assert.equal(s.projects[0].value,540);
 execute(s,admin,'project',1,{name:'Social laufend',status:'done',value:'690',service_type:'social_media',owner_id:1});
 assert.equal(s.projects[0].status,'done');
 assert.equal(s.projects[0].value,690);
});
test('appointments: cancellation, archive and restore are explicit, reversible and audited',()=>{
 const s=fixture();
 execute(s,staff,'appointment',null,{company_id:1,title:'Erstgespräch',start_at:'2026-11-25T10:00',end_at:'2026-11-25T11:00'});
 assert.equal(s.appointments[0].status,'planned');
 assert.throws(()=>execute(s,staff,'appointment_cancel',1,{}),/bestätigen/);
 execute(s,staff,'appointment_cancel',1,{confirmed:'yes'});
 assert.equal(s.appointments[0].status,'cancelled');
 execute(s,admin,'appointment_archive',1,{confirmed:'yes'});
 assert.equal(s.appointments[0].status,'archived');
 execute(s,admin,'appointment_restore',1,{confirmed:'yes'});
 assert.equal(s.appointments[0].status,'cancelled','restoration must not silently create a live appointment');
 assert.ok(s.activities.some(a=>a.subject==='Termin abgesagt'));
 assert.ok(s.activities.some(a=>a.subject==='Termin wiederhergestellt'));
});
test('complete requires documented outcome and confirmation, and sets 3-day callback atomically',()=>{
 const s=fixture();
 execute(s,admin,'task',null,{company_id:1,title:'Erstkontakt',kind:'call',owner_id:2,due_date:'2026-11-19'});
 const form={target:'task:1',work_kind:'call',result:'Telefonisch nicht erreicht',pipeline_status:'not_reached'};
 assert.throws(()=>execute(s,staff,'complete_work',null,form),/bestätigen/);
 assert.equal(s.tasks[0].status,'open');
 execute(s,staff,'complete_work',null,{...form,confirmed:'yes'});
 assert.equal(s.tasks[0].status,'done');
 assert.equal(s.deals[0].stage,'followup');
 assert.equal(s.deals[0].next_follow_up,'2026-11-22');
 assert.ok(s.activities.some(a=>a.subject==='Erledigt · Anruf'));
});
test('multiple offers must be disambiguated before marking company as won',()=>{
 const s=fixture();
 execute(s,admin,'deal',null,{company_id:1,title:'Website',value:'1200'});
 execute(s,admin,'deal',null,{company_id:1,title:'Marketing',value:'500'});
 assert.throws(()=>execute(s,admin,'customer_win',1,{confirmed:'yes',service_type:'website',value:'1200'}),/passende Verkaufschance/);
 assert.equal(s.projects.length,0);
 execute(s,admin,'customer_win',1,{confirmed:'yes',deal_id:2,service_type:'social_media',value:'500'});
 assert.equal(s.projects.length,1);
 assert.equal(s.deals[0].stage,'new');
 assert.equal(s.deals[1].stage,'won');
});