'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons={overview:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',activities:'M9 5h11v15H4V5h3 M9 3h6v4H9z M8 12l2 2 5-5',sales:'M4 20V12 M12 20V5 M20 20V9',contacts:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M20 21v-2a4 4 0 0 0-3-3.9 M16 3a4 4 0 0 1 0 8',projects:'M3 7h7l2 2h9v11H3z M3 7V4h7l2 3',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',call:'M7 3H3c0 10 8 18 18 18v-4l-5-2-2 2a15 15 0 0 1-7-7l2-2z',email:'M3 5h18v14H3z M3 5l9 7 9-7',meeting:'M3 5h18v16H3z M7 3v4 M17 3v4 M3 10h18',note:'M5 3h14v18H5z M8 8h8 M8 12h8 M8 16h5',work:'M4 6h16v12H4z M2 21h20',task:'M5 3h14v18H5z M8 12l3 3 5-6',clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2',plus:'M12 5v14 M5 12h14',check:'M5 12l4 4L19 6',arrow:'M5 12h14 M14 7l5 5-5 5',company:'M4 21V3h12v18 M16 10h4v11 M8 7h4 M8 11h4 M8 15h4',edit:'M14 5l5 5 M4 20l5-1L21 7l-5-5L4 14z'};
const icon=n=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[n]||icons.note}"/></svg>`;
const pages={overview:'Übersicht',sales:'Lead-Pipeline',activities:'Aufgaben',followups:'Nachfassen',appointments:'Termine',contacts:'Firmen',projects:'Projekte',clients:'Bestandskunden',no_interest:'Kein Interesse',stopped:'Kontaktstopp',settings:'Einstellungen'};
Object.assign(icons,{followups:icons.clock,appointments:icons.meeting,clients:icons.company,no_interest:icons.contacts,stopped:icons.clock});
const PHASES={new:'Neue Leads',contacted:'Kontaktversuch',reached:'Erreicht',interest:'Interesse',offer_email:'E-Mail-Angebot',offer_demo:'Demo-Angebot',followup:'Nachfassen'};
const PIPELINE_COLUMNS={new:'Neue Leads',contacted:'Kontaktversuch',reached:'Erreicht',interest:'Interesse',offer_email:'E-Mail-Angebot',offer_demo:'Demo-Angebot',won:'In Bearbeitung'};
const PHASE_COLORS=['#2563eb','#0891b2','#0ea5a4','#0d9488','#7c3aed','#c026d3','#05943f'];
const SERVICE_TYPES={other:'Noch zuordnen',website:'Website',app:'App',social_media:'Social Media',mixed:'Kombination'};
let mobilePipelineStage='all';
let dashboardCategory='new';
const KINDS={task:'Aufgabe',call:'Anruf',email:'E-Mail',meeting:'Termin',work:'Ausarbeitung'};
const ACTIONS={call:'Anrufen',followup:'Nachfassen',build_page:'Angebotsseite bauen',send_page:'Angebotsseite senden',email:'E-Mail schreiben',whatsapp:'WhatsApp schreiben',offer:'Angebot senden',meeting:'Termin vereinbaren',other:'Nächster Schritt'};
const PROJECTS={planning:'Geplant',active:'In Arbeit',review:'In Abstimmung',done:'Abgeschlossen',on_hold:'Pausiert',archived:'Archiviert'};
let data=null, route='', actor=Number(localStorage.getItem('kaiser.v9.actor')||1), scope='all', query='', filter='open', view='board', page=1, dialogSave=null, dialogRevision='', dialogDirty=false, loading=false;
const money=n=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(Number(n)||0);
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const dateLabel=d=>!d?'Ohne Datum':new Date(d.slice(0,10)+'T12:00:00').toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'});
const stamp=d=>!d?'':new Date(d).toLocaleString('de-DE',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});
const find=(t,id)=>data[t].find(r=>r.id===Number(id));
const company=id=>find('companies',id)||{name:'Ohne Unternehmen'};
const member=id=>find('crm_members',id);
const initials=n=>String(n||'?').trim().split(/\s+/).slice(0,2).map(p=>p[0]).join('').toUpperCase();
const owner=id=>id&&member(id)?`<span class="owner"><span class="owner-avatar">${esc(initials(member(id).name))}</span>${esc(member(id).name)}</span>`:'<span class="muted">Nicht zugewiesen</span>';
const phase=d=>d.stage==='attempted'?'contacted':d.stage==='meeting'?'followup':d.stage==='offer'?'offer_email':d.stage==='building'?'interest':d.stage;
const open=d=>d.disposition==='active'&&d.stage!=='won';
const nonWon=d=>!(d.stage==='won'&&d.disposition==='active');
const companyStatus=c=>{const ds=data.deals.filter(d=>d.company_id===c.id);return c.do_not_contact?'stopped':ds.some(d=>open(d)&&phase(d)==='followup')?'followup':ds.some(open)?'open':ds.some(d=>d.stage==='won'&&d.disposition==='active')?'won':ds.some(d=>d.disposition==='no_interest')?'no_interest':ds.some(d=>d.disposition!=='active')?'lost':'none'};
const STATUS_LABELS={none:'Noch nicht bearbeitet',open:'In der Pipeline',followup:'Nachfassen',won:'Bestandskunde',no_interest:'Kein Interesse',lost:'Verloren',stopped:'Kontaktstopp'};
const companyStatusBadge=c=>{const k=companyStatus(c);return `<span class="status-pill status-${k}"><i></i>${STATUS_LABELS[k]}</span>`};
const firmNext=c=>agenda().find(a=>a.company_id===c.id&&a.status==='open');
const nextLabel=c=>{const a=firmNext(c);return a?`<strong>${esc(a.title)}</strong><small>${due(a)}</small>`:['open','followup'].includes(companyStatus(c))?'<span class="needs-plan">Noch nicht geplant</span>':'<span class="muted">—</span>'};
const taskGroup=(label,rows,empty)=>'<section class="panel clear-panel"><div class="panel-head"><h3>'+esc(label)+' <span class="tab-count">'+rows.length+'</span></h3></div>'+
 rows.map(a=>{
  const isAppointment=a.source==='appointment';
  const controls=a.status==='open'?
    '<div class="task-actions">'+button('Erledigt','complete',a.key,'small')+
    (isAppointment?button('Absagen','appointment-cancel',a.id,'small')+
    button('Entfernen','appointment-archive',a.id,'small'):'')+'</div>':
    a.status==='archived'&&isAppointment?button('Wiederherstellen','appointment-restore',a.id,'small'):
    a.status==='done'?(button('Wieder öffnen','reopen',a.key,'small')+(isAppointment?button('Entfernen','appointment-archive',a.id,'small'):'')):
    isAppointment?button('Entfernen','appointment-archive',a.id,'small'):badge('Abgesagt');
  return '<div class="clear-task '+(a.status==='done'?'completed-task':'')+'"><div class="task-icon">'+icon(a.kind)+
   '</div><div class="task-copy"><button class="row-button main-link" data-action="activity-edit" data-id="'+a.key+'">'+esc(a.title)+
   '</button><small>'+(a.company_id?'<a class="firm-link" href="#company/'+a.company_id+'">'+esc(company(a.company_id).name)+'</a>':'Allgemein')+'</small></div>'+
   '<div class="task-date">'+(a.status==='done'?'<span class="muted">Erledigt '+esc(stamp(a.updated_at))+'</span>':due(a))+'</div>'+
   controls+'</div>';
 }).join('')+(rows.length?'':'<div class="panel-body empty-copy">'+esc(empty)+'</div>')+'</section>';
