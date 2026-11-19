# Kaiser CRM 7.1 · local calendar, editing and transactional data protection.
import math
BaseHandler = Handler
legacy_init_db = init_db
APP_VERSION = '7.3.0'
SCHEMA_VERSION = 710
STAGES['meeting'] = 'Besprechung vereinbart'
BACKUP_TABLES = ['companies','contacts','deals','tasks','activities','projects','imports','settings','agent_runs','appointments']

def init_db():
    legacy_init_db()
    with db() as con:
        con.executescript('''CREATE TABLE IF NOT EXISTS appointments (
        id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL,
        start_at TEXT NOT NULL, end_at TEXT NOT NULL, location TEXT DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'meeting', status TEXT NOT NULL DEFAULT 'planned',
        reminder_minutes INTEGER NOT NULL DEFAULT 15, notes TEXT DEFAULT '',
        deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
        company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_appointments_start ON appointments(start_at);''')
        ensure_column(con,'tasks',"due_time TEXT DEFAULT ''")
        con.commit()

def checkpoint(label='manual'):
    target=BACKUP_DIR / ('kaiser-crm-'+label+'-'+datetime.now().strftime('%Y%m%d-%H%M%S-%f')+'.db')
    with db() as source, sqlite3.connect(target) as dest: source.backup(dest)
    return target.name

def required_text(value,label):
    value=str(value or '').strip()
    if not value: raise ValueError(label+' fehlt.')
    if len(value)>1000: raise ValueError(label+' ist zu lang.')
    return value

def valid_choice(value,options,label):
    if value not in options: raise ValueError(label+' ist ungültig.')
    return value

def valid_money(value):
    try: number=float(str(value or 0).replace(',','.'))
    except (ValueError,TypeError): raise ValueError('Betrag ist ungültig.')
    if not math.isfinite(number) or number<0: raise ValueError('Betrag muss positiv oder null sein.')
    return number

def references(con,p):
    did=int(p.get('deal_id') or 0) or None;cid=int(p.get('company_id') or 0) or None
    if did:
        d=con.execute('SELECT company_id FROM deals WHERE id=?',(did,)).fetchone()
        if not d: raise ValueError('Der verknüpfte Kontakt existiert nicht mehr.')
        cid=d['company_id']
    if cid and not con.execute('SELECT id FROM companies WHERE id=?',(cid,)).fetchone(): raise ValueError('Firma nicht gefunden.')
    return did,cid

def appointment_values(con,p,old=None):
    v=dict(old or {});v.update(p)
    title=required_text(v.get('title'),'Termintitel')
    try:
        start=datetime.fromisoformat(v.get('start_at',''));end=datetime.fromisoformat(v.get('end_at',''))
        if start.tzinfo or end.tzinfo: raise ValueError()
    except (ValueError,TypeError):raise ValueError('Bitte gültigen Beginn und gültiges Ende eingeben.')
    if end<=start:raise ValueError('Das Ende muss nach dem Beginn liegen.')
    if end-start>timedelta(days=31):raise ValueError('Ein Termin darf höchstens 31 Tage dauern.')
    reminder=int(v.get('reminder_minutes',15))
    if reminder not in (-1,0,5,15,30,60,1440):raise ValueError('Ungültige Erinnerung.')
    did,cid=references(con,v)
    return dict(title=title,start_at=start.isoformat(timespec='minutes'),end_at=end.isoformat(timespec='minutes'),location=str(v.get('location','')),kind=valid_choice(v.get('kind','meeting'),('meeting','call','work','personal'),'Terminart'),status=valid_choice(v.get('status','planned'),('planned','done','cancelled'),'Terminstatus'),reminder_minutes=reminder,notes=str(v.get('notes','')),deal_id=did,company_id=cid)

