'use strict';
(() => {
  const root = document.getElementById('teamPresence');
  if (!root) return;
  const label = root.querySelector('.presence-label');
  const count = root.querySelector('.presence-count');
  const list = root.querySelector('.presence-list');
  let busy = false, stopped = false, timer, knownAdmin = false;
  function item(name, self) {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'presence-dot';
    dot.setAttribute('aria-hidden','true');
    const text = document.createElement('span');
    text.className = 'presence-name';
    text.textContent = name + (self ? ' (du)' : '');
    li.append(dot,text);
    return li;
  }
  function unavailable() {
    if (!knownAdmin && !(typeof data !== 'undefined' && data?.session?.role === 'admin')) return;
    root.hidden = false;
    root.dataset.state = 'unavailable';
    count.textContent = '–';
    label.textContent = 'Team';
    const li = document.createElement('li');
    li.textContent = 'Online-Status momentan nicht verfügbar.';
    list.replaceChildren(li);
  }
  async function pulse() {
    if (busy || stopped || document.hidden) return;
    busy = true;
    try {
      const response = await fetch('/api/presence', {method:'POST',cache:'no-store',credentials:'same-origin'});
      if (stopped) return;
      if (response.status === 401 || response.status === 403) {
        root.hidden = true; knownAdmin = false; list.replaceChildren(); return;
      }
      if (!response.ok) throw new Error('Presence unavailable');
      const result = await response.json();
      if (stopped) return;
      if (result.admin !== true) { root.hidden = true; knownAdmin = false; list.replaceChildren(); return; }
      knownAdmin = true;
      if (!Array.isArray(result.online)) throw new Error('Invalid presence');
      const people = result.online.filter(p => p && typeof p.name === 'string');
      root.hidden = false;
      root.dataset.state = 'online';
      count.textContent = String(people.length);
      label.textContent = 'online';
      list.replaceChildren(...people.map(p => item(p.name,p.self === true)));
      if (!people.length) {
        const li = document.createElement('li'); li.textContent = 'Niemand online.'; list.append(li);
      }
    } catch { if (!stopped) unavailable(); }
    finally { busy = false; }
  }
  document.addEventListener('visibilitychange',() => { if (!document.hidden) pulse(); });
  window.addEventListener('online',pulse);
  window.addEventListener('offline',unavailable);
  document.getElementById('logout')?.addEventListener('click',() => {
    stopped = true; clearInterval(timer); root.hidden = true; list.replaceChildren();
  });
  document.addEventListener('click',e => { if(root.open && !root.contains(e.target)) root.open = false; });
  root.addEventListener('keydown',e => { if(e.key==='Escape'){root.open=false;root.querySelector('summary')?.focus();} });
  timer = setInterval(pulse,30000);
  pulse();
})();
