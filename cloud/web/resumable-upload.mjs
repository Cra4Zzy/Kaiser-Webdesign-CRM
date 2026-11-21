// Kaiser CRM · signed, resumable TUS uploads. No Supabase secret or user JWT in browser.
export const UPLOAD_CHUNK_SIZE = 6 * 1024 * 1024;
const MAX_AGE = 23 * 60 * 60 * 1000;
const wait = ms => new Promise(resolve => setTimeout(resolve,ms));
const hasStorage = storage => storage && typeof storage.getItem === 'function';
const bytes64 = value => {
  const bytes = new TextEncoder().encode(String(value));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
};
export const formatMegabytes = n => (n / (1024 * 1024)).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1) + ' MB';

export class ResumableProjectUpload {
  constructor({file, projectId, memberId, maxBytes, fetcher = globalThis.fetch,
    storage = globalThis.localStorage, onProgress = () => {}, onState = () => {}}) {
    if (!file || typeof file.slice !== 'function') throw Error('Bitte eine Datei auswählen.');
    if (!Number.isSafeInteger(Number(projectId)) || Number(projectId) < 1) throw Error('Projekt ungültig.');
    if (!Number.isFinite(maxBytes) || maxBytes <= 0 || file.size <= 0 || file.size > maxBytes)
      throw Error('Datei zu groß. Aktuelles Limit: ' + formatMegabytes(maxBytes) + '.');
    this.file = file;
    this.projectId = Number(projectId);
    this.memberId = String(memberId);
    this.maxBytes = maxBytes;
    this.fetcher = fetcher;
    this.storage = storage;
    this.onProgress = onProgress;
    this.onState = onState;
    this.key = 'kaiser:project-upload:v1:' + JSON.stringify([
      this.memberId, this.projectId, file.name, file.size, file.lastModified || 0
    ]);
    this.running = false;
    this.paused = false;
    this.finished = false;
    this.controller = null;
  }

