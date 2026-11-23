import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../../cloud/web/crm.js',import.meta.url),'utf8');
const screens=['renderOverview','renderActivities','renderSales','renderContacts','renderProjects',
 'renderClients','renderAppointments','renderFollowups','renderSettings'];

test('all route handlers and desktop pipeline binder exist',()=>{
 for(const name of [...screens,'wirePipeline']){
  const pattern=new RegExp('(?:^|\\n)(?:async )?function\\s+'+name+'\\s*\\(');
  assert.match(source,pattern,'Missing CRM function '+name);
 }
 assert.match(source,/settings\s*:\s*renderSettings/);
 assert.match(source,/function wire\(\)\s*\{\s*wirePipeline\(\)/);
});
test('frontend executes settings and renders its HTML for both roles',()=>{
 const beforeEvents=source.indexOf("$('#form').addEventListener");
 assert.ok(beforeEvents>0,'Unknown browser initialization boundary');
 const evalFront=new Function('localStorage','document','history','window','location',
  source.slice(0,beforeEvents)+
  "\n data={revision:'r1',session:{role:'admin',name:'Ivan',member_id:1},crm_members:[{id:1,name:'Ivan',active:1}],companies:[],contacts:[],deals:[],projects:[],tasks:[],appointments:[],activities:[]};"+
  "\n const adminHTML=renderSettings();data.session.role='staff';const staffHTML=renderSettings();return {adminHTML,staffHTML};");
 const env=[{getItem:()=>null},{querySelector:()=>null,querySelectorAll:()=>[]},{scrollRestoration:'manual'},{},{hash:''}];
 const {adminHTML,staffHTML}=evalFront(...env);
 assert.match(adminHTML,/Einstellungen/);
 assert.match(adminHTML,/JSON-Backup/);
 assert.match(staffHTML,/Einstellungen/);
 assert.doesNotMatch(staffHTML,/JSON-Backup/);
});

function frontend(snapshot,expression){
 const env=[{getItem:()=>null},{querySelector:()=>null,querySelectorAll:()=>[]},{scrollRestoration:'manual'},{},{hash:''}];
 const execute=new Function('localStorage','document','history','window','location','snapshot',source.slice(0,source.indexOf("$('#form').addEventListener"))+'\ndata=snapshot; return ('+expression+');');
 return execute(...env,snapshot);
}
const emptySnapshot=()=>({revision:'test',session:{role:'admin',name:'Test',member_id:1},crm_members:[{id:1,name:'Test',active:1}],companies:[],contacts:[],deals:[],projects:[],tasks:[],appointments:[],activities:[]});
test('every main screen renders with an empty workspace',()=>{
 for(const screen of screens){const html=frontend(emptySnapshot(),screen+'()');assert.ok(html.includes('<h1>'),screen);assert.doesNotMatch(html,/NaN|undefined/);}
});
test('dashboard groups partition all statuses, including blocked won deals and legacy phases',()=>{
 const s=emptySnapshot();s.companies=[{id:1,name:'Test'}];
 const scenarios=[['new','active',0,'new'],['attempted','active',0,'contacted'],['offer','active',0,'offer_email'],['won','active',0,'won'],['won','active',1,'stopped'],['interest','no_interest',0,'no_interest'],['new','lost',0,'lost'],['meeting','active',0,'followup']];
 s.deals=scenarios.map(([stage,disposition,do_not_contact],i)=>({id:i+1,company_id:1,stage,disposition,do_not_contact}));
 assert.deepEqual(frontend(s,'data.deals.map(dashboardGroupForDeal)'),scenarios.map(x=>x[3]));
 const html=frontend(s,'renderOverview()');assert.doesNotMatch(html,/NaN|undefined/);
 assert.ok(html.indexOf('dashboard-chart-full')<html.indexOf('dashboard-kpis'),'large chart must come first');
 assert.match(html,/pointer|donut-arc/);
});
test('legacy dates on won, closed or blocked leads do not appear as actionable callbacks',()=>{
 const s=emptySnapshot();s.companies=[{id:1,name:'Test'}];
 s.deals=[{id:1,company_id:1,stage:'won',disposition:'active'},{id:2,company_id:1,stage:'new',disposition:'no_interest'},{id:3,company_id:1,stage:'new',disposition:'active',do_not_contact:1}].map(d=>({...d,next_follow_up:'2026-01-01'}));
 assert.equal(frontend(s,'agenda().length'),0);
 for(const key of ['won','no_interest','stopped'])assert.doesNotMatch(frontend(s,`dashboardDetails('${key}')`),/Nächster Schritt:/);
});

test('follow-ups have their own visible queue and navigation',()=>{
 const state=emptySnapshot();
 state.companies=[{id:1,name:'Demo Zimmerei',do_not_contact:0}];
 state.deals=[
 {id:1,company_id:1,title:'Demo Zimmerei - Website',disposition:'active',stage:'followup',next_follow_up:'2026-11-25',next_action:'call',owner_id:1},
 {id:2,company_id:1,title:'Won',disposition:'active',stage:'won',next_follow_up:'2026-11-24',owner_id:1},
 {id:3,company_id:1,title:'Closed',disposition:'no_interest',stage:'followup',next_follow_up:'2026-11-24',owner_id:1}
 ];
 const html=frontend(state,'renderFollowups()');
 assert.match(html,/Demo Zimmerei/);
 assert.match(html,/Nachfassen/);
 assert.match(html,/2026/);
 assert.doesNotMatch(html,/Won|Closed/);
 assert.match(source,/followups:renderFollowups/);
 assert.match(source,/followups:'Nachfassen'/);
 assert.match(source,/data-move-deal/);
});
test('company screen includes direct pipeline movement and Excel research panel',()=>{
 const state=emptySnapshot();
 state.companies=[{id:1,name:'Demo Zimmerei',do_not_contact:0,city:'Musterstadt'}];
 state.deals=[{id:1,company_id:1,title:'Website',disposition:'active',stage:'interest',value:850,research_json:JSON.stringify({company_profile:'Handwerksbetrieb',opening_line:'Guten Tag'})}];
 const html=frontend(state,'renderCompany(1)');
 assert.match(html,/Status direkt ändern/);
 assert.match(html,/Demo-Angebot versendet/);
 assert.match(html,/Excel-Recherche/);
 assert.match(html,/Guten Tag/);
 assert.match(html,/Kontaktstopp setzen/);
});


test('new leads ask for a contact attempt before they can be marked reached',()=>{
 const s=emptySnapshot();
 s.companies=[{id:1,name:'Kunde A',do_not_contact:0}];
 s.deals=[{id:1,company_id:1,title:'Website',stage:'new',disposition:'active',owner_id:1,value:897}];
 const newHtml=frontend(s,'renderSales()');
 assert.match(newHtml,/Kontaktversuch starten/);
 assert.doesNotMatch(newHtml,/data-action="pipeline-reached"/);
 s.deals[0].stage='contacted';
 const contactedHtml=frontend(s,'renderSales()');
 assert.match(contactedHtml,/data-action="pipeline-reached"/);
 assert.match(contactedHtml,/Nicht erreicht/);
 s.deals[0].stage='reached';
 const reachedHtml=frontend(s,'renderSales()');
 assert.match(reachedHtml,/data-action="pipeline-interest"/);
 assert.match(reachedHtml,/Kein Interesse/);
});
test('accepted customers with unfinished projects have a separate processing lane',()=>{
 const s=emptySnapshot();
 s.companies=[{id:1,name:'Kunde A',do_not_contact:0}];
 s.deals=[{id:1,company_id:1,title:'Website',stage:'won',disposition:'active',owner_id:1,value:897}];
 s.projects=[{id:1,deal_id:1,company_id:1,name:'Website',status:'active',value:897,service_type:'website'}];
 const html=frontend(s,'renderSales()');
 assert.match(html,/In Bearbeitung/);
 assert.match(html,/data-action="project-complete"/);
 assert.match(html,/Kunde A/);
 s.projects[0].status='done';
 assert.doesNotMatch(frontend(s,'renderSales()'),/data-action="project-complete"/);
});
test('manual forms and customer sidebar actions are exposed',()=>{
 assert.match(source,/function manualCompanyEditor/);
 assert.match(source,/new_contact_name/);
 assert.match(source,/contact_role/);
 assert.match(source,/case'client-manual'/);
 assert.match(frontend(emptySnapshot(),'renderClients()'),/Bestandskunde hinzufügen/);
});