def checked_restore(data):
    tables=data.get('tables') or {}
    required=BACKUP_TABLES[:8]
    if not isinstance(tables,dict) or not all(isinstance(tables.get(t),list) for t in required):raise ValueError('Ungültiges CRM-Backup.')
    # Validate complete insert + foreign keys in an isolated transaction first.
    with db() as source, sqlite3.connect(':memory:') as test:
        source.backup(test)
        def apply(con):
            con.execute('PRAGMA foreign_keys=OFF');con.execute('BEGIN')
            for table in BACKUP_TABLES:con.execute('DELETE FROM '+table)
            for table in BACKUP_TABLES:
                allowed={r[1] for r in con.execute('PRAGMA table_info('+table+')')}
                for row in tables.get(table,[]):
                    if not isinstance(row,dict):raise ValueError('Ungültige Datensätze im Backup.')
                    cols=[c for c in row if c in allowed]
                    if not cols:raise ValueError('Leerer Datensatz im Backup.')
                    con.execute('INSERT INTO '+table+'('+','.join(cols)+') VALUES('+','.join('?' for _ in cols)+')',[row[c] for c in cols])
            if con.execute('PRAGMA foreign_key_check').fetchall():raise ValueError('Backup enthält ungültige Verknüpfungen.')
        try:apply(test)
        except sqlite3.Error as e:raise ValueError('Backup lässt sich nicht wiederherstellen: '+str(e))
        test.rollback()
    name=checkpoint('before-restore')
    with db() as con:
        try:apply(con);con.commit()
        except Exception:con.rollback();raise
    return name

def ics_text(rows):
    def esc(v):return str(v or '').replace('\\','\\\\').replace('\n','\\n').replace(';','\\;').replace(',','\\,').replace('\r','')
    lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Kaiser Webdesign//CRM 7//DE','CALSCALE:GREGORIAN','X-WR-CALNAME:Kaiser Webdesign']
    for a in rows:
        lines+=['BEGIN:VEVENT','UID:kaiser-appointment-'+str(a['id'])+'@local','DTSTAMP:'+datetime.utcnow().strftime('%Y%m%dT%H%M%SZ'),'DTSTART:'+datetime.fromisoformat(a['start_at']).strftime('%Y%m%dT%H%M%S'),'DTEND:'+datetime.fromisoformat(a['end_at']).strftime('%Y%m%dT%H%M%S'),'SUMMARY:'+esc(a['title']),'LOCATION:'+esc(a['location']),'DESCRIPTION:'+esc(a['notes']),'STATUS:'+('CANCELLED' if a['status']=='cancelled' else 'CONFIRMED')]
        if a['reminder_minutes']>=0 and a['status']=='planned':lines+=['BEGIN:VALARM','ACTION:DISPLAY','DESCRIPTION:Terminerinnerung','TRIGGER:-PT'+str(a['reminder_minutes'])+'M','END:VALARM']
        lines+=['END:VEVENT']
    lines+=['END:VCALENDAR']
    # Fold without breaking UTF-8 characters (RFC 5545).
    folded=[]
    for line in lines:
        part=''
        for char in line:
            if len((part+char).encode('utf-8'))>73:folded.append(part);part=' '
            part+=char
        folded.append(part)
    return ('\r\n'.join(folded)+'\r\n').encode('utf-8')