  _load() {
    if (!hasStorage(this.storage)) return null;
    try {
      const state = JSON.parse(this.storage.getItem(this.key));
      if (!state || typeof state.path !== 'string' ||
          !state.path.startsWith(this.projectId + '/') ||
          typeof state.location !== 'string' ||
          !Number.isFinite(state.created) || Date.now() - state.created > MAX_AGE) {
        this._clear();
        return null;
      }
      return state;
    } catch { this._clear(); return null; }
  }
  _store(state) { try { this.storage?.setItem(this.key,JSON.stringify(state)); } catch {} }
  _clear() { try { this.storage?.removeItem(this.key); } catch {} }
  pause() {
    this.paused = true;
    this.controller?.abort();
    this.onState('paused');
  }
  async _signed(resumePath) {
    const response = await this.fetcher('/api/project-files/sign', {
      method:'POST', credentials:'same-origin',cache:'no-store',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({project:this.projectId,name:this.file.name,size:this.file.size,
        content_type:this.file.type||'application/octet-stream',
        ...(resumePath?{resume_path:resumePath}:{})})
    });
    let answer={};try{answer=await response.json()}catch{}
    if(!response.ok) {
      const e=new Error(answer.error||'Upload-Berechtigung konnte nicht geprüft werden.');
      e.status=response.status;
      throw e;
    }
    if(typeof answer.token!=='string'||typeof answer.path!=='string'||
       typeof answer.endpoint!=='string'||typeof answer.bucket!=='string')
      throw Error('Ungültiges Upload-Ticket.');
    if(this.file.size>answer.upload_limit_bytes)
      throw Error('Das Supabase-Limit erlaubt derzeit nur '+formatMegabytes(answer.upload_limit_bytes)+'.');
    const endpoint=new URL(answer.endpoint);
    if(endpoint.protocol!=='https:' || !/^[a-z0-9-]+\.storage\.supabase\.co$/.test(endpoint.hostname))
      throw Error('Unsichere Speicheradresse abgelehnt.');
    return answer;
  }
  _url(location,endpoint) {
    const resolved=new URL(location,endpoint);
    if(resolved.origin!==new URL(endpoint).origin || resolved.protocol!=='https:')
      throw Error('Ungültige Upload-Adresse.');
    return resolved.href;
  }
  _headers(ticket) {
    return {'Tus-Resumable':'1.0.0','x-signature':ticket.token};
  }
  async _send(url,options) {
    if(this.paused)throw Error('Upload pausiert.');
    const controller=new AbortController();
    this.controller=controller;
    try {
      return await this.fetcher(url,{...options,credentials:'omit',signal:controller.signal});
    } catch(e) {
      if(this.paused)throw Error('Upload pausiert.');
      throw e;
    } finally {
      if(this.controller===controller)this.controller=null;
    }
  }
  async _readOffset(location,ticket) {
    const response=await this._send(location,{method:'HEAD',headers:this._headers(ticket)});
    if(response.status===404||response.status===410)return null;
    if(!response.ok)throw Error('Fortsetzung konnte nicht geprüft werden (HTTP '+response.status+').');
    const offset=Number(response.headers.get('Upload-Offset'));
    if(!Number.isSafeInteger(offset)||offset<0||offset>this.file.size)
      throw Error('Der Speicherdienst hat einen ungültigen Fortschritt zurückgegeben.');
    return offset;
  }
  async _create(ticket) {
    const metadata={
      bucketName:ticket.bucket,
      objectName:ticket.path,
      contentType:this.file.type||'application/octet-stream',
      cacheControl:'3600'
    };
    const encoded=Object.entries(metadata).map(([key,value])=>key+' '+bytes64(value)).join(',');
    const response=await this._send(ticket.endpoint,{
      method:'POST',
      headers:{...this._headers(ticket),'Upload-Length':String(this.file.size),'Upload-Metadata':encoded}
    });
    if(response.status!==201)throw Error('Upload konnte nicht gestartet werden (HTTP '+response.status+').');
    const location=response.headers.get('Location');
    if(!location)throw Error('Der Speicherdienst hat keine Upload-Adresse zurückgegeben.');
    return this._url(location,ticket.endpoint);
  }
  async start() {
    if(this.running)return;
    if(this.finished)throw Error('Datei wurde bereits hochgeladen.');
    this.running=true;
    this.paused=false;
    this.onState('starting');
    try {
      let previous=this._load(),ticket;
      try { ticket=await this._signed(previous?.path); }
      catch(e) {
        if(e.status!==410||!previous)throw e;
        this._clear();previous=null;
        ticket=await this._signed();
      }
      let location=null,offset=0;
      if(previous?.location&&previous.path===ticket.path) {
        location=this._url(previous.location,ticket.endpoint);
        try {
          const existingOffset=await this._readOffset(location,ticket);
          if(existingOffset===null)location=null;
          else offset=existingOffset;
        } catch(e) {
          if(this.paused)throw e;
          // A network failure while checking offset must not silently restart
          // an upload: the old session could still be active.
          throw e;
        }
      }
      if(!location) {
        location=await this._create(ticket);
        this._store({path:ticket.path,location,created:Date.now()});
      }
      this.onState('uploading');
      this.onProgress(offset,this.file.size);
      let failures=0;
      while(offset<this.file.size) {
        if(this.paused)throw Error('Upload pausiert.');
        const end=Math.min(offset+UPLOAD_CHUNK_SIZE,this.file.size);
        const chunk=this.file.slice(offset,end);
        try {
          const response=await this._send(location,{
            method:'PATCH',
            headers:{...this._headers(ticket),'Content-Type':'application/offset+octet-stream','Upload-Offset':String(offset)},
            body:chunk
          });
          if(!response.ok) {
            const error=new Error('Speicherfehler HTTP '+response.status);
            error.status=response.status;
            throw error;
          }
          const reported=response.headers.get('Upload-Offset');
          const next=reported===null?end:Number(reported);
          if(!Number.isSafeInteger(next)||next<=offset||next>this.file.size)throw Error('Ungültiger Upload-Fortschritt.');
          offset=next;
          failures=0;
          this.onProgress(offset,this.file.size);
        } catch(e) {
          if(this.paused)throw e;
          if(e.status&&![408,409,423,429,500,502,503,504].includes(e.status))throw e;
          if(++failures>5)throw Error('Upload unterbrochen. Du kannst ihn über „Fortsetzen“ erneut starten.');
          await wait([0,1000,2000,4000,8000][Math.min(failures-1,4)]);
          const checked=await this._readOffset(location,ticket);
          if(checked===null)throw Error('Die Upload-Sitzung ist abgelaufen. Bitte erneut auswählen.');
          offset=checked;
          this.onProgress(offset,this.file.size);
        }
      }
      this._clear();
      this.finished=true;
      this.onState('complete');
      return {path:ticket.path,size:this.file.size};
    } catch(e) {
      if(this.paused)this.onState('paused');
      else this.onState('error');
      throw e;
    } finally {
      this.running=false;
      this.controller=null;
    }
  }
}