"""HTTPS reverse-proxy deployment of the existing CRM with Supabase Auth and private Postgres."""
import os, sys, json, time, secrets, threading, sqlite3, importlib.util
from pathlib import Path
from http.cookies import SimpleCookie
from urllib.parse import urlparse
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pgstore import Store
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
os.environ.setdefault('KAISER_CRM_DATA_DIR', '/tmp/kaiser-cloud-runtime')
spec=importlib.util.spec_from_file_location('legacy',ROOT/'START-KAISER-CRM.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
m.db=Store
m.APP_VERSION='9.9.0'
SESSION_LOCK=threading.Lock();SESSIONS={};TTL=3600
STATIC={'/','/index.html','/crm.css','/crm.js','/Kaiser-CRM.ico','/Kaiser-CRM-Icon.png','/brand-logo-full.png','/login.html','/login.js','/manifest.webmanifest','/sw.js','/install.js','/icon-192.png','/icon-512.png','/Kaiser-CRM-Windows.zip'}

def auth_login(email,password):
    url=os.environ['SUPABASE_URL'].rstrip('/')
    key=os.environ['SUPABASE_PUBLISHABLE_KEY']
    req=Request(url+'/auth/v1/token?grant_type=password',data=json.dumps({'email':email,'password':password}).encode(),headers={'apikey':key,'Content-Type':'application/json'})
    with urlopen(req,timeout=12) as r: out=json.load(r)
    # Supabase Auth response is received over TLS by server, never trusted from browser.
    return out['user']['id'],min(TTL,int(out.get('expires_in',TTL)))

def access(uid):
    with Store() as db:
        row=db.execute('SELECT a.member_id,a.role,m.name FROM account_access a JOIN crm_members m ON m.id=a.member_id WHERE a.user_id=? AND a.active AND m.active=1',(uid,)).fetchone()
        return row

class TeamHandler(m.Handler):
    server_version='KaiserCRM-Cloud/9.9'
    def translate_path(self,path):
        name=urlparse(path).path
        return str(ROOT/'cloud'/'web'/('index.html' if name=='/' else name.lstrip('/'))) if name in STATIC else str(ROOT/'cloud'/'web'/'__not_found__')
    def end_headers(self):
        self.send_header('X-Content-Type-Options','nosniff');self.send_header('Referrer-Policy','no-referrer');self.send_header('X-Frame-Options','DENY')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        super().end_headers()
    def origin_ok(self):
        if self.command=='POST' and self.headers.get('Origin')!=os.environ['CRM_PUBLIC_URL'].rstrip('/'):
            self.send_json(403,{'error':'Ungültiger Anfrageursprung.'});return False
        return True
    def token(self):
        try: return SimpleCookie(self.headers.get('Cookie',''))['kaiser_session'].value
        except (KeyError,ValueError):return ''
    def identity(self):
        with SESSION_LOCK: s=SESSIONS.get(self.token())
        if not s or s[1]<time.time():return None
        return access(s[0])
    def session_response(self,token='',maxage=0):
        raw=b'{"ok":true}';self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)))
        self.send_header('Set-Cookie',f'kaiser_session={token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age={maxage}')
        self.end_headers();self.wfile.write(raw)
    def redirect_login(self): self.send_response(303);self.send_header('Location','/login.html');self.end_headers()
    def do_HEAD(self):
        if urlparse(self.path).path in STATIC and urlparse(self.path).path not in ('/','/index.html'):
            return SimpleHTTPRequestHandler.do_HEAD(self)
        self.send_response(405);self.end_headers()
    def do_GET(self):
        path=urlparse(self.path).path
        try:
            if path=='/healthz':return self.send_json(200,{'ok':True})
            if path not in STATIC and path not in ('/api/crm','/api/backup','/api/export/leads.csv'):return self.send_json(404,{'error':'Nicht gefunden'})
            if path in STATIC:
                if path in ('/','/index.html') and not self.identity():return self.redirect_login()
                return SimpleHTTPRequestHandler.do_GET(self)
            user=self.identity()
            if not user:return self.send_json(401,{'error':'Bitte erneut anmelden.'})
            if path=='/api/crm':
                with Store() as db: snap=m.crm_snapshot(db)
                snap['session']={'member_id':user['member_id'],'role':user['role'],'name':user['name']}
                return self.send_json(200,snap)
            if user['role']!='admin':return self.send_json(403,{'error':'Nur Administration.'})
            return super().do_GET()
        except Exception as e:m.log('cloud GET '+type(e).__name__);return self.send_json(503,{'error':'Datenbank momentan nicht erreichbar.'})
    def do_POST(self):
        if not self.origin_ok():return
        path=urlparse(self.path).path
        try:
            if path=='/api/login':
                p=self.read_json();email=str(p.get('email','')).strip();pw=str(p.get('password',''))
                if not email or not pw or len(email)>320 or len(pw)>1024:return self.send_json(400,{'error':'Bitte E-Mail und Passwort eingeben.'})
                try: uid,ttl=auth_login(email,pw);user=access(uid)
                except HTTPError:return self.send_json(401,{'error':'Anmeldung fehlgeschlagen.'})
                if not user:return self.send_json(403,{'error':'Kein freigegebener CRM-Zugang.'})
                token=secrets.token_urlsafe(32)
                with SESSION_LOCK:
                    for k,v in list(SESSIONS.items()):
                        if v[1]<time.time() or k==self.token():SESSIONS.pop(k,None)
                    SESSIONS[token]=(uid,time.time()+ttl)
                return self.session_response(token,ttl)
            if path=='/api/logout':
                with SESSION_LOCK:SESSIONS.pop(self.token(),None)
                return self.session_response()
            user=self.identity()
            if not user:return self.send_json(401,{'error':'Bitte erneut anmelden.'})
            if path=='/api/crm':
                p=self.read_json();p['actor_id']=user['member_id']
                if p.get('op')=='member' and user['role']!='admin':return self.send_json(403,{'error':'Nur Administration.'})
                try:
                    with Store() as db: out=m.crm_command(db,p)
                    return self.send_json(200,out)
                except RuntimeError as e:return self.send_json(409,{'error':str(e)})
                except (ValueError,TypeError,sqlite3.IntegrityError) as e:return self.send_json(400,{'error':str(e)})
            # Imports use existing parser; restrict to admin and bind transient sessions to account.
            if path in ('/api/import/parse','/api/import/select','/api/import/commit'):
                if user['role']!='admin':return self.send_json(403,{'error':'Nur Administration.'})
                with m.CRM_WRITE_LOCK:
                    p=self.read_json(); original=self.read_json; self.read_json=lambda:p
                    for k,s in list(m.IMPORT_SESSIONS.items()):
                        if time.time()-s['created']>3600:m.IMPORT_SESSIONS.pop(k,None)
                    if path!='/api/import/parse' and m.IMPORT_SESSIONS.get(p.get('session_id'),{}).get('account')!=user['member_id']:return self.send_json(404,{'error':'Importsitzung nicht gefunden.'})
                    before=set(m.IMPORT_SESSIONS)
                    try:return super().do_POST()
                    finally:
                        self.read_json=original
                        for k in set(m.IMPORT_SESSIONS)-before:m.IMPORT_SESSIONS[k]['account']=user['member_id']
            return self.send_json(403,{'error':'Aktion im Team-Modus nicht verfügbar.'})
        except Exception as e:m.log('cloud POST '+type(e).__name__);return self.send_json(503,{'error':'Anfrage fehlgeschlagen. Datenstand prüfen und erneut versuchen.'})
    def do_PATCH(self):return self.send_json(405,{'error':'Nicht erlaubt'})
    def do_DELETE(self):return self.send_json(405,{'error':'Nicht erlaubt'})

def main():
    for name in ('DATABASE_URL','SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','CRM_PUBLIC_URL'):
        if not os.environ.get(name):raise SystemExit('Konfiguration fehlt: '+name)
    for name in ('SUPABASE_URL','CRM_PUBLIC_URL'):
        if urlparse(os.environ[name]).scheme!='https':raise SystemExit(name+' muss HTTPS verwenden.')
    if not os.environ['SUPABASE_PUBLISHABLE_KEY'].startswith('sb_publishable_'):raise SystemExit('Bitte einen Publishable Key verwenden.')
    with Store() as db:
        if not db.execute('SELECT 1 FROM migration_state WHERE id=1').fetchone():raise SystemExit('Migration zuerst ausführen.')
    ThreadingHTTPServer(('0.0.0.0',int(os.getenv('PORT','8080'))),TeamHandler).serve_forever()
if __name__=='__main__':main()
