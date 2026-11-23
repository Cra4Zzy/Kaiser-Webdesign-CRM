'use strict';
(() => {
 const root=document.getElementById('teamHubDrawer'),openTop=document.getElementById('teamHubOpen'),close=document.getElementById('teamHubClose');
 if(!root||!openTop||!close)return;
 const messages=root.querySelector('#teamHubMessages'),scroller=root.querySelector('#teamHubScroll'),form=root.querySelector('#teamHubForm'),input=root.querySelector('#teamHubInput'),
  status=root.querySelector('#teamHubStatus'),claimList=root.querySelector('#teamHubClaims'),older=root.querySelector('#teamHubOlder'),count=openTop.querySelector('#teamHubUnread');
 let opened=false,working=false,busy=false,clock=null,renewTimer=null,mine=new Set(),cache=new Map(),claims=[],lastRead=0,memberId=null,hasOlder=false,stopped=false;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?'':d.toLocaleString('de-DE',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})};
 function messageRow(m){
  const mineMsg=Number(m.member_id)===memberId,li=document.createElement('article');li.className='hub-message'+(mineMsg?' mine':'')+(m.kind==='system'?' system':'');
  const head=document.createElement('header');head.textContent=m.sender_name+' · '+fmt(m.created_at);
  const text=document.createElement('p');text.textContent=m.body;li.append(head,text);
  if(m.deal_id){const a=document.createElement('a');a.href='#deal/'+m.deal_id;a.textContent='Lead öffnen';a.addEventListener('click',()=>toggle(false));li.append(a)}
  return li;
 }
 function renderMessages(){
  const atBottom=scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight<120;
  const arr=[...cache.values()].sort((a,b)=>Number(a.id)-Number(b.id));
  messages.replaceChildren(...arr.map(messageRow));
  older.hidden=!hasOlder;
  if(atBottom)scroller.scrollTop=scroller.scrollHeight;
  if(opened&&arr.length)lastRead=Number(arr.at(-1).id);
  const unread=opened?0:arr.filter(m=>Number(m.id)>lastRead&&Number(m.member_id)!==memberId).length;
  count.hidden=unread===0;count.textContent=unread>99?'99+':String(unread);
 }
 function setStatus(text,error=false){status.textContent=text;status.dataset.error=String(error)}
 async function call(url,body){
  const res=await fetch(url,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',
   headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  let json;try{json=await res.json()}catch{json={}};
  if(!res.ok)throw Object.assign(new Error(json.error||'Teamverbindung vorübergehend nicht erreichbar.'),{status:res.status});
  return json;
 }
 function openNav(){
  const links=document.querySelectorAll('#nav [data-team-hub-link]');links.forEach(el=>el.setAttribute('aria-expanded',String(opened)));
 }
 function toggle(value=!opened){
  opened=Boolean(value);root.hidden=!opened;document.body.classList.toggle('team-hub-visible',opened);openTop.setAttribute('aria-expanded',String(opened));openNav();
  if(opened){lastRead=Math.max(lastRead,...[...cache.keys()].map(Number),0);renderMessages();input.focus();refresh(true)}
  else openTop.focus();
 }
 openTop.addEventListener('click',()=>toggle());
 close.addEventListener('click',()=>toggle(false));
 root.querySelector('.hub-backdrop').addEventListener('click',()=>toggle(false));
 document.addEventListener('keydown',e=>{if(opened&&e.key==='Escape'){toggle(false)}});
 document.addEventListener('click',e=>{const el=e.target.closest('[data-team-hub-link]');if(el){e.preventDefault();toggle(true)}});
 form.addEventListener('submit',async e=>{
  e.preventDefault();if(working)return;
  const body=input.value.trim();if(!body)return;if(body.length>1500){setStatus('Maximal 1500 Zeichen.',true);return}
  working=true;const submit=form.querySelector('button[type=submit]');submit.disabled=true;
  try{const msg=await call('/api/team/send',{body});cache.set(msg.id,msg);input.value='';renderMessages();scroller.scrollTop=scroller.scrollHeight;setStatus('Gesendet · Nachricht dauerhaft gespeichert')}
  catch(err){setStatus(err.message,true)}
  finally{submit.disabled=false;working=false;input.focus()}
 });
 older.addEventListener('click',async()=>{
  const first=Math.min(...[...cache.keys()].map(Number));if(!Number.isFinite(first))return;
  const oldHeight=scroller.scrollHeight;
  try{const r=await call('/api/team/hub?before='+first);for(const m of r.messages||[])cache.set(m.id,m);hasOlder=Boolean(r.has_older);renderMessages();scroller.scrollTop=scroller.scrollHeight-oldHeight}
  catch(err){setStatus(err.message,true)}
 });
 function availableClaims(){
  const now=Date.now();return claims.filter(c=>Date.parse(c.lease_until)>now);
 }
 function renderClaims(){
  const live=availableClaims();
  claimList.replaceChildren(...live.slice(0,12).map(c=>{
    const li=document.createElement('li');const a=document.createElement('a');a.href='#deal/'+c.deal_id;a.textContent=c.name+' · '+c.purpose;a.onclick=()=>toggle(false);
    const small=document.createElement('small');small.textContent=c.mine?'Du bearbeitest diesen Lead':'Lead #'+c.deal_id;
    li.append(a,small);return li;
  }));
  if(!live.length){const li=document.createElement('li');li.className='hub-empty';li.textContent='Aktuell kein Lead reserviert.';claimList.append(li)}
 }
 function renderLockControls(){
  const byDeal=new Map(availableClaims().map(c=>[Number(c.deal_id),c]));
  document.querySelectorAll('[data-team-deal]').forEach(node=>{
   const dealId=Number(node.dataset.teamDeal);if(!dealId)return;
   const target=node.querySelector('[data-team-lock-slot]');if(!target)return;
   const c=byDeal.get(dealId);const mineClaim=c?.mine;
   const signature=(c?.member_id||0)+'|'+(c?.purpose||'')+'|'+String(mineClaim);
   if(target.dataset.signature===signature)return;target.dataset.signature=signature;
   target.replaceChildren();
   const wrap=document.createElement('div');wrap.className='team-claim-line'+(c?' claimed':'');
   const label=document.createElement('span');label.textContent=c?(mineClaim?'Du bearbeitest: '+c.purpose:c.name+' bearbeitet: '+c.purpose):'Zurzeit frei';
   const btn=document.createElement('button');btn.type='button';btn.className='button small';
   btn.textContent=c?(mineClaim?'Freigeben':'Reserviert'):'Bearbeiten';btn.disabled=Boolean(c&&!mineClaim);
   btn.onclick=async()=>{
    btn.disabled=true;try{
     const action=mineClaim?'release':'claim';
     let purpose='Lead bearbeiten';
     if(action==='claim'){const entered=prompt('Woran arbeitest du bei diesem Lead?','Anruf / Kontaktaufnahme');if(entered===null){btn.disabled=false;return}purpose=entered.trim();if(!purpose||purpose.length>120){setStatus('Bitte Tätigkeit mit maximal 120 Zeichen eingeben.',true);btn.disabled=false;return}}
     await call('/api/team/claim',{deal_id:dealId,action,purpose});
     if(action==='claim')mine.add(dealId);else mine.delete(dealId);
     await refresh(true);
    }catch(e){setStatus(e.message,true);await refresh(true)}
   };
   wrap.append(label,btn);target.append(wrap);
   node.classList.toggle('team-locked-by-other',Boolean(c&&!mineClaim));
  });
 }
 function setNavBadge(){
  openTop.classList.toggle('is-open',opened);
 }
 async function refresh(force=false){
  if(stopped||busy||(!force&&document.hidden))return;busy=true;
  try{
   const response=await call('/api/team/hub');
   if(!Array.isArray(response.messages)||!Array.isArray(response.claims))throw new Error('Ungültiger Teamstatus');
   memberId=Number(response.member_id);claims=response.claims;mine=new Set(claims.filter(c=>c.mine).map(c=>Number(c.deal_id)));
   const firstLoad=!cache.size;for(const msg of response.messages)cache.set(Number(msg.id),msg);
   if(firstLoad)hasOlder=Boolean(response.has_older);
   renderMessages();renderClaims();renderLockControls();setNavBadge();
   setStatus('Live verbunden · Aktualisierung alle 8 Sekunden');
  }catch(e){
   if(e.status===401||e.status===403){setStatus('Bitte erneut anmelden.',true);stopped=true;return}
   setStatus(e.message,true);
  }finally{busy=false}
 }
 async function renew(){
  if(stopped||document.hidden||!mine.size)return;
  for(const id of [...mine])try{await call('/api/team/claim',{deal_id:id,action:'renew',purpose:'Lead bearbeiten'})}catch{mine.delete(id)}
  refresh();
 }
 // Continuous snapshots, not transient localStorage: messages are persisted server-side.
 clock=setInterval(()=>refresh(),8000);renewTimer=setInterval(renew,120000);
 window.KaiserTeamHub={refresh,open:()=>toggle(true),close:()=>toggle(false),updateClaims:renderLockControls};
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh(true)});
 window.addEventListener('hashchange',()=>{setTimeout(renderLockControls,0)});
 document.getElementById('logout')?.addEventListener('click',()=>{stopped=true;clearInterval(clock);clearInterval(renewTimer)});
 refresh(true);
})();
