import {command} from '../../pages/commands.mjs';
import {importRows} from '../../pages/import.mjs';
import {handleProjectFiles} from '../../pages/project-files.mjs';
const COOKIE='__Host-kaiser_session';
const err=(status,message)=>Object.assign(new Error(message),{status});
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const cookie=(value,seconds)=>`${COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${seconds}`;
const token=req=>req.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)||'';
function config(env){let u;try{u=new URL(env.SUPABASE_URL)}catch{throw err(503,'Supabase ist noch nicht eingerichtet.');}if(u.protocol!=='https:'||!env.SUPABASE_PUBLISHABLE_KEY||!env.SUPABASE_SECRET_KEY)throw err(503,'Supabase ist noch nicht eingerichtet.');return {url:u.origin,pub:env.SUPABASE_PUBLISHABLE_KEY,secret:env.SUPABASE_SECRET_KEY};}
async function sup(c,path,{method='GET',data,access,priv=false}={}){const key=priv?c.secret:c.pub;const headers={apikey:key,'Content-Type':'application/json'};if(access)headers.Authorization='Bearer '+access;else if(key.startsWith('eyJ'))headers.Authorization='Bearer '+key;const r=await fetch(c.url+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data),redirect:'manual'});if(r.status>=300&&r.status<400){console.error('CRM Supabase unexpected redirect',path.split('?')[0],r.status);throw err(503,'Supabase-Verbindung umgeleitet. Bitte Projekt-URL prüfen.');}let out;try{out=await r.json()}catch{out={}};return {r,out};}
async function rpc(c,name,args){const {r,out}=await sup(c,'/rest/v1/rpc/'+name,{method:'POST',data:args,priv:true});if(!r.ok){if(out.code==='42501')throw err(403,'Kein freigegebener CRM-Zugang.');if(out.code==='40001'||out.message==='CRM_CONFLICT')throw err(409,'Der Datenstand wurde inzwischen geändert. Bitte neu laden und deine Eingabe erneut prüfen.');console.error('CRM RPC',name,r.status,out.code);throw err(503,'Datenbankoperation fehlgeschlagen. Bitte die Supabase-Einrichtung prüfen.');}return out;}
async function identity(c,req){let access=token(req);if(!access||access.length>3500)throw err(401,'Bitte erneut anmelden.');let {r,out}=await sup(c,'/auth/v1/user',{access});if(!r.ok||!out.id)throw err(401,'Bitte erneut anmelden.');return {uid:out.id,access};}
async function readBody(req){const length=Number(req.headers.get('Content-Length')||0);if(length>2_000_000)throw err(413,'Anfrage zu groß.');let t=await req.text();if(t.length>2_000_000)throw err(413,'Anfrage zu groß.');try{let p=JSON.parse(t);if(!p||typeof p!=='object'||Array.isArray(p))throw Error();return p}catch{throw err(400,'Ungültige Anfrage.');}}
const download=(body,type,filename)=>new Response(body,{headers:{'Content-Type':type,'Content-Disposition':`attachment; filename="${filename}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
function csv(s){const quote=x=>'"'+String(x??'').replace(/^[\s]*[=+\-@\t\r]/,m=>"'"+m).replaceAll('"','""')+'"';const rows=[['Firma','Branche','Ort','Telefon','E-Mail','Website','Vorgang','Phase','Status','Nächster Kontakt']];for(const c of s.companies){let ds=s.deals.filter(d=>d.company_id===c.id);for(const d of ds.length?ds:[{}])rows.push([c.name,c.industry,c.city,c.phone,c.email,c.website,d.title,d.stage,d.disposition,d.next_follow_up]);}return '\ufeff'+rows.map(row=>row.map(quote).join(';')).join('\r\n');}
export async function onRequest({request:req,env}){try{const u=new URL(req.url),path=u.pathname,method=req.method;if(method==='POST'&&req.headers.get('Origin')!==u.origin)throw err(403,'Ungültiger Anfrageursprung.');if(!['GET','POST'].includes(method))throw err(405,'Nicht erlaubt.');if(path!=='/api/login'&&path!=='/api/logout'&&!token(req))throw err(401,'Bitte erneut anmelden.');const c=config(env);
 if(path==='/api/login'&&method==='POST'){let p=await readBody(req),email=String(p.email??'').trim(),password=String(p.password??'');if(!email||!password||email.length>320||password.length>1024)throw err(400,'Bitte E-Mail und Passwort eingeben.');let {r,out}=await sup(c,'/auth/v1/token?grant_type=password',{method:'POST',data:{email,password}});if(!r.ok||!out.user?.id||!out.access_token)throw err(401,'Anmeldung fehlgeschlagen.');await rpc(c,'kaiser_pages_read',{p_uid:out.user.id,p_backup:false});if(!/^[\w.-]+$/.test(out.access_token)||out.access_token.length>3500)throw err(503,'Sitzung konnte nicht erstellt werden.');return json({ok:true},200,{'Set-Cookie':cookie(out.access_token,Math.min(3600,Number(out.expires_in)||3600))});}
 if(path==='/api/logout'&&method==='POST'){let access=token(req);if(access){try{await sup(c,'/auth/v1/logout?scope=local',{method:'POST',access})}catch{}}return json({ok:true},200,{'Set-Cookie':cookie('',0)});}
 const {uid}=await identity(c,req);
 if(path.startsWith('/api/project-files')){const snapshot=await rpc(c,'kaiser_pages_read',{p_uid:uid,p_backup:false});return handleProjectFiles({req,c,session:snapshot.session,projects:snapshot.projects,env});}
 if(path==='/api/presence'&&method==='POST')return json(await rpc(c,'kaiser_team_presence',{p_uid:uid}));
 if(path==='/api/team/hub'&&method==='GET'){
   const raw=u.searchParams.get('before');
   if(raw!==null&&!/^[1-9]\\d{0,17}$/.test(raw))throw err(400,'Ungültiger Nachrichtenverlauf.');
   return json(await rpc(c,'kaiser_team_hub_read',{p_uid:uid,p_before:raw?Number(raw):null}));
 }
 if(path==='/api/team/send'&&method==='POST'){
   const p=await readBody(req),body=String(p.body??'').trim();
   if(body.length<1||body.length>1500)throw err(400,'Nachricht muss 1 bis 1500 Zeichen enthalten.');
   const dealId=p.deal_id==null?null:Number(p.deal_id);
   if(dealId!==null&&(!Number.isSafeInteger(dealId)||dealId<1))throw err(400,'Ungültiger Lead.');
   return json(await rpc(c,'kaiser_team_hub_send',{p_uid:uid,p_body:body,p_deal_id:dealId}));
 }
 if(path==='/api/team/claim'&&method==='POST'){
   const p=await readBody(req),dealId=Number(p.deal_id);
   if(!Number.isSafeInteger(dealId)||dealId<1||!['claim','release','renew'].includes(p.action))
    throw err(400,'Ungültige Reservierung.');
   const purpose=String(p.purpose||'Lead bearbeiten').trim();
   if(purpose.length<1||purpose.length>120)throw err(400,'Tätigkeit muss 1 bis 120 Zeichen enthalten.');
   try{return json(await rpc(c,'kaiser_lead_claim',{p_uid:uid,p_deal_id:dealId,p_action:p.action,p_purpose:purpose}));}
   catch(e){if(e.status===503)throw err(409,'Bearbeitung derzeit nicht möglich. Bitte den Teamstatus prüfen.');throw e;}
 }
 if(path==='/api/crm'&&method==='GET')return json(await rpc(c,'kaiser_pages_read',{p_uid:uid,p_backup:false}));
 if(path==='/api/crm'&&method==='POST'){const p=await readBody(req);const snapshot=await rpc(c,'kaiser_pages_read',{p_uid:uid,p_backup:false});if(p.revision!==snapshot.revision)throw err(409,'Der Datenstand wurde inzwischen geändert. Bitte neu laden und deine Eingabe erneut prüfen.');if(p.op==='member'&&snapshot.session.role!=='admin')throw err(403,'Nur Administration.');let change;try{change=command(snapshot,snapshot.session,p)}catch(e){throw err(400,e.message)}
   const checked=new Set();
   for(const patch of change.patches){
    if(!['deals','contacts','tasks','appointments','projects','companies'].includes(patch.table))continue;
    if(patch.action==='insert'&&patch.table==='companies')continue;
    const entity=patch.action==='update'?snapshot[patch.table]?.find(x=>x.id===patch.id):null;
    const dealId=patch.table==='deals'?patch.id:(patch.values.deal_id??entity?.deal_id??null);
    const companyId=patch.table==='companies'?patch.id:(patch.values.company_id??entity?.company_id??null);
    if(!dealId&&!companyId)continue;
    const key=String(dealId||'')+'|'+String(companyId||'');
    if(checked.has(key))continue;
    checked.add(key);
    const status=await rpc(c,'kaiser_lead_lock_check',{p_uid:uid,p_deal_id:dealId,p_company_id:companyId});
    if(!status?.allowed)throw err(409,'Dieser Lead wird von '+String(status.name||'einem Teammitglied')+' bearbeitet ('+String(status.purpose||'in Bearbeitung')+'). Bitte kurz abstimmen.');
   }
   await rpc(c,'kaiser_pages_apply',{p_uid:uid,p_revision:snapshot.revision,p_patches:change.patches});return json({ok:true,id:change.id});}
 if(path==='/api/backup'&&method==='GET'){let snap=await rpc(c,'kaiser_pages_read',{p_uid:uid,p_backup:true});return download(JSON.stringify(snap,null,2),'application/json','Kaiser-CRM-Backup.json');}
 if(path==='/api/export/leads.csv'&&method==='GET'){let s=await rpc(c,'kaiser_pages_read',{p_uid:uid,p_backup:true});return download(csv(s.tables),'text/csv; charset=utf-8','Kaiser-CRM-Firmen.csv');}
 if(path==='/api/import/commit'&&method==='POST'){const p=await readBody(req),s=await rpc(c,'kaiser_pages_read',{p_uid:uid,p_backup:false});if(s.session.role!=='admin')throw err(403,'Nur Administration.');if(p.revision!==s.revision)throw err(409,'Datenstand geändert. Bitte Import erneut prüfen.');let x;try{x=importRows(s,s.session,p)}catch(e){throw err(400,e.message)}if(x.patches.length)await rpc(c,'kaiser_pages_apply',{p_uid:uid,p_revision:s.revision,p_patches:x.patches});return json(x.report);}
 throw err(404,'Nicht gefunden.');
 }catch(e){if(!e.status)console.error('CRM API',e.name);return json({error:e.status?e.message:'Verbindung momentan nicht erreichbar.'},e.status||503);}}
