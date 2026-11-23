import test from 'node:test';
import assert from 'node:assert/strict';
import {importRows,labels} from '../import.mjs';

const snapshot=()=>({companies:[],contacts:[],deals:[],projects:[],activities:[]});
const actor={role:'admin',member_id:1,name:'Test'};
const headers=['Unternehmen','Branche','Ort','Telefon','Firmen-E-Mail','Website','Website-Signal','Quelle URL','Ansprechpartner','Rolle','Kontakt-Telefon','Kontakt-E-Mail','Status','Ergebnis','Nicht kontaktieren','Potenzial','Score','Priorität','Follow-up','Bedarf','Notizen','Grund','Firmenprofil','Prüfstatus','Geprüft am','Aktivitätsnachweis','Recherchequellen','Website-Beobachtung','Nutzenhypothese','Gesprächseinstieg','Prioritätsbegründung','Offene Recherchefragen'];
const keys=['company_name','industry','city','company_phone','company_email','website','website_status','source_url','contact_name','contact_role','contact_phone','contact_email','stage','result','do_not_contact','value','score','priority','next_follow_up','need_summary','notes','reason','company_profile','activity_status','checked_at','activity_evidence','evidence_urls','website_observation','benefit_hypothesis','opening_line','priority_reason','research_uncertainty'];
const mapping=Object.fromEntries(keys.map((key,i)=>[key,i]));
test('all 32 October lead template columns have a recognized import key',()=>{
 assert.equal(keys.length,32);
 for(const k of keys)assert.ok(Object.hasOwn(labels,k), 'Missing import key: '+k);
});
test('Excel lead preserves its original research, result, reason and lead status',()=>{
 const row=Array(32).fill('');
 row[0]='Demo Zimmerei';row[2]='Dinkelsbühl';row[3]='09851 12345';row[7]='https://www.example.com/';
 row[12]='Neu';row[13]='Ansprechpartner nicht erreicht';row[14]=0;row[15]='897';row[17]='Hoch';
 row[19]='Website mit Referenzen';row[20]='Telefonat vorbereiten';row[21]='Interessant für Winter';
 row[22]='Familienbetrieb';row[23]='Prüfen';row[24]=46297;row[26]='Google Unternehmensprofil';
 row[29]='Guten Tag!';row[31]='Fragen zum Budget';
 const result=importRows(snapshot(),actor,{headers,rows:[row],mapping,filename:'test.xlsx',sheet:'CRM-Import'},new Date('2026-11-23T10:00:00Z'));
 assert.equal(result.report.imported,1);
 const deal=result.patches.find(p=>p.table==='deals').values;
 const company=result.patches.find(p=>p.table==='companies').values;
 assert.equal(deal.stage,'new');assert.equal(deal.disposition,'active');
 assert.equal(company.source_url,'https://www.example.com/');
 assert.match(deal.notes,/Ansprechpartner nicht erreicht/);
 assert.match(deal.notes,/Interessant für Winter/);
 assert.match(deal.import_raw,/Guten Tag!/);
 assert.equal(JSON.parse(deal.research_json).company_profile,'Familienbetrieb');
});
test('Excel no-contact flag blocks outreach without silently dropping the lead',()=>{
 const row=Array(32).fill('');
 row[0]='Test Kontaktstopp';row[12]='Neu';row[14]=1;row[21]='Bitte nicht erneut anrufen';
 const result=importRows(snapshot(),actor,{headers,rows:[row],mapping,filename:'test.xlsx',sheet:'CRM-Import'});
 assert.equal(result.report.imported,1);
 const company=result.patches.find(p=>p.table==='companies').values;
 const deal=result.patches.find(p=>p.table==='deals').values;
 assert.equal(company.do_not_contact,1);
 assert.equal(deal.do_not_contact,1);
 assert.equal(deal.disposition,'no_interest');
});
