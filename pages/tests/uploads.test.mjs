import test from 'node:test';
import assert from 'node:assert/strict';
import {ResumableProjectUpload, UPLOAD_CHUNK_SIZE} from '../../cloud/web/resumable-upload.mjs';
import {handleProjectFiles, resumableLimitBytes} from '../project-files.mjs';

const project=1, endpoint='https://example.storage.supabase.co/storage/v1/upload/resumable';
const file=()=>{
 const blob=new Blob([new Uint8Array(UPLOAD_CHUNK_SIZE+17)],{type:'application/zip'});
 Object.defineProperties(blob,{name:{value:'website.zip'},lastModified:{value:1700000000000}});
 return blob;
};
const memory=()=>{const items=new Map();return {
 getItem:k=>items.get(k)||null,
 setItem:(k,v)=>items.set(k,v),
 removeItem:k=>items.delete(k),
 get size(){return items.size}
}};
function directMock(){
 let offset=0,post=0,head=0,patches=[],tickets=[];
 const location=endpoint+'/upload-id';
 const fetcher=async (url,opts={})=>{
  if(url==='/api/project-files/sign'){
   const body=JSON.parse(opts.body);tickets.push(body);
   return Response.json({token:'signed-token-123456',path:body.resume_path||'1/1700000000000-deadbeef-website.zip',endpoint,bucket:'kaiser-projects',upload_limit_bytes:50*1024*1024});
  }
  if(url===endpoint&&opts.method==='POST'){
   post++;
   assert.equal(opts.headers['x-signature'],'signed-token-123456');
   assert.equal(opts.headers['Upload-Length'],String(file().size));
   assert.match(opts.headers['Upload-Metadata'],/bucketName /);
   return new Response(null,{status:201,headers:{Location:location}});
  }
  if(url===location&&opts.method==='HEAD'){
   head++;return new Response(null,{status:200,headers:{'Upload-Offset':String(offset)}});
  }
  if(url===location&&opts.method==='PATCH'){
   assert.equal(opts.credentials,'omit');
   assert.equal(opts.headers['Upload-Offset'],String(offset));
   patches.push(opts.body.size);
   offset+=opts.body.size;
   return new Response(null,{status:204,headers:{'Upload-Offset':String(offset)}});
  }
  throw Error('Unexpected request: '+url+' '+opts.method);
 };
 return {fetcher,stats:()=>({offset,post,head,patches,tickets})};
}
test('resumable signed uploads stream in 6 MiB chunks with no service role in browser',async()=>{
 const mock=directMock(),storage=memory(),progress=[];
 const upload=new ResumableProjectUpload({file:file(),projectId:1,memberId:12,maxBytes:50*1024*1024,
  fetcher:mock.fetcher,storage,onProgress:(sent,total)=>progress.push([sent,total])});
 await upload.start();
 assert.equal(mock.stats().post,1);
 assert.deepEqual(mock.stats().patches,[UPLOAD_CHUNK_SIZE,17]);
 assert.equal(mock.stats().offset,file().size);
 assert.equal(progress.at(-1)[0],file().size);
 assert.equal(storage.size,0);
});
test('pause keeps upload URL and resumes from server offset, not from zero',async()=>{
 const mock=directMock(),storage=memory(),selected=file();
 let upload;
 upload=new ResumableProjectUpload({file:selected,projectId:1,memberId:12,maxBytes:50*1024*1024,
  fetcher:mock.fetcher,storage,onProgress:sent=>{if(sent===UPLOAD_CHUNK_SIZE)upload.pause()}});
 await assert.rejects(upload.start(),/pausiert/);
 assert.equal(storage.size,1);
 const resumed=new ResumableProjectUpload({file:selected,projectId:1,memberId:12,maxBytes:50*1024*1024,
  fetcher:mock.fetcher,storage});
 await resumed.start();
 assert.equal(mock.stats().post,1);
 assert.equal(mock.stats().head,1);
 assert.deepEqual(mock.stats().patches,[UPLOAD_CHUNK_SIZE,17]);
 assert.equal(storage.size,0);
});
test('server limits Free plan to 50 MB and can be configured up to 500 MB after an upgrade',()=>{
 assert.equal(resumableLimitBytes({}),50*1024*1024);
 assert.equal(resumableLimitBytes({CRM_UPLOAD_LIMIT_MB:'500'}),500*1024*1024);
 assert.equal(resumableLimitBytes({CRM_UPLOAD_LIMIT_MB:'900'}),500*1024*1024);
});
test('signed-upload route refuses other projects and oversized files',async()=>{
 const c={url:'https://example.supabase.co',secret:'private-service-role-key'};
 const request=body=>new Request('https://crm.example.com/api/project-files/sign',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const rejected=await handleProjectFiles({req:request({project:22,name:'a.zip',size:512}),
  c,session:{role:'staff'},projects:[{id:1}]});
 assert.equal(rejected.status,404);
 const tooBig=await handleProjectFiles({req:request({project:1,name:'a.zip',size:51*1024*1024}),
  c,session:{role:'staff'},projects:[{id:1}]});
 assert.equal(tooBig.status,413);
});
test('server mints only project-scoped signed upload tickets with private keys kept server side',async()=>{
 const oldFetch=globalThis.fetch,urls=[];
 globalThis.fetch=async(url,opts)=>{
  urls.push({url,headers:opts.headers,body:opts.body});
  return Response.json({token:'signed-token-valid-long-enough'});
 };
 try{
  const c={url:'https://example.supabase.co',secret:'private-service-role-key'};
  const req=new Request('https://crm.example.com/api/project-files/sign',{method:'POST',
   headers:{'Content-Type':'application/json'},body:JSON.stringify({project:1,name:'website.zip',size:45000000})});
  const result=await handleProjectFiles({req,c,session:{role:'staff'},projects:[{id:1}]});
  assert.equal(result.status,200);
  const ticket=await result.json();
  assert.equal(ticket.endpoint,endpoint);
  assert.match(ticket.path,/^1\/\d{13}-[a-f0-9]{8}-website\.zip$/);
  assert.equal(ticket.upload_limit_bytes,50*1024*1024);
  assert.ok(!JSON.stringify(ticket).includes('private-service-role-key'));
  assert.match(urls[0].url,/\/storage\/v1\/object\/upload\/sign\/kaiser-projects\/1\//);
  assert.equal(urls[0].headers.Authorization,'Bearer private-service-role-key');
 }finally{globalThis.fetch=oldFetch}
});
test('modern sb_secret API keys are never forwarded as bearer tokens',async()=>{
 const old=globalThis.fetch,requestHeaders=[];
 globalThis.fetch=async(url,opts)=>{requestHeaders.push(opts.headers);return Response.json({token:'signed-token-valid-long-enough'})};
 try {
  const req=new Request('https://crm.example.com/api/project-files/sign',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({project:1,name:'asset.zip',size:120000})
  });
  const result=await handleProjectFiles({req,c:{url:'https://example.supabase.co',secret:'sb_secret_fakekeyvalue'},session:{role:'admin'},projects:[{id:1}]});
  assert.equal(result.status,200);
  assert.equal(requestHeaders[0].apikey,'sb_secret_fakekeyvalue');
  assert.ok(!('Authorization' in requestHeaders[0]));
 } finally {globalThis.fetch=old}
});

test('missing bucket is detected even when object listing would return an empty array',async()=>{
 const old=globalThis.fetch;const calls=[];
 globalThis.fetch=async url=>{calls.push(url);return url.includes('/bucket/')?Response.json({statusCode:'404',error:'Bucket not found'},{status:400}):Response.json([])};
 try{
  const r=await handleProjectFiles({req:new Request('https://crm.example.com/api/project-files?project=1'),c:{url:'https://example.supabase.co',secret:'sb_secret_test'},session:{role:'admin'},projects:[{id:1}]});
  assert.equal(r.status,200);assert.equal((await r.json()).setup_required,true);assert.equal(calls.length,1);
 }finally{globalThis.fetch=old}
});
test('private storage lists files, but an unexpectedly public bucket fails closed',async()=>{
 const old=globalThis.fetch;let isPublic=false;
 globalThis.fetch=async url=>url.includes('/bucket/')?Response.json({id:'kaiser-projects',public:isPublic}):Response.json([{id:'file1',name:'test.txt',metadata:{size:15}}]);
 try{
  const request=()=>handleProjectFiles({req:new Request('https://crm.example.com/api/project-files?project=1'),c:{url:'https://example.supabase.co',secret:'sb_secret_test'},session:{role:'staff'},projects:[{id:1}]});
  assert.equal((await (await request()).json()).files[0].path,'1/test.txt');
  isPublic=true;assert.equal((await request()).status,503);
 }finally{globalThis.fetch=old}
});
