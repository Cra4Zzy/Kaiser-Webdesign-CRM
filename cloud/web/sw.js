// Network only: never cache CRM responses, credentials or customer data.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 if(event.request.mode==='navigate' && new URL(event.request.url).origin===self.location.origin){
 event.respondWith(fetch(event.request).catch(()=>new Response('<!doctype html><html lang="de"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kaiser CRM offline</title><body style="font:16px system-ui;padding:36px;background:#142b35;color:white"><h1>Keine Verbindung</h1><p>Kaiser CRM braucht Internet, um Kundendaten sicher zu synchronisieren. Bitte stelle die Verbindung wieder her und lade die Seite neu.</p></body></html>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})));
 }
});
