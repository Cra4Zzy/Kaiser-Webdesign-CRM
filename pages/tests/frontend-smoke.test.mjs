import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../../cloud/web/crm.js',import.meta.url),'utf8');
const screens=['renderOverview','renderActivities','renderSales','renderContacts','renderProjects',
 'renderClients','renderAppointments','renderSettings'];

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
