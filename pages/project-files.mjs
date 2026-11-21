// Project-scoped private file storage. Only called after CRM session verification.
const BUCKET='kaiser-projects';
const MAX_UPLOAD=8*1024*1024; // Legacy proxy uploads; new large uploads bypass Cloudflare.
const MB=1024*1024;
const MAX_RESUMABLE_MB=500;
export const resumableLimitBytes=env=>{
  const configured=Number(env?.CRM_UPLOAD_LIMIT_MB);
  // Default matches the existing Supabase Free plan. Raising this requires Supabase Pro
  // and an appropriate global Storage limit; never enable larger uploads by guessing.
  return (Number.isInteger(configured)&&configured>=1?Math.min(configured,MAX_RESUMABLE_MB):50)*MB;
};
const answer=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const denied=(status,message)=>Object.assign(new Error(message),{status});
const cleanName=name=>{let s=String(name||'datei').normalize('NFKD').replace(/[^\x20-\x7E]/g,'').replace(/[^A-Za-z0-9._-]/g,'-').replace(/^-+/,'').slice(-92);return !s||s==='.'||s==='..'?'datei':s};
const folder=id=>String(id)+'/';
function credentials(c){return {apikey:c.secret,Authorization:'Bearer '+c.secret}}
async function storage(c,path,{method='GET',body,headers={}}={}){
 const res=await fetch(c.url+'/storage/v1/'+path,{method,headers:{...credentials(c),...headers},body,redirect:'manual'});
 if(res.status>=300&&res.status<400)throw denied(502,'Unerwartete Weiterleitung im Dateispeicher.');
 return res;
}
const projectId=value=>{const id=Number(value);if(!Number.isSafeInteger(id)||id<=0)throw denied(400,'Ungültige Projekt-ID.');return id};
function validPath(p,id){p=String(p||'');if(p.length>180||!p.startsWith(folder(id))||!/^\d+\/[A-Za-z0-9._-]+$/.test(p))throw denied(400,'Ungültiger Dateipfad.');return p}
const fileKey=path=>path.split('/').map(encodeURIComponent).join('/');
function directTusEndpoint(c){
 const host=new URL(c.url).hostname;
 const match=/^([a-z0-9-]+)\.supabase\.co$/.exec(host);
 if(!match)throw denied(503,'Die Supabase-Storage-Adresse ist nicht korrekt eingerichtet.');
 return 'https://'+match[1]+'.storage.supabase.co/storage/v1/upload/resumable';
}
function uploadObjectName(id,body){
 const name=cleanName(body.name);
 if(!name||!String(body.name||'').trim())throw denied(400,'Dateiname fehlt.');
 const previous=body.resume_path?String(body.resume_path):'';
 if(!previous)return folder(id)+Date.now()+'-'+crypto.randomUUID().slice(0,8)+'-'+name;
 const pattern=new RegExp('^'+id+'/([0-9]{13})-[a-f0-9]{8}-[A-Za-z0-9._-]{1,92}$');
 const match=pattern.exec(previous);
 if(!match||!previous.endsWith('-'+name))throw denied(400,'Ungültiger Fortsetzungspfad.');
 const age=Date.now()-Number(match[1]);
 if(age< -60000||age>23*60*60*1000)throw denied(410,'Upload-Fortsetzung abgelaufen. Bitte neu starten.');
 return previous;
}
function belongs(projects,id){if(!projects.some(p=>p.id===id))throw denied(404,'Projekt nicht gefunden.')}
export async function handleProjectFiles({req,c,session,projects,env={}}){
 try{
  const url=new URL(req.url),pathname=url.pathname,method=req.method;
  const maxResumableBytes=resumableLimitBytes(env);
  if(pathname==='/api/project-files'&&method==='GET'){
   const id=projectId(url.searchParams.get('project'));belongs(projects,id);
   const r=await storage(c,'object/list/'+BUCKET,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefix:folder(id),limit:200,offset:0,sortBy:{column:'created_at',order:'desc'}})});
   if(r.status===404)return answer({files:[],setup_required:true,admin:session.role==='admin',upload_limit_bytes:maxResumableBytes});
   if(!r.ok)throw denied(502,'Projektdateien konnten nicht geladen werden.');
   const files=await r.json();
   return answer({files:(Array.isArray(files)?files:[]).filter(f=>f.name&&f.id).map(f=>({name:f.name,path:folder(id)+f.name,size:Number(f.metadata?.size||0),created_at:f.created_at||''})),admin:session.role==='admin',upload_limit_bytes:maxResumableBytes});
  }
  if(pathname==='/api/project-files/init'&&method==='POST'){
   if(session.role!=='admin')throw denied(403,'Nur Administratoren dürfen den Speicher einrichten.');
   const p=await req.json(),id=projectId(p.project);belongs(projects,id);
   const r=await storage(c,'bucket',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:BUCKET,name:BUCKET,public:false})});
   if(!r.ok&&r.status!==409)throw denied(502,'Der private Speicher konnte nicht eingerichtet werden.');
   return answer({ok:true});
  }
  if(pathname==='/api/project-files/sign'&&method==='POST'){
   const body=await req.json();
   if(!body||typeof body!=='object'||Array.isArray(body))throw denied(400,'Ungültige Anfrage.');
   const id=projectId(body.project);belongs(projects,id);
   const size=Number(body.size);
   if(!Number.isSafeInteger(size)||size<=0||size>maxResumableBytes)
     throw denied(413,'Die Dateigröße überschreitet das aktuelle Limit von '+Math.floor(maxResumableBytes/MB)+' MB.');
   const path=uploadObjectName(id,body);
   const signed=await storage(c,'object/upload/sign/'+BUCKET+'/'+fileKey(path),{
     method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({upsert:false})
   });
   if(signed.status===404)throw denied(409,'Der private Projektspeicher muss zuerst eingerichtet werden.');
   if(!signed.ok)throw denied(502,'Ein sicherer Upload konnte nicht vorbereitet werden.');
   let result;try{result=await signed.json()}catch{}
   if(typeof result?.token!=='string'||result.token.length<10||result.token.length>8000)
     throw denied(502,'Der Speicherdienst hat kein gültiges Upload-Ticket geliefert.');
   return answer({token:result.token,path,bucket:BUCKET,endpoint:directTusEndpoint(c),upload_limit_bytes:maxResumableBytes});
  }
  if(pathname==='/api/project-files'&&method==='POST'){
   const len=Number(req.headers.get('Content-Length')||0);
   if(len>MAX_UPLOAD+500000)throw denied(413,'Datei zu groß (maximal 8 MB).');
   const form=await req.formData(),id=projectId(form.get('project'));belongs(projects,id);
   const file=form.get('file');
   if(!file||typeof file.arrayBuffer!=='function')throw denied(400,'Bitte eine Datei auswählen.');
   if(file.size<=0||file.size>MAX_UPLOAD)throw denied(413,'Dateigröße muss zwischen 1 Byte und 8 MB liegen.');
   const fileName=Date.now()+'-'+crypto.randomUUID().slice(0,8)+'-'+cleanName(file.name);
   const r=await storage(c,'object/'+BUCKET+'/'+fileKey(folder(id)+fileName),{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream','x-upsert':'false'},body:await file.arrayBuffer()});
   if(!r.ok)throw denied(r.status===404?409:502,r.status===404?'Der Dateispeicher muss zuerst eingerichtet werden.':'Datei konnte nicht hochgeladen werden.');
   return answer({ok:true,name:fileName},201);
  }
  if(pathname==='/api/project-files/download'&&method==='GET'){
   const id=projectId(url.searchParams.get('project'));belongs(projects,id);
   const p=validPath(url.searchParams.get('file'),id);
   const r=await storage(c,'object/'+BUCKET+'/'+fileKey(p));
   if(!r.ok)throw denied(404,'Datei wurde nicht gefunden.');
   const name=cleanName(p.split('/').at(-1));
   return new Response(r.body,{status:200,headers:{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="'+name+'"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  }
  if(pathname==='/api/project-files/delete'&&method==='POST'){
   if(session.role!=='admin')throw denied(403,'Nur Administratoren dürfen Dateien löschen.');
   const body=await req.json(),id=projectId(body.project);belongs(projects,id);
   const p=validPath(body.path,id);
   const r=await storage(c,'object/'+BUCKET,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:[p]})});
   if(!r.ok)throw denied(502,'Datei konnte nicht gelöscht werden.');
   return answer({ok:true});
  }
  throw denied(404,'Nicht gefunden.');
 }catch(e){
  if(!e.status)console.error('CRM project files',e.name);
  return answer({error:e.status?e.message:'Dateispeicher vorübergehend nicht erreichbar.'},e.status||503);
 }
}
