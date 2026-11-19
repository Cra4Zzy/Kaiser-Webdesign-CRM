let installPrompt=null;
if('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(console.warn);
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;});
const installed=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
function hideInstall(){if(installed())document.querySelectorAll('[data-install]').forEach(b=>b.hidden=true);}
window.addEventListener('appinstalled',()=>{installPrompt=null;document.querySelectorAll('[data-install]').forEach(b=>b.hidden=true);});
document.querySelectorAll('[data-install]').forEach(b=>b.addEventListener('click',async()=>{
 if(installPrompt){const p=installPrompt;installPrompt=null;await p.prompt();return;}
 if(installed())return;
 const ios=/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 alert(ios?'In Safari: Teilen → Zum Home-Bildschirm → Hinzufügen.':'Im Browser-Menü: App installieren / Zum Startbildschirm hinzufügen. Unter Windows auch über den Windows-Download auf der Anmeldeseite.');
}));hideInstall();
