export const tables=['companies','contacts','deals','tasks','appointments','projects','activities','crm_members'];
const fail=m=>{throw new Error(m)};
const txt=x=>String(x??'').trim();
const req=(x,label)=>{let s=txt(x);if(!s||s.length>1000)fail(label+' fehlt oder ist zu lang.');return s};
const choice=(x,a,l)=>{if(!a.includes(x))fail(l+' ist ungültig.');return x};
const day=x=>{let s=txt(x);if(s&&(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s))fail('Ungültiges Datum.');return s};
const clock=(x,d)=>{let s=txt(x);if(s&&(!d||!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)))fail('Ungültige Uhrzeit.');return s};
const cash=x=>{let n=Number(txt(x).replace(',','.'));if(!Number.isFinite(n)||n<0)fail('Ungültiger Betrag.');return n};
const actionNames={call:'Anrufen',followup:'Nachfassen',build_page:'Angebotsseite bauen',send_page:'Angebotsseite senden',email:'E-Mail schreiben',whatsapp:'WhatsApp schreiben',offer:'Angebot senden',meeting:'Termin vereinbaren',other:'Sonstiges'};
const phases=['new','contacted','interest','offer','offer_email','offer_demo','building','followup'], kinds=['task','call','email','meeting','work'], contactKinds=['call','email','meeting','whatsapp'];
const cleared={next_follow_up:'',next_follow_up_time:'',next_action:''};
export function command(snapshot,actor,p,now=new Date()){
 const s=structuredClone(snapshot), patches=[];const stamp=now.toISOString();const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const inDays=n=>{const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
 const get=(t,id)=>s[t].find(r=>r.id===Number(id))||fail('Datensatz nicht gefunden.');
 const add=(t,v)=>{const id=s[t].reduce((m,r)=>Math.max(m,r.id),0)+1;const values={id,...v,...(!['activities','crm_members'].includes(t)?{created_at:stamp,updated_at:stamp}:{})};s[t].push({...values});patches.push({table:t,action:'insert',id,values});return s[t].at(-1)};
 const upd=(t,id,v)=>{const r=get(t,id),values={...v,...(!['activities','crm_members'].includes(t)?{updated_at:stamp}:{})};Object.assign(r,values);patches.push({table:t,action:'update',id:r.id,values});return r};
 const owner=x=>{if(!x)return null;let r=get('crm_members',x);if(!r.active)fail('Teamprofil deaktiviert.');return r.id};
 const stopped=cid=>Boolean(get('companies',cid).do_not_contact||s.deals.some(d=>d.company_id===cid&&d.do_not_contact));
 const log=(subject,body='',d=null,cid=null,type='edit',meta={})=>add('activities',{subject,body,type,occurred_at:stamp,company_id:d?.company_id??cid,deal_id:d?.id??null,metadata:JSON.stringify({actor_id:actor.member_id,actor_name:actor.name,version:9,...meta})});
 const deal=x=>x?get('deals',x):null;const fields=(v,keys)=>Object.fromEntries(keys.split(' ').map(k=>[k,txt(v[k])]));
 const refs=v=>{const d=deal(v.deal_id);let cid=d?.company_id??(v.company_id?get('companies',v.company_id).id:null);return {deal_id:d?.id??null,company_id:cid}};
 const newDeal=cid=>add('deals',{company_id:cid,title:'Kundenkontakt',stage:'new',disposition:'active',owner_id:actor.member_id,value:0});
 const quick=(d,status,reason='',date='',time='')=>{if(d.stage==='won'&&d.disposition==='active')fail('Ein gewonnener Auftrag kann hier nicht geändert werden.');let val,sub;if(status==='no_interest'){val={disposition:status,lost_reason:reason||'Kein Interesse',disposition_at:stamp,...cleared};sub='Kein Interesse'}else{if(stopped(d.company_id))fail('Kontaktstopp zuerst aufheben.');val={disposition:'active',lost_reason:'',disposition_at:'',stage:status==='followup'?'followup':'new',...(date?{next_follow_up:date,next_follow_up_time:time,next_action:'followup'}:{})};sub=status==='followup'?'Nachfassen':'Wieder offen'}let before={stage:d.stage,disposition:d.disposition};upd('deals',d.id,val);log(sub,reason,d,null,'edit',{before,after:val})};
 const restoreWonProject=d=>{const archived=s.projects.find(p=>p.deal_id===d.id&&p.status==='archived');if(archived){upd('projects',archived.id,{status:'active'});return}if(!s.projects.some(p=>p.deal_id===d.id))add('projects',{company_id:d.company_id,deal_id:d.id,name:d.title,value:d.value||0,status:'active',owner_id:d.owner_id??null,service_type:'website'});};
 const complete=d=>{if(!d.next_follow_up)fail('Wiedervorlage bereits abgeschlossen.');let a=d.next_action||'other',title=actionNames[a]||'Wiedervorlage';let t=add('tasks',{title,kind:['call','email','meeting'].includes(a)?a:'task',status:'done',due_date:d.next_follow_up,due_time:d.next_follow_up_time||'',company_id:d.company_id,deal_id:d.id,owner_id:d.owner_id??null,notes:'Abgeschlossene Vertriebswiedervorlage.'});upd('deals',d.id,cleared);log('Wiedervorlage erledigt',title,d,null,'edit',{task_id:t.id});return t.id};
 if(!p||typeof p!=='object'||!p.values||typeof p.values!=='object'||Array.isArray(p.values))fail('Ungültige Anfrage.');const v=p.values;let id=p.id?Number(p.id):null;
 switch(p.op){
 case 'member':{if(actor.role!=='admin')fail('Nur Administration.');let name=req(v.name,'Name');if(id){let active=Number(Boolean(v.active??1));if(!active&&id===actor.member_id)fail('Eigenes Profil kann nicht deaktiviert werden.');upd('crm_members',id,{name,active})}else id=add('crm_members',{name,active:1}).id;log('Teamprofil aktualisiert',name);break}
 case 'company':{let val=fields(v,'name industry city phone email website notes');val.name=req(val.name,'Unternehmen');if(val.website){try{let u=new URL(/^[a-z]+:/i.test(val.website)?val.website:'https://'+val.website);if(!['http:','https:'].includes(u.protocol))fail('Ungültige Website.');val.website=u.href}catch{fail('Ungültige Website.')}}id=id?upd('companies',id,val).id:add('companies',val).id;log('Unternehmensdaten gespeichert','',null,id);break}
 case 'contact':{let cid=get('companies',v.company_id).id,val={...fields(v,'first_name last_name role phone email notes'),company_id:cid};if(!val.first_name&&!val.last_name)fail('Bitte einen Namen angeben.');if(id&&get('contacts',id).company_id!==cid)fail('Firmenzuordnung bleibt erhalten.');id=id?upd('contacts',id,val).id:add('contacts',val).id;log('Ansprechpartner gespeichert','',null,cid);break}
 case 'deal':{let cid=id?get('deals',id).company_id:get('companies',v.company_id).id,contact=v.contact_id?get('contacts',v.contact_id):null;if(contact&&contact.company_id!==cid)fail('Ansprechpartner gehört nicht zur Firma.');let val={title:req(v.title,'Bezeichnung'),company_id:cid,contact_id:contact?.id??null,value:cash(v.value),need_summary:txt(v.need_summary),owner_id:owner(v.owner_id)};id=id?upd('deals',id,val).id:add('deals',{...val,stage:'new',disposition:'active'}).id;log('Verkaufschance gespeichert','',deal(id));break}
 case 'pipeline':{
  const d=deal(id),status=choice(v.status,['new','contacted','not_reached','reached','interest','offer_email','offer_demo','followup','building','no_interest'],'Pipeline-Schritt');
  if(status==='no_interest'){quick(d,'no_interest',txt(v.reason));break}
  if(d.stage==='won')fail('Gewonnene Aufträge bearbeitest du unter Projekte.');
  if(stopped(d.company_id))fail('Kontaktstopp aktiv. Erst aufheben.');
  const before={stage:d.stage,disposition:d.disposition},val={disposition:'active',lost_reason:'',disposition_at:'',...cleared};
  let label='';
  if(status==='not_reached'){Object.assign(val,{stage:'followup',last_contact:today,next_follow_up:inDays(3),next_action:'call'});label='Nicht erreicht · Rückruf in 3 Tagen'}
  else if(status==='reached'){val.stage='interest';val.last_contact=today;label='Erreicht · Interesse prüfen'}
  else if(status==='offer_email'||status==='offer_demo'){val.stage=status;val.proposal_sent_at=stamp;label=status==='offer_email'?'Angebot per E-Mail versendet':'Website-/Social-Media-Demo gesendet'}
  else if(status==='followup'){val.stage='followup';val.next_follow_up=day(v.due_date)||inDays(3);val.next_follow_up_time=clock(v.due_time,val.next_follow_up);val.next_action='followup';label='Nachfassen eingeplant'}
  else if(status==='building'){val.stage='won';label='Zusage · Auftrag in Bearbeitung'}
  else {val.stage=status;label={new:'Neuer Lead',contacted:'Kontaktaufnahme',interest:'Interesse bestätigt'}[status]}
  upd('deals',id,val);
  if(status==='building'){
    const service_type=choice(v.service_type||'website',['website','app','social_media','mixed'],'Leistung');
    const existing=s.projects.find(p=>p.deal_id===d.id);
    if(existing&&existing.status==='archived')upd('projects',existing.id,{status:'active',service_type});
    else if(!existing)add('projects',{company_id:d.company_id,deal_id:d.id,name:d.title,value:d.value||0,status:'active',owner_id:d.owner_id??null,service_type});
  }
  log(label,txt(v.notes),d,null,'edit',{before,after:val});
  break
 }
 case 'deal_priority':{
  const d=deal(id),priority=choice(v.priority,['high','medium','low'],'Priorität');
  upd('deals',id,{priority});log('Priorität geändert',{high:'Hoch',medium:'Mittel',low:'Niedrig'}[priority],d);break
 }
 case 'company_quick_status':case 'quick_status':{if(p.op==='company_quick_status'){let cid=get('companies',id).id;if(s.deals.some(d=>d.company_id===cid))fail('Firma hat bereits einen Vorgang.');id=newDeal(cid).id}let status=choice(v.status,['no_interest','followup','open'],'Status'),d=status==='followup'?day(v.due_date):'';if(status==='followup'&&!d)fail('Bitte Datum auswählen.');quick(deal(id),status,txt(v.reason),d,clock(d?v.due_time:'',d));break}
 case 'stage':{let d=deal(id),status=choice(v.status,['open','won','lost'],'Abschluss'),stage=choice(v.stage,phases,'Phase'),reason=txt(v.reason);if(d.stage==='won'&&d.disposition==='active'&&status!=='won')fail('Bestandskunden bitte über Zurück in Vertrieb bearbeiten.');if(status==='open'&&stopped(d.company_id))fail('Kontaktstopp aktiv.');if(status==='lost'&&!reason)fail('Verlustgrund fehlt.');let val={stage:status==='won'?'won':stage,disposition:status==='lost'?'lost':'active',lost_reason:status==='lost'?reason:'',disposition_at:status==='lost'?stamp:'',...(status==='open'?{}:cleared)},before={stage:d.stage,disposition:d.disposition};upd('deals',id,val);if(status==='won'){
 const service_type=choice(v.service_type||'website',['website','app','social_media','mixed'],'Leistung');
 const existing=s.projects.find(r=>r.deal_id===id);
 if(existing?.status==='archived')upd('projects',existing.id,{status:'active',service_type});
 else if(!existing)add('projects',{company_id:d.company_id,deal_id:id,name:d.title,value:d.value??0,status:'active',owner_id:d.owner_id??null,service_type});
}log(status==='won'?'Auftrag gewonnen':status==='lost'?'Verkaufschance verloren':'Verkaufsphase geändert',reason,d,null,'edit',{before,after:val});break}
 case 'stop':{get('companies',id);let stop=Number(Boolean(v.stop));upd('companies',id,{do_not_contact:stop});for(const d of s.deals.filter(d=>d.company_id===id))upd('deals',d.id,{do_not_contact:stop,...(stop?cleared:{})});log(stop?'Kontaktstopp gesetzt':'Kontaktstopp aufgehoben',txt(v.reason),null,id);break}
 case 'log':case 'conversation':{let conv=p.op==='conversation',d=deal(v.deal_id),cid=conv?get('companies',v.company_id).id:d?.company_id;if(!cid||d&&d.company_id!==cid)fail('Ungültige Firmenzuordnung.');let kind=choice(v.kind,['note',...contactKinds,...(conv?[]:['work'])],'Kontaktart'),body=txt(v.body),result=kind==='note'?'Notiz':req(v.result,'Ergebnis');if(kind==='note'&&!body)fail('Bitte eine Notiz eingeben.');if(contactKinds.includes(kind)&&stopped(cid))fail('Kontaktstopp aktiv.');let status=conv?choice(v.sales_status??'keep',['keep','no_interest','followup','open'],'Status'):'keep';if(conv&&!d&&status!=='keep'&&kind!=='note'&&!s.deals.some(x=>x.company_id===cid))d=newDeal(cid);
 let task=null;if(conv&&choice(v.planning??'keep',['keep','plan'],'Planung')==='plan'){let date=day(v.due_date),k=choice(v.task_kind??'call',kinds,'Aufgabenart');if(!date)fail('Bitte Datum für nächsten Schritt angeben.');if(contactKinds.includes(k)&&stopped(cid))fail('Kontaktstopp aktiv.');task={title:req(v.title,'Nächster Schritt'),kind:k,due_date:date,due_time:clock(v.due_time,date),owner_id:owner(v.owner_id),company_id:cid,deal_id:d?.id??null}}
 if(conv&&v.complete){let m=/^(task|appointment|followup):(\d+)$/.exec(v.complete);if(!m)fail('Ungültige Aufgabe.');let t={task:'tasks',appointment:'appointments',followup:'deals'}[m[1]],old=get(t,m[2]);if(old.company_id!==cid)fail('Aufgabe gehört zu einer anderen Firma.');if(m[1]==='followup')complete(old);else{if(old.status!==(t==='tasks'?'open':'planned'))fail('Aufgabe bereits abgeschlossen.');upd(t,old.id,{status:'done'});log('Aufgabe abgeschlossen',old.title,deal(old.deal_id),cid)}}
 log(result,body,d,cid,kind);if(d&&contactKinds.includes(kind))upd('deals',d.id,{last_contact:today});if(status!=='keep'){if(!d||kind==='note')fail('Statusänderung benötigt einen Kontaktvorgang.');if(status==='followup'&&!task&&result!=='Nicht erreicht')fail('Bitte nächsten Schritt planen.');if(status==='no_interest'&&task)fail('Bei Kein Interesse keine neue Aufgabe planen.');quick(d,status,body,result==='Nicht erreicht'&&!task?inDays(3):'');if(status==='followup'&&task&&d.next_follow_up)upd('deals',d.id,cleared)}if(task){add('tasks',task);log('Nächster Schritt geplant',task.title,d,cid)}break}
 case 'task':{let r=refs(v),date=day(v.due_date),kind=choice(v.kind??'task',kinds,'Aktivitätsart');if(r.company_id&&contactKinds.includes(kind)&&stopped(r.company_id))fail('Kontaktstopp aktiv.');let val={...r,title:req(v.title,'Titel'),due_date:date,due_time:clock(v.due_time,date),notes:txt(v.notes),kind,owner_id:owner(v.owner_id),priority:choice(v.priority??'medium',['high','medium','low'],'Priorität')};id=id?upd('tasks',id,val).id:add('tasks',val).id;log('Aktivität geplant',val.title,deal(r.deal_id),r.company_id);break}
 case 'complete_work':{
  // A completion is one atomic CRM command: log the work, finish the source,
  // and optionally advance the sales pipeline. No silent status changes.
  if(v.confirmed!==true&&v.confirmed!=='yes')fail('Bitte den Abschluss ausdrücklich bestätigen.');
  const match=/^(task|appointment|followup):([1-9]\d*)$/.exec(txt(v.target));
  if(!match)fail('Ungültige Aufgabe.');
  const source=match[1],record=source==='followup'?get('deals',match[2]):get(source==='task'?'tasks':'appointments',match[2]);
  const oldFollowup=source==='followup'?{...record}:null;
  if(source==='followup'?!record.next_follow_up||record.stage==='won'||record.disposition!=='active':
    record.status!==(source==='task'?'open':'planned'))fail('Dieser Vorgang wurde bereits abgeschlossen.');
  const work=choice(v.work_kind,['call','email','meeting','offer','demo','work','other'],'Erledigte Tätigkeit');
  const result=req(v.result,'Ergebnis / Notiz');
  const status=choice(v.pipeline_status,['keep','contacted','not_reached','interest','offer_email','offer_demo','followup','no_interest','won'],'Pipeline-Status');
  const cid=record.company_id||null;
  let d=source==='followup'?record:(record.deal_id?get('deals',record.deal_id):null);
  if(d&&cid&&d.company_id!==cid)fail('Unpassende Firmenzuordnung.');
  if(v.deal_id){
   const selected=get('deals',v.deal_id);
   if(!cid||selected.company_id!==cid||d&&selected.id!==d.id)fail('Vorgang gehört nicht zur Aufgabe.');
   d=selected;
  }
  if(status!=='keep'&&!d) {
   if(!cid)fail('Ohne Firmenbezug kann keine Pipeline geändert werden.');
   const active=s.deals.filter(x=>x.company_id===cid&&x.disposition==='active'&&x.stage!=='won');
   if(active.length>1)fail('Bitte zuerst die passende Verkaufschance auswählen.');
   d=active[0]||newDeal(cid);
  }
  if(cid&&stopped(cid)&&(status!=='keep'||['call','email','meeting','offer','demo'].includes(work)))
   fail('Kontaktstopp aktiv. Bitte keine Kontaktaktion abschließen.');
  if(d&&status!=='keep'){
   if(d.stage==='won')fail('Abgeschlossene Kundenaufträge nicht in die Lead-Pipeline verschieben.');
   const val={disposition:'active',lost_reason:'',disposition_at:'',...cleared};
   if(status==='no_interest'){
    Object.assign(val,{disposition:'no_interest',lost_reason:result,disposition_at:stamp});
   }else if(status==='not_reached'){
    Object.assign(val,{stage:'followup',next_follow_up:inDays(3),next_follow_up_time:'',next_action:'call',last_contact:today});
   }else if(status==='followup'){
    const followDate=day(v.due_date)||inDays(3);
    Object.assign(val,{stage:'followup',next_follow_up:followDate,
      next_follow_up_time:clock(v.due_time,followDate),next_action:'followup'});
   }else if(status==='won'){
    Object.assign(val,{stage:'won'});
    const service=choice(v.service_type,['website','app','social_media','mixed'],'Leistung');
    const existing=s.projects.find(x=>x.deal_id===d.id);
    if(existing?.status==='archived')upd('projects',existing.id,{status:'active',service_type:service});
    else if(!existing)add('projects',{company_id:d.company_id,deal_id:d.id,name:d.title,value:d.value||0,
       status:'active',owner_id:d.owner_id??null,service_type:service});
   }else{
    val.stage=status;
    if(status==='offer_email'||status==='offer_demo')val.proposal_sent_at=stamp;
   }
   upd('deals',d.id,val);
  }
  if(source==='task')upd('tasks',record.id,{status:'done'});
  else if(source==='appointment')upd('appointments',record.id,{status:'done'});
  else{
   // Record the completed callback before replacing it with a new follow-up.
   add('tasks',{title:oldFollowup.next_action==='call'?'Rückruf erledigt':'Wiedervorlage erledigt',
     kind:'call',status:'done',due_date:oldFollowup.next_follow_up,
     due_time:oldFollowup.next_follow_up_time||'',company_id:cid,deal_id:record.id,
     owner_id:record.owner_id??null,notes:result});
   if(status==='keep')upd('deals',record.id,cleared);
  }
  if(d&&['call','email','meeting','offer','demo'].includes(work))upd('deals',d.id,{last_contact:today});
  log('Erledigt · '+({call:'Anruf',email:'E-Mail',meeting:'Termin',offer:'Angebot',demo:'Demo',work:'Projektarbeit',other:'Sonstiges'}[work]),
    result,d,cid,'edit',{source,target:v.target,work_kind:work,pipeline_status:status});
  break;
 }
 case 'task_status':{let t=get('tasks',id),status=choice(v.status,['open','done','cancelled'],'Aktivitätsstatus');upd('tasks',id,{status});log({open:'Aktivität wieder geöffnet',done:'Aktivität erledigt',cancelled:'Aktivität abgesagt'}[status],t.title,deal(t.deal_id),t.company_id);break}
 case 'complete_followup':id=complete(deal(id));break;
 case 'followup':{let d=deal(id),date=day(v.due_date);if(date&&(d.stage==='won'||d.disposition!=='active'||stopped(d.company_id)))fail('Keine Wiedervorlage möglich.');if(!date&&d.next_follow_up){complete(d);break}upd('deals',id,{next_follow_up:date,next_follow_up_time:clock(v.due_time,date),next_action:date?choice(v.next_action??'call',Object.keys(actionNames),'Nächster Schritt'):''});log('Bestehende Wiedervorlage geändert','',d);break}
 case 'appointment':{let a=id?get('appointments',id):{},x={...a,...v},r=refs(x),start=txt(x.start_at),end=txt(x.end_at),valid=t=>/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(t)&&Number.isFinite(Date.parse(t));if(!valid(start)||!valid(end)||Date.parse(end)<=Date.parse(start)||Date.parse(end)-Date.parse(start)>31*86400000)fail('Ungültiger Terminzeitraum.');let val={...r,title:req(x.title,'Termintitel'),start_at:start.slice(0,16),end_at:end.slice(0,16),location:txt(x.location),kind:choice(x.kind||'meeting',['meeting','call','work','personal'],'Terminart'),status:choice(x.status||'planned',['planned','done','cancelled'],'Terminstatus'),reminder_minutes:choice(Number(x.reminder_minutes??15),[-1,0,5,15,30,60,1440],'Erinnerung'),notes:txt(x.notes),owner_id:owner(x.owner_id||actor.member_id)};if(r.company_id&&val.status==='planned'&&['call','meeting'].includes(val.kind)&&stopped(r.company_id))fail('Kontaktstopp aktiv.');id=id?upd('appointments',id,val).id:add('appointments',val).id;log('Termin '+(a.id?'aktualisiert':'vereinbart'),val.title,deal(r.deal_id),r.company_id);break}
 case 'customer_win':{
  if(v.confirmed!=='yes'&&v.confirmed!==true)fail('Bitte die Übernahme bestätigen.');
  const cid=get('companies',id).id;
  if(stopped(cid))fail('Kontaktstopp zuerst aufheben.');
  const all=s.deals.filter(d=>d.company_id===cid&&d.stage!=='won');
  let d;
  if(v.deal_id){d=get('deals',v.deal_id);if(d.company_id!==cid||d.stage==='won')fail('Ungültige Verkaufschance für diesen Kunden.');}
  else if(all.length===1)d=all[0];
  else if(!all.length)d=newDeal(cid);
  else fail('Bitte die passende Verkaufschance auswählen.');
  const service=choice(v.service_type||'website',['website','app','social_media','mixed'],'Leistung');
  const amount=cash(v.value??d.value??0);
  upd('deals',d.id,{stage:'won',disposition:'active',value:amount,lost_reason:'',disposition_at:'',...cleared});
  const existing=s.projects.find(p=>p.deal_id===d.id);
  if(existing?.status==='archived')upd('projects',existing.id,{status:'active',value:amount,service_type:service});
  else if(!existing)add('projects',{company_id:cid,deal_id:d.id,name:d.title,value:amount,status:'active',owner_id:d.owner_id??null,service_type:service});
  log('Kunde übernommen · Auftrag gewonnen',txt(v.notes),d,cid,'edit',{service_type:service,value:amount});
  break;
 }
 case 'customer_reopen':{
  if(v.confirmed!=='yes'&&v.confirmed!==true)fail('Bitte Rückstufung bestätigen.');
  const d=get('deals',id);
  if(d.stage!=='won'||d.disposition!=='active')fail('Dieser Auftrag ist kein aktiver Bestandskundenauftrag.');
  const reason=req(v.reason,'Grund für Rückstufung');
  const next=choice(v.stage||'interest',['new','contacted','interest','offer_email','offer_demo','followup'],'Neue Phase');
  const val={stage:next,disposition:'active',...cleared};
  if(next==='followup'){const date=day(v.due_date);if(!date)fail('Datum der Wiedervorlage fehlt.');Object.assign(val,{next_follow_up:date,next_action:'call'});}
  upd('deals',id,val);
  const related=s.projects.filter(p=>p.deal_id===id&&p.status!=='archived');
  for(const p of related)upd('projects',p.id,{status:'archived'});
  log('Bestandskunde in Vertrieb zurückgestuft',reason,d,null,'edit',{from:'won',to:next,archived_project_ids:related.map(p=>p.id)});
  break;
 }
 case 'project_archive':{
  if(v.confirmed!=='yes'&&v.confirmed!==true)fail('Bitte Archivierung bestätigen.');
  const project=get('projects',id);
  if(project.status==='archived')fail('Projekt ist bereits archiviert.');
  const previousStatus=project.status;
  upd('projects',id,{status:'archived'});
  log('Projekt archiviert',txt(v.reason)||project.name,deal(project.deal_id),project.company_id,'edit',{project_id:id,previous_status:previousStatus});
  break;
 }
 case 'project_restore':{
  if(v.confirmed!=='yes'&&v.confirmed!==true)fail('Bitte Wiederherstellung bestätigen.');
  const project=get('projects',id);
  if(project.status!=='archived')fail('Projekt ist nicht archiviert.');
  upd('projects',id,{status:'on_hold'});
  log('Projekt wiederhergestellt','Projekt zunächst pausiert, Status bitte prüfen.',deal(project.deal_id),project.company_id,'edit',{project_id:id});
  break;
 }
 case 'appointment_cancel':{
  if(v.confirmed!=='yes'&&v.confirmed!==true)fail('Bitte Absage bestätigen.');
  const a=get('appointments',id);
  if(a.status!=='planned')fail('Der Termin ist nicht mehr geplant.');
  upd('appointments',id,{status:'cancelled'});
  log('Termin abgesagt',txt(v.reason)||a.title,deal(a.deal_id),a.company_id,'edit',{appointment_id:id});
  break;
 }
 case 'appointment_archive':{
  if(v.confirmed!=='yes'&&v.confirmed!==true)fail('Bitte Entfernung bestätigen.');
  const appointment=get('appointments',id);
  if(appointment.status==='archived')fail('Termin ist bereits archiviert.');
  const old=appointment.status;
  upd('appointments',id,{status:'archived'});
  log('Termin aus Kalender entfernt',txt(v.reason)||appointment.title,deal(appointment.deal_id),appointment.company_id,'edit',{appointment_id:id,previous_status:old});
  break;
 }
 case 'appointment_restore':{
  if(v.confirmed!=='yes'&&v.confirmed!==true)fail('Bitte Wiederherstellung bestätigen.');
  const appointment=get('appointments',id);
  if(appointment.status!=='archived')fail('Termin ist nicht archiviert.');
  upd('appointments',id,{status:'cancelled'});
  log('Termin wiederhergestellt','Als abgesagt wiederhergestellt; bei Bedarf neu einplanen.',deal(appointment.deal_id),appointment.company_id,'edit',{appointment_id:id});
  break;
 }
 case 'project':{let a=get('projects',id);if(a.status==='archived')fail('Archiviertes Projekt erst wiederherstellen.');let val={name:req(v.name,'Projektname'),status:choice(v.status,['planning','active','review','done','on_hold'],'Projektstatus'),value:cash(v.value??a.value??0),deadline:day(v.deadline),notes:txt(v.notes),owner_id:owner(v.owner_id),service_type:choice(v.service_type||a.service_type||'other',['other','website','app','social_media','mixed'],'Leistung')};upd('projects',id,val);log('Projekt aktualisiert',val.name,deal(a.deal_id),a.company_id);break}
 default:fail('Unbekannte Aktion.');
 }return {id,patches};
}