class Handler(BaseHandler):
    server_version='KaiserCRM/7.1'
    def origin_ok(self):
        host=self.headers.get('Host','');origin=self.headers.get('Origin','')
        if host not in (f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}') or (origin and origin not in ('http://'+host,)):
            self.send_json(403,{'error':'Zugriff nur aus dem lokalen CRM erlaubt.'});return False
        return True
    def do_GET(self):
        if not self.origin_ok():return
        path=urlparse(self.path).path
        try:
            if path in ('/v7.js','/v7.css','/workspace.js','/workspace.css','/pipeline.js','/pipeline.css'):return SimpleHTTPRequestHandler.do_GET(self)
            if path=='/api/appointments' or path=='/api/calendar.ics':
                with db() as con:rows=[dict(r) for r in con.execute('SELECT a.*,c.name company_name FROM appointments a LEFT JOIN companies c ON c.id=a.company_id ORDER BY start_at,id')]
                if path.endswith('.ics'):
                    raw=ics_text(rows);self.send_response(200);self.send_header('Content-Type','text/calendar; charset=utf-8');self.send_header('Content-Disposition','attachment; filename="Kaiser-Kalender.ics"');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw);return
                return self.send_json(200,{'items':rows})
            if path=='/api/insights':
                since=(date.today()-timedelta(days=30)).isoformat()
                with db() as con:
                    rows=[dict(r) for r in con.execute("SELECT a.*,c.industry FROM activities a LEFT JOIN companies c ON c.id=a.company_id WHERE a.occurred_at>=? AND coalesce(a.undone_at,'')=''",(since,))]
                return self.send_json(200,{'activities':rows,'since':since})
            if path=='/api/backup':
                with db() as con:data={'version':APP_VERSION,'created_at':now_iso(),'tables':{t:[dict(r) for r in con.execute('SELECT * FROM '+t)] for t in BACKUP_TABLES}}
                raw=json.dumps(data,ensure_ascii=False,indent=2).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Disposition','attachment; filename="kaiser-crm-backup-'+date.today().isoformat()+'.json"');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw);return
            return super().do_GET()
        except Exception as e:log('V7 GET '+repr(e));return self.send_json(500,{'error':str(e)})
    def write_entity(self,path,p,identifier=None):
        table={'/api/appointments':'appointments','/api/tasks':'tasks','/api/projects':'projects'}[path]
        with db() as con:
            old=con.execute('SELECT * FROM '+table+' WHERE id=?',(identifier,)).fetchone() if identifier else None
            if identifier and not old:return self.send_json(404,{'error':'Eintrag nicht gefunden.'})
            v=dict(old or {});v.update(p);ts=now_iso()
            if table=='appointments':
                data=appointment_values(con,p,old)
                overlaps=[dict(r) for r in con.execute("SELECT id,title,start_at,end_at FROM appointments WHERE status='planned' AND start_at<? AND end_at>? AND id<>?",(data['end_at'],data['start_at'],identifier or 0))] if data['status']=='planned' else []
                if overlaps and not p.get('allow_overlap'):return self.send_json(409,{'error':'Dieser Zeitraum überschneidet sich mit einem Termin.','conflicts':overlaps})
            elif table=='tasks':
                did,cid=references(con,v);due=safe_date(v.get('due_date',''));due_time=str(v.get('due_time',''))
                if due_time and (not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d',due_time) or not due):raise ValueError('Uhrzeit benötigt ein gültiges Fälligkeitsdatum.')
                data=dict(title=required_text(v.get('title'),'Aufgabentitel'),due_date=due,due_time=due_time,priority=valid_choice(v.get('priority','medium'),('high','medium','low'),'Priorität'),status=valid_choice(v.get('status','open'),('open','done'),'Aufgabenstatus'),notes=str(v.get('notes','')),deal_id=did,company_id=cid)
            else:
                did,cid=references(con,v)
                if not cid:raise ValueError('Bitte eine Firma auswählen.')
                data=dict(name=required_text(v.get('name'),'Projektname'),company_id=cid,deal_id=did,status=valid_choice(v.get('status','planning'),('planning','active','review','completed','paused'),'Projektstatus'),value=valid_money(v.get('value')),deadline=safe_date(v.get('deadline','')),domain=safe_web_url(v.get('domain','')),repo_url=safe_web_url(v.get('repo_url','')),notes=str(v.get('notes','')))
            data['updated_at']=ts
            if identifier:con.execute('UPDATE '+table+' SET '+','.join(k+'=?' for k in data)+' WHERE id=?',list(data.values())+[identifier])
            else:
                data['created_at']=ts
                identifier=con.execute('INSERT INTO '+table+'('+','.join(data)+') VALUES('+','.join('?' for _ in data)+')',list(data.values())).lastrowid
            con.commit();return self.send_json(200 if old else 201,{'id':identifier,**data})
    def do_POST(self):
        if not self.origin_ok():return
        path=urlparse(self.path).path
        if path not in ('/api/appointments','/api/tasks','/api/projects','/api/restore','/api/opportunities','/api/backup/checkpoint'):return super().do_POST()
        try:
            p=self.read_json()
            if path=='/api/backup/checkpoint':return self.send_json(200,{'file':checkpoint()})
            if path=='/api/restore':return self.send_json(200,{'ok':True,'safety_backup':checked_restore(p.get('backup') or {})})
            if path=='/api/opportunities':
                with db() as con:
                    did,cid=references(con,p)
                    if not cid:raise ValueError('Firma auswählen.')
                    if company_exclusion(con,cid):raise ValueError('Diese Firma ist ausgeschlossen. Bitte den Kontaktstatus zuerst prüfen.')
                    title=required_text(p.get('title'),'Titel');value=valid_money(p.get('value'));ts=now_iso()
                    stage=valid_choice(p.get('stage','interest'),tuple(STAGES),'Phase')
                    contact_id=None
                    if did:contact_id=con.execute('SELECT contact_id FROM deals WHERE id=?',(did,)).fetchone()['contact_id']
                    r=con.execute('INSERT INTO deals(company_id,contact_id,title,stage,value,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',(cid,contact_id,title,stage,value,ts,ts));con.commit()
                    return self.send_json(201,{'id':r.lastrowid})
            return self.write_entity(path,p)
        except (ValueError,TypeError,sqlite3.IntegrityError) as e:return self.send_json(400,{'error':str(e)})
        except Exception as e:log('V7 POST '+repr(e));return self.send_json(500,{'error':str(e)})
    def do_PATCH(self):
        if not self.origin_ok():return
        match=re.fullmatch(r'(/api/(?:appointments|tasks|projects))/(\d+)',urlparse(self.path).path)
        if not match:return super().do_PATCH()
        try:return self.write_entity(match[1],self.read_json(),int(match[2]))
        except (ValueError,TypeError,sqlite3.IntegrityError) as e:return self.send_json(400,{'error':str(e)})
        except Exception as e:log('V7 PATCH '+repr(e));return self.send_json(500,{'error':str(e)})
    def do_DELETE(self):
        if not self.origin_ok():return
        match=re.fullmatch(r'/api/(appointments|tasks|projects)/(\d+)',urlparse(self.path).path)
        if not match:return super().do_DELETE()
        with db() as con:
            result=con.execute('DELETE FROM '+match[1]+' WHERE id=?',(int(match[2]),));con.commit()
            return self.send_json(200 if result.rowcount else 404,{'ok':bool(result.rowcount)})

original_create_lead=create_lead
def create_lead(con,payload,activity=True):
    c=payload.get('company') or {};name=required_text(c.get('name'),'Firmenname')
    if company_duplicate(con,name,c.get('city',''),c.get('phone',''),c.get('website',''),c.get('source_url','')):
        raise ValueError('Diese Firma ist bereits vorhanden. Öffne den bestehenden Kontakt oder lege dort eine weitere Verkaufschance an.')
    d=payload.get('deal') or {};d['next_follow_up']=safe_date(d.get('next_follow_up',''));d['value']=valid_money(d.get('value'))
    return original_create_lead(con,{**payload,'deal':d},activity)

original_log_activity=log_activity
def log_activity(con,payload):
    d=con.execute('SELECT company_id FROM deals WHERE id=?',(payload.get('deal_id'),)).fetchone()
    if d and payload.get('type','call') not in ('note','work'):
        if con.execute('SELECT id FROM deals WHERE company_id=? AND do_not_contact=1',(d['company_id'],)).fetchone():raise ValueError('Für diese Firma besteht ein Kontaktstopp.')
    return original_log_activity(con,payload)

original_list_deals=list_deals
def list_deals(con,qs):
    rows=original_list_deals(con,qs)
    blocked={r['company_id'] for r in con.execute('SELECT DISTINCT company_id FROM deals WHERE do_not_contact=1')}
    for r in rows:
        r['company_contact_stop']=r['company_id'] in blocked
        if r['company_contact_stop']:r['do_not_contact']=1
    return rows

original_deal_detail=deal_detail
def deal_detail(con,did):
    d=original_deal_detail(con,did)
    if d:d['appointments']=[dict(a) for a in con.execute('SELECT * FROM appointments WHERE deal_id=? ORDER BY start_at',(did,))]
    return d