const blocked=d=>Boolean(d.do_not_contact||company(d.company_id).do_not_contact);
const inScope=r=>scope==='all'||scope==='none'?!((scope==='none')&&r.owner_id):r.owner_id===Number(scope==='mine'?actor:scope);
const matches=(...v)=>v.join(' ').toLocaleLowerCase('de').includes(query.toLocaleLowerCase('de'));
const badge=(s,c='')=>`<span class="badge ${c}">${esc(s)}</span>`;
const stageBadge=d=>blocked(d)?badge('Kontaktstopp','red'):d.stage==='won'&&d.disposition==='active'?badge('Gewonnen','green'):d.disposition==='no_interest'?badge('Kein Interesse','red'):d.disposition!=='active'?badge('Verloren','red'):badge(PHASES[phase(d)]||d.stage,'purple');
const dueState=a=>!a.date?'undated':a.date<today()?'overdue':a.date===today()?'today':'upcoming';
const due=a=>badge(!a.date?'Ohne Datum':a.date===today()?'Heute'+(a.time?' · '+a.time:''):dateLabel(a.date)+(a.time?' · '+a.time:''),dueState(a)==='overdue'?'red':dueState(a)==='today'?'purple':'');
const button=(label,action,id='',cls='')=>`<button class="button ${cls}" data-action="${action}" data-id="${esc(id)}">${esc(label)}</button>`;
const blank=(title,text)=>`<div class="empty">${icon('check')}<h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;
const options=(obj,selected)=>Object.entries(obj).map(([v,l])=>`<option value="${esc(v)}" ${String(selected??'')===String(v)?'selected':''}>${esc(l)}</option>`).join('');
const ownerOptions=selected=>options({'':'Nicht zugewiesen',...Object.fromEntries(data.crm_members.filter(m=>m.active||m.id===selected).map(m=>[m.id,m.name+(m.active?'':' (inaktiv)')]))},selected);
const scopeSelect=()=>`<label class="scope-label">Zuständig <select class="filter-select" id="scope">${options({all:'Gesamtes Team',mine:'Meine Vorgänge',none:'Nicht zugewiesen',...Object.fromEntries(data.crm_members.filter(m=>m.active).map(m=>[m.id,m.name]))},scope)}</select></label>`;
const head=(title,subtitle,actions='',eyebrow='WORKSPACE')=>`<section class="page-head"><div><span class="eyebrow">${esc(eyebrow)}</span><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="actions">${actions}</div></section>`;
const toolbar=(placeholder,extra='')=>`<div class="toolbar"><input id="localSearch" aria-label="${esc(placeholder)}" placeholder="${esc(placeholder)}" value="${esc(query)}">${extra}<div class="push">${scopeSelect()}</div></div>`;
const tabs=items=>`<div class="tabs">${items.map(([v,l,n])=>`<button class="tab ${filter===v?'active':''}" data-filter="${v}">${l}${n===undefined?'':`<span class="tab-count">${n}</span>`}</button>`).join('')}</div>`;
function paginate(rows,render,columns){const total=rows.length;page=Math.min(page,Math.max(1,Math.ceil(total/30)));const slice=rows.slice((page-1)*30,page*30);return `<div class="panel"><div class="table-wrap"><table>${columns}<tbody>${slice.map(render).join('')||'<tr><td colspan="7">Keine Einträge für diese Auswahl.</td></tr>'}</tbody></table></div><div class="pagination"><span>${total?`${(page-1)*30+1}–${Math.min(page*30,total)} von ${total}`:'0 Einträge'}</span><div class="actions"><button class="button small" data-page="${page-1}" ${page<=1?'disabled':''}>Zurück</button><button class="button small" data-page="${page+1}" ${page*30>=total?'disabled':''}>Weiter</button></div></div></div>`}
async function request(path,opts={}){const r=await fetch(path,{cache:'no-store',...opts,headers:{'Content-Type':'application/json',...opts.headers}});let j;try{j=await r.json()}catch{throw Error('Der Server hat keine gültige Antwort geliefert. Bitte das CRM neu starten.')}if(!r.ok){if(r.status===401){location.replace('/login.html');throw Error('Sitzung beendet.')}const e=Error(j.error||'Anfrage fehlgeschlagen');e.status=r.status;throw e}return j}
function toast(s){$('#toast').textContent=s;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,4200)}
function applySnapshot(fresh){if(fresh?.version!=='9.9.1'||!fresh.session)throw Error('Falscher CRM-Server.');data=fresh;actor=data.session.member_id;$('#actor').innerHTML=options({[actor]:data.session.name},actor);$('#actor').disabled=true;$('#avatar').textContent=initials(data.session.name);$('#updateBanner').hidden=true;$('#syncStatus').textContent='Synchronisiert · '+new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});render()}
async function reload(){applySnapshot(await request('/api/crm'))}
async function command(op,id,values,revision=data.revision){const r=await request('/api/crm',{method:'POST',body:JSON.stringify({op,id:id||null,values,actor_id:actor,revision})});await reload();return r}
let agendaCache=null, agendaRevision='';
function agenda(){if(agendaRevision===data.revision&&agendaCache)return agendaCache;const rows=data.tasks.map(t=>({...t,key:'task:'+t.id,source:'task',date:t.due_date,time:t.due_time,kind:t.kind||'task'}));for(const a of data.appointments)rows.push({...a,key:'appointment:'+a.id,source:'appointment',date:a.start_at.slice(0,10),time:a.start_at.slice(11,16),status:a.status==='planned'?'open':a.status});for(const d of data.deals)if(d.next_follow_up&&open(d)&&!blocked(d))rows.push({id:d.id,key:'followup:'+d.id,source:'followup',title:ACTIONS[d.next_action]||'Wiedervorlage',date:d.next_follow_up,time:d.next_follow_up_time,kind:d.next_action==='call'?'call':'task',status:'open',owner_id:d.owner_id,deal_id:d.id,company_id:d.company_id,notes:'Aus deiner bisherigen Wiedervorlage übernommen.',next_action:d.next_action});agendaRevision=data.revision;return agendaCache=rows.sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999')||(a.time||'23:59').localeCompare(b.time||'23:59')||a.id-b.id)}
const pending=d=>agenda().filter(a=>a.deal_id===d.id&&a.status==='open');
function taskRow(a){return `<div class="task-row"><button class="check" data-action="complete" data-id="${a.key}" aria-label="${esc(a.title)} erledigen">${a.status==='done'?'✓':''}</button><span class="task-icon">${icon(a.kind)}</span><div class="task-copy"><button class="row-button" data-action="activity-edit" data-id="${a.key}"><strong>${esc(a.title)}</strong></button><small>${a.deal_id?`<a class="main-link" href="#company/${a.company_id}">${esc(company(a.company_id).name)}</a>`:esc(company(a.company_id).name)}</small></div><span class="due">${due(a)}</span></div>`}
function workRow(a){return `<div class="task-row"><span class="task-icon">${icon(a.kind)}</span><div class="task-copy"><strong>${esc(a.title)}</strong><small>${esc(company(a.company_id).name)} · ${member(a.owner_id)?esc(member(a.owner_id).name):'Nicht zugewiesen'}</small></div>${due(a)}${a.company_id?`<a class="button small" href="#company/${a.company_id}">Firma öffnen</a>`:button('Aufgabe öffnen','activity-edit',a.key,'small')}</div>`}
function renderOverviewLegacy(){const all=agenda().filter(a=>a.status==='open'&&inScope(a)),dueNow=all.filter(a=>a.date&&a.date<=today()),upcoming=all.filter(a=>a.date>today()),firms=[...new Set(data.deals.filter(d=>open(d)&&!blocked(d)&&inScope(d)).map(d=>d.company_id))],missing=firms.filter(id=>!all.some(a=>a.company_id===id&&a.date));return head('Dein Arbeitstag','Firma öffnen. Kontakt festhalten. Nächsten Schritt planen.',button('+ Firma hinzufügen','company-new','','primary'),'KAISER WEBDESIGN')+`<div class="toolbar"><span class="quiet-note">${new Date().toLocaleDateString('de-DE',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</span><div class="push">${scopeSelect()}</div></div><div class="stats daily-stats"><a class="stat" href="#activities"><span class="stat-label">Heute zu erledigen ${icon('clock')}</span><strong>${dueNow.length}</strong><small>Inklusive überfälliger Aufgaben</small></a><a class="stat" href="#contacts"><span class="stat-label">Firmen in Bearbeitung ${icon('company')}</span><strong>${firms.length}</strong><small>Mit offenem Anliegen</small></a><button class="stat" data-action="missing-firms"><span class="stat-label">Ohne nächsten Termin ${icon('activities')}</span><strong>${missing.length}</strong><small>Hier fehlt noch eine Planung</small></button></div><div class="columns"><div><section class="panel"><div class="panel-head"><div><h3>Damit geht es heute weiter</h3><p>Öffne die Firma – dort erledigst du den ganzen Vorgang.</p></div></div>${dueNow.slice(0,12).map(workRow).join('')||blank('Heute ist nichts fällig','Du kannst eine Firma öffnen oder die nächsten geplanten Aufgaben ansehen.')}${dueNow.length>12?'<div class="panel-body"><a class="text-link" href="#activities">Alle fälligen Aufgaben ansehen</a></div>':''}</section><section class="panel section-gap"><div class="panel-head"><h3>Als Nächstes geplant</h3><a class="text-link" href="#activities">Alle Aufgaben</a></div>${upcoming.slice(0,5).map(workRow).join('')||blank('Noch keine weiteren Termine','Den nächsten Schritt planst du direkt bei der jeweiligen Firma.')}</section></div><aside><section class="panel" id="missingFirms"><div class="panel-head"><h3>Hier fehlt ein nächster Schritt</h3></div>${missing.slice(0,8).map(id=>`<div class="task-row"><div class="task-copy"><strong>${esc(company(id).name)}</strong><small>Noch kein Termin geplant</small></div><a class="button small" href="#company/${id}">Öffnen</a></div>`).join('')||blank('Alle Firmen sind eingeplant','Für die offenen Anliegen ist ein nächster Termin vorhanden.')}<div class="panel-body"><a class="text-link" href="#contacts">Alle Firmen ansehen</a></div></section><section class="panel section-gap"><div class="panel-head"><h3>Dein normaler Ablauf</h3></div><div class="panel-body"><div class="help-steps"><div class="help-step"><span>1</span><span><b>Firma öffnen</b>Telefonnummer, Notizen und Aufgaben stehen zusammen.</span></div><div class="help-step"><span>2</span><span><b>Kontakt festhalten</b>Notiere kurz, was besprochen wurde.</span></div><div class="help-step"><span>3</span><span><b>Nächsten Schritt wählen</b>Direkt im selben Formular planen – anschließend zurück zur Liste.</span></div></div></div></section></aside></div>`}

function renderFollowups(){
 const rows=data.deals.filter(d=>d.disposition==='active'&&d.stage!=='won'&&!blocked(d)&&d.next_follow_up&&inScope(d)&&matches(company(d.company_id).name,d.title))
 .sort((a,b)=>(a.next_follow_up||'').localeCompare(b.next_follow_up||'')||(a.next_follow_up_time||'').localeCompare(b.next_follow_up_time||''));
 const dueRows=rows.filter(d=>d.next_follow_up<=today()),later=rows.filter(d=>d.next_follow_up>today());
 const line=d=>'<article class="followup-row"><span class="followup-date '+(d.next_follow_up<today()?'late':'')+'">'+(d.next_follow_up<today()?'Überfällig · ':d.next_follow_up===today()?'Heute · ':'')+esc(dateLabel(d.next_follow_up))+'</span><div class="followup-copy"><a class="followup-name" href="#company/'+d.company_id+'">'+esc(company(d.company_id).name)+'</a><small>'+esc(d.title)+' · '+esc(d.next_action==='call'?'Anrufen':'Nachfassen')+'</small></div><div class="followup-controls">'+button('Erreicht','pipeline-reached',d.id,'small action-positive')+button('Nicht erreicht','pipeline-missed',d.id,'small')+'<a class="button small" href="#company/'+d.company_id+'">Öffnen</a></div></article>';
 return head('Nachfassen','Alle Rückrufe mit Datum – auch Leads, die du vor drei Tagen nicht erreicht hast.','','WIEDERVORLAGEN')+
 '<div class="followup-summary"><div><span>Heute & überfällig</span><strong>'+dueRows.length+'</strong></div><div><span>Später geplant</span><strong>'+later.length+'</strong></div><div><span>Alle Wiedervorlagen</span><strong>'+rows.length+'</strong></div></div>'+
 toolbar('Firma oder Anliegen suchen …')+
 '<section class="panel followup-list"><div class="panel-head"><h3>Jetzt nachfassen</h3><span class="tab-count">'+dueRows.length+'</span></div>'+(dueRows.map(line).join('')||'<div class="panel-body empty-copy">Keine fälligen Rückrufe.</div>')+'</section>'+
 '<section class="panel followup-list section-gap"><div class="panel-head"><h3>Demnächst</h3><span class="tab-count">'+later.length+'</span></div>'+(later.map(line).join('')||'<div class="panel-body empty-copy">Keine weiteren Wiedervorlagen.</div>')+'</section>';
}
function renderActivities(){
 const all=agenda().filter(inScope), matchesRows=all.filter(a=>matches(a.title,company(a.company_id).name)), active=all.filter(a=>a.status==='open'), done=all.filter(a=>a.status==='done'), completedToday=done.filter(a=>(a.updated_at||'').slice(0,10)===today());
 const now=matchesRows.filter(a=>a.status==='open'&&a.date&&a.date<=today()), planned=matchesRows.filter(a=>a.status==='open'&&a.date>today()), undated=matchesRows.filter(a=>a.status==='open'&&!a.date), archived=matchesRows.filter(a=>a.status==='done').sort((a,b)=>(b.updated_at||'').localeCompare(a.updated_at||'')||b.id-a.id);
 return head('Aufgaben & Termine','Offene Aufgaben abarbeiten. Erledigte bleiben im Archiv erhalten.',button('+ Aufgabe planen','task-new','','primary'),'PLANUNG')+`<section class="panel filter-panel"><div class="filter-top"><input id="localSearch" placeholder="Aufgabe oder Firma suchen …" aria-label="Aufgaben suchen" value="${esc(query)}">${scopeSelect()}</div>`+tabs([['due','Heute & überfällig',active.filter(a=>a.date&&a.date<=today()).length],['open','Alle offenen',active.length],['upcoming','Später geplant',active.filter(a=>a.date>today()).length],['done','Erledigt',done.length],...(all.some(a=>a.status==='cancelled')||filter==='cancelled'?[['cancelled','Abgesagt',all.filter(a=>a.status==='cancelled').length]]:[])])+`</section><div class="clear-stack">`+(filter==='done'?taskGroup('Aufgabenarchiv',archived,'Noch keine erledigten Aufgaben.'):filter==='cancelled'?taskGroup('Abgesagt',matchesRows.filter(a=>a.status==='cancelled'),'Keine abgesagten Aufgaben.'):filter==='upcoming'?taskGroup('Kommende Termine',planned,'Keine späteren Termine geplant.'):filter==='undated'?taskGroup('Ohne Datum',undated,'Keine Aufgaben ohne Datum.'):taskGroup('Heute & überfällig',now,'Für heute ist nichts mehr fällig.')+(filter==='open'?taskGroup('Später geplant',planned,'Keine kommenden Termine.')+taskGroup('Ohne Datum',undated,'Keine Aufgaben ohne Datum.'):undated.length?taskGroup('Ohne Datum',undated,''):'')+`<section class="panel clear-panel done-section"><div class="panel-head"><h3>Heute erledigt <span class="tab-count">${completedToday.length}</span></h3><button class="text-link" data-filter="done">Alle erledigten Aufgaben →</button></div>${completedToday.filter(a=>matches(a.title,company(a.company_id).name)).map(a=>`<div class="clear-task completed-task"><span class="task-icon">${icon('check')}</span><div class="task-copy"><strong>${esc(a.title)}</strong><small>${esc(company(a.company_id).name)} · ${esc(stamp(a.updated_at))}</small></div>${button('Wieder öffnen','reopen',a.key,'small')}</div>`).join('')||'<div class="panel-body empty-copy">Heute noch nichts abgeschlossen.</div>'}</section>`)+`</div>`;
}
function dealRows(){return data.deals.filter(d=>inScope(d)&&matches(d.title,company(d.company_id).name)&&(filter==='won'?d.stage==='won'&&d.disposition==='active':filter==='no_interest'?d.disposition==='no_interest':filter==='lost'?d.disposition!=='active'&&d.disposition!=='no_interest':filter==='stopped'?blocked(d):open(d)&&!blocked(d)&&(filter!=='unplanned'||!pending(d).some(a=>a.date)))).sort((a,b)=>b.id-a.id)}
function dealTable(rows){return paginate(rows,d=>`<tr><td><a class="main-link" href="#company/${d.company_id}">${esc(d.title)}</a><small>${esc(company(d.company_id).name)}</small></td><td>${stageBadge(d)}</td><td>${money(d.value)}</td><td>${owner(d.owner_id)}</td><td>${pending(d)[0]?due(pending(d)[0]):badge('Keine Aktivität','orange')}</td></tr>`,'<thead><tr><th>Verkaufschance</th><th>Phase / Status</th><th>Wert</th><th>Zuständig</th><th>Nächste Aktivität</th></tr></thead>')}
function pipelineCard(d){
 const c=company(d.company_id),a=pending(d)[0],label=PHASES[phase(d)]||'In Bearbeitung',p=d.priority||'medium';
 const next=phase(d)==='new'||phase(d)==='contacted'?button('Nicht erreicht','pipeline-missed',d.id,'small')+button('Erreicht','pipeline-reached',d.id,'small action-positive'):
   phase(d)==='reached'?button('Interesse','pipeline-interest',d.id,'small action-positive')+button('Kein Interesse','pipeline-decline',d.id,'small'):
   phase(d)==='interest'?button('E-Mail-Angebot','pipeline-offer',d.id,'small')+button('Demo-Angebot','pipeline-demo',d.id,'small'):
   button('Zusage / Projekt','pipeline-win',d.id,'small action-positive')+button('Kein Interesse','pipeline-decline',d.id,'small');
 return `<article class="lead-card" draggable="true" data-drag-deal="${d.id}">
  <div class="lead-card-top"><span class="lead-phase">${esc(label)}</span><span class="lead-priority priority-${esc(p)}">${esc({high:'● Hoch',medium:'● Mittel',low:'● Niedrig'}[p]||'● Mittel')}</span></div>
  <a class="lead-title" href="#company/${d.company_id}">${esc(c.name)}</a>
  <p class="lead-subtitle">${esc(d.title)}</p>
  <div class="lead-card-meta"><span>${owner(d.owner_id)}</span><span>${a?due(a):'<small>Keine Wiedervorlage</small>'}</span></div>
  <div class="lead-card-actions">${next}<button class="button small" data-action="pipeline-contact" data-id="${d.company_id}">Kontakt</button></div>
  <div class="lead-card-bottom"><label>Priorität<select data-priority-deal="${d.id}" aria-label="Priorität für ${esc(c.name)}">${options({high:'Hoch',medium:'Mittel',low:'Niedrig'},p)}</select></label><label>Weiterleiten<select data-move-deal="${d.id}" aria-label="Status für ${esc(c.name)}"><option value="">Status wählen</option>${options({...PHASES,not_reached:'Nicht erreicht · +3 Tage',reached:'Erreicht · Interesse offen',building:'Zusage · In Bearbeitung',no_interest:'Kein Interesse'},'')}</select></label></div>
 </article>`;
}
function processingCard(d){
 const p=data.projects.find(x=>x.deal_id===d.id&&x.status!=='archived'&&x.status!=='done');
 return '<article class="lead-card processing-card"><div class="lead-card-top"><span class="lead-phase">In Bearbeitung</span><span class="lead-priority priority-low">'+esc(p?PROJECTS[p.status]||p.status:'Projekt')+'</span></div>'+
 '<a class="lead-title" href="#company/'+d.company_id+'">'+esc(company(d.company_id).name)+'</a><p class="lead-subtitle">'+esc(p?.name||d.title)+'</p>'+
 '<div class="lead-card-meta"><strong>'+money(d.value)+'</strong><span>'+owner(d.owner_id)+'</span></div>'+
 '<div class="lead-card-actions"><a class="button small" href="#company/'+d.company_id+'">Projekt öffnen</a>'+(p?button('Abschließen','project-complete',p.id,'small action-positive'):'')+'</div></article>';
}
function renderSales(){
 const rows=dealRows(), active=rows.filter(d=>open(d)&&!blocked(d)&&phase(d)!=='followup');
 const processing=filter==='open'?data.deals.filter(d=>d.stage==='won'&&d.disposition==='active'&&!blocked(d)&&inScope(d)&&matches(d.title,company(d.company_id).name)&&data.projects.some(p=>p.deal_id===d.id&&p.status!=='done'&&p.status!=='archived')):[];
 const boardDeals=[...active,...processing];
 const shown=boardDeals.filter(d=>mobilePipelineStage==='all'||(d.stage==='won'?'won':phase(d))===mobilePipelineStage);
 const sorted=items=>items.sort((a,b)=>({high:0,medium:1,low:2}[a.priority||'medium']??1)-({high:0,medium:1,low:2}[b.priority||'medium']??1)||String(a.next_follow_up||'9999').localeCompare(String(b.next_follow_up||'9999'))||b.id-a.id);
 const intro=head('Lead-Pipeline','Neu → Kontaktversuch → Erreicht → Interesse → Angebot / Demo → In Bearbeitung. Nachfassen steht separat.',button('+ Lead anlegen','lead-manual','','primary'),'AKQUISE · TEAM');
 const filters=tabs([['open','Aktiv',data.deals.filter(d=>open(d)&&!blocked(d)).length],['unplanned','Ohne Planung'],['won','Zusage'],['no_interest','Kein Interesse'],['lost','Verloren'],['stopped','Kontaktstopp']]);
 const counts=Object.fromEntries(Object.keys(PIPELINE_COLUMNS).map(k=>[k,k==='won'?processing.length:active.filter(d=>phase(d)===k).length]));
 const header='<div class="sales-quicklink"><a href="#followups">Rückrufe / Nachfassen ansehen</a><span>Nach 3 Tagen automatisch fällig</span></div>'+filters+toolbar('Firma, Angebot oder Ansprechpartner …',`<select id="salesView" aria-label="Darstellung">${options({board:'Pipeline',list:'Liste'},view)}</select>`);
 if(view==='list'||!['open','unplanned'].includes(filter))return intro+header+dealTable(rows);
 const desktop=`<div class="pipeline-desktop" aria-label="Vertriebsphasen" role="region" tabindex="0"><div class="kanban pipeline-board">${Object.entries(PIPELINE_COLUMNS).map(([k,l],i)=>`<section class="kanban-column pipeline-column" data-drop-stage="${k}"><header class="kanban-head"><h3><i class="pipeline-color" style="background:${PHASE_COLORS[i]}"></i>${esc(l)}<span class="tab-count">${counts[k]}</span></h3></header>${sorted(k==='won'?processing:active.filter(d=>phase(d)===k)).map(d=>k==='won'?processingCard(d):pipelineCard(d)).join('')||'<div class="empty-column">Hier ist noch kein Lead.</div>'}</section>`).join('')}</div></div>`;
 const mobile=`<section class="pipeline-mobile"><label class="mobile-pipeline-filter">Anzeigen<select id="mobilePhase" aria-label="Pipeline-Phase filtern">${options({all:'Alle aktiven Leads',...Object.fromEntries(Object.entries(PIPELINE_COLUMNS).map(([k,l])=>[k,l+' ('+counts[k]+')']))},mobilePipelineStage)}</select></label><p class="pipeline-mobile-caption">Status ändern, Notiz erfassen oder direkt anrufen – ohne Drag & Drop.</p><div class="pipeline-mobile-cards">${sorted(shown).map(d=>d.stage==='won'?processingCard(d):pipelineCard(d)).join('')||'<p class="empty-column">Keine Leads in dieser Phase.</p>'}</div></section>`;
 return intro+`<div class="pipeline-topline"><div><strong>${active.length}</strong><span>aktive Leads</span></div><div><strong>${data.deals.filter(d=>d.next_follow_up&&d.next_follow_up<=today()&&open(d)).length}</strong><span>heute nachfassen</span></div><div><strong>${processing.length}</strong><span>in Bearbeitung</span></div></div>`+header+desktop+mobile;
}

function renderContacts(){
 const people=filter==='people', firms=data.companies.filter(c=>matches(c.name,c.city,c.industry,c.email,c.phone)), statuses=['open','followup','won','no_interest','none','lost','stopped'];
 const rows=people?data.contacts.filter(c=>matches(c.first_name,c.last_name,c.email,company(c.company_id).name)):firms.filter(c=>filter==='companies'||(filter==='unplanned'?['open','followup','none'].includes(companyStatus(c))&&!firmNext(c):companyStatus(c)===filter));
 return head('Firmen & Kontakte','Wähle eine Firma aus. Dort findest du alle Informationen und kannst direkt weiterarbeiten.',button(people?'+ Ansprechpartner':'+ Firma anlegen',people?'contact-new':'company-new','','primary'),'ADRESSBUCH')+
 `<section class="panel filter-panel"><div class="filter-top"><input id="localSearch" aria-label="Firmen oder Personen suchen" placeholder="Name, Ort, Telefonnummer …" value="${esc(query)}">${button('Excel importieren','import','','small')}</div><div class="firm-filters"><div class="mode-switch">${tabs([['companies','Alle Firmen',firms.length],['people','Ansprechpartner',data.contacts.length]])}</div><label class="scope-label">Firmenstatus <select id="firmStatus" class="filter-select" ${people?'disabled':''}>${options({companies:'Alle Status',...Object.fromEntries(statuses.map(k=>[k,STATUS_LABELS[k]+' ('+firms.filter(c=>companyStatus(c)===k).length+')'])),unplanned:'Ohne nächsten Schritt'},people?'companies':filter)}</select></label></div><div class="filter-summary">${rows.length} ${people?'Personen':'Firmen'} · ${people?'Ansprechpartner aller Firmen':filter==='companies'?'Alle Firmenstatus':STATUS_LABELS[filter]||(filter==='unplanned'?'Ohne Planung':'Alle Firmen')}</div></section>`+
 paginate(rows,c=>people?`<tr><td><button class="row-button main-link" data-action="contact-edit" data-id="${c.id}">${esc([c.first_name,c.last_name].filter(Boolean).join(' '))}</button><small>${esc(c.role)}</small></td><td><a class="firm-link" href="#company/${c.company_id}">${esc(company(c.company_id).name)}</a></td><td>${esc(c.email||'—')}</td><td>${esc(c.phone||'—')}</td></tr>`:`<tr class="firm-row"><td><a class="company-cell" href="#company/${c.id}"><span class="company-icon">${esc(initials(c.name))}</span><span class="main-link">${esc(c.name)}<small>${esc([c.industry,c.city].filter(Boolean).join(' · ')||'—')}</small></span></a></td><td>${companyStatusBadge(c)}</td><td>${nextLabel(c)}</td><td>${c.phone?contactLinks(c)[0][1]:c.email?contactLinks(c)[1][1]:'—'}</td><td><div class="firm-actions"><a class="button small open-firm" href="#company/${c.id}">Öffnen</a>${!c.do_not_contact?button('Kontakt festhalten','conversation',c.id,'small'): ''}</div></td></tr>`,people?'<thead><tr><th>Name</th><th>Firma</th><th>E-Mail</th><th>Telefon</th></tr></thead>':'<thead><tr><th>Firma</th><th>Status</th><th>Nächster Schritt</th><th>Kontakt</th><th></th></tr></thead>')
}
function timeline(rows){return `<div class="timeline">${rows.filter(a=>!a.undone_at).sort((a,b)=>b.occurred_at.localeCompare(a.occurred_at)||b.id-a.id).slice(0,100).map(a=>{let m={};try{m=JSON.parse(a.metadata)}catch{}return `<article class="timeline-item"><span class="task-icon">${icon(a.type)}</span><div class="timeline-copy"><header><strong>${esc(a.subject)}</strong><small>${stamp(a.occurred_at)}</small></header><small>${esc(m.actor_name||'Bestehender Verlauf · ohne Teamzuordnung')}</small>${a.body?`<p>${esc(a.body)}</p>`:''}</div></article>`}).join('')||blank('Noch kein Verlauf','Notizen und protokollierte Aktivitäten erscheinen hier.')} ${rows.length>100?'<p class="quiet-note">Die letzten 100 Einträge werden angezeigt. Der vollständige Verlauf bleibt im Backup erhalten.</p>':''}</div>`}
function definition(items){return `<dl class="detail-fields">${items.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${value||'<span class="muted">Nicht hinterlegt</span>'}</dd></div>`).join('')}</dl>`}
function contactLinks(c){const tel=String(c.phone||'').replace(/[^+\d]/g,'');const email=String(c.email||'');return [['Telefon',tel?`<a href="tel:${tel}">${esc(c.phone)}</a>`:''],['E-Mail',email?`<a href="mailto:${esc(encodeURIComponent(email))}">${esc(email)}</a>`:'']]}
function renderDeal(id){const d=find('deals',id);if(!d)return blank('Verkaufschance nicht gefunden','Öffne einen vorhandenen Vorgang im Vertrieb.');const c=company(d.company_id),ct=find('contacts',d.contact_id),steps=pending(d),pi=Object.keys(PIPELINE_COLUMNS).indexOf(d.stage==='won'?'won':phase(d));return `<section class="page-head"><div><span class="eyebrow">VERKAUFSCHANCE</span><div class="detail-heading"><h1>${esc(d.title)}</h1></div><div class="detail-sub"><a class="text-link" href="#company/${c.id}">${esc(c.name)}</a><span>·</span>${stageBadge(d)}</div></div><div class="actions">${button('Stammdaten bearbeiten','deal-edit',d.id)}${(d.stage==='won'&&d.disposition==='active'?button('Zurück in Vertrieb','customer-reopen',d.id,'primary'):button('Phase / Abschluss','stage',d.id,'primary'))}</div></section>${blocked(d)?'<div class="notice">Kontaktstopp für dieses Unternehmen. Prüfe bestehende Aktivitäten vor einer Kontaktaufnahme. Interne Notizen bleiben möglich.</div>':''}<div class="detail-layout"><div><section class="panel"><div class="panel-head"><h3>Verkaufsfortschritt</h3><strong>${money(d.value)}</strong></div><div class="stage-track">${Object.entries(PIPELINE_COLUMNS).map(([k,l],i)=>`<div class="stage-step ${d.stage==='won'||i<pi?'passed':''} ${i===pi?'current':''}">${l}</div>`).join('')}</div><div class="detail-actions">${button('Gespräch / Aktivität erfassen','log',d.id,'primary')}${button('Notiz hinzufügen','note',d.id)}${button('+ Aufgabe planen','task-for',d.id)}</div></section><section class="panel section-gap"><div class="panel-head"><div><h3>Nächste Aktivitäten <span class="tab-count">${steps.length}</span></h3><p>Planung ist unabhängig von der Verkaufsphase.</p></div></div>${steps.map(taskRow).join('')||blank('Nächsten Schritt festlegen','Plane eine Aktivität mit Datum und Zuständigkeit.')}</section><section class="panel section-gap"><div class="panel-head"><h3>Verlauf</h3><span class="quiet-note">Neueste zuerst</span></div>${timeline(data.activities.filter(a=>a.deal_id===d.id))}</section></div><aside><section class="panel"><div class="panel-head"><h3>Auf einen Blick</h3></div>${definition([['Verantwortlich',owner(d.owner_id)],['Auftragswert',money(d.value)],['Bedarf / Ziel',esc(d.need_summary)],['Verlustgrund',esc(d.lost_reason)],['Angelegt',dateLabel(d.created_at)]])}</section><section class="panel section-gap"><div class="panel-head"><h3>${ct?'Ansprechpartner':'Unternehmen'}</h3><a class="text-link" href="#company/${c.id}">Akte öffnen</a></div>${definition([['Name',esc(ct?[ct.first_name,ct.last_name].join(' '):c.name)],...contactLinks(ct||c)])}</section>${d.notes?`<section class="panel section-gap"><div class="panel-head"><h3>Bestehende Notizen</h3></div>${definition([['Aus V8 übernommen',esc(d.notes)]])}</section>`:''}</aside></div>`}
function companyQuick(c,ds,tasks){const available=ds.filter(nonWon),d=available.length===1?available[0]:null, next=tasks[0];return `<section class="company-quick"><div class="quick-main"><div class="quick-title"><span class="eyebrow">KUNDENSTATUS</span>${companyStatusBadge(c)}</div><div class="quick-contact">${contactLinks(c).filter(([k,v])=>v).map(([k,v])=>`<span>${v}</span>`).join('')||'<span class="muted">Keine Kontaktdaten hinterlegt</span>'}</div><div class="quick-next">${next?`<strong>${esc(next.title)}</strong> · ${due(next)}`:'Kein nächster Schritt geplant'}</div></div><div class="quick-actions">${available.length&&!c.do_not_contact?button('Nachfassen','quick-followup',c.id,'primary')+button('Kein Interesse','quick-no-interest',c.id,'danger')+button('Wieder offen','quick-open',c.id):''}${!ds.length?button('Anliegen anlegen','deal-company',c.id):''}${d?button('Phase / Abschluss','stage',d.id,'small'):''}</div></section>`}
function quickStatusEditor(cid,status,preferred){const ds=data.deals.filter(d=>d.company_id===cid&&nonWon(d));if(!ds.length){const label={followup:'Nachfassen planen',no_interest:'Kein Interesse',open:'In Bearbeitung'}[status];return edit(label,(status==='followup'?field('Datum','due_date',today(),'date',false,true)+field('Uhrzeit · optional','due_time','','time'):'')+textarea('Notiz · optional','reason')+help('Der Status wird direkt bei der Firma gespeichert.'),v=>command('company_quick_status',cid,{...v,status},dialogRevision),label);}const selected=ds.find(d=>d.id===preferred)||ds.find(open)||ds[0],label={followup:'Nachfassen planen',no_interest:'Kein Interesse',open:'In Bearbeitung'}[status];edit(label,(ds.length===1?`<input type="hidden" name="deal_id" value="${selected.id}">`:selectField('Anliegen','deal_id',Object.fromEntries(ds.map(d=>[d.id,d.title])),selected.id,true))+(status==='followup'?field('Datum','due_date',selected.next_follow_up||today(),'date',false,true)+field('Uhrzeit · optional','due_time',selected.next_follow_up_time||'','time'):'')+textarea('Notiz · optional','reason')+help(status==='no_interest'?'Die Firma wird als Kein Interesse markiert. Alte Wiedervorlagen entfallen; selbst angelegte Aufgaben bleiben sichtbar.':'Der Status wird direkt gespeichert. Andere Anliegen der Firma bleiben unverändert.'),v=>command('quick_status',Number(v.deal_id),{...v,status},dialogRevision),label)}
function renderCompanyLegacy(id){const c=find('companies',id);if(!c)return blank('Firma nicht gefunden','Wähle eine Firma unter Firmen & Kontakte.');const ds=data.deals.filter(d=>d.company_id===c.id),cs=data.contacts.filter(t=>t.company_id===c.id),tasks=agenda().filter(a=>a.company_id===c.id&&a.status==='open');let url='';try{const u=new URL(c.website.startsWith('http')?c.website:'https://'+c.website);if(['https:','http:'].includes(u.protocol)&&c.website)url=u.href}catch{}return head(c.name,[c.industry,c.city].filter(Boolean).join(' · ')||'Alles zu dieser Firma an einem Ort',button('Kontakt festhalten','conversation',c.id,'primary')+button('Aufgabe planen','company-task',c.id),'FIRMA')+companyQuick(c,ds,tasks)+`${c.do_not_contact?'<div class="notice">Kontaktstopp aktiv. Interne Notizen und Aufgaben bleiben möglich.</div>':''}<div class="detail-layout"><div><section class="panel"><div class="panel-head"><div><h3>Was steht als Nächstes an?</h3><p>Aufgaben öffnen, ändern oder über „Kontakt festhalten“ abschließen.</p></div><span class="tab-count">${tasks.length}</span></div>${tasks.map(taskRow).join('')||blank('Noch kein nächster Schritt','Nach einem Gespräch kannst du hier direkt den nächsten Termin planen.')}</section><section class="panel section-gap"><div class="panel-head"><div><h3>Was bisher passiert ist</h3><p>Gespräche, Notizen und erledigte Schritte</p></div>${button('+ Notiz','company-note',c.id,'small')}</div>${timeline(data.activities.filter(a=>a.company_id===c.id))}</section><details class="panel section-gap company-deals"><summary>Angebote & Aufträge <span class="tab-count">${ds.length}</span></summary><div class="panel-body"><p class="quiet-note">Nur nötig, wenn du Angebot, Auftragswert oder Abschluss bearbeiten möchtest.</p><div class="section-gap">${button('+ Neues Anliegen / Angebot','deal-company',c.id,'small')}</div></div><div class="table-wrap"><table><tbody>${ds.map(d=>`<tr><td><a class="main-link" href="#deal/${d.id}">${esc(d.title)}</a><small>${owner(d.owner_id)}</small></td><td>${stageBadge(d)}</td><td>${money(d.value)}</td></tr>`).join('')||'<tr><td>Noch kein Angebot angelegt.</td></tr>'}</tbody></table></div></details></div><aside><section class="panel"><div class="panel-head"><h3>Kontakt aufnehmen</h3>${button('Bearbeiten','company-edit',c.id,'small')}</div>${definition([...contactLinks(c),['Website',url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(c.website)}</a>`:''],['Notizen zur Firma',esc(c.notes)]])}</section><section class="panel section-gap"><div class="panel-head"><h3>Ansprechpartner</h3>${button('+ Person','contact-company',c.id,'small')}</div>${cs.map(ct=>`<div class="person-card"><strong>${esc(ct.first_name+' '+ct.last_name)}</strong><small>${esc(ct.role)}</small>${definition(contactLinks(ct))}${button('Person bearbeiten','contact-edit',ct.id,'small')}</div>`).join('')||'<div class="panel-body"><p class="quiet-note">Noch keine Person hinterlegt.</p></div>'}</section><details class="panel section-gap company-deals"><summary>Kontaktfreigabe</summary><div class="panel-body"><p class="quiet-note">Gilt für die ganze Firma.</p><div class="section-gap">${button(c.do_not_contact?'Kontaktstopp prüfen':'Kontaktstopp setzen','stop',c.id,'small danger')}</div></div></details></aside></div>`}

function renderProjects(){
 const all=data.projects.filter(p=>inScope(p)&&matches(p.name,company(p.company_id).name)),
 archived=all.filter(p=>p.status==='archived'),
 active=all.filter(p=>p.status!=='archived'&&p.status!=='done'),
 done=all.filter(p=>p.status==='done'),
 shown=filter==='archived'?archived:filter==='done'?done:filter==='open'?active:all.filter(p=>p.status!=='archived');
 return head('Projekte','Website-, App- und Social-Media-Aufträge. Archivierte Projekte und Kundendateien bleiben erhalten.','','PROJEKTMANAGEMENT')+
  tabs([['open','In Bearbeitung',active.length],['done','Abgeschlossen',done.length],['all','Alle aktiven',active.length+done.length],['archived','Archiv',archived.length]])+
  toolbar('Projekt oder Kunde suchen …')+
  paginate(shown,p=>'<tr><td><button class="row-button main-link" data-action="'+(p.status==='archived'?'project-restore':'project')+'" data-id="'+p.id+'">'+esc(p.name)+'</button><small><a href="#company/'+p.company_id+'">'+esc(company(p.company_id).name)+'</a></small></td>'+
  '<td>'+esc(SERVICE_TYPES[p.service_type]||'Noch zuordnen')+'</td>'+
  '<td>'+badge(PROJECTS[p.status]||p.status,p.status==='done'?'green':'purple')+'</td>'+
  '<td>'+money(p.value)+'</td><td>'+dateLabel(p.deadline)+'</td>'+
  '<td><div class="actions">'+(p.status==='archived'?button('Wiederherstellen','project-restore',p.id,'small'):button('Bearbeiten','project',p.id,'small')+
     button('Dateien','project-files',p.id,'small')+button('Archivieren','project-archive',p.id,'small'))+'</div></td></tr>',
  '<thead><tr><th>Projekt / Unternehmen</th><th>Leistung</th><th>Status</th><th>Auftragswert</th><th>Termin</th><th>Aktionen</th></tr></thead>');
}
const DASHBOARD_GROUPS=[
 {key:'new',label:'Neue Leads',tone:'#2563eb'},
 {key:'contacted',label:'Kontaktaufnahme',tone:'#0891b2'},
 {key:'reached',label:'Erreicht · Interesse offen',tone:'#0ea5a4'},
 {key:'interest',label:'Interesse',tone:'#0d9488'},
 {key:'offer_email',label:'E-Mail-Angebote',tone:'#7c3aed'},
 {key:'offer_demo',label:'Angebotsdemos',tone:'#c026d3'},
 {key:'followup',label:'Nachfassen',tone:'#d97706'},
 {key:'won',label:'Zusage / In Bearbeitung',tone:'#05943f'},
 {key:'completed',label:'Abgeschlossen / Bestand',tone:'#047857'},
 {key:'no_interest',label:'Kein Interesse',tone:'#c75b12'},
 {key:'stopped',label:'Kontaktstopp',tone:'#dc2626'},
 {key:'lost',label:'Verloren / geschlossen',tone:'#475569'}
];
function dashboardGroupForDeal(d){
 if(blocked(d))return 'stopped';
 if(d.disposition==='no_interest')return 'no_interest';
 if(d.disposition!=='active')return 'lost';
 if(d.stage==='won')return data.projects.some(p=>p.deal_id===d.id&&p.status==='done')?'completed':'won';
 const key=phase(d);
 return ['new','contacted','reached','interest','offer_email','offer_demo','followup'].includes(key)?key:'interest';
}
function dashboardDetails(key){
 const g=DASHBOARD_GROUPS.find(x=>x.key===key)||DASHBOARD_GROUPS[0];
 const rows=data.deals.filter(d=>dashboardGroupForDeal(d)===g.key)
  .sort((a,b)=>({high:0,medium:1,low:2}[a.priority||'medium']??1)-({high:0,medium:1,low:2}[b.priority||'medium']??1)
   ||String(a.next_follow_up||'9999').localeCompare(String(b.next_follow_up||'9999'))
   ||company(a.company_id).name.localeCompare(company(b.company_id).name,'de'));
 return '<div class="dashboard-detail-head"><div class="dashboard-detail-heading"><i style="background:'+g.tone+'"></i><div><span class="eyebrow">DETAILANSICHT · LIVE</span><h3>'+esc(g.label)+'</h3></div></div><span class="dashboard-detail-total">'+rows.length+' '+(rows.length===1?'Vorgang':'Vorgänge')+'</span></div>'+
  (rows.length?
   '<div class="dashboard-detail-rows">'+rows.map(d=>{
    const c=company(d.company_id),next=d.next_follow_up&&open(d)&&!blocked(d)?'<span class="dashboard-detail-date">Nächster Schritt: '+esc(dateLabel(d.next_follow_up))+'</span>':'';
    const priority=d.priority==='high'?'<span class="dashboard-detail-priority">Hohe Priorität</span>':'';
    return '<div class="dashboard-detail-row"><div class="dashboard-detail-copy"><a href="#company/'+d.company_id+'" class="dashboard-detail-name">'+esc(c.name)+'</a><small>'+esc(d.title||'Kundenkontakt')+'</small></div><div class="dashboard-detail-extra">'+priority+next+'</div><a class="dashboard-detail-open" href="#company/'+d.company_id+'" aria-label="Firmenakte öffnen: '+esc(c.name)+'">Öffnen</a></div>';
   }).join('')+'</div>':
   '<div class="dashboard-detail-empty">Hier gibt es gerade keine Vorgänge. Wähle eine andere Kategorie im Kreisdiagramm.</div>');
}
function selectDashboardCategory(key){
 if(!DASHBOARD_GROUPS.some(g=>g.key===key))return;
 dashboardCategory=key;
 const box=$('#dashboardSelection');
 if(!box)return;
 box.innerHTML=dashboardDetails(key);
 const group=DASHBOARD_GROUPS.find(g=>g.key===key),count=data.deals.filter(d=>dashboardGroupForDeal(d)===key).length;
 const center=$('#dashboardCenter');if(center){center.style.setProperty('--status-color',group.tone);center.innerHTML=dashboardCenter(group,count,data.deals.length);}
 box.classList.remove('dashboard-detail-reveal');
 void box.offsetWidth;
 box.classList.add('dashboard-detail-reveal');
 $$('[data-action="dashboard-category"]').forEach(b=>{
  const selected=b.dataset.id===key;
  b.classList.toggle('selected',selected);
  b.setAttribute('aria-pressed',selected?'true':'false');
 });
}
function renderSettings(){const admin=data.session.role==='admin';return head('Einstellungen','Team, Zuständigkeiten und zentrale Daten.','','TEAM-WORKSPACE')+`<div class="notice info">Ihr arbeitet gemeinsam in einer zentralen Datenbank. Jede Aktion wird deinem persönlichen Konto zugeordnet.</div><div class="settings-grid"><section class="panel settings-card"><h3>Team & Zuständigkeiten</h3><p>Angemeldet als ${esc(data.session.name)} · ${admin?'Administrator':'Mitarbeiter'}</p>${data.crm_members.map(m=>`<div class="team-row"><span class="profile-avatar">${esc(initials(m.name))}</span><div class="member-info"><strong>${esc(m.name)}</strong><small>${m.active?'Aktiv':'Deaktiviert'}</small></div></div>`).join('')}<p class="quiet-note">Persönliche Konten werden vom Administrator in Supabase freigegeben.</p></section>${admin?`<section class="panel settings-card"><h3>Daten & Sicherung</h3><p>Export und Excel-/CSV-Import stehen der Administration zur Verfügung.</p><div class="actions"><a class="button" href="/api/backup">JSON-Backup herunterladen</a><a class="button" href="/api/export/leads.csv">CSV exportieren</a>${button('Excel / CSV importieren','import')}</div><p class="quiet-note">Eine Wiederherstellung der Team-Datenbank erfolgt ausschließlich durch die Administration außerhalb der App.</p></section>`:''}<section class="panel settings-card"><h3>Synchronisierung</h3><p>Änderungen erscheinen automatisch innerhalb weniger Sekunden. Während der Bearbeitung bleiben deine Eingaben erhalten.</p><p class="quiet-note">Bei parallelen Änderungen wird vor dem Speichern ein Abgleich verlangt.</p></section><section class="panel settings-card"><img class="logo-preview" src="brand-logo-full.png" alt="Kaiser Webdesign Logo"><h3>Kaiser CRM · V9.9.1 PAGES</h3><p>Gemeinsam arbeiten, ohne lokale Datenkopien.</p></section></div>`}
function wirePipeline(){
 let dragged=null;
 $$('[data-drag-deal]').forEach(card=>{card.addEventListener('dragstart',e=>{dragged=Number(card.dataset.dragDeal);e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(dragged));card.classList.add('dragging')});card.addEventListener('dragend',()=>{dragged=null;$$('.drop-active,.dragging').forEach(x=>x.classList.remove('drop-active','dragging'))})});
 $$('[data-drop-stage]').forEach(col=>{col.addEventListener('dragover',e=>{if(dragged!==null){e.preventDefault();e.dataTransfer.dropEffect='move';col.classList.add('drop-active')}});col.addEventListener('dragleave',e=>{if(!col.contains(e.relatedTarget))col.classList.remove('drop-active')});col.addEventListener('drop',async e=>{e.preventDefault();col.classList.remove('drop-active');const id=dragged;dragged=null;if(id===null)return;const d=find('deals',id),stage=col.dataset.dropStage;if(!d||!open(d)||blocked(d)||phase(d)===stage)return;try{if(stage==='won'){pipelineWonEditor(d.id);return}if(stage==='followup'){quickStatusEditor(d.company_id,'followup',d.id);return}await pipelineMove(d.id,stage)}catch(err){toast(err.message)}})});
}
function dashboardCenter(group,count,total){
 const percent=total?new Intl.NumberFormat('de-DE',{maximumFractionDigits:1}).format(count/total*100):'0';
 return '<span class="donut-center-label">'+esc(group.label)+'</span><strong>'+count+'</strong><span class="donut-center-share">'+percent+' % aller Vorgänge</span>';
}
function renderOverview(){
 const items=agenda(),dueNow=items.filter(a=>a.status==='open'&&a.date&&a.date<=today()),
 planned=items.filter(a=>a.status==='open'&&a.date>today());
 const groups=DASHBOARD_GROUPS.map(g=>({...g,count:data.deals.filter(d=>dashboardGroupForDeal(d)===g.key).length}));
 const total=data.deals.length,circumference=2*Math.PI*74;
 const selectedGroup=groups.find(g=>g.key===dashboardCategory)||groups[0];
 let offset=0;
 const slices=groups.map(g=>{
  const dash=total?g.count/total*circumference:0;
  if(!g.count)return '';
  const selected=dashboardCategory===g.key,gap=Math.min(1.6,dash*.15);
  const html='<circle class="donut-arc'+(selected?' selected':'')+'" r="74" cx="100" cy="100" fill="none" stroke="'+g.tone+
    '" stroke-width="24" stroke-dasharray="'+(dash-gap).toFixed(3)+' '+(circumference-dash+gap).toFixed(3)+'" stroke-dashoffset="'+(-offset-gap/2).toFixed(3)+
    '" transform="rotate(-90 100 100)" role="button" tabindex="0" aria-pressed="'+selected+'" aria-label="'+esc(g.label)+': '+g.count+
    '" data-action="dashboard-category" data-id="'+g.key+'"><title>'+esc(g.label)+' · '+g.count+'</title></circle>';
  offset+=dash;return html;
 }).join('');
 const legend=groups.map(g=>'<button type="button" style="--status-color:'+g.tone+'" class="donut-legend-item'+(dashboardCategory===g.key?' selected':'')+
  '" data-action="dashboard-category" data-id="'+g.key+'" aria-pressed="'+(dashboardCategory===g.key)+
  '"><i aria-hidden="true"></i><span>'+esc(g.label)+'</span><strong>'+g.count+'</strong></button>').join('');
 const tasks=dueNow.slice(0,4).map(a=>'<div class="dashboard-todo-item"><span class="dashboard-todo-icon">'+icon(a.kind)+'</span>'+
  '<div class="dashboard-todo-label"><a href="#'+(a.company_id?'company/'+a.company_id:'activities')+'">'+esc(a.title)+'</a>'+
  '<small>'+esc(a.company_id?company(a.company_id).name:'Allgemeine Aufgabe')+' · '+esc(dateLabel(a.date))+'</small></div>'+
  '<button type="button" class="dashboard-todo-done" data-action="complete" data-id="'+esc(a.key)+'">Erledigt</button></div>').join('');
 return '<section class="dashboard-greeting"><div><span class="eyebrow">KAISER WEBDESIGN · TEAM WORKSPACE</span><h1>Alles im Blick.</h1><p>'+
  new Date().toLocaleDateString('de-DE',{weekday:'long',day:'numeric',month:'long',year:'numeric'})+
  '</p></div><a href="#sales" class="button primary">Zur Lead-Pipeline</a></section>'+
  '<section class="panel dashboard-chart dashboard-chart-full"><div class="dashboard-section-head"><div><span class="eyebrow">VERTRIEBSÜBERSICHT</span>'+
  '<h2>Jeder Lead. Ein klarer Status.</h2><p>Status auswählen und die passenden Vorgänge darunter öffnen.</p></div><span class="dashboard-total"><strong>'+total+'</strong> Vorgänge gesamt</span></div>'+
  '<div class="donut-layout"><div class="donut-visual"><svg viewBox="0 0 200 200" role="group" aria-label="Leadstatus als interaktives Kreisdiagramm">'+
  '<circle class="donut-track" cx="100" cy="100" r="74" fill="none" stroke="#edf1f3" stroke-width="24"/>'+slices+'</svg>'+
  '<div class="donut-center" id="dashboardCenter" style="--status-color:'+selectedGroup.tone+'">'+dashboardCenter(selectedGroup,selectedGroup.count,total)+'</div></div><div class="donut-legend">'+legend+'</div></div>'+
  '<p class="dashboard-chart-note">Ein Vorgang zählt einmal. Kontaktstopp hat Vorrang. Gewonnen bedeutet Auftrag zugesagt; den Projektabschluss siehst du unter Projekte.</p></section>'+
  '<div class="dashboard-kpis"><button data-action="go-today"><small>Jetzt fällig</small><strong>'+dueNow.length+
  '</strong><span>Aufgaben & Wiedervorlagen</span></button><button data-action="dashboard-category" data-id="new"><small>Neue Leads</small><strong>'+groups.find(g=>g.key==='new').count+
  '</strong><span>Noch vor dem Erstkontakt</span></button><button data-action="go-planned"><small>Später geplant</small><strong>'+planned.length+
  '</strong><span>Aufgaben & Termine ab morgen</span></button><button class="kpi-won" data-action="dashboard-category" data-id="won"><small>Gewonnene Aufträge</small><strong>'+
  groups.find(g=>g.key==='won').count+'</strong><span>Noch in Bearbeitung</span></button></div>'+
  '<div class="followup-callout"><div><span class="eyebrow">VERTRIEB / WIEDERVORLAGEN</span><h3>Nachfassen</h3><p>Nicht erreichte Kontakte sind hier mit dem automatischen Rückrufdatum sichtbar.</p></div><strong>'+data.deals.filter(d=>d.disposition==='active'&&d.stage!=='won'&&d.next_follow_up&&d.next_follow_up<=today()&&!blocked(d)).length+' fällig</strong><button class="button primary" data-action="go-followups">Alle Rückrufe öffnen</button></div>'+ 
  '<div class="dashboard-lower"><section id="dashboardSelection" class="panel dashboard-selection" aria-live="polite">'+dashboardDetails(dashboardCategory)+'</section>'+
  '<section class="dashboard-todo-panel panel"><div class="dashboard-todo-header"><div><span class="eyebrow">DEIN NÄCHSTER SCHRITT</span>'+
  '<h2>Heute anpacken <span>'+dueNow.length+' fällig</span></h2></div><a href="#activities">Alle Aufgaben</a></div>'+
  '<div class="dashboard-todo-list">'+(tasks||'<p class="dashboard-todo-empty">Keine Aufgaben für heute offen.</p>')+'</div>'+
  (dueNow.length>4?'<p class="dashboard-todo-overflow">+'+(dueNow.length-4)+' weitere fällige Aufgaben in der Aufgabenübersicht</p>':'')+'</section></div>';
}

function researchInfo(d){
 let info={};try{info=JSON.parse(d.research_json||'{}')}catch{} 
 const pairs=[['Firmenprofil','company_profile'],['Website-Beobachtung','website_observation'],['Nutzenhypothese','benefit_hypothesis'],['Gesprächseinstieg','opening_line'],['Prioritätsbegründung','priority_reason'],['Recherchequellen','evidence_urls'],['Offene Recherchefragen','research_uncertainty'],['Aktivitätsnachweis','activity_evidence']];
 const found=pairs.filter(([label,key])=>info[key]);
 return found.length?'<details class="company-research panel"><summary>Excel-Recherche & Gesprächsvorbereitung <span class="tab-count">'+found.length+'</span></summary><div class="company-research-grid">'+found.map(([label,key])=>'<div><small>'+esc(label)+'</small><p>'+esc(info[key])+'</p></div>').join('')+'</div></details>':'';
}
function renderCompany(id){
 const c=find('companies',id);
 if(!c)return blank('Firma nicht gefunden','Wähle eine Firma aus.');
 const deals=data.deals.filter(d=>d.company_id===c.id),
  openDeals=deals.filter(d=>d.disposition==='active'&&d.stage!=='won'),
  wonDeals=deals.filter(d=>d.stage==='won'&&d.disposition==='active'),
  persons=data.contacts.filter(p=>p.company_id===c.id),
  projects=data.projects.filter(p=>p.company_id===c.id&&p.status!=='archived'),
  appointments=data.appointments.filter(a=>a.company_id===c.id&&a.status==='planned')
    .sort((a,b)=>(a.start_at||'').localeCompare(b.start_at||'')),
  dueTasks=agenda().filter(a=>a.company_id===c.id&&a.status==='open'),
  history=agenda().filter(a=>a.company_id===c.id&&a.status==='done'),
  next=dueTasks[0];
 let website='';try{if(c.website){const u=new URL(/^https?:/i.test(c.website)?c.website:'https://'+c.website);if(['https:','http:'].includes(u.protocol))website=u.href;}}catch{}
 const totalWon=wonDeals.reduce((n,d)=>n+(Number(d.value)||0),0);
 const highestPriority=openDeals.some(d=>d.priority==='high')?'Hoch':openDeals.some(d=>d.priority==='medium')?'Mittel':'Normal';
 const quickMove=d=>'<div class="company-fast-status"><select data-move-deal="'+d.id+'" aria-label="Status direkt ändern"><option value="">Status direkt ändern …</option>'+options({new:'Neue Leads',contacted:'Kontaktversuch',not_reached:'Nicht erreicht → Nachfassen in 3 Tagen',reached:'Erreicht · Interesse offen',interest:'Interesse bestätigt',offer_email:'E-Mail-Angebot versendet',offer_demo:'Demo-Angebot versendet',followup:'Nachfassen planen',building:'Zusage → In Bearbeitung',no_interest:'Kein Interesse'},'')+'</select></div>';
 const actions='<div class="company-toolbar">'+
  (c.do_not_contact?button('Kontakt freigeben','stop',c.id,'small'):
  button('Kontakt festhalten','conversation',c.id,'primary')+
  (openDeals.length||!wonDeals.length?button('Als Bestandskunde übernehmen','customer-win',c.id,'small'):''))+
  button('Termin','appointment-new',c.id,'small')+
  button('+ Aufgabe','company-task',c.id,'small')+
  button('Daten bearbeiten','company-edit',c.id,'small')+button(c.do_not_contact?'Kontaktstopp aufheben':'Kontaktstopp setzen','stop',c.id,'small danger')+'</div>';
 const detail=(label,value)=>'<div class="company-fact"><small>'+esc(label)+'</small><strong>'+value+'</strong></div>';
 const cardProjects=projects.map(p=>
  '<article class="company-project-line"><div><strong>'+esc(p.name)+'</strong><small>'+esc(SERVICE_TYPES[p.service_type]||'Projekt')+
  ' · '+esc(PROJECTS[p.status]||p.status)+'</small></div><span class="company-project-money">'+money(p.value)+'</span><div class="company-project-cta">'+
   button('Bearbeiten','project',p.id,'small')+(p.status!=='done'?button('Abschließen','project-complete',p.id,'small'):'')+button('Dateien','project-files',p.id,'small')+
   button('Archivieren','project-archive',p.id,'small')+'</div></article>').join('');
 const opportunities=deals.map(d=>'<div class="company-opportunity" style="--lead-accent:'+(DASHBOARD_GROUPS.find(g=>g.key===dashboardGroupForDeal(d))?.tone||'#64748b')+'">'+
  '<div><a href="#deal/'+d.id+'" class="company-opportunity-title">'+esc(d.title)+'</a>'+
  '<small>'+esc(d.stage==='won'?'Auftrag gewonnen':PHASES[phase(d)]||d.stage)+'</small></div>'+
  '<span>'+stageBadge(d)+'</span><strong>'+money(d.value)+'</strong>'+
  '<div class="company-opportunity-actions">'+
   (d.stage==='won'&&d.disposition==='active'?button('Zurück in Vertrieb','customer-reopen',d.id,'small'):
    quickMove(d)+button('Details','stage',d.id,'small'))+'</div></div>').join('');
 const people=persons.map(p=>'<article class="company-person"><span class="company-person-avatar">'+
  esc(initials(p.first_name+' '+p.last_name))+'</span><div class="company-person-text"><strong>'+esc((p.first_name+' '+p.last_name).trim())+
  '</strong><small>'+esc(p.role||'Ansprechpartner')+'</small></div>'+
  '<div class="company-person-actions">'+definition(contactLinks(p))+button('Bearbeiten','contact-edit',p.id,'small')+'</div></article>').join('');
 return '<section class="company-focus-header company-focus-'+companyStatus(c)+'"><div class="company-focus-top"><span class="company-identity">'+
   '<span class="company-identity-mark">'+esc(initials(c.name))+'</span><span><small>UNTERNEHMENSAKTE</small><h1>'+esc(c.name)+
   '</h1><span class="company-subline">'+esc([c.industry,c.city].filter(Boolean).join(' · '))+'</span></span></span>'+
   '<span class="company-status-tag">'+companyStatusBadge(c)+'</span></div>'+actions+'</section>'+
   '<div class="company-insight-strip">'+
   detail('Auftragswert gewonnen',money(totalWon))+
   detail('Vertriebsvorgänge',String(deals.length))+
   detail('Aktive Projekte',String(projects.filter(p=>p.status!=='done').length))+
   detail('Offene Aufgaben',String(dueTasks.length))+
   '</div>'+
   '<div class="company-workspace-grid"><div class="company-main-column">'+
   '<section class="panel company-journey"><div class="company-section-heading"><span class="eyebrow">VERTRIEB & ZUSAMMENARBEIT</span><h2>Vorgänge und nächste Schritte</h2></div>'+
   (c.do_not_contact?'<p class="company-warning">Kontaktstopp aktiv. Bitte keine neuen Akquiseaktionen durchführen.</p>':'')+
   '<div class="company-next-line"><span>ALS NÄCHSTES</span><strong>'+esc(next?.title||'Noch keine Aufgabe geplant')+'</strong>'+
   (next?'<small>'+esc(dateLabel(next.date))+'</small>':'')+
   (next?button('Erledigt','complete',next.key,'small'):'')+'</div>'+
   '<div class="company-opportunities">'+(opportunities||'<p class="company-empty">Noch keine Verkaufschance erfasst. Über „Als Bestandskunde übernehmen“ kannst du direkt einen Auftrag anlegen.</p>')+
   '</div><div class="company-journey-actions">'+button('+ Angebot / Vorgang','deal-company',c.id,'small')+
   (!c.do_not_contact?button('Nachfassen','quick-followup',c.id,'small')+button('Kein Interesse','quick-no-interest',c.id,'small'):'')+
   '</div></section>'+
   (deals.some(d=>d.research_json)?researchInfo(deals.find(d=>d.research_json)):'')+ 
   '<section class="panel company-projects"><div class="company-section-heading"><span class="eyebrow">PROJEKTMANAGEMENT</span><h2>Kundenprojekte</h2></div>'+
   (cardProjects||'<p class="company-empty">Für dieses Unternehmen ist noch kein aktives Projekt hinterlegt.</p>')+'</section>'+
   '<section class="panel company-activity"><div class="company-section-heading"><span class="eyebrow">DOKUMENTATION</span><h2>Kontaktverlauf</h2>'+
   button('+ Notiz','company-note',c.id,'small')+'</div>'+timeline(data.activities.filter(a=>a.company_id===c.id))+'</section></div>'+
   '<aside class="company-side-column"><section class="panel company-contact-panel"><div class="company-section-heading"><span class="eyebrow">STAMMDATEN</span><h2>Kontakt</h2></div>'+
   definition([...contactLinks(c),['Website',website?'<a href="'+esc(website)+'" target="_blank" rel="noopener noreferrer">'+esc(c.website)+'</a>':'—']])+
   (c.notes?'<p class="company-note-preview">'+esc(c.notes)+'</p>':'')+'</section>'+
   '<section class="panel company-contact-panel"><div class="company-section-heading"><span class="eyebrow">KONTAKTPERSONEN</span><h2>Ansprechpartner</h2>'+
   button('+ Person','contact-company',c.id,'small')+'</div>'+(people||'<p class="company-empty">Noch keine Kontaktperson hinterlegt.</p>')+'</section>'+
   '<section class="panel company-contact-panel"><div class="company-section-heading"><span class="eyebrow">PLANUNG</span><h2>Termine</h2></div>'+
   (appointments.slice(0,5).map(a=>'<div class="company-appointment"><strong>'+esc(a.title)+'</strong><small>'+esc(dateLabel(a.start_at))+
    ' · '+esc(a.start_at?.slice(11,16)||'')+'</small><div>'+button('Bearbeiten','activity-edit','appointment:'+a.id,'small')+
    button('Entfernen','appointment-archive',a.id,'small')+'</div></div>').join('')||'<p class="company-empty">Kein aktiver Termin.</p>')+
   '<div class="company-section-footer">'+button('+ Termin vereinbaren','appointment-new',c.id,'small')+'</div></section>'+
   '<section class="company-footer-controls"><span>Weitere Firmenaktionen</span>'+
   button(c.do_not_contact?'Kontaktstopp aufheben':'Kontaktstopp setzen','stop',c.id,'small danger')+
   '<details><summary>Aufgabenarchiv ('+history.length+')</summary>'+taskGroup('Erledigt',history,'Noch kein Abschluss.')+'</details></section></aside></div>';
}
function renderAppointments(){
 const all=agenda().filter(a=>a.source==='appointment'&&inScope(a)&&matches(a.title,company(a.company_id).name)),
 upcoming=all.filter(a=>a.status==='open'&&a.date>=today()),late=all.filter(a=>a.status==='open'&&a.date<today()),
 done=all.filter(a=>a.status==='done'),cancelled=all.filter(a=>a.status==='cancelled'),
 archived=all.filter(a=>a.status==='archived');
 const rows=filter==='done'?done:filter==='cancelled'?cancelled:filter==='archived'?archived:[...late,...upcoming];
 return head('Termine','Anstehende, abgeschlossene und abgesagte Termine. Einträge lassen sich mit Bestätigung archivieren oder wiederherstellen.',button('+ Termin vereinbaren','appointment-new','','primary'),'KALENDER')+
 tabs([['open','Anstehend',upcoming.length+late.length],['done','Erledigt',done.length],['cancelled','Abgesagt',cancelled.length],['archived','Archiv',archived.length]])+
 toolbar('Termin oder Firma suchen …')+
 '<div class="clear-stack">'+taskGroup(filter==='archived'?'Archivierte Termine':filter==='done'?'Abgeschlossene Termine':filter==='cancelled'?'Abgesagte Termine':'Anstehende Termine',
 rows,filter==='archived'?'Keine archivierten Termine.':'Keine passenden Termine.')+'</div>';
}
function renderSpecial(status){
 const firms=data.companies.filter(c=>matches(c.name,c.city,c.phone,c.email)&&(status==='stopped'?Boolean(c.do_not_contact):!c.do_not_contact&&companyStatus(c)==='no_interest'));
 const title=status==='stopped'?'Kontaktstopp':'Kein Interesse',sub=status==='stopped'?'Diese Unternehmen dürfen nicht erneut kontaktiert werden.':'Abgelehnte Anfragen bleiben hier sichtbar und können bei Bedarf wieder geöffnet werden.';
 return head(title,sub,'','KUNDENSTATUS')+toolbar('Firma suchen …')+paginate(firms,c=>`<tr><td><a class="main-link" href="#company/${c.id}">${esc(c.name)}</a><small>${esc(c.city||'')}</small></td><td>${companyStatusBadge(c)}</td><td>${esc(c.phone||c.email||'—')}</td><td><a class="button small" href="#company/${c.id}">Akte öffnen</a></td></tr>`,'<thead><tr><th>Unternehmen</th><th>Status</th><th>Kontakt</th><th></th></tr></thead>');
}
function renderClients(){
 const won=data.deals.filter(d=>d.stage==='won'&&d.disposition==='active');
 const all=data.projects.filter(p=>matches(p.name,company(p.company_id).name));
 const active=all.filter(p=>p.status!=='archived'&&p.status!=='done'),done=all.filter(p=>p.status==='done'),archived=all.filter(p=>p.status==='archived');
 const visible=filter==='done'?done:filter==='active'?active:filter==='archived'?archived:done;
 const price=p=>Number(p.value)||0,sum=items=>items.reduce((n,p)=>n+price(p),0);
 const wonTotal=won.reduce((n,d)=>n+(Number(d.value)||0),0);
 return head('Bestandskunden','Hier findest du abgeschlossene Projekte mit ihren Auftragswerten und Unterlagen. Laufende Aufträge findest du unter Projekte.',button('+ Bestandskunde hinzufügen','client-manual','','primary'),'KUNDENBETREUUNG')+
 '<section class="client-revenue-grid" aria-label="Auftragswerte">'+
 '<div class="client-revenue-card"><span>Gewonnene Aufträge</span><strong>'+money(wonTotal)+'</strong><small>'+won.length+' angenommene Verkaufschancen</small></div>'+
 '<div class="client-revenue-card"><span>Abgeschlossene Projekte</span><strong>'+money(sum(done))+'</strong><small>'+done.length+' abgeschlossene Projekte</small></div>'+
 '<div class="client-revenue-card"><span>Laufende Projekte</span><strong>'+money(sum(active))+'</strong><small>'+active.length+' in Bearbeitung oder pausiert</small></div></section>'+
 tabs([['all','Abgeschlossene Kunden',done.length],['done','Abgeschlossene Projekte',done.length],['active','Noch in Bearbeitung',active.length],['archived','Archiv',archived.length]])+
 toolbar('Kunde oder Projekt suchen …')+
 paginate(visible,p=>'<tr><td><a class="main-link" href="#company/'+p.company_id+'">'+esc(company(p.company_id).name)+'</a><small>'+esc(p.name)+'</small></td>'+
 '<td>'+esc(SERVICE_TYPES[p.service_type]||'Projekt')+'</td>'+
 '<td>'+badge(PROJECTS[p.status]||p.status,p.status==='done'?'green':'purple')+'</td>'+
 '<td class="client-price-cell">'+money(price(p))+'</td>'+
 '<td><div class="actions">'+(p.status==='archived'?button('Wiederherstellen','project-restore',p.id,'small'):
 button('Projekt','project',p.id,'small')+button('Dateien','project-files',p.id,'small')+
 button('Archivieren','project-archive',p.id,'small'))+
 (p.deal_id&&data.deals.some(d=>d.id===p.deal_id&&d.stage==='won'&&d.disposition==='active')?
 button('Zurück in Vertrieb','customer-reopen',p.deal_id,'small'):'')+'</div></td></tr>',
 '<thead><tr><th>Kunde / Auftrag</th><th>Leistung</th><th>Status</th><th>Auftragswert</th><th>Aktionen</th></tr></thead>')+
 '<p class="muted client-hint">Angezeigt werden Auftragswerte, nicht bestätigte Zahlungseingänge. Gewonnene Chancen und Projekte werden getrennt ausgewiesen, um keine Umsätze doppelt zu zählen.</p>';
}
function pipelineFollowupEditor(id){
 const d=find('deals',id),base=new Date(today()+'T12:00:00Z');base.setUTCDate(base.getUTCDate()+3);
 edit('Nachfassen planen',help('Die Wiedervorlage erscheint automatisch unter Aufgaben und Termine.')+field('Nachfassen am','due_date',d.next_follow_up||base.toISOString().slice(0,10),'date',true,true)+field('Uhrzeit (optional)','due_time',d.next_follow_up_time||'','time')+textarea('Notiz','notes'),v=>command('pipeline',id,{...v,status:'followup'},dialogRevision),'Wiedervorlage speichern');
}
function customerWinEditor(cid){
 const c=company(cid),deals=data.deals.filter(d=>d.company_id===cid&&d.stage!=='won'),
 defaultDeal=deals.length===1?deals[0]:null;
 const choices=deals.length>1?selectField('Welcher Auftrag?','deal_id',{
  '':'Bitte auswählen',...Object.fromEntries(deals.map(d=>[d.id,d.title]))
 },'',true):'<input type="hidden" name="deal_id" value="'+(defaultDeal?.id||'')+'">';
 edit('Als Bestandskunde übernehmen · '+c.name,
  help('Ein Auftrag wird als gewonnen markiert und mit dem ausgewählten Website-, App- oder Social-Media-Projekt verknüpft. Es wird kein bestehender Datensatz gelöscht.')+
  choices+
  selectField('Leistung','service_type',{
   website:'Website',app:'App',social_media:'Social Media',mixed:'Kombination'
  },'website',true)+
  field('Auftragswert in €','value',defaultDeal?.value??0,'number',true,true)+
  textarea('Hinweise zum Projektstart (optional)','notes')+
  '<label class="span2 completion-confirm"><input type="checkbox" name="confirmed" value="yes" required><span>Die Zusage und der Auftragswert sind geprüft.</span></label>',
  v=>command('customer_win',cid,v,dialogRevision),'Als Bestandskunde übernehmen');
}
function customerReopenEditor(dealId){
 const d=find('deals',dealId);if(!d)return;
 const linked=data.projects.filter(p=>p.deal_id===d.id&&p.status!=='archived');
 edit('Bestandskunde zurückstufen',help('Der Auftrag wird wieder in die aktive Vertriebspipeline übernommen. Verknüpfte Projekte ('+linked.length+') verschwinden aus der aktiven Liste, bleiben aber inklusive aller Dateien im Archiv erhalten.')+
  selectField('Neue Vertriebsphase','stage',{new:'Neuer Lead',contacted:'Kontaktaufnahme',
   interest:'Interesse',offer_email:'E-Mail-Angebot',offer_demo:'Demo-Angebot',followup:'Nachfassen'},'interest',true)+
  '<div class="span2" id="reopenDate" hidden>'+field('Wiedervorlage am','due_date','','date',true)+'</div>'+
  textarea('Warum wird die Zusage zurückgenommen? · Pflichtfeld','reason')+
  '<label class="span2 completion-confirm"><input type="checkbox" name="confirmed" value="yes" required><span>Ja, Auftrag aus den Bestandskunden entfernen und Projekt archivieren.</span></label>',
  async v=>{if(!String(v.reason||'').trim())throw Error('Bitte einen Grund angeben.');await command('customer_reopen',dealId,v,dialogRevision);},'Zurück in Vertrieb');
 const phase=$('#fields select[name=stage]'),date=$('#reopenDate');
 const update=()=>{date.hidden=phase.value!=='followup';date.querySelector('input[name=due_date]').required=phase.value==='followup'};
 phase.addEventListener('change',update);update();
}
async function completeProject(id){
 const p=find('projects',id);
 if(!p||p.status==='done'||p.status==='archived')return;
 if(!confirm('Projekt „'+p.name+'“ als vollständig abgeschlossen markieren? Es erscheint anschließend unter abgeschlossenen Projekten und Bestandskunden.'))return;
 await command('project_complete',id,{confirmed:'yes'});
 toast('Projekt abgeschlossen und bei den Bestandskunden sichtbar.');
}
async function archiveProject(id){
 const p=find('projects',id);if(!p)return;
 if(!confirm('Projekt „'+p.name+'“ aus der aktiven Ansicht entfernen? Alle Dateien bleiben im Archiv erhalten.'))return;
 await command('project_archive',id,{confirmed:'yes'});
 toast('Projekt ins Archiv verschoben. Dateien bleiben erhalten.');
}
async function restoreProject(id){
 const p=find('projects',id);if(!p)return;
 if(!confirm('Projekt „'+p.name+'“ aus dem Archiv zurückholen? Es erscheint zunächst als pausiert.'))return;
 await command('project_restore',id,{confirmed:'yes'});
 toast('Projekt wiederhergestellt.');
}
async function cancelAppointment(id){
 const a=find('appointments',id);if(!a||a.status!=='planned')return toast('Termin ist nicht mehr aktiv.');
 if(!confirm('Termin „'+a.title+'“ als abgesagt markieren? Er bleibt im Bereich „Abgesagt“ sichtbar.'))return;
 await command('appointment_cancel',id,{confirmed:'yes'});
 toast('Termin abgesagt.');
}
async function archiveAppointment(id){
 const a=find('appointments',id);if(!a)return;
 if(!confirm('Termin „'+a.title+'“ aus der Terminliste entfernen? Ein Eintrag im Verlauf bleibt erhalten.'))return;
 await command('appointment_archive',id,{confirmed:'yes'});
 toast('Termin archiviert.');
}
async function restoreAppointment(id){
 const a=find('appointments',id);if(!a)return;
 if(!confirm('Termin „'+a.title+'“ wiederherstellen? Er erscheint als abgesagt, bis du ihn neu einplanst.'))return;
 await command('appointment_restore',id,{confirmed:'yes'});
 toast('Termin wiederhergestellt.');
}
function pipelineWonEditor(id){
 const d=find('deals',id);
 edit('Zusage erhalten',help('Der Lead wird Bestandskunde. Wir legen automatisch ein laufendes Projekt an.')+selectField('Was setzt ihr um?','service_type',SERVICE_TYPES,'website',true)+textarea('Projektstart / Notiz','notes'),v=>command('pipeline',id,{...v,status:'building'},dialogRevision),'Auftrag übernehmen');
}
function pipelineOfferEditor(id,preferred='offer_email'){
 const d=find('deals',id);
 edit('Angebot übermitteln',selectField('Angebotsart','status',{offer_email:'Angebot per E-Mail',offer_demo:'Demo der Website / Social Media'},preferred,true)+textarea('Notiz zum Angebot','notes'),v=>command('pipeline',id,v,dialogRevision),'Als versendet markieren');
}
function pipelineDeclineEditor(id){
 edit('Kein Interesse',help('Der Lead wird aus der aktiven Pipeline genommen. Kein Kontaktstopp – diesen kannst du zusätzlich in der Firmenakte setzen.')+textarea('Grund oder Gesprächsnotiz','reason'),v=>command('pipeline',id,{...v,status:'no_interest'},dialogRevision),'Lead abschließen');
}
async function pipelineMove(id,status){
 if(!status)return;
 if(status==='building')return pipelineWonEditor(id);
 if(status==='no_interest')return pipelineDeclineEditor(id);
 if(status==='followup')return pipelineFollowupEditor(id);
 if(status==='offer_email'||status==='offer_demo')return pipelineOfferEditor(id,status);
 const d=find('deals',id);if(!d)return toast('Lead nicht gefunden.');
 await command('pipeline',id,{status});
 toast(status==='not_reached'?'Nicht erreicht · automatisch in drei Tagen nachfassen.':status==='reached'?'Erreicht gespeichert · Interesse noch offen.':'Pipeline aktualisiert.');
}
function appointmentEditor(id,cid){
 const a=id?find('appointments',id):{},selected=cid||a.company_id||'',start=a.start_at||today()+'T10:00',end=a.end_at||today()+'T11:00';
 edit(id?'Termin bearbeiten':'Termin vereinbaren',field('Titel','title',a.title||'Kundengespräch','text',true,true)+selectField('Firma','company_id',{'':'Allgemeiner Teamtermin',...Object.fromEntries(data.companies.map(c=>[c.id,c.name]))},selected,true)+field('Beginn','start_at',start,'datetime-local',false,true)+field('Ende','end_at',end,'datetime-local',false,true)+field('Ort / Videolink','location',a.location||'','text',true)+selectField('Art','kind',{meeting:'Gespräch',call:'Anruf',work:'Projekttermin',personal:'Intern'},a.kind||'meeting')+ownerField(a.owner_id||actor)+textarea('Notizen','notes',a.notes||''),v=>command('appointment',id,{...v,status:a.status||'planned',reminder_minutes:a.reminder_minutes??15},dialogRevision),'Termin speichern');
}
async function projectFilesEditor(id){
 const p=find('projects',id);if(!p)return toast('Projekt nicht gefunden.');
 edit('Dateien · '+p.name,
  '<section class="span2 file-vault"><p>Projektunterlagen, Code-Archive, Entwürfe und Social-Media-Assets. Privat gespeichert, nur für angemeldete CRM-Mitglieder abrufbar.</p>'+
  '<div id="projectFileState" class="file-vault-state">Dateien werden geladen …</div>'+
  '<div id="projectFileList" class="file-vault-list"></div>'+
  '<div class="file-vault-upload"><label>Neue Datei hochladen <small id="projectUploadLimit">Größe wird geprüft …</small><input type="file" id="projectUploadInput"></label>'+
  '<button type="button" class="button primary" id="projectUploadButton">Hochladen</button>'+
  '<button type="button" class="button" id="projectPauseButton" hidden>Pause</button></div>'+
  '<div class="file-upload-progress" id="projectUploadProgress" hidden><div class="file-upload-progress-row"><span id="projectUploadStatus">Upload wird vorbereitet …</span><strong id="projectUploadPercent">0 %</strong></div><progress id="projectUploadBar" max="100" value="0"></progress><small>Direkt zu Supabase Storage · Wiederaufnahme bei Unterbrechungen</small></div></section>',
  async()=>{},'Schließen'
 );
 const list=$('#projectFileList'),state=$('#projectFileState'),
  upload=$('#projectUploadButton'),pause=$('#projectPauseButton'),input=$('#projectUploadInput'),
  limit=$('#projectUploadLimit'),progress=$('#projectUploadProgress'),
  bar=$('#projectUploadBar'),percentage=$('#projectUploadPercent'),uploadStatus=$('#projectUploadStatus');
 let uploader=null,maxBytes=50*1024*1024,setupReady=false;
 const prettySize=n=>n>=1024*1024?(n/(1024*1024)).toFixed(n>=10*1024*1024?0:1)+' MB':n>=1024?(n/1024).toFixed(0)+' KB':n+' B';
 const setProgress=(sent,total)=>{
  progress.hidden=false;
  const pct=Math.max(0,Math.min(100,Math.floor(sent/total*100)));
  bar.value=pct;
  percentage.textContent=pct+' %';
  uploadStatus.textContent=prettySize(sent)+' / '+prettySize(total)+' hochgeladen';
 };
 const refresh=async()=>{
  state.textContent='Dateien werden geladen …';list.innerHTML='';
  try {
   const info=await request('/api/project-files?project='+id);
   if(Number.isFinite(info.upload_limit_bytes)&&info.upload_limit_bytes>0)maxBytes=info.upload_limit_bytes;
   limit.textContent='Maximal '+prettySize(maxBytes)+' je Datei';
   if(info.setup_required){
    state.innerHTML=info.admin?'Der private Projektspeicher muss einmalig eingerichtet werden. <button type="button" class="button small" id="projectVaultSetup">Speicher aktivieren</button>':'Der private Projektspeicher wird durch einen Administrator eingerichtet.';
    if(info.admin)$('#projectVaultSetup').onclick=async()=>{try{state.textContent='Speicher wird eingerichtet …';await request('/api/project-files/init',{method:'POST',body:JSON.stringify({project:id})});await refresh()}catch(e){state.textContent=e.message}};
    upload.disabled=true;setupReady=false;return;
   }
   setupReady=true;
   upload.disabled=false;
   state.textContent=info.files.length+' Datei'+(info.files.length===1?'':'en')+' · privater Projektspeicher';
   list.innerHTML=info.files.map(file=>{
    const display=file.name.replace(/^\d{13}-[A-Za-z0-9]{8}-/,'');
    const href='/api/project-files/download?project='+id+'&file='+encodeURIComponent(file.path);
    return '<article class="file-vault-item"><div class="file-vault-file-icon">'+esc((display.split('.').at(-1)||'FILE').slice(0,4).toUpperCase())+'</div>'+
     '<div class="file-vault-description"><strong>'+esc(display)+'</strong><small>'+esc(prettySize(file.size))+' · '+esc(dateLabel(file.created_at||''))+'</small></div>'+
     '<a class="button small" href="'+esc(href)+'" download>Herunterladen</a>'+
     (info.admin?'<button type="button" class="button small" data-project-file-delete="'+esc(file.path)+'">Löschen</button>':'')+'</article>';
   }).join('')||'<p class="file-vault-empty">Hier liegen noch keine Dateien. Lade das erste Kundenasset hoch.</p>';
   $$('[data-project-file-delete]').forEach(b=>b.onclick=async()=>{if(!confirm('Diese Projektdatei endgültig löschen?'))return;try{await request('/api/project-files/delete',{method:'POST',body:JSON.stringify({project:id,path:b.dataset.projectFileDelete})});await refresh()}catch(e){state.textContent=e.message}});
  }catch(e){state.textContent=e.message;upload.disabled=true;setupReady=false}
 };
 input.addEventListener('change',()=>{
  if(uploader?.running)return;
  uploader=null;
  progress.hidden=true;
  pause.hidden=true;
  upload.textContent='Hochladen';
 });
 pause.onclick=()=>{if(uploader?.running)uploader.pause()};
 upload.onclick=async()=>{
  if(!setupReady)return;
  const file=input.files[0];
  if(!file)return toast('Bitte zuerst eine Datei auswählen.');
  if(!file.size||file.size>maxBytes)return toast('Datei zu groß: maximal '+prettySize(maxBytes)+'.');
  upload.disabled=true;
  input.disabled=true;
  try {
   if(!uploader||uploader.file!==file){
    const {ResumableProjectUpload}=await import('/resumable-upload.mjs?v=1');
    uploader=new ResumableProjectUpload({
     file,projectId:id,memberId:actor,maxBytes,
     onProgress:setProgress,
     onState:status=>{
      if(status==='starting'){progress.hidden=false;uploadStatus.textContent='Sicherer Upload wird vorbereitet …';}
      if(status==='uploading'){pause.hidden=false;}
      if(status==='paused'){pause.hidden=true;uploadStatus.textContent='Upload pausiert – mit „Fortsetzen“ weiterladen.';}
      if(status==='complete'){pause.hidden=true;bar.value=100;percentage.textContent='100 %';uploadStatus.textContent='Upload abgeschlossen.';}
      if(status==='error'){pause.hidden=true;}
     }
    });
   }
   await uploader.start();
   toast('Datei sicher hochgeladen.');
   input.value='';uploader=null;
   upload.textContent='Hochladen';
   await refresh();
  } catch(e) {
   if(!uploader?.paused)state.textContent=e.message;
   upload.textContent='Fortsetzen';
  } finally {
   input.disabled=false;
   pause.hidden=true;
   upload.disabled=!setupReady;
  }
 };
 await refresh();
}
function render(){if(!data)return;const [name,id]=route.split('/');$('#nav').innerHTML='<div class="nav-label">TÄGLICHE ARBEIT</div>'+Object.entries(pages).map(([k,l])=>`${k==='projects'?'<div class="nav-label secondary-nav">KUNDEN & VERWALTUNG</div>':''}<a href="#${k}" class="nav-link ${k==='settings'?'nav-settings':''} ${(name===k||name==='deal'&&k==='sales'||name==='company'&&k==='contacts')?'active':''}">${icon(k)}${l}</a>`).join('');$('#breadcrumbs').innerHTML=name==='deal'?'<a href="#sales">Vertrieb</a><span>/</span>Verkaufschance':name==='company'?'<a href="#contacts">Firmen</a><span>/</span>Unternehmen':`${pages[name]||'Übersicht'}`;const renders={overview:renderOverview,activities:renderActivities,followups:renderFollowups,appointments:renderAppointments,sales:renderSales,contacts:renderContacts,projects:renderProjects,clients:renderClients,no_interest:()=>renderSpecial('no_interest'),stopped:()=>renderSpecial('stopped'),settings:renderSettings};$('#main').innerHTML=name==='deal'?renderDeal(id):name==='company'?renderCompany(id):(renders[name]||renderOverview)();$('#main').insertAdjacentHTML('afterbegin',backNavigation());wire();rememberScreen()}
// Each browser-history entry owns its complete list state and scroll position.
let restoringNavigation=false, navigationScrollTimer=null;
if('scrollRestoration' in history)history.scrollRestoration='manual';
const routeLabel=r=>pages[r.split('/')[0]]||({deal:'Verkaufschance',company:'Unternehmen'}[r.split('/')[0]])||'Übersicht';
function screenState(){return {route,scope,query,filter,view,page,scrollX:window.scrollX||0,scrollY:window.scrollY||0,areas:$$('.table-wrap,.kanban').map(el=>({left:el.scrollLeft||0,top:el.scrollTop||0}))}}
function rememberScreen(){if(!data||restoringNavigation)return;const previous=history.state?.kaiserCRM?history.state:{};history.replaceState({...previous,kaiserCRM:true,screen:screenState()},'', '#'+route)}
function showScreen(screen){clearTimeout(navigationScrollTimer);restoringNavigation=true;route=screen.route;scope=screen.scope??'all';query=screen.query??'';filter=screen.filter??(route==='contacts'?'companies':route==='activities'?'due':'open');view=screen.view??'board';page=screen.page||1;$('#searchResults').hidden=true;$('.sidebar').classList.remove('open');render();requestAnimationFrame(()=>{window.scrollTo(screen.scrollX||0,screen.scrollY||0);$$('.table-wrap,.kanban').forEach((el,i)=>{el.scrollLeft=screen.areas?.[i]?.left||0;el.scrollTop=screen.areas?.[i]?.top||0});restoringNavigation=false;rememberScreen()})}
function navigateTo(next,overrides={}){if(!next||next===route&&!Object.keys(overrides).length)return;rememberScreen();const screen={route:next,scope,query:'',filter:next==='contacts'?'companies':next==='activities'?'due':next==='clients'?'all':'open',view,page:1,scrollX:0,scrollY:0,areas:[],...overrides};history.pushState({kaiserCRM:true,canBack:true,backLabel:routeLabel(route),screen},'', '#'+next);showScreen(screen)}
function goBack(){if(history.state?.kaiserCRM&&history.state.canBack){$('#crmBack').disabled=true;history.back();return}navigateTo(route.startsWith('company/')?'contacts':route.startsWith('deal/')?'sales':'overview')}
function backNavigation(){const h=history.state,detail=/^(deal|company)\//.test(route);if(!h?.canBack&&!detail)return '';const label=h?.kaiserCRM&&h.canBack?h.backLabel:route.startsWith('company/')?pages.contacts:pages.sales;return `<div class="back-navigation"><button type="button" class="button back-button" id="crmBack" aria-label="Zurück zu ${esc(label)}"><span aria-hidden="true">←</span> Zurück zu ${esc(label)}</button></div>`}
function navigate(){const next=location.hash.slice(1)||'overview';if(history.state?.kaiserCRM&&history.state.screen?.route===next){showScreen(history.state.screen);return}if(next===route)return;const screen={route:next,scope,query:'',filter:next==='contacts'?'companies':next==='activities'?'due':next==='clients'?'all':'open',view,page:1,scrollX:0,scrollY:0,areas:[]};history.replaceState({kaiserCRM:true,canBack:false,screen},'', '#'+next);showScreen(screen)}

function wire(){wirePipeline();$('#firmStatus')?.addEventListener('change',e=>{filter=e.target.value;page=1;render()}); $('#crmBack')?.addEventListener('click',goBack); $('#scope')?.addEventListener('change',e=>{scope=e.target.value;page=1;render()});$('#localSearch')?.addEventListener('input',e=>{query=e.target.value;page=1;const start=e.target.selectionStart;render();const inp=$('#localSearch');inp.focus();inp.setSelectionRange(start,start)});$('#salesView')?.addEventListener('change',e=>{view=e.target.value;page=1;render()});$$('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;page=1;render()});$$('[data-page]').forEach(b=>b.onclick=()=>{page=Number(b.dataset.page);render()});$$('[data-action]').forEach(b=>{b.onclick=()=>act(b.dataset.action,b.dataset.id).catch(e=>toast(e.message));if(b.tagName.toLowerCase()==='circle')b.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();b.click()}}});$('#mobilePhase')?.addEventListener('change',e=>{mobilePipelineStage=e.target.value;render()});$$('[data-priority-deal]').forEach(el=>el.onchange=async()=>{try{await command('deal_priority',Number(el.dataset.priorityDeal),{priority:el.value});toast('Priorität gespeichert.')}catch(err){toast(err.message)}});$$('[data-move-deal]').forEach(el=>el.onchange=async()=>{try{await pipelineMove(Number(el.dataset.moveDeal),el.value)}catch(err){toast(err.message)}el.value=''})}
const field=(label,name,value='',type='text',full=false,required=false)=>`<label class="field ${full?'span2':''}">${esc(label)}${required?' *':''}<input name="${name}" type="${type}" value="${esc(value)}" ${required?'required':''} ${type==='number'?'min="0" step="0.01"':''}></label>`;
const selectField=(label,name,opts,value='',full=false)=>`<label class="field ${full?'span2':''}">${esc(label)}<select name="${name}">${options(opts,value)}</select></label>`;
const ownerField=v=>`<label class="field">Verantwortlich<select name="owner_id">${ownerOptions(v)}</select></label>`;
const textarea=(label,name,value='')=>`<label class="field span2">${esc(label)}<textarea name="${name}">${esc(value)}</textarea></label>`;
const help=s=>`<p class="field-help span2">${esc(s)}</p>`;
function edit(title,fields,onSave,label='Speichern'){dialogSave=onSave;dialogRevision=data.revision;dialogDirty=false;$('#dialogTitle').textContent=title;$('#fields').innerHTML=fields;$('#formError').hidden=true;$('#save').textContent=label;$('#save').disabled=false;$('#dialog').showModal();setTimeout(()=>$('#fields input:not([type=hidden]),#fields textarea,#fields select')?.focus(),20)}
function closeDialog(){if(dialogDirty&&!confirm('Ungespeicherte Eingaben verwerfen?'))return;$('#dialog').close();dialogDirty=false}
function companyEditor(id){const c=find('companies',id)||{};edit(id?'Unternehmen bearbeiten':'Unternehmen anlegen',field('Unternehmen','name',c.name,'text',true,true)+field('Branche','industry',c.industry)+field('Ort','city',c.city)+field('Telefon','phone',c.phone,'tel')+field('E-Mail','email',c.email,'email')+field('Website','website',c.website,'text',true)+textarea('Unternehmensnotizen','notes',c.notes),async v=>{const r=await command('company',id,v,dialogRevision);if(!id)navigateTo('company/'+r.id)})}
function contactEditor(id,cid){const c=find('contacts',id)||{};cid=c.company_id||cid;if(!data.companies.length){toast('Lege zuerst ein Unternehmen an.');companyEditor();return}edit(id?'Ansprechpartner bearbeiten':'Ansprechpartner anlegen',selectField('Unternehmen','company_id',Object.fromEntries(data.companies.map(c=>[c.id,c.name])),cid,true)+field('Vorname','first_name',c.first_name)+field('Nachname','last_name',c.last_name)+field('Position','role',c.role,'text',true)+field('Telefon','phone',c.phone,'tel')+field('E-Mail','email',c.email,'email')+textarea('Notizen','notes',c.notes),v=>command('contact',id,v,dialogRevision));if(id)$('#fields select[name=company_id]').style.pointerEvents='none'}
function dealEditor(id,cid){if(!id&&!cid)return manualCompanyEditor(false);const d=find('deals',id)||{};if(!data.companies.length){toast('Lege zuerst ein Unternehmen an.');companyEditor();return}cid=d.company_id||cid||data.companies[0].id;const contactOpts=c=>({'':'Kein Ansprechpartner',...Object.fromEntries(data.contacts.filter(t=>t.company_id===Number(c)).map(t=>[t.id,[t.first_name,t.last_name].join(' ')]))});edit(id?'Verkaufschance bearbeiten':'Verkaufschance anlegen',help('Ein möglicher Auftrag, ein Vorgang. Phase und Abschluss pflegst du separat in der Verkaufschance.')+selectField('Unternehmen','company_id',Object.fromEntries((id?data.companies.filter(c=>c.id===cid):data.companies).map(c=>[c.id,c.name])),cid,true)+field('Bezeichnung','title',d.title||'Website-Projekt','text',true,true)+selectField('Ansprechpartner','contact_id',contactOpts(cid),d.contact_id)+ownerField(d.owner_id||(!id?actor:''))+field('Auftragswert (€)','value',d.value||0,'number',true)+textarea('Bedarf / Ziel','need_summary',d.need_summary),async v=>{const r=await command('deal',id,v,dialogRevision);if(!id)navigateTo('deal/'+r.id)});$('#fields select[name=company_id]').onchange=e=>{$('#fields select[name=contact_id]').innerHTML=options(contactOpts(e.target.value),'')}}
function stageEditor(id){const d=find('deals',id),status=d.disposition!=='active'?'lost':d.stage==='won'?'won':'open',n=pending(d).length;edit('Phase & Abschluss',help('Nur hier änderst du den Verkaufsfortschritt. Ein Anrufergebnis oder eine erledigte Aufgabe verschiebt keine Phase.')+selectField('Verkaufsphase','stage',PHASES,phase(d)==='won'?'followup':phase(d),true)+selectField('Ergebnis','status',{open:'Offen',won:'Gewonnen',lost:'Verloren'},status,true)+selectField('Leistung bei Zusage','service_type',SERVICE_TYPES,'website',true)+textarea('Verlustgrund · bei „Verloren“ erforderlich','reason',d.lost_reason)+help(`Bei „Gewonnen“ wird einmalig ein Projekt angelegt. ${n} offene Aktivitäten sind verknüpft: Aufgaben und Termine bleiben sichtbar und müssen bewusst erledigt oder abgesagt werden. Eine alte Vertriebswiedervorlage wird beim Abschluss entfernt.`),v=>command('stage',id,v,dialogRevision))}
function logEditor(id,note=false){edit(note?'Notiz hinzufügen':'Aktivität protokollieren',help('Der Eintrag erscheint im Verlauf. Verkaufsphase und bestehende Termine bleiben unverändert.')+(note?'<input type="hidden" name="kind" value="note">':selectField('Art','kind',{call:'Anruf',email:'E-Mail',meeting:'Gespräch / Termin',whatsapp:'WhatsApp',work:'Interne Ausarbeitung'},'call')+field('Ergebnis','result','Gespräch geführt','text',false,true))+textarea(note?'Notiz':'Gesprächsnotiz','body'),v=>command('log',null,{...v,deal_id:id},dialogRevision),'Eintrag speichern')}
function taskEditor(id,did){const a=find('tasks',id)||{};did=a.deal_id||did||'';edit(id?'Aktivität bearbeiten':'Aufgabe planen',selectField('Verknüpfte Verkaufschance','deal_id',{'':'Allgemeine Aufgabe',...Object.fromEntries(data.deals.map(d=>[d.id,company(d.company_id).name+' · '+d.title]))},did,true)+field('Titel','title',a.title,'text',true,true)+selectField('Art','kind',KINDS,a.kind||'task')+ownerField(a.owner_id||(!id?(find('deals',did)?.owner_id||actor):''))+field('Fällig am','due_date',a.due_date||'','date')+field('Uhrzeit · optional','due_time',a.due_time||'','time')+selectField('Priorität','priority',{medium:'Normal',high:'Hoch',low:'Niedrig'},a.priority||'medium',true)+textarea('Beschreibung','notes',a.notes)+help('Ohne Datum bleibt die Aktivität unter „Ohne Datum“ sichtbar. Eine neue Aufgabe ersetzt bestehende Aufgaben nicht.'),v=>command('task',id,v,dialogRevision));const oldCompany=a.company_id;const fn=dialogSave;dialogSave=v=>fn({...v,company_id:v.deal_id?null:oldCompany});if(id&&a.status==='open')$('#fields').insertAdjacentHTML('beforeend',`<div class="span2">${button('Aktivität absagen','task-cancel',id,'small danger')}</div>`);$('#fields [data-action=task-cancel]')?.addEventListener('click',async()=>{if(confirm('Diese Aktivität absagen? Der Verlauf bleibt erhalten.'))try{await command('task_status',id,{status:'cancelled'},dialogRevision);$('#dialog').close();toast('Aktivität abgesagt.')}catch(e){$('#formError').textContent=e.message;$('#formError').hidden=false}})}
function completeWorkEditor(key){
 const a=agenda().find(item=>item.key===key&&item.status==='open');
 if(!a)return toast('Diese Aufgabe ist nicht mehr offen. Bitte Liste aktualisieren.');
 const related=a.company_id?data.deals.filter(d=>d.company_id===a.company_id&&nonWon(d)):[];
 const selectedDeal=a.deal_id?find('deals',a.deal_id):related.length===1?related[0]:null;
 const statusOptions={
  keep:'Pipeline-Status beibehalten',
  contacted:'Kontaktiert',
  not_reached:'Nicht erreicht · Nachfassen in 3 Tagen',
  interest:'Interesse vorhanden',
  offer_email:'Angebot per E-Mail versendet',
  offer_demo:'Demo versendet',
  followup:'Neuen Rückruf einplanen',
  no_interest:'Kein Interesse',
  won:'Zusage · Bestandskunde / Projekt'
 };
 const workTypes={call:'Anruf durchgeführt',email:'E-Mail gesendet',meeting:'Termin vereinbart / durchgeführt',
  offer:'Angebot versendet',demo:'Demo vorgestellt / versendet',work:'Projektarbeit',other:'Sonstiges'};
 const workDefault=['call','email','meeting'].includes(a.kind)?a.kind:'work';
 const dealSelect=related.length>1?
  selectField('Verkaufschance','deal_id',{'':'Bitte zuordnen',...Object.fromEntries(related.map(d=>[d.id,d.title]))},selectedDeal?.id||'',true):
  '<input type="hidden" name="deal_id" value="'+(selectedDeal?.id||'')+'">';
 const fields=help('Erst dokumentieren, dann abschließen. Die Aktivität wird archiviert und der passende Lead auf Wunsch direkt weitergeschoben.')+
  '<div class="span2 completion-origin"><span>AKTIVITÄT</span><strong>'+esc(a.title)+'</strong><small>'+esc(a.company_id?company(a.company_id).name:'Interne Aufgabe')+'</small></div>'+
  selectField('Was hast du erledigt?','work_kind',workTypes,workDefault,true)+
  textarea('Was kam dabei heraus? · Pflichtfeld','result')+
  dealSelect+
  selectField('Was passiert mit dem Lead?','pipeline_status',a.company_id?statusOptions:{keep:'Keine Pipeline-Änderung'},'keep',true)+
  '<div class="span2 completion-followup-fields" id="completionFollowup" hidden>'+
  field('Neuer Termin für den Rückruf','due_date','','date')+
  field('Uhrzeit (optional)','due_time','','time')+'</div>'+
  '<div class="span2" id="completionService" hidden>'+
  selectField('Projektleistung bei Zusage','service_type',SERVICE_TYPES,'website',true)+'</div>'+
  '<label class="span2 completion-confirm"><input type="checkbox" name="confirmed" value="yes" required>'+
  '<span>Ja, die Angaben stimmen und diese Aufgabe ist wirklich erledigt.</span></label>';
 edit('Aufgabe als erledigt dokumentieren',fields,async v=>{
  if(!String(v.result||'').trim())throw Error('Beschreibe zuerst, was bei der Aufgabe herausgekommen ist.');
  if(v.pipeline_status==='followup'&&!v.due_date)throw Error('Bitte Datum für den nächsten Rückruf wählen.');
  if(v.pipeline_status!=='keep'&&related.length>1&&!v.deal_id)
   throw Error('Bitte die passende Verkaufschance auswählen.');
  if(!confirm('Aufgabe wirklich als erledigt bestätigen? Ergebnis und Pipeline-Änderung werden gespeichert.'))throw Error('Nicht bestätigt. Keine Änderung gespeichert.');
  await command('complete_work',null,{...v,target:key},dialogRevision);
 },'Erledigt bestätigen');
 const status=$('#fields select[name=pipeline_status]');
 const followup=$('#completionFollowup'),service=$('#completionService');
 const update=()=>{
  const follow=status?.value==='followup';
  const won=status?.value==='won';
  followup.hidden=!follow;
  service.hidden=!won;
  followup.querySelector('input[name=due_date]').required=follow;
 };
 if(status)status.addEventListener('change',update);
 update();
}
function legacyEditor(key){const a=agenda().find(x=>x.key===key);if(!a)return;if(a.status==='archived')return restoreAppointment(a.id); if(a.source==='task')return taskEditor(a.id);if(a.source==='followup'){edit('Rückruf / Wiedervorlage',help('Diese Wiedervorlage stammt aus der bisherigen Version. Neue Schritte planst du über „Aufgabe planen“.')+selectField('Nächster Schritt','next_action',ACTIONS,a.next_action,true)+field('Datum','due_date',a.date,'date')+field('Uhrzeit','due_time',a.time,'time'),v=>command('followup',a.id,v,dialogRevision));return}edit('Bestehenden Termin bearbeiten',field('Titel','title',a.title,'text',true,true)+field('Beginn','start_at',a.start_at,'datetime-local',false,true)+field('Ende','end_at',a.end_at,'datetime-local',false,true)+field('Ort','location',a.location,'text',true)+selectField('Status','status',{planned:'Geplant',done:'Erledigt',cancelled:'Abgesagt'},a.status==='open'?'planned':a.status,true)+textarea('Notizen','notes',a.notes),v=>command('appointment',a.id,v,dialogRevision))}
function memberEditor(id){const m=member(Number(id))||{};edit(id?'Teamprofil bearbeiten':'Teamprofil hinzufügen',help('Ein Arbeitsprofil dient der Zuordnung. Es ist kein Login und kein Nachweis, wer sich tatsächlich am Computer angemeldet hat.')+field('Name','name',m.name,'text',true,true)+(id?selectField('Status','active',{'1':'Aktiv','0':'Deaktiviert'},m.active,true):''),v=>command('member',id,{...v,active:v.active!=='0'},dialogRevision))}
function projectEditor(id){
 const p=find('projects',id);if(p?.status==='archived')return restoreProject(id);
 edit('Projekt bearbeiten',field('Projektname','name',p.name,'text',true,true)+selectField('Status','status',PROJECTS,p.status)+selectField('Leistung','service_type',SERVICE_TYPES,p.service_type||'other')+ownerField(p.owner_id)+field('Zieltermin','deadline',p.deadline,'date',true)+field('Auftragswert in €','value',p.value??0,'number',true)+textarea('Projektbeschreibung','notes',p.notes),v=>command('project',id,v,dialogRevision));
}
function conversationEditor(cid,note=false,taskKey=''){
 const c=company(cid),ds=data.deals.filter(d=>d.company_id===cid),tasks=agenda().filter(a=>a.company_id===cid&&a.status==='open'),active=ds.filter(open),selected=active.length===1?active[0].id:ds.length===1&&nonWon(ds[0])?ds[0].id:'',origin=tasks.find(a=>a.key===taskKey),canStatus=!ds.length||ds.some(nonWon),returnToList=route.startsWith('company/');
 if(note){return edit('Notiz · '+c.name,textarea('Deine Notiz','body')+'<input type="hidden" name="kind" value="note">',v=>command('conversation',null,{...v,company_id:cid},dialogRevision),'Notiz speichern')}
 const section=(n,title,body)=>`<section class="span2 contact-step"><header><span>${n}</span><h3>${title}</h3></header><div class="step-fields">${body}</div></section>`;
 const dealField=ds.length>1?selectField('Vorgang (nur bei mehreren Angeboten)','deal_id',{'':'Allgemeiner Firmenkontakt',...Object.fromEntries(ds.map(d=>[d.id,d.title]))},origin?.deal_id||selected,true):`<input type="hidden" name="deal_id" value="${selected}">`;
 edit('Kontakt · '+c.name,section(1,'Gespräch festhalten',selectField('Kontaktart','kind',{call:'Anruf',email:'E-Mail',meeting:'Gespräch / Termin',whatsapp:'WhatsApp'},['call','email','meeting'].includes(origin?.kind)?origin.kind:'call')+selectField('Ergebnis','result',{'Gespräch geführt':'Gespräch geführt','Nicht erreicht':'Nicht erreicht','Interesse bestätigt':'Interesse bestätigt','Später melden':'Später wieder melden','Kein Interesse':'Kein Interesse'},'Gespräch geführt')+textarea('Notizen (optional)','body')+dealField)+section(2,'Firmenstatus',canStatus?selectField('Status nach dem Kontakt','sales_status',{keep:'Unverändert lassen',open:'In Bearbeitung',followup:'Nachfassen',no_interest:'Kein Interesse'},ds.length?'keep':'open',true)+`<p class="field-help span2" id="statusHelp">Der Status bleibt erhalten, bis du ihn änderst.</p>`:help('Kunde / gewonnener Auftrag bleibt unverändert.'))+section(3,'Nächster Schritt', (tasks.length?selectField('Welche Aufgabe wurde erledigt?','complete',{'':'Keine abschließen',...Object.fromEntries(tasks.map(a=>[a.key,a.title+' · '+dateLabel(a.date)]))},taskKey,true):'')+selectField('Weiterarbeiten','planning',{keep:'Keine neue Aufgabe',plan:'Nächste Aufgabe planen'},'keep',true)+`<div class="span2 next-plan-fields" id="nextPlanFields" hidden>${field('Aufgabe','title','Nachfassen','text',true,true)}${selectField('Art','task_kind',KINDS,'call')}${field('Fällig am','due_date',new Date(Date.now()+3*86400000).toLocaleDateString('sv-SE'),'date',false,true)}${field('Uhrzeit (optional)','due_time','','time')}<input type="hidden" name="owner_id" value="${active[0]?.owner_id||actor}"></div>`+`<p class="field-help span2" id="planHelp">Du kannst auch ohne neue Aufgabe speichern.</p>`)+(returnToList?'<label class="span2 return-choice"><input type="checkbox" name="return_after" checked> Nach dem Speichern zur vorherigen Übersicht zurück</label>':''),async v=>{await command('conversation',null,{...v,company_id:cid},dialogRevision);if(v.return_after){const prev=history.state?.backLabel;if(history.state?.canBack&&['Heute','Firmen','Aufgaben & Termine'].includes(prev))goBack();else navigateTo('contacts')}},'Kontakt speichern');
 const status=$('#fields select[name=sales_status]'), result=$('#fields select[name=result]'),plan=$('#fields select[name=planning]'),deal=$('#fields select[name=deal_id]');
 const toggle=()=>{const closed=status?.value==='no_interest',follow=status?.value==='followup',autoMissed=follow&&result?.value==='Nicht erreicht';const keep=plan.querySelector('[value=keep]'),newPlan=plan.querySelector('[value=plan]');keep.disabled=follow&&!autoMissed;newPlan.disabled=closed;if(follow&&!autoMissed)plan.value='plan';if(autoMissed)plan.value='keep';if(closed)plan.value='keep';const show=plan.value==='plan';$('#nextPlanFields').hidden=!show;$$('#nextPlanFields input,#nextPlanFields select').forEach(el=>el.disabled=!show);$('#planHelp').textContent=closed?'Kein neuer Kontakt geplant. Weitere offene Aufgaben bleiben zur Prüfung erhalten.':follow?'Bitte Datum für den Rückruf oder die nächste Aufgabe auswählen.':'Du kannst auch ohne neue Aufgabe speichern.';if(status)$('#statusHelp').textContent=status.value==='keep'?'Der bisherige Status bleibt erhalten.':status.value==='no_interest'?'Der gewählte Vertriebsvorgang wird geschlossen.':status.value==='followup'?'Die Firma erscheint unter Nachfassen.':'Der gewählte Vorgang ist in Bearbeitung.'};
 plan.onchange=toggle;if(status){status.onchange=toggle;result.onchange=()=>{status.value=result.value==='Kein Interesse'?'no_interest':['Später melden','Nicht erreicht'].includes(result.value)?'followup':result.value==='Interesse bestätigt'?'open':ds.length?'keep':'open';toggle()};if(deal)deal.onchange=()=>{const won=ds.some(d=>String(d.id)===deal.value&&!nonWon(d));if(won){status.value='keep';status.disabled=true}else status.disabled=false;toggle()}}toggle();
}
function companyTaskEditor(cid){const ds=data.deals.filter(d=>d.company_id===cid&&open(d));edit('Aufgabe für '+company(cid).name,field('Was ist zu tun?','title','','text',true,true)+selectField('Art','kind',KINDS,'call')+ownerField(ds[0]?.owner_id||actor)+field('Fällig am','due_date','','date',false,true)+field('Uhrzeit · optional','due_time','','time')+textarea('Beschreibung','notes'),v=>command('task',null,{...v,company_id:cid,deal_id:ds.length===1?ds[0].id:null},dialogRevision),'Aufgabe planen')}
async function importEditor(){edit('Excel / CSV importieren',help('Datei auswählen, Spalten zuordnen und importieren. Maximal 500 Datenzeilen je Tabellenblatt.')+'<div class="span2"><input id="importFile" class="file-input" type="file" accept=".csv,.xlsx"><div id="importSummary" class="section-gap"></div></div>',null,'Importieren');$('#save').disabled=true;$('#importFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;$('#save').disabled=true;$('#importSummary').textContent='Datei wird geprüft …';try{const sheets=await window.KaiserSheets.read(file),fields={company_name:'Firma / Unternehmen',industry:'Branche',city:'Ort',company_phone:'Firmentelefon',company_email:'Firmen-E-Mail',website:'Website',website_status:'Website-Signal',source_url:'Quell-URL',contact_name:'Ansprechpartner',contact_role:'Rolle',contact_phone:'Kontakt-Telefon',contact_email:'Kontakt-E-Mail',stage:'Status',result:'Ergebnis',do_not_contact:'Nicht kontaktieren',value:'Potenzial €',score:'Lead Score',priority:'Priorität',next_follow_up:'Follow-up',need_summary:'Akquise-Aufhänger / Bedarf',notes:'Notizen',reason:'Grund',company_profile:'Firmenprofil',activity_status:'Prüfstatus',checked_at:'Geprüft am',activity_evidence:'Aktivitätsnachweis',evidence_urls:'Recherchequellen',website_observation:'Website-Beobachtung',benefit_hypothesis:'Nutzenhypothese',opening_line:'Gesprächseinstieg',priority_reason:'Prioritätsbegründung',research_uncertainty:'Offene Recherchefragen'},aliases={company_name:['firma','unternehmen','firmenname','company','betrieb','name'],city:['stadt','standort','city'],company_phone:['telefon','telefonnummer','tel','phone'],company_email:['email','e mail'],website:['webseite','homepage'],source_url:['quelle url','quelle','quell url'],score:['score'],value:['potenzial','potenzial eur','auftragswert'],need_summary:['bedarf','akquise aufhaenger','akquise aufhänger'],contact_name:['kontaktperson','inhaber'],stage:['phase','pipeline'],result:['kontaktergebnis'],do_not_contact:['kontaktstopp','sperre','nicht kontaktieren'],reason:['grund'],next_follow_up:['wiedervorlage','nachfassen']};let active=Object.keys(sheets)[0];const norm=s=>String(s).toLowerCase().replace(/[^a-z0-9äöüß]+/g,' ').trim();const paint=()=>{let [headers,...rows]=sheets[active];if(rows.length>500||!rows.length){$('#importSummary').innerHTML='<p>Bitte ein Tabellenblatt mit 1–500 Datenzeilen auswählen.</p><select id="importSheet">'+options(Object.fromEntries(Object.keys(sheets).map(k=>[k,k])),active)+'</select>';$('#importSheet').onchange=e=>{active=e.target.value;paint()};$('#save').disabled=true;return}$('#importSummary').innerHTML=`<p class="quiet-note">${rows.length} Zeilen erkannt. Dubletten und ausgeschlossene Firmen bleiben unverändert.</p><label class="field section-gap">Tabellenblatt<select id="importSheet">${options(Object.fromEntries(Object.keys(sheets).map(k=>[k,k])),active)}</select></label><div class="import-map section-gap">${Object.entries(fields).map(([k,label])=>{let i=headers.findIndex(h=>[k,label,...(aliases[k]||[])].some(x=>norm(x)===norm(h)));return `<label>${esc(label)}${k==='company_name'?' *':''}<select data-map="${esc(k)}">${options({'':'Nicht übernehmen',...Object.fromEntries(headers.map((h,j)=>[j,h||'Spalte '+(j+1)]))},i<0?'':String(i))}</select></label>`}).join('')}</div>`;$('#importSheet').onchange=e=>{active=e.target.value;paint()};$('#save').disabled=false;dialogSave=async()=>{let mapping={};$$('[data-map]').forEach(x=>{if(x.value!=='')mapping[x.dataset.map]=Number(x.value)});if(mapping.company_name===undefined)throw Error('Bitte die Firmenspalte auswählen.');let r=await request('/api/import/commit',{method:'POST',body:JSON.stringify({filename:file.name,sheet:active,headers,rows,mapping,revision:dialogRevision})});await reload();setTimeout(()=>toast(`${r.imported} neu · ${r.duplicates} Dubletten · ${r.excluded} ausgeschlossen · ${r.errors} fehlerhafte Zeilen`),100);if(r.errors)setTimeout(()=>edit('Importbericht',help('Fehlerhafte Zeilen wurden nicht übernommen.')+`<div class="span2 import-preview">${r.details.map(x=>`<p>Zeile ${esc(x.row)}: ${esc(x.error)}</p>`).join('')}</div>`,async()=>{},'Schließen'),150)}};paint()}catch(err){$('#importSummary').textContent=err.message;$('#save').disabled=true}}}
async function restoreEditor(){edit('V9-Backup wiederherstellen',help('Ersetzt den aktuellen Datenbestand vollständig. Vorher wird automatisch eine lokale Sicherung erstellt. Verwende ein vollständiges V9-JSON-Backup.')+'<div class="span2"><input id="restoreFile" class="file-input" type="file" accept=".json"></div>'+field('Zur Bestätigung WIEDERHERSTELLEN eingeben','confirm','','text',true,true),async v=>{if(v.confirm!=='WIEDERHERSTELLEN')throw Error('Bitte die Bestätigung exakt eingeben.');const f=$('#restoreFile').files[0];if(!f)throw Error('Bitte eine Backup-Datei auswählen.');let backup;try{backup=JSON.parse(await f.text())}catch{throw Error('Die Datei enthält kein gültiges JSON.')}await request('/api/crm-restore',{method:'POST',body:JSON.stringify({backup,revision:dialogRevision})});await reload()},'Daten wiederherstellen')}
async function act(action,id){switch(action){case'customer-win':return customerWinEditor(Number(id));case'customer-reopen':return customerReopenEditor(Number(id));case'project-complete':return completeProject(Number(id));case'project-archive':return archiveProject(Number(id));case'project-restore':return restoreProject(Number(id));case'appointment-cancel':return cancelAppointment(Number(id));case'appointment-archive':return archiveAppointment(Number(id));case'appointment-restore':return restoreAppointment(Number(id));case'project-files':return projectFilesEditor(Number(id));case'pipeline-contact':return conversationEditor(Number(id));case'pipeline-missed':return pipelineMove(Number(id),'not_reached');case'pipeline-reached':return pipelineMove(Number(id),'reached');case'pipeline-interest':return pipelineMove(Number(id),'interest');case'pipeline-demo':return pipelineOfferEditor(Number(id),'offer_demo');case'pipeline-offer':return pipelineOfferEditor(Number(id),'offer_email');case'pipeline-win':return pipelineWonEditor(Number(id));case'pipeline-decline':return pipelineDeclineEditor(Number(id));case'appointment-new':return appointmentEditor(null,id?Number(id):null);case'dashboard-category':return selectDashboardCategory(id);case'go-today':return navigateTo('activities',{filter:'due',scope:'all'});case'go-planned':return navigateTo('activities',{filter:'upcoming',scope:'all'});case'go-followups':return navigateTo('followups');case'go-done':return navigateTo('activities',{filter:'done',scope:'all'});case'go-unplanned':return navigateTo('contacts',{filter:'unplanned'});case'open-company':navigateTo('company/'+id);return;case'missing-firms':$('#missingFirms').scrollIntoView({behavior:'smooth',block:'start'});return;case'task-contact':{const a=agenda().find(x=>x.key===id);if(a)return conversationEditor(a.company_id,false,a.key);return}case'quick-followup':return quickStatusEditor(Number(id),'followup');case'quick-no-interest':return quickStatusEditor(Number(id),'no_interest');case'quick-open':return quickStatusEditor(Number(id),'open');case'conversation':return conversationEditor(Number(id));case'company-note':return conversationEditor(Number(id),true);case'company-task':return companyTaskEditor(Number(id));case'company-new':return companyEditor();case'company-edit':return companyEditor(Number(id));case'contact-new':return contactEditor();case'contact-edit':return contactEditor(Number(id));case'contact-company':return contactEditor(null,Number(id));case'lead-manual':return manualCompanyEditor(false);case'client-manual':return manualCompanyEditor(true);case'deal-new':return dealEditor();case'deal-edit':return dealEditor(Number(id));case'deal-company':return dealEditor(null,Number(id));case'stage':return stageEditor(Number(id));case'log':return logEditor(Number(id));case'note':return logEditor(Number(id),true);case'task-new':return taskEditor();case'task-for':return taskEditor(null,Number(id));case'activity-edit':return legacyEditor(id);case'member':return memberEditor(id?Number(id):null);case'project':return projectEditor(Number(id));case'import':if(data.session.role!=='admin')return toast('Nur Administration.');return importEditor();case'restore':return restoreEditor();case'backup':await request('/api/backup/checkpoint',{method:'POST',body:'{}'});return toast('Lokale Sicherung erstellt.');case'complete':return completeWorkEditor(id);case'reopen':{const a=agenda().find(a=>a.key===id||a.source==='task'&&String(a.id)===String(id));if(!a)return;if(a.source==='appointment')await command('appointment',a.id,{status:'planned'});else await command('task_status',a.id,{status:'open'});return toast('Aufgabe wieder geöffnet – unter Alle offenen.');}case'unplanned':case'unassigned':{navigateTo('sales',{scope:action==='unassigned'?'none':scope,filter:action==='unplanned'?'unplanned':'open'});return}case'stop':{const c=company(Number(id));edit(c.do_not_contact?'Kontaktstopp aufheben':'Kontaktstopp setzen',help(c.do_not_contact?'Der Kontaktstopp wird für alle Vorgänge dieses Unternehmens aufgehoben. Verlorene Chancen bleiben geschlossen; alte Termine werden nicht neu angelegt.':'Gilt für das gesamte Unternehmen. Alte Wiedervorlagen werden entfernt. Bestehende Aufgaben und Termine bleiben zur bewussten Prüfung sichtbar.')+textarea('Begründung','reason'),v=>command('stop',c.id,{...v,stop:!c.do_not_contact},dialogRevision),c.do_not_contact?'Kontakt freigeben':'Kontaktstopp setzen');return}}}
$('#form').addEventListener('input',()=>dialogDirty=true);
$('#form').onsubmit=async e=>{e.preventDefault();if(!dialogSave)return;$('#save').disabled=true;$('#formError').hidden=true;try{await dialogSave(Object.fromEntries(new FormData(e.target)));dialogDirty=false;$('#dialog').close();toast('Gespeichert.')}catch(err){$('#formError').textContent=err.message;$('#formError').hidden=false;if(err.status===409){const b=document.createElement('button');b.type='button';b.className='button small';b.textContent='Aktuellen Datenstand laden';b.onclick=async()=>{try{await reload();dialogRevision=data.revision;b.remove();$('#formError').textContent='Datenstand aktualisiert. Deine Eingabe wurde beibehalten. Prüfe sie anhand der aktualisierten Ansicht und speichere erneut.'}catch(e){toast(e.message)}};$('#formError').appendChild(b)}}finally{$('#save').disabled=false}};
$('#closeDialog').onclick=closeDialog;$('#cancelDialog').onclick=closeDialog;$('#dialog').addEventListener('cancel',e=>{e.preventDefault();closeDialog()});$('#menu').onclick=()=>$('.sidebar').classList.toggle('open');$('#logout').onclick=async()=>{try{await request('/api/logout',{method:'POST',body:'{}'});location.replace('/login.html')}catch(e){toast(e.message)}};$('#refresh').onclick=()=>reload().catch(e=>toast(e.message));$('#loadUpdates').onclick=()=>reload().catch(e=>toast(e.message));
$('#globalSearch').oninput=e=>{const q=e.target.value.trim().toLowerCase(),box=$('#searchResults');box.hidden=!q;if(!q)return;const companies=data.companies.filter(c=>[c.name,c.city,c.email].join(' ').toLowerCase().includes(q)),deals=data.deals.filter(d=>d.title.toLowerCase().includes(q)),contacts=data.contacts.filter(c=>[c.first_name,c.last_name,c.email].join(' ').toLowerCase().includes(q));box.innerHTML=companies.slice(0,6).map(c=>`<a href="#company/${c.id}">${esc(c.name)}<small>Unternehmen · ${esc(c.city)}</small></a>`).join('')+deals.slice(0,4).map(d=>`<a href="#company/${d.company_id}">${esc(d.title)}<small>Verkaufschance · ${esc(company(d.company_id).name)}</small></a>`).join('')+contacts.slice(0,4).map(c=>`<a href="#company/${c.company_id}">${esc(c.first_name+' '+c.last_name)}<small>Ansprechpartner · ${esc(company(c.company_id).name)}</small></a>`).join('')||'<p>Keine passenden Einträge.</p>'};
document.addEventListener('click',e=>{if(!e.target.closest('.global-search'))$('#searchResults').hidden=true;if(!e.target.closest('.sidebar')&&!e.target.closest('#menu'))$('.sidebar').classList.remove('open')});$('#globalSearch').addEventListener('keydown',e=>{if(e.key==='Escape')$('#searchResults').hidden=true;if(e.key==='Enter')$('#searchResults a')?.click()});window.addEventListener('popstate',navigate);window.addEventListener('hashchange',()=>{if((location.hash.slice(1)||'overview')!==route)navigate()});window.addEventListener('beforeunload',e=>{if($('#dialog').open&&dialogDirty){e.preventDefault();e.returnValue=''}});
document.addEventListener('click',e=>{const a=e.target.closest('a[href^="#"]');if(!a||e.defaultPrevented||e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey||a.target==='_blank')return;const next=a.getAttribute('href').slice(1);if(!/^(overview|activities|followups|appointments|sales|contacts|projects|clients|no_interest|stopped|settings|deal\/\d+|company\/\d+)$/.test(next))return;e.preventDefault();navigateTo(next)});
window.addEventListener('scroll',()=>{if(restoringNavigation)return;clearTimeout(navigationScrollTimer);navigationScrollTimer=setTimeout(rememberScreen,150)},true);
(async()=>{route=location.hash.slice(1)||'overview';filter=route==='contacts'?'companies':route==='activities'?'due':route==='clients'?'all':'open';const saved=history.state?.kaiserCRM&&history.state.screen?.route===route?history.state.screen:null;if(saved){scope=saved.scope??'all';query=saved.query??'';filter=saved.filter;view=saved.view??'board';page=saved.page||1}try{await reload();if(saved)showScreen(saved)}catch(e){$('#main').innerHTML=blank('CRM nicht erreichbar',e.message)}})();
async function syncTeam(){if(!data||document.hidden||loading)return;loading=true;const prior=data.revision;try{const fresh=await request('/api/crm');if(data.revision!==prior)return;if(fresh.revision!==data.revision){if($('#dialog').open||document.activeElement?.matches('input,textarea,select')||document.querySelector('.dragging')){$('#updateBanner').hidden=false;$('#syncStatus').textContent='Neue Änderungen verfügbar'}else{applySnapshot(fresh)}}else{$('#syncStatus').textContent='Synchronisiert · '+new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})}}catch(e){$('#syncStatus').textContent='Verbindung unterbrochen'}finally{loading=false}}
setInterval(syncTeam,4000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncTeam()});
