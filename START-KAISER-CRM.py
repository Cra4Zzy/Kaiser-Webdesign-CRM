from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from html.parser import HTMLParser
import base64, csv, io, json, re, sqlite3, threading, time, uuid, webbrowser, zipfile, os, html, ctypes, shutil, sys, socket
import xml.etree.ElementTree as ET
from datetime import datetime, date, timedelta

APP_DIR = Path(__file__).resolve().parent
APP_VERSION = '8.0.0'
SCHEMA_VERSION = 710
DATA_DIR = Path(os.environ.get('KAISER_CRM_DATA_DIR', str(APP_DIR / 'data'))).expanduser().resolve()
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / 'kaiser-crm.db'
LOG_PATH = DATA_DIR / 'kaiser-crm.log'
BACKUP_DIR = DATA_DIR / 'backups'
BACKUP_DIR.mkdir(parents=True, exist_ok=True)
HOST = '127.0.0.1'
PORT_START = int(os.environ.get('KAISER_CRM_PORT', '9020'))
DESKTOP_MODE = os.environ.get('KAISER_CRM_DESKTOP', '') == '1'
LAST_DESKTOP_PING = time.time()
RUNTIME_PATH = DATA_DIR / 'runtime.json'
OLLAMA = 'http://127.0.0.1:11434'
MAX_BODY = 30 * 1024 * 1024
IMPORT_SESSIONS = {}

STAGES = {
    'new': 'Neu',
    'attempted': 'Nicht erreicht',
    'contacted': 'Im Gespräch',
    'interest': 'Interesse',
    'building': 'Angebotsseite bauen',
    'offer': 'Angebot / Seite gesendet',
    'followup': 'Nachfassen',
    'won': 'Gewonnen',
}
DISPOSITIONS = {
    'active': 'Aktiv',
    'no_interest': 'Kein Interesse',
    'lost': 'Verloren',
}
OPEN_STAGES = ('new','attempted','contacted','interest','building','offer','followup')


def log(msg):
    try:
        with LOG_PATH.open('a', encoding='utf-8') as f:
            f.write(f"{datetime.now().isoformat(timespec='seconds')}  {msg}\n")
    except Exception:
        pass


def now_iso():
    return datetime.now().isoformat(timespec='seconds')


def db():
    con = sqlite3.connect(DB_PATH, timeout=20)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA busy_timeout=20000')
    con.execute('PRAGMA foreign_keys=ON')
    return con


def table_columns(con, table):
    return {r['name'] for r in con.execute(f'PRAGMA table_info({table})').fetchall()}


def ensure_column(con, table, definition):
    name = definition.split()[0]
    if name not in table_columns(con, table):
        con.execute(f'ALTER TABLE {table} ADD COLUMN {definition}')


def init_db():
    with db() as con:
        con.execute('PRAGMA journal_mode=WAL')
        con.executescript('''
        CREATE TABLE IF NOT EXISTS companies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            industry TEXT DEFAULT '', city TEXT DEFAULT '',
            phone TEXT DEFAULT '', email TEXT DEFAULT '', website TEXT DEFAULT '',
            website_status TEXT DEFAULT '', social_status TEXT DEFAULT '',
            source TEXT DEFAULT '', source_url TEXT DEFAULT '', notes TEXT DEFAULT '',
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS contacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            first_name TEXT DEFAULT '', last_name TEXT DEFAULT '', role TEXT DEFAULT '',
            phone TEXT DEFAULT '', email TEXT DEFAULT '', preferred_channel TEXT DEFAULT '',
            notes TEXT DEFAULT '', is_primary INTEGER DEFAULT 1,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS deals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
            title TEXT NOT NULL, stage TEXT NOT NULL DEFAULT 'new',
            disposition TEXT NOT NULL DEFAULT 'active', do_not_contact INTEGER DEFAULT 0,
            disposition_at TEXT DEFAULT '',
            value REAL DEFAULT 0, score INTEGER DEFAULT 60, priority TEXT DEFAULT 'medium',
            source TEXT DEFAULT '', next_follow_up TEXT DEFAULT '', next_action TEXT DEFAULT '', last_contact TEXT DEFAULT '',
            need_summary TEXT DEFAULT '', notes TEXT DEFAULT '', lost_reason TEXT DEFAULT '',
            import_raw TEXT DEFAULT '{}',
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL, due_date TEXT DEFAULT '', priority TEXT DEFAULT 'medium',
            status TEXT DEFAULT 'open', company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
            contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
            deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
            notes TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS activities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL DEFAULT 'note', subject TEXT DEFAULT '', body TEXT DEFAULT '',
            occurred_at TEXT NOT NULL, company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
            contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
            deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE,
            metadata TEXT DEFAULT '{}',
            undone_at TEXT DEFAULT '', undone_reason TEXT DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
            name TEXT NOT NULL, status TEXT DEFAULT 'planning', value REAL DEFAULT 0,
            deadline TEXT DEFAULT '', domain TEXT DEFAULT '', repo_url TEXT DEFAULT '', notes TEXT DEFAULT '',
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS imports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL, sheet_name TEXT DEFAULT '', total_rows INTEGER DEFAULT 0,
            imported_count INTEGER DEFAULT 0, duplicate_count INTEGER DEFAULT 0,
            excluded_count INTEGER DEFAULT 0, error_count INTEGER DEFAULT 0,
            report_json TEXT DEFAULT '{}', created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS agent_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, finished_at TEXT DEFAULT '', status TEXT DEFAULT 'running',
            query TEXT DEFAULT '', found_count INTEGER DEFAULT 0, imported_count INTEGER DEFAULT 0, duplicate_count INTEGER DEFAULT 0, excluded_count INTEGER DEFAULT 0, report_json TEXT DEFAULT '{}'
        );
        CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(name);
        CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage);
        CREATE INDEX IF NOT EXISTS idx_deals_disposition ON deals(disposition);
        CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
        CREATE INDEX IF NOT EXISTS idx_activities_deal ON activities(deal_id, occurred_at);
        CREATE INDEX IF NOT EXISTS idx_activities_deal_type ON activities(deal_id, type, occurred_at);
        ''')
        # Safe migration from V3/V3.1 databases if a user copies the data folder over.
        ensure_column(con, 'companies', "source_url TEXT DEFAULT ''")
        ensure_column(con, 'deals', "disposition TEXT NOT NULL DEFAULT 'active'")
        ensure_column(con, 'deals', "do_not_contact INTEGER DEFAULT 0")
        ensure_column(con, 'deals', "disposition_at TEXT DEFAULT ''")
        ensure_column(con, 'deals', "import_raw TEXT DEFAULT '{}'")
        ensure_column(con, 'deals', "research_json TEXT DEFAULT '{}'")
        ensure_column(con, 'imports', "excluded_count INTEGER DEFAULT 0")
        ensure_column(con, 'companies', "website_audit_json TEXT DEFAULT '{}'")
        ensure_column(con, 'companies', "website_audit_at TEXT DEFAULT ''")
        ensure_column(con, 'contacts', "preferred_channel TEXT DEFAULT ''")
        ensure_column(con, 'deals', "next_action TEXT DEFAULT ''")
        ensure_column(con, 'activities', "undone_at TEXT DEFAULT ''")
        ensure_column(con, 'activities', "undone_reason TEXT DEFAULT ''")
        ensure_column(con, 'deals', "proposal_url TEXT DEFAULT ''")
        ensure_column(con, 'deals', "proposal_sent_at TEXT DEFAULT ''")
        # Old V3 lost stage becomes a proper lost disposition.
        con.execute("UPDATE deals SET disposition='lost', disposition_at=updated_at WHERE stage='lost' AND disposition='active'")
        con.execute("UPDATE deals SET stage='contacted' WHERE stage='lost'")
        defaults = {'ollama_model':'qwen3:8b','brand_name':'KAISER WEBDESIGN CRM','ai_speed':'fast','followup_attempted_days':'2','followup_offer_days':'3','stale_days':'7'}
        for k,v in defaults.items():
            con.execute('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)',(k,v))
        # Legacy prospecting settings are retained for backups, but never executed.
        con.execute("UPDATE settings SET value='0' WHERE key='lead_agent_auto'")
        con.execute(f'PRAGMA user_version={SCHEMA_VERSION}')
        con.commit()


def setting(key, default=''):
    with db() as con:
        r=con.execute('SELECT value FROM settings WHERE key=?',(key,)).fetchone()
        return r['value'] if r else default


def normalize_phone(s):
    return re.sub(r'\D+','',s or '')


def normalize_domain(s):
    s=(s or '').strip().lower()
    s=re.sub(r'^https?://','',s); s=re.sub(r'^www\.','',s)
    return s.split('/')[0]


def normalize_text(s):
    s=(str(s or '')).strip().casefold().replace('_',' ').replace('-',' ')
    s=s.replace('ä','ae').replace('ö','oe').replace('ü','ue').replace('ß','ss')
    return re.sub(r'[^a-z0-9]+',' ',s).strip()


def company_duplicate(con, name, city='', phone='', website='', source_url=''):
    # Strong identifiers first. Never collapse unrelated same-name businesses.
    dom=normalize_domain(website); ph=normalize_phone(phone)
    matches=set()
    for r in con.execute('SELECT id,name,city,phone,website,source_url FROM companies'):
        strong=(dom and normalize_domain(r['website'])==dom) or (ph and normalize_phone(r['phone'])==ph)
        exact=(name and city and normalize_text(r['name'])==normalize_text(name) and normalize_text(r['city'])==normalize_text(city))
        source=(source_url and r['source_url'] and r['source_url'].strip().lower()==source_url.strip().lower())
        if strong or exact or source:matches.add(r['id'])
    if len(matches)>1:raise ValueError('Mehrdeutiger Firmenabgleich: bitte bestehende Kontakte prüfen.')
    return next(iter(matches),None)


def company_exclusion(con, company_id):
    return con.execute("SELECT id,lost_reason,notes FROM deals WHERE company_id=? AND (disposition='no_interest' OR do_not_contact=1) ORDER BY id DESC LIMIT 1",(company_id,)).fetchone()


def safe_score(v, default=60):
    try:return max(0,min(100,int(float(str(v).replace(',','.')))))
    except:return default


def safe_value(v, default=0):
    s=str(v or '').strip().replace('€','').replace(' ','')
    if not s:return default
    if ',' in s and '.' in s:s=s.replace('.','').replace(',','.')
    elif ',' in s:s=s.replace(',','.')
    try:return max(0,float(s))
    except:return default


def safe_date(v):
    s=str(v or '').strip()
    if not s:return ''
    try:
        n=float(s.replace(',','.'))
        if 20000<=n<=90000:return (date(1899,12,30)+timedelta(days=int(n))).isoformat()
    except:pass
    for fmt in ('%Y-%m-%d','%d.%m.%Y','%d/%m/%Y','%d-%m-%Y'):
        try:return datetime.strptime(s,fmt).date().isoformat()
        except:pass
    raise ValueError('Ungültiges Datum: '+s+' (JJJJ-MM-TT oder TT.MM.JJJJ verwenden)')


def safe_datetime(v):
    s=str(v or '').strip()
    if not s:return now_iso()
    try:
        parsed=datetime.fromisoformat(s.replace('Z','+00:00'))
        if parsed.tzinfo is not None:
            parsed=parsed.astimezone().replace(tzinfo=None)
        return parsed.isoformat(timespec='seconds')
    except Exception:
        return now_iso()


def stage_from_text(v, fallback='new'):
    s=normalize_text(v)
    aliases={
        'neu':'new','new':'new','nicht kontaktiert':'new','unkontaktiert':'new',
        'kontaktversuch':'attempted','versucht':'attempted','attempted':'attempted','nicht erreicht':'attempted',
        'kontaktiert':'contacted','kontakt':'contacted','contacted':'contacted','im gespraech':'contacted','erreicht':'contacted',
        'interesse':'interest','interessiert':'interest','interest':'interest',
        'angebot':'offer','offer':'offer','angebot gesendet':'offer','seite gesendet':'offer','angebot / seite gesendet':'offer',
        'building':'building','seite bauen':'building','angebotsseite bauen':'building','angebot seite bauen':'building',
        'follow up':'followup','followup':'followup','wiedervorlage':'followup','nachfassen':'followup',
        'gewonnen':'won','won':'won'
    }
    return aliases.get(s,fallback)


def priority_from_text(v, score=60):
    s=normalize_text(v).replace(' ','')
    if s in ('a','a+','hoch','high','1'):return 'high'
    if s in ('c','c+','niedrig','low','3'):return 'low'
    if s in ('b','b+','mittel','medium','2'):return 'medium'
    return 'high' if score>=88 else ('low' if score<70 else 'medium')


def infer_state(status='', notes='', need=''):
    # Free-text research must never invent sales outcomes or a contact stop.
    explicit=normalize_text(status)
    if explicit in ('nicht kontaktieren','kontaktstopp','do not contact','gesperrt'):
        return {'stage':'new','disposition':'no_interest','do_not_contact':1,'reason':'Kontaktstopp'}
    if explicit in ('kein interesse','nicht interessiert','abgesagt'):
        return {'stage':'contacted','disposition':'no_interest','do_not_contact':0,'reason':'Kein Interesse'}
    if explicit in ('verloren','lost'):
        return {'stage':'contacted','disposition':'lost','do_not_contact':0,'reason':'Verloren'}
    return {'stage':stage_from_text(status,'new'),'disposition':'active','do_not_contact':0,'reason':''}


def split_contact_name(name):
    parts=(name or '').strip().split()
    if not parts:return ('','')
    if len(parts)==1:return (parts[0],'')
    return (' '.join(parts[:-1]),parts[-1])


def create_lead(con,payload,activity=True):
    ts=now_iso(); company=payload.get('company') or {}; contact=payload.get('contact') or {}; deal=payload.get('deal') or {}
    name=(company.get('name') or '').strip()
    if not name:raise ValueError('Firmenname fehlt.')
    cur=con.execute('''INSERT INTO companies(name,industry,city,phone,email,website,website_status,social_status,source,source_url,notes,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)''',(name,company.get('industry',''),company.get('city',''),company.get('phone',''),company.get('email',''),company.get('website',''),company.get('website_status',''),company.get('social_status',''),company.get('source',''),company.get('source_url',''),company.get('notes',''),ts,ts))
    cid=cur.lastrowid; contact_id=None
    if any(str(contact.get(k,'')).strip() for k in ('first_name','last_name','role','phone','email')):
        cr=con.execute('''INSERT INTO contacts(company_id,first_name,last_name,role,phone,email,preferred_channel,notes,is_primary,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,1,?,?)''',(cid,contact.get('first_name',''),contact.get('last_name',''),contact.get('role',''),contact.get('phone',''),contact.get('email',''),contact.get('preferred_channel',''),contact.get('notes',''),ts,ts))
        contact_id=cr.lastrowid
    stage=deal.get('stage') if deal.get('stage') in STAGES else 'new'; disp=deal.get('disposition','active') if deal.get('disposition','active') in DISPOSITIONS else 'active'
    dnc=1 if deal.get('do_not_contact') or disp=='no_interest' else 0
    score=safe_score(deal.get('score'),60); value=safe_value(deal.get('value'),0)
    title=(deal.get('title') or f'{name} · Webdesign').strip()
    dr=con.execute('''INSERT INTO deals(company_id,contact_id,title,stage,disposition,do_not_contact,disposition_at,value,score,priority,source,next_follow_up,last_contact,need_summary,notes,lost_reason,import_raw,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',(cid,contact_id,title,stage,disp,dnc,ts if disp!='active' else '',value,score,deal.get('priority','medium'),deal.get('source') or company.get('source',''),deal.get('next_follow_up',''),deal.get('last_contact',''),deal.get('need_summary',''),deal.get('notes',''),deal.get('lost_reason',''),json.dumps(deal.get('import_raw') or {},ensure_ascii=False),ts,ts))
    did=dr.lastrowid
    con.execute('UPDATE deals SET next_action=?,proposal_url=? WHERE id=?',(str(deal.get('next_action') or ''),safe_web_url(deal.get('proposal_url')),did))
    if activity:
        con.execute('INSERT INTO activities(type,subject,body,occurred_at,company_id,contact_id,deal_id) VALUES(?,?,?,?,?,?,?)',('created','Lead angelegt','Lead wurde im CRM angelegt.',ts,cid,contact_id,did))
    return {'company_id':cid,'contact_id':contact_id,'deal_id':did}


def deal_detail(con,did):
    r=con.execute('''SELECT d.*,c.name company_name,c.industry,c.city,c.phone company_phone,c.email company_email,c.website,c.website_status,c.social_status,c.source company_source,c.source_url,c.notes company_notes,c.website_audit_json,c.website_audit_at,
      ct.first_name,ct.last_name,ct.role,ct.phone contact_phone,ct.email contact_email,ct.preferred_channel
      FROM deals d JOIN companies c ON c.id=d.company_id LEFT JOIN contacts ct ON ct.id=d.contact_id WHERE d.id=?''',(did,)).fetchone()
    if not r:return None
    out=dict(r)
    out['research']=json.loads(out.get('research_json') or '{}')
    try:out['import_raw']=json.loads(out.get('import_raw') or '{}')
    except:out['import_raw']={}
    try:out['website_audit']=json.loads(out.get('website_audit_json') or '{}')
    except:out['website_audit']={}
    out['activities']=[dict(x) for x in con.execute('SELECT * FROM activities WHERE deal_id=? ORDER BY occurred_at DESC,id DESC LIMIT 100',(did,)).fetchall()]
    out['communication']=dict(con.execute('''SELECT
      count(*) activity_count,
      coalesce(sum(CASE WHEN type='email' THEN 1 ELSE 0 END),0) email_count,
      coalesce(sum(CASE WHEN type='call' THEN 1 ELSE 0 END),0) call_count,
      coalesce(sum(CASE WHEN type='call' AND lower(subject) LIKE '%nicht erreicht%' THEN 1 ELSE 0 END),0) missed_call_count,
      coalesce(sum(CASE WHEN type='whatsapp' THEN 1 ELSE 0 END),0) whatsapp_count,
      coalesce(sum(CASE WHEN type='offer' OR lower(subject) LIKE '%angebot gesendet%' THEN 1 ELSE 0 END),0) offer_count,
      coalesce(sum(CASE WHEN type='response' OR lower(subject) LIKE '%antwort erhalten%' THEN 1 ELSE 0 END),0) response_count,
      max(CASE WHEN type='email' THEN occurred_at ELSE '' END) last_email_at,
      max(CASE WHEN type='call' THEN occurred_at ELSE '' END) last_call_at,
      max(CASE WHEN type='whatsapp' THEN occurred_at ELSE '' END) last_whatsapp_at,
      max(CASE WHEN type='offer' OR lower(subject) LIKE '%angebot gesendet%' THEN occurred_at ELSE '' END) last_offer_at,
      max(CASE WHEN type='response' OR lower(subject) LIKE '%antwort erhalten%' THEN occurred_at ELSE '' END) last_response_at,
      max(CASE WHEN type IN ('email','whatsapp','offer') OR lower(subject) LIKE '%angebot gesendet%' THEN occurred_at ELSE '' END) last_outbound_at
      FROM activities WHERE deal_id=? AND coalesce(undone_at,'')='' ''',(did,)).fetchone())
    out['tasks']=[dict(x) for x in con.execute('SELECT * FROM tasks WHERE deal_id=? ORDER BY CASE status WHEN "open" THEN 0 ELSE 1 END,due_date',(did,)).fetchall()]
    return out


def list_deals(con,qs):
    where=[];args=[]
    q=(qs.get('q',[''])[0] or '').strip(); stage=(qs.get('stage',[''])[0] or '').strip(); disposition=(qs.get('disposition',['active'])[0] or 'active').strip()
    if disposition!='all':
        if disposition not in DISPOSITIONS:disposition='active'
        where.append('d.disposition=?');args.append(disposition)
    if stage and stage in STAGES:where.append('d.stage=?');args.append(stage)
    if q:
        pat=f'%{q}%';where.append('(c.name LIKE ? OR c.city LIKE ? OR c.industry LIKE ? OR c.phone LIKE ? OR c.email LIKE ? OR c.website LIKE ? OR c.source_url LIKE ? OR ct.first_name LIKE ? OR ct.last_name LIKE ? OR d.notes LIKE ?)');args.extend([pat]*10)
    sql='''SELECT d.*,c.name company_name,c.industry,c.city,c.phone company_phone,c.email company_email,c.website,c.website_status,c.source company_source,c.source_url,
      ct.first_name,ct.last_name,ct.role,ct.phone contact_phone,ct.email contact_email,ct.preferred_channel,
      (SELECT a.subject FROM activities a WHERE a.deal_id=d.id AND coalesce(a.undone_at,'')='' ORDER BY a.occurred_at DESC,a.id DESC LIMIT 1) last_action_subject,
      (SELECT a.type FROM activities a WHERE a.deal_id=d.id AND coalesce(a.undone_at,'')='' ORDER BY a.occurred_at DESC,a.id DESC LIMIT 1) last_action_type,
      (SELECT a.occurred_at FROM activities a WHERE a.deal_id=d.id AND coalesce(a.undone_at,'')='' ORDER BY a.occurred_at DESC,a.id DESC LIMIT 1) last_action_at,
      (SELECT a.subject FROM activities a WHERE a.deal_id=d.id AND coalesce(a.undone_at,'')='' AND a.type='call' ORDER BY a.occurred_at DESC,a.id DESC LIMIT 1) last_call_result,
      (SELECT a.occurred_at FROM activities a WHERE a.deal_id=d.id AND coalesce(a.undone_at,'')='' AND a.type='call' ORDER BY a.occurred_at DESC,a.id DESC LIMIT 1) last_call_at,
      (SELECT count(*) FROM activities a WHERE a.deal_id=d.id AND coalesce(a.undone_at,'')='' AND a.type='call') call_count,
      (SELECT count(*) FROM activities a WHERE a.deal_id=d.id AND coalesce(a.undone_at,'')='' AND a.type='call' AND lower(a.subject) LIKE '%nicht erreicht%') missed_call_count,
      (SELECT count(*) FROM activities a WHERE a.deal_id=d.id AND coalesce(a.undone_at,'')='' AND a.type='email') email_count,
      (SELECT count(*) FROM activities a WHERE a.deal_id=d.id AND coalesce(a.undone_at,'')='' AND a.type='whatsapp') whatsapp_count,
      (SELECT count(*) FROM activities a WHERE a.deal_id=d.id AND coalesce(a.undone_at,'')='' AND (a.type='offer' OR lower(a.subject) LIKE '%angebot gesendet%')) offer_count,
      (SELECT count(*) FROM activities a WHERE a.deal_id=d.id AND coalesce(a.undone_at,'')='' AND (a.type='response' OR lower(a.subject) LIKE '%antwort erhalten%')) response_count,
      (SELECT max(a.occurred_at) FROM activities a WHERE a.deal_id=d.id AND coalesce(a.undone_at,'')='' AND a.type='email') last_email_at,
      (SELECT max(a.occurred_at) FROM activities a WHERE a.deal_id=d.id AND coalesce(a.undone_at,'')='' AND a.type='whatsapp') last_whatsapp_at,
      (SELECT max(a.occurred_at) FROM activities a WHERE a.deal_id=d.id AND coalesce(a.undone_at,'')='' AND (a.type='offer' OR lower(a.subject) LIKE '%angebot gesendet%')) last_offer_at,
      (SELECT max(a.occurred_at) FROM activities a WHERE a.deal_id=d.id AND coalesce(a.undone_at,'')='' AND (a.type='response' OR lower(a.subject) LIKE '%antwort erhalten%')) last_response_at,
      (SELECT max(a.occurred_at) FROM activities a WHERE a.deal_id=d.id AND coalesce(a.undone_at,'')='' AND (a.type IN ('email','whatsapp','offer') OR lower(a.subject) LIKE '%angebot gesendet%')) last_outbound_at,
      (SELECT count(*) FROM activities a WHERE a.deal_id=d.id AND coalesce(a.undone_at,'')='' AND a.type IN ('call','email','whatsapp','response','offer')) reversible_count
      FROM deals d JOIN companies c ON c.id=d.company_id LEFT JOIN contacts ct ON ct.id=d.contact_id'''
    if where:sql+=' WHERE '+' AND '.join(where)
    sql+=" ORDER BY CASE d.stage WHEN 'won' THEN 2 ELSE 1 END,CASE d.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,d.score DESC,d.updated_at DESC"
    return [dict(r) for r in con.execute(sql,args).fetchall()]


def dashboard_data():
    today=date.today().isoformat();month=date.today().strftime('%Y-%m')
    try:stale_days=max(1,int(setting('stale_days','7') or 7))
    except:stale_days=7
    stale_cut=(date.today()-timedelta(days=stale_days)).isoformat()
    with db() as con:
        ph=','.join('?'*len(OPEN_STAGES))
        open_leads=con.execute(f"SELECT count(*) n FROM deals WHERE disposition='active' AND stage IN ({ph})",OPEN_STAGES).fetchone()['n']
        pipeline=con.execute(f"SELECT coalesce(sum(value),0) v FROM deals WHERE disposition='active' AND stage IN ({ph})",OPEN_STAGES).fetchone()['v']
        won_month=con.execute("SELECT coalesce(sum(value),0) v FROM deals WHERE disposition='active' AND stage='won' AND substr(updated_at,1,7)=?",(month,)).fetchone()['v']
        due=con.execute(f"SELECT count(*) n FROM deals WHERE disposition='active' AND stage IN ({ph}) AND next_follow_up<>'' AND next_follow_up<=?",(*OPEN_STAGES,today)).fetchone()['n']
        no_interest=con.execute("SELECT count(*) n FROM deals WHERE disposition='no_interest'").fetchone()['n']
        overdue=con.execute("SELECT count(*) n FROM tasks WHERE status='open' AND due_date<>'' AND due_date<?",(today,)).fetchone()['n']
        stale=con.execute(f"SELECT count(*) n FROM deals d WHERE d.disposition='active' AND d.stage IN ({ph}) AND coalesce((SELECT max(substr(a.occurred_at,1,10)) FROM activities a WHERE a.deal_id=d.id AND coalesce(a.undone_at,'')=''),substr(d.created_at,1,10))<?",(*OPEN_STAGES,stale_cut)).fetchone()['n']
        tasks=[dict(x) for x in con.execute("SELECT t.*,c.name company_name FROM tasks t LEFT JOIN companies c ON c.id=t.company_id WHERE t.status='open' ORDER BY CASE WHEN due_date='' THEN 1 ELSE 0 END,due_date,CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END LIMIT 8").fetchall()]
        focus_sql=f"SELECT d.id,d.stage,d.score,d.value,d.next_follow_up,d.need_summary,d.last_contact,c.name company_name,c.city,c.industry,c.phone company_phone, coalesce((SELECT max(a.occurred_at) FROM activities a WHERE a.deal_id=d.id AND coalesce(a.undone_at,'')=''),d.created_at) last_activity FROM deals d JOIN companies c ON c.id=d.company_id WHERE d.disposition='active' AND d.stage IN ({ph}) ORDER BY CASE WHEN d.next_follow_up<>'' AND d.next_follow_up<=? THEN 0 ELSE 1 END,CASE d.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,d.score DESC,d.updated_at DESC LIMIT 8"
        focus=[dict(x) for x in con.execute(focus_sql,(*OPEN_STAGES,today)).fetchall()]
        stages={r['stage']:{'count':r['n'],'value':r['v']} for r in con.execute("SELECT stage,count(*) n,coalesce(sum(value),0) v FROM deals WHERE disposition='active' GROUP BY stage")}
        recent=[dict(x) for x in con.execute("SELECT a.*,c.name company_name FROM activities a LEFT JOIN companies c ON c.id=a.company_id WHERE coalesce(a.undone_at,'')='' ORDER BY a.occurred_at DESC LIMIT 10").fetchall()]
        due_sql=f"SELECT d.id,d.stage,d.score,d.next_follow_up,c.name company_name,c.phone company_phone,c.city FROM deals d JOIN companies c ON c.id=d.company_id WHERE d.disposition='active' AND d.stage IN ({ph}) AND d.next_follow_up<>'' AND d.next_follow_up<=? ORDER BY d.next_follow_up,d.score DESC LIMIT 8"
        due_items=[dict(x) for x in con.execute(due_sql,(*OPEN_STAGES,today)).fetchall()]
        return {'metrics':{'open_leads':open_leads,'pipeline':pipeline,'won_month':won_month,'due_followups':due,'no_interest':no_interest,'overdue_tasks':overdue,'stale_leads':stale},'tasks':tasks,'focus':focus,'stages':stages,'recent':recent,'due_items':due_items}

# ---------- Excel / CSV import ----------
HEADER_HINTS={'prio','prioritaet','priority','score','lead score','unternehmen','firma','firmenname','ort','stadt','branche','telefon','telefonnummer','website','webseite','website signal','akquise aufhaenger','status','quelle','notizen','ansprechpartner','email','follow up','potenzial','projektwert'}


def header_row_score(row):
    score=0;non=0
    for v in row or []:
        h=normalize_text(v)
        if not h:continue
        non+=1
        for hint in HEADER_HINTS:
            nh=normalize_text(hint)
            if h==nh:score+=4;break
            if len(nh)>=5 and (nh in h or h in nh):score+=2;break
    if non>=4:score+=2
    if non>=7:score+=2
    return score


def build_sheet(matrix,name='Tabelle'):
    clean=[]
    for rn,row in enumerate(matrix,start=1):
        vals=[str(v or '').strip() for v in row]
        if any(vals):clean.append((rn,vals))
    if not clean:raise ValueError(f'{name} enthält keine Daten.')
    width=max(len(r) for _,r in clean);clean=[(n,r+['']*(width-len(r))) for n,r in clean]
    best_score,idx=max([(header_row_score(r),i) for i,(_,r) in enumerate(clean[:35])],default=(0,0))
    if best_score<8:idx=0
    header_row,headers=clean[idx];last=max([i for i,h in enumerate(headers) if h],default=-1)
    if last<0:raise ValueError(f'{name}: Keine Kopfzeile erkannt.')
    headers=headers[:last+1];rows=[]
    for _,r in clean[idx+1:]:
        r=(r+['']*len(headers))[:len(headers)]
        if any(r):rows.append(r)
    if not rows:raise ValueError(f'{name}: Keine Daten unter der Kopfzeile.')
    return {'headers':headers,'rows':rows,'header_row':header_row,'header_score':best_score}


def decode_text(raw):
    for enc in ('utf-8-sig','utf-8','cp1252','latin-1'):
        try:return raw.decode(enc)
        except UnicodeDecodeError:pass
    return raw.decode('utf-8',errors='replace')


def parse_csv_bytes(raw):
    text=decode_text(raw);sample=text[:12000]
    try:delim=csv.Sniffer().sniff(sample,delimiters=';,\t|').delimiter
    except:delim=';' if sample.count(';')>=sample.count(',') else ','
    matrix=[list(r) for r in csv.reader(io.StringIO(text),delimiter=delim)][:5035]
    return {'CSV':build_sheet(matrix,'CSV')}


def col_index(ref):
    m=re.match(r'[A-Z]+',ref or '')
    if not m:return 0
    n=0
    for ch in m.group(0):n=n*26+(ord(ch)-64)
    return n-1


def cell_text(cell,shared,ns):
    typ=cell.attrib.get('t','')
    if typ=='inlineStr':return ''.join((t.text or '') for t in cell.findall('.//main:t',ns)).strip()
    v=cell.find('main:v',ns);raw=v.text if v is not None and v.text is not None else ''
    if typ=='s':
        try:return shared[int(raw)]
        except:return raw
    if typ=='b':return 'Ja' if raw=='1' else 'Nein'
    return raw.strip()


def parse_xlsx_bytes(raw):
    try:zf=zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile as e:raise ValueError('Ungültige XLSX-Datei.') from e
    main='http://schemas.openxmlformats.org/spreadsheetml/2006/main';rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';pkg='http://schemas.openxmlformats.org/package/2006/relationships';ns={'main':main}
    shared=[]
    if 'xl/sharedStrings.xml' in zf.namelist():
        root=ET.fromstring(zf.read('xl/sharedStrings.xml'))
        for si in root.findall(f'{{{main}}}si'):shared.append(''.join((t.text or '') for t in si.iter(f'{{{main}}}t')))
    wb=ET.fromstring(zf.read('xl/workbook.xml'));sheets=wb.find(f'{{{main}}}sheets');rels=ET.fromstring(zf.read('xl/_rels/workbook.xml.rels'));rmap={r.attrib.get('Id'):r.attrib.get('Target') for r in rels.findall(f'{{{pkg}}}Relationship')}
    out={}
    for sh in (list(sheets) if sheets is not None else []):
        name=sh.attrib.get('name') or 'Tabelle';rid=sh.attrib.get(f'{{{rel}}}id');target=rmap.get(rid)
        if name=='Feldhilfe':continue  # Documentation tab in the V6.1 template, never leads.
        if not target:continue
        target=target.lstrip('/');path=target if target.startswith('xl/') else 'xl/'+target
        if path not in zf.namelist():continue
        root=ET.fromstring(zf.read(path));data=root.find(f'{{{main}}}sheetData');matrix=[];maxcol=0
        if data is None:continue
        for row in data.findall(f'{{{main}}}row'):
            try:excel_row=int(row.attrib.get('r') or len(matrix)+1)
            except:excel_row=len(matrix)+1
            while len(matrix)<excel_row-1:matrix.append([])
            vals={}
            for cell in row.findall(f'{{{main}}}c'):
                idx=col_index(cell.attrib.get('r',''));vals[idx]=cell_text(cell,shared,ns);maxcol=max(maxcol,idx)
            arr=['']*(maxcol+1)
            for i,v in vals.items():
                if i>=len(arr):arr.extend(['']*(i+1-len(arr)))
                arr[i]=str(v).strip()
            matrix.append(arr)
            if len(matrix)>=5035:break
        try:out[name]=build_sheet(matrix,name)
        except ValueError:continue
    if not out:raise ValueError('Excel-Datei enthält keine Lead-Daten. Bitte das Blatt Leads ab Zeile 2 ausfüllen.')
    return out


def parse_workbook(filename,raw):
    lo=filename.lower()
    if lo.endswith(('.csv','.txt')):return parse_csv_bytes(raw)
    if lo.endswith(('.xlsx','.xlsm')):return parse_xlsx_bytes(raw)
    raise ValueError('Unterstützt werden .xlsx, .xlsm und .csv.')

FIELD_LABELS={
 'company_name':'Firma / Unternehmen','industry':'Branche','city':'Ort','company_phone':'Firmentelefon','company_email':'Firmen-E-Mail','website':'Website','website_status':'Website-Signal','source_url':'Quell-URL',
 'contact_name':'Ansprechpartner','contact_role':'Rolle','contact_phone':'Kontakt-Telefon','contact_email':'Kontakt-E-Mail','stage':'Status','value':'Potenzial €','score':'Lead Score','priority':'Priorität','next_follow_up':'Follow-up','need_summary':'Akquise-Aufhänger / Bedarf','notes':'Notizen'
}
SYNONYMS={
 'company_name':['firma','unternehmen','firmenname','company','betrieb','name des unternehmens'],
 'industry':['branche','industry','gewerbe','kategorie'], 'city':['ort','stadt','city','standort','location'],
 'company_phone':['telefon','telefonnummer','tel','phone','firma telefon','firmentelefon'],
 'company_email':['firma email','firmen email','allgemeine email','zentrale email','email','e mail'],
 'website':['website','webseite','homepage','internetadresse'], 'website_status':['website signal','website status','web status','internet signal'],
 'source_url':['quelle','quell url','source url','fundstelle','listing'],
 'contact_name':['ansprechpartner','kontaktperson','inhaber','geschaeftsfuehrer','name ansprechpartner'], 'contact_role':['rolle','funktion','position','titel'],
 'contact_phone':['kontakt telefon','ansprechpartner telefon','mobil','handy'], 'contact_email':['kontakt email','ansprechpartner email','persoenliche email'],
 'stage':['status','pipeline','phase','stage'], 'value':['potenzial','projektwert','wert','umsatz','deal value','budget'], 'score':['score','lead score','leadscore'],
 'priority':['prio','prioritaet','priority','klasse'], 'next_follow_up':['follow up','followup','naechster kontakt','wiedervorlage','datum'],
 'need_summary':['akquise aufhaenger','aufhaenger','akquise ansatz','verkaufsansatz','bedarf','chance'], 'notes':['notiz','notizen','bemerkung','bemerkungen','hinweis']
}


RESEARCH_FIELDS={
 'company_profile':'Firmenprofil', 'activity_status':'Prüfstatus',
 'checked_at':'Geprüft am', 'activity_evidence':'Aktivitätsnachweis',
 'evidence_urls':'Recherchequellen', 'website_observation':'Website-Beobachtung',
 'benefit_hypothesis':'Nutzenhypothese', 'opening_line':'Gesprächseinstieg',
 'priority_reason':'Prioritätsbegründung', 'research_uncertainty':'Offene Recherchefragen'
}
FIELD_LABELS.update(RESEARCH_FIELDS)
for key,label in RESEARCH_FIELDS.items():SYNONYMS[key]=[label,key]
SYNONYMS['checked_at']+=['prüfdatum','recherchedatum']
SYNONYMS['activity_status']+=['aktivitätsstatus','recherche status']
SYNONYMS['company_profile']+=['kurzprofil']

def clean_research(data):
    if not isinstance(data,dict):raise ValueError('Recherche muss ein Objekt sein.')
    out={k:str(data[k] or '').strip()[:12000] for k in RESEARCH_FIELDS if k in data}
    if out.get('checked_at'):out['checked_at']=safe_date(out['checked_at'])
    if out.get('activity_status'):
        statuses={'aktiv':'Aktiv','prüfen':'Prüfen','pruefen':'Prüfen','inaktiv':'Inaktiv','ungeprüft':'Ungeprüft','ungeprueft':'Ungeprüft'}
        status=out['activity_status'].lower()
        if status not in statuses:raise ValueError('Prüfstatus: Aktiv, Prüfen, Inaktiv oder Ungeprüft verwenden.')
        out['activity_status']=statuses[status]
    return out

def merge_research(con,did,incoming,raw=None):
    row=con.execute('SELECT research_json FROM deals WHERE id=?',(did,)).fetchone()
    current=json.loads(row['research_json'] or '{}')
    incoming={k:v for k,v in clean_research(incoming).items() if v}
    if incoming and current.get('checked_at') and not incoming.get('checked_at'):
        raise ValueError('Zum Aktualisieren einer datierten Recherche das neue Prüfdatum mitliefern.')
    if current.get('checked_at') and incoming.get('checked_at') and incoming['checked_at']<current['checked_at']:
        raise ValueError('Recherche ist älter als die gespeicherte Prüfung; nicht überschrieben.')
    if not incoming:return False
    current.update(incoming)
    con.execute('UPDATE deals SET research_json=?,updated_at=? WHERE id=?',(json.dumps(current,ensure_ascii=False),now_iso(),did))
    return True


def column_profile(rows,idx):
    vals=[str(r[idx]).strip() for r in rows[:100] if idx<len(r) and str(r[idx]).strip()]
    if not vals:return {'url':0,'email':0,'phone':0,'score':0,'currency':0,'status':0}
    n=len(vals)
    return {
      'url':sum(bool(re.match(r'https?://|www\.',v,re.I)) for v in vals)/n,
      'email':sum(bool(re.search(r'[^\s@]+@[^\s@]+\.[^\s@]+',v)) for v in vals)/n,
      'phone':sum(bool(re.fullmatch(r'[+()\d\s/\-]{6,}',v)) for v in vals)/n,
      'score':sum(bool(re.fullmatch(r'\d{1,3}(?:[.,]0+)?',v)) and 0<=safe_score(v,999)<=100 for v in vals)/n,
      'currency':sum('€' in v or bool(re.fullmatch(r'\d+[.,]?\d*\s*(eur)?',v,re.I)) for v in vals)/n,
      'status':sum(stage_from_text(v,'__x')!='__x' for v in vals)/n,
    }


def detect_mapping(headers,rows):
    mapping={};used=set();norm=[normalize_text(h) for h in headers]
    # Exact header matches first.
    for field,syns in SYNONYMS.items():
        for i,h in enumerate(norm):
            if i in used or not h:continue
            if any(h==normalize_text(s) for s in syns):mapping[field]=i;used.add(i);break
    # Specific partial matches.
    for field,syns in SYNONYMS.items():
        if field in mapping:continue
        best=None;score=0
        for i,h in enumerate(norm):
            if i in used or not h:continue
            for syn in syns:
                ns=normalize_text(syn)
                if len(ns)>=6 and ns in h and len(ns)>score:best=i;score=len(ns)
        if best is not None:mapping[field]=best;used.add(best)
    # Content-aware correction: a generic Quelle containing URLs is a source_url.
    for i,h in enumerate(norm):
        p=column_profile(rows,i)
        if h in ('quelle','source') and p['url']>=.5:
            for f,j in list(mapping.items()):
                if j==i:del mapping[f]
            mapping['source_url']=i;used.add(i)
    # Unambiguous content fallback for unknown headers.
    for i,h in enumerate(norm):
        if i in used:continue
        p=column_profile(rows,i)
        if p['email']>=.8 and 'company_email' not in mapping:mapping['company_email']=i;used.add(i)
        elif p['phone']>=.8 and 'company_phone' not in mapping:mapping['company_phone']=i;used.add(i)
        elif p['url']>=.8 and 'source_url' not in mapping:mapping['source_url']=i;used.add(i)
    return mapping


def row_value(row,mapping,field):
    idx=mapping.get(field)
    try:return str(row[int(idx)]).strip() if idx is not None and int(idx)<len(row) else ''
    except:return ''


def normalize_import_row(row,headers,mapping,defaults=None):
    defaults=defaults or {}
    val=lambda f:row_value(row,mapping,f)
    score=safe_score(val('score'),safe_score(defaults.get('score'),60))
    state=infer_state(val('stage'),val('notes'),val('need_summary'))
    raw={headers[i]:str(row[i]).strip() if i<len(row) else '' for i in range(len(headers)) if headers[i]}
    return {
      'company_name':val('company_name'),'industry':val('industry'),'city':val('city'),'company_phone':val('company_phone'),'company_email':val('company_email'),'website':val('website'),'website_status':val('website_status'),'source_url':val('source_url'),
      'contact_name':val('contact_name'),'contact_role':val('contact_role'),'contact_phone':val('contact_phone'),'contact_email':val('contact_email'),
      'stage':state['stage'],'disposition':state['disposition'],'do_not_contact':state['do_not_contact'],'lost_reason':state['reason'],
      'value':safe_value(val('value'),safe_value(defaults.get('value'),0)),'score':score,'priority':priority_from_text(val('priority'),score),'next_follow_up':safe_date(val('next_follow_up')),
      'research':clean_research({k:val(k) for k in RESEARCH_FIELDS if k in mapping}),'need_summary':val('need_summary'),'notes':val('notes'),'source':defaults.get('source','Excel Import'),'raw_status':val('stage'),'import_raw':raw
    }

def import_preview(rows,headers,mapping):
    out=[]
    for row in rows[:10]:
        try:out.append(normalize_import_row(row,headers,mapping))
        except ValueError as e:out.append({'company_name':row_value(row,mapping,'company_name'),'notes':'Prüfen: '+str(e),'stage':'new','disposition':'active','priority':'medium','score':0})
    return out


# ---------- Sales OS helpers ----------
def backup_before_migration():
    if not DB_PATH.exists() or DB_PATH.stat().st_size == 0:
        return ''
    source = sqlite3.connect(DB_PATH, timeout=20)
    source.execute('PRAGMA busy_timeout=20000')
    try:
        current = int(source.execute('PRAGMA user_version').fetchone()[0])
        if current >= SCHEMA_VERSION:
            return ''
        stamp = datetime.now().strftime('%Y-%m-%d-%H%M%S')
        target = BACKUP_DIR / f'kaiser-crm-before-v{SCHEMA_VERSION}-{stamp}.db'
        with sqlite3.connect(target) as destination:
            source.backup(destination)
        log(f'Pre-migration backup created: {target}')
        return str(target)
    except Exception as exc:
        raise RuntimeError('Sicherungsbackup vor der Datenbank-Aktualisierung fehlgeschlagen: ' + str(exc)) from exc
    finally:
        source.close()


def daily_backup():
    stamp=date.today().isoformat();target=BACKUP_DIR/f'kaiser-crm-{stamp}.db'
    if target.exists():return str(target)
    try:
        with db() as src, sqlite3.connect(target) as dst:src.backup(dst)
        old=sorted(x for x in BACKUP_DIR.glob('kaiser-crm-*.db') if re.fullmatch(r'kaiser-crm-\d{4}-\d{2}-\d{2}\.db',x.name))[:-21]
        for x in old:
            try:x.unlink()
            except:pass
        return str(target)
    except Exception as e:log('backup '+repr(e));return ''





class AuditParser(HTMLParser):
    def __init__(self):
        super().__init__();self.title='';self.in_title=False;self.meta={};self.links=[];self.forms=0;self.h1=0
    def handle_starttag(self,tag,attrs):
        a=dict(attrs);t=tag.lower()
        if t=='title':self.in_title=True
        elif t=='meta':
            k=(a.get('name') or a.get('property') or '').lower();v=a.get('content','')
            if k:self.meta[k]=v
        elif t=='a':self.links.append(a.get('href',''))
        elif t=='form':self.forms+=1
        elif t=='h1':self.h1+=1
    def handle_endtag(self,tag):
        if tag.lower()=='title':self.in_title=False
    def handle_data(self,data):
        if self.in_title:self.title+=data.strip()

def website_audit(url):
    raw=(url or '').strip()
    if not raw:raise ValueError('Keine Website hinterlegt.')
    if not re.match(r'^https?://',raw,re.I):raw='https://'+raw
    started=time.time();req=Request(raw,headers={'User-Agent':'Mozilla/5.0 KaiserCRM/5.0'})
    with urlopen(req,timeout=12) as r:
        body=r.read(1_500_000);final=r.geturl();status=getattr(r,'status',200);ctype=r.headers.get('Content-Type','')
    ms=int((time.time()-started)*1000);text=body.decode('utf-8',errors='ignore');parser=AuditParser();parser.feed(text);low=text.lower();checks=[];score=0
    def add(ok,label,pts,detail=''):
        nonlocal score
        if ok:score+=pts
        checks.append({'ok':bool(ok),'label':label,'detail':detail})
    add(final.lower().startswith('https://'),'HTTPS aktiv',15)
    add(bool(parser.title.strip()),'Seitentitel vorhanden',12,parser.title.strip()[:120])
    desc=parser.meta.get('description','');add(bool(desc.strip()),'Meta Description vorhanden',10,desc.strip()[:150])
    viewport=parser.meta.get('viewport','');add('width=device-width' in viewport.replace(' ',''),'Mobile Viewport gesetzt',13)
    add(parser.h1>0,'H1-Überschrift vorhanden',10,f'{parser.h1} H1')
    add(any(x in low for x in ('kontakt','anfrage','angebot','termin','jetzt anfragen','projekt anfragen')),'Kontakt-/Anfrage-Signale',12)
    tel=any(str(x).lower().startswith('tel:') for x in parser.links);mail=any(str(x).lower().startswith('mailto:') for x in parser.links);add(tel or mail,'Direkter Telefon-/E-Mail-Link',10)
    social=any(any(d in str(x).lower() for d in ('instagram.com','facebook.com','linkedin.com','tiktok.com')) for x in parser.links);add(social,'Social-Media-Verknüpfung',8)
    add(parser.forms>0,'Kontaktformular erkannt',10,f'{parser.forms} Formular(e)')
    return {'url':raw,'final_url':final,'status_code':status,'response_ms':ms,'score':min(100,score),'title':parser.title.strip()[:160],'description':desc.strip()[:240],'checks':checks,'audited_at':now_iso(),'content_type':ctype}






# ---------- Ollama ----------
def ollama_status():
    try:
        with urlopen(OLLAMA+'/api/tags',timeout=2) as r:
            data=json.loads(r.read().decode());return {'online':True,'models':[m.get('name') for m in data.get('models',[])]}
    except Exception as e:return {'online':False,'models':[],'error':str(e)}

SYSTEM_PROMPT='''Du bist Kaiser AI, der lokale CRM- und Akquise-Assistent von Kaiser Webdesign. Antworte auf Deutsch, konkret, kurz und professionell. Erfinde niemals fehlende Kundendaten. Berücksichtige Do-Not-Contact/Kein-Interesse unbedingt. Bei Akquise: freundlich, menschlich, nicht drängend. Wenn du eine CRM-Aktion vorschlägst, ändere nie eigenmächtig Daten.'''


def ollama_chat(messages,fmt=None):
    body={'model':setting('ollama_model','qwen3:8b'),'messages':messages,'stream':False,'options':{'temperature':.25}}
    if fmt:body['format']=fmt
    req=Request(OLLAMA+'/api/chat',data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
    with urlopen(req,timeout=180) as r:return json.loads(r.read().decode())['message']['content']


def lead_context(con,did):
    d=deal_detail(con,did)
    if not d:return ''
    return '\n'.join([
      f"Firma: {d['company_name']}",f"Branche: {d['industry']}",f"Ort: {d['city']}",f"Telefon: {d['company_phone']}",f"Website: {d['website'] or 'keine/unklar'}",f"Website-Signal: {d['website_status']}",
      f"Status: {STAGES.get(d['stage'],d['stage'])}",f"Disposition: {DISPOSITIONS.get(d['disposition'],d['disposition'])}",f"Nicht kontaktieren: {'Ja' if d['do_not_contact'] else 'Nein'}",f"Score: {d['score']}/100",f"Potenzial: {d['value'] or 'offen'}",f"Bedarf: {d['need_summary']}",f"Notizen: {d['notes']}",f"Angebotsseite: {d['proposal_url'] or 'kein Link'}",f"Versand: {d['proposal_sent_at'] or 'nicht protokolliert'}",f"Nächste Aktion: {d['next_action']}",f"Wiedervorlage: {d['next_follow_up']}"
    ])


def crm_context(con):
    active=con.execute("SELECT count(*) n FROM deals WHERE disposition='active'").fetchone()['n'];excluded=con.execute("SELECT count(*) n FROM deals WHERE disposition='no_interest'").fetchone()['n']
    top=con.execute("SELECT d.id,c.name,d.score,d.stage,d.value,d.next_follow_up,d.next_action FROM deals d JOIN companies c ON c.id=d.company_id WHERE d.disposition='active' AND d.stage<>'won' ORDER BY d.score DESC LIMIT 8").fetchall()
    return f"Aktive Leads: {active}\nKein Interesse / nicht kontaktieren: {excluded}\nTop Leads:\n"+'\n'.join(f"- Lead #{r['id']}: {r['name']} · Wiedervorlage {r['next_follow_up'] or 'offen'} · Score {r['score']} · {STAGES.get(r['stage'],r['stage'])} · Potenzial {r['value'] or 'offen'}" for r in top)


def ai_analysis(con,did,mode):
    ctx=lead_context(con,did)
    ctx+='\nRecherche (Beobachtungen und Hypothesen unterscheiden): '+json.dumps(deal_detail(con,did).get('research',{}),ensure_ascii=False)
    prompts={
      'analyze':'Analysiere diesen Lead. Nenne Potenzial, Schwächen, beste Ansprache und nächsten sinnvollen Schritt.',
      'prepare':'Bereite ein kurzes Telefongespräch vor: Einstieg, 3 Fragen, Nutzenargument und Umgang mit Einwand.',
      'followup':'Formuliere ein kurzes natürliches Follow-up, passend zu den vorhandenen Daten.',
      'score':'Prüfe den Lead Score kritisch. Nenne einen empfohlenen Score und begründe ihn. Keine erfundenen Fakten.'}
    return ollama_chat([{'role':'system','content':SYSTEM_PROMPT},{'role':'user','content':ctx+'\n\n'+prompts.get(mode,prompts['analyze'])}])


def propose_actions(con,instruction):
    context=crm_context(con)
    schema={"type":"object","properties":{"actions":{"type":"array","items":{"type":"object","properties":{"type":{"type":"string","enum":["update_deal","create_task","add_activity"]},"deal_id":{"type":"integer"},"fields":{"type":"object"},"title":{"type":"string"},"due_date":{"type":"string"},"priority":{"type":"string"},"notes":{"type":"string"},"activity_type":{"type":"string"},"subject":{"type":"string"},"body":{"type":"string"}},"required":["type","deal_id"]}}},"required":["actions"]}
    prompt=context+'\n\nAnweisung: '+instruction+'\nErstelle nur Aktionen, wenn der Lead eindeutig identifizierbar ist. Keine Löschaktionen. Markiere Kein Interesse mit disposition=no_interest und do_not_contact=true.'
    raw=ollama_chat([{'role':'system','content':SYSTEM_PROMPT},{'role':'user','content':prompt}],schema)
    try:return json.loads(raw).get('actions',[])
    except:return []


def execute_actions(con,actions):
    done=[];ts=now_iso()
    for a in actions[:20]:
        typ=a.get('type');did=int(a.get('deal_id') or 0);deal=con.execute('SELECT * FROM deals WHERE id=?',(did,)).fetchone()
        if not deal:continue
        if typ=='update_deal':
            allowed={'stage','value','score','priority','next_follow_up','next_action','need_summary','notes','disposition','do_not_contact','lost_reason'};sets=[];vals=[]
            for k,v in (a.get('fields') or {}).items():
                if k not in allowed:continue
                if k=='stage' and v not in STAGES:continue
                if k=='disposition' and v not in DISPOSITIONS:continue
                if k=='score':v=safe_score(v,deal['score'])
                if k=='value':v=safe_value(v,deal['value'])
                if k=='do_not_contact':v=1 if v else 0
                sets.append(f'{k}=?');vals.append(v)
            if sets:
                sets+=['updated_at=?'];vals += [ts,did];con.execute('UPDATE deals SET '+','.join(sets)+' WHERE id=?',vals);done.append({'type':typ,'deal_id':did})
        elif typ=='create_task':
            con.execute('INSERT INTO tasks(title,due_date,priority,status,company_id,deal_id,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',(a.get('title') or 'Follow-up',a.get('due_date',''),a.get('priority','medium'),'open',deal['company_id'],did,a.get('notes',''),ts,ts));done.append({'type':typ,'deal_id':did})
        elif typ=='add_activity':
            con.execute('INSERT INTO activities(type,subject,body,occurred_at,company_id,deal_id) VALUES(?,?,?,?,?,?)',(a.get('activity_type','note'),a.get('subject','Notiz'),a.get('body',''),ts,deal['company_id'],did));done.append({'type':typ,'deal_id':did})
    return done

def safe_web_url(value):
    value=str(value or '').strip()
    if not value:return ''
    if not re.match(r'^https?://',value,re.I):
        if '://' in value or re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:',value):
            raise ValueError('Bitte eine http- oder https-Adresse für die Angebotsseite eingeben.')
        value='https://'+value
    parsed=urlparse(value)
    if parsed.scheme.lower() not in ('http','https') or not parsed.hostname or any(c.isspace() for c in value):
        raise ValueError('Die Adresse der Angebotsseite ist ungültig.')
    return value


def workflow_days(key, fallback):
    try:return max(1,min(90,int(setting(key,str(fallback)))))
    except (TypeError,ValueError):return fallback


def log_activity(con,payload):
    did=int(payload.get('deal_id') or 0)
    d=con.execute('SELECT * FROM deals WHERE id=?',(did,)).fetchone()
    if not d:raise ValueError('Lead nicht gefunden.')
    kind=payload.get('type','call');result=payload.get('result','')
    if kind not in ('call','email','whatsapp','offer','response','meeting','note','work','linkedin'):
        raise ValueError('Unbekannte Aktivität.')
    if (d['do_not_contact'] or d['disposition']!='active') and kind not in ('note','work'):
        raise ValueError('Dieser Lead ist für Kontaktaufnahmen gesperrt. Er muss zuerst bewusst reaktiviert werden.')
    labels={'call':'Anruf','email':'E-Mail','whatsapp':'WhatsApp','offer':'Angebot','response':'Antwort','meeting':'Termin','note':'Notiz','work':'Angebotsseite','linkedin':'LinkedIn'}
    outcomes={'reached':'Erreicht','not_reached':'Nicht erreicht','interested':'Interesse','no_interest':'Kein Interesse','later':'Später wieder melden','contact_stop':'Kontaktstopp','inactive':'Firma inaktiv','offer_sent':'Angebot gesendet','page_building':'Angebotsseite wird gebaut','page_sent':'Angebotsseite gesendet','followup':'Nachfassen geplant','email_sent':'E-Mail gesendet','called':'Angerufen','whatsapp_sent':'WhatsApp gesendet','response_received':'Antwort erhalten'}
    if result and result not in outcomes:raise ValueError('Unbekanntes Ergebnis.')
    try:count=max(1,min(25,int(payload.get('count') or 1)))
    except (ValueError,TypeError):count=1
    occurred_at=safe_datetime(payload.get('occurred_at'))
    follow=safe_date(payload.get('follow_up',''))
    body=str(payload.get('body') or '').strip()
    proposal=safe_web_url(payload.get('proposal_url',d['proposal_url']))
    latest=con.execute("SELECT max(occurred_at) ts FROM activities WHERE deal_id=? AND coalesce(undone_at,'')='' AND type IN ('call','email','whatsapp','offer','response','meeting','work')",(did,)).fetchone()['ts']
    historical=bool(latest and occurred_at<latest)
    subject=outcomes.get(result) or labels[kind]
    batch_id=str(uuid.uuid4())
    ids=[]
    for i in range(count):
        metadata={'result':result,'batch_id':batch_id,'batch_count':count,'batch_index':i+1,'historical':historical}
        cur=con.execute('INSERT INTO activities(type,subject,body,occurred_at,company_id,contact_id,deal_id,metadata) VALUES(?,?,?,?,?,?,?,?)',(kind,subject,body if i==0 else '',occurred_at,d['company_id'],d['contact_id'],did,json.dumps(metadata,ensure_ascii=False)))
        ids.append(cur.lastrowid)
    patch={}
    event_day=date.fromisoformat(occurred_at[:10])
    if kind in ('call','email','whatsapp','offer','response','meeting','linkedin'):
        patch['last_contact']=max(d['last_contact'] or '',event_day.isoformat())
    active=d['disposition']=='active' and not d['do_not_contact'] and d['stage']!='won'
    if not historical and active:
        if result in ('not_reached','called'):
            if d['stage'] in ('new','attempted'):patch['stage']='attempted'
            patch['next_follow_up']=follow or (event_day+timedelta(days=workflow_days('followup_attempted_days',2))).isoformat()
            patch['next_action']='call'
        elif result in ('reached','email_sent','whatsapp_sent','response_received'):
            if d['stage'] in ('new','attempted'):patch['stage']='contacted'
        elif result=='interested':
            if d['stage'] in ('new','attempted','contacted','interest'):patch['stage']='interest'
        elif result=='page_building':
            patch.update(stage='building',next_action='build_page',proposal_url=proposal,next_follow_up=follow)
        elif result in ('offer_sent','page_sent'):
            patch.update(stage='offer',next_action='followup',next_follow_up=follow or (event_day+timedelta(days=workflow_days('followup_offer_days',3))).isoformat())
            if result=='page_sent':patch.update(proposal_url=proposal,proposal_sent_at=occurred_at)
        elif result=='followup':
            patch.update(stage='followup',next_action='followup')
        if result in ('no_interest','contact_stop','inactive'):
            patch.update(disposition='no_interest',do_not_contact=1 if result=='contact_stop' else 0,lost_reason=outcomes[result],disposition_at=occurred_at,next_follow_up='',next_action='')
        elif result=='later':
            patch.update(stage='followup',next_action='call',next_follow_up=follow or (event_day+timedelta(days=30)).isoformat())
        else:
            if follow:patch['next_follow_up']=follow
            action=str(payload.get('next_action') or '').strip()
            if action:patch['next_action']=action[:64]
    if patch:
        con.execute('UPDATE deals SET '+','.join(f'{key}=?' for key in patch)+',updated_at=? WHERE id=?',[*patch.values(),now_iso(),did])
    out=deal_detail(con,did)
    out.update(logged_count=count,activity_ids=ids,historical=historical)
    return out


# ---------- HTTP ----------
class Handler(SimpleHTTPRequestHandler):
    server_version='KaiserCRM/6.1.0'
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(APP_DIR),**kwargs)
    def log_message(self,fmt,*args):log(fmt%args)
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        super().end_headers()

    def send_json(self,status,payload):
        raw=json.dumps(payload,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
    def read_json(self):
        n=int(self.headers.get('Content-Length','0') or 0)
        if n<=0:return {}
        if n>MAX_BODY:raise ValueError('Anfrage zu groß.')
        return json.loads(self.rfile.read(n).decode())

    def do_GET(self):
        u=urlparse(self.path);path=u.path;qs=parse_qs(u.query)
        try:
            if path=='/api/desktop/ping':
                global LAST_DESKTOP_PING
                LAST_DESKTOP_PING=time.time()
                return self.send_json(200,{'ok':True})
            if path=='/api/health':return self.send_json(200,{'ok':True,'version':APP_VERSION,'database':str(DB_PATH),'app_dir':str(APP_DIR)})
            if path=='/api/dashboard':return self.send_json(200,dashboard_data())
            if path=='/api/deals':
                with db() as con:return self.send_json(200,{'items':list_deals(con,qs)})
            m=re.fullmatch(r'/api/deals/(\d+)',path)
            if m:
                with db() as con:
                    d=deal_detail(con,int(m.group(1)));return self.send_json(200,d) if d else self.send_json(404,{'error':'Lead nicht gefunden'})
            if path=='/api/companies':
                with db() as con:
                    items=[dict(r) for r in con.execute('''SELECT c.*,(SELECT count(*) FROM deals d WHERE d.company_id=c.id) deal_count,(SELECT count(*) FROM deals d WHERE d.company_id=c.id AND (d.disposition='no_interest' OR d.do_not_contact=1)) excluded_count,(SELECT max(a.occurred_at) FROM activities a WHERE a.company_id=c.id AND coalesce(a.undone_at,'')='') last_activity FROM companies c ORDER BY c.updated_at DESC''')]
                    return self.send_json(200,{'items':items})
            if path=='/api/contacts':
                with db() as con:return self.send_json(200,{'items':[dict(r) for r in con.execute('SELECT ct.*,c.name company_name,c.city FROM contacts ct JOIN companies c ON c.id=ct.company_id ORDER BY ct.updated_at DESC')]})
            if path=='/api/tasks':
                with db() as con:return self.send_json(200,{'items':[dict(r) for r in con.execute('''SELECT t.*,c.name company_name,d.title deal_title FROM tasks t LEFT JOIN companies c ON c.id=t.company_id LEFT JOIN deals d ON d.id=t.deal_id ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END,CASE WHEN due_date='' THEN 1 ELSE 0 END,due_date''')]})
            if path=='/api/projects':
                with db() as con:return self.send_json(200,{'items':[dict(r) for r in con.execute('SELECT p.*,c.name company_name FROM projects p JOIN companies c ON c.id=p.company_id ORDER BY p.updated_at DESC')]})
            if path=='/api/import/history':
                with db() as con:return self.send_json(200,{'items':[dict(r) for r in con.execute('SELECT * FROM imports ORDER BY id DESC LIMIT 50')]})
            if path=='/api/settings':
                with db() as con:out={r['key']:r['value'] for r in con.execute('SELECT * FROM settings') if not r['key'].startswith(('openai_','lead_agent_'))}
                return self.send_json(200,out)
            if path.startswith('/api/agent/'):
                return self.send_json(410,{'error':'Die kostenpflichtige Lead-Suche wurde entfernt.'})
            if path=='/api/ai/status':return self.send_json(200,ollama_status())
            if path=='/api/export/leads.csv':
                with db() as con:
                    rows=con.execute('''SELECT c.name,c.industry,c.city,c.phone,c.email,c.website,c.website_status,c.source_url,trim(coalesce(ct.first_name,'')||' '||coalesce(ct.last_name,'')) contact_name,ct.role,ct.phone contact_phone,ct.email contact_email,d.stage,d.disposition,d.do_not_contact,d.value,d.score,d.priority,d.next_follow_up,d.need_summary,d.notes,d.lost_reason,d.research_json FROM deals d JOIN companies c ON c.id=d.company_id LEFT JOIN contacts ct ON ct.id=d.contact_id ORDER BY d.updated_at DESC''').fetchall()
                out=io.StringIO();w=csv.writer(out,delimiter=';',lineterminator='\n');w.writerow(['Unternehmen','Branche','Ort','Telefon','Firmen-E-Mail','Website','Website-Signal','Quelle URL','Ansprechpartner','Rolle','Kontakt-Telefon','Kontakt-E-Mail','Status','Ergebnis','Nicht kontaktieren','Potenzial','Score','Priorität','Follow-up','Bedarf','Notizen','Grund']+list(RESEARCH_FIELDS.values()))
                for r in rows:w.writerow([r['name'],r['industry'],r['city'],r['phone'],r['email'],r['website'],r['website_status'],r['source_url'],r['contact_name'],r['role'],r['contact_phone'],r['contact_email'],STAGES.get(r['stage'],r['stage']),DISPOSITIONS.get(r['disposition'],r['disposition']),r['do_not_contact'],r['value'],r['score'],r['priority'],r['next_follow_up'],r['need_summary'],r['notes'],r['lost_reason']]+[json.loads(r['research_json'] or '{}').get(k,'') for k in RESEARCH_FIELDS])
                raw=('\ufeff'+out.getvalue()).encode();self.send_response(200);self.send_header('Content-Type','text/csv; charset=utf-8');self.send_header('Content-Disposition',f'attachment; filename="kaiser-crm-leads-{date.today().isoformat()}.csv"');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw);return
            if path=='/api/backup':
                with db() as con:
                    tables=['companies','contacts','deals','tasks','activities','projects','imports','settings','agent_runs'];data={'version':'6.1.0','created_at':now_iso(),'tables':{}}
                    for t in tables:data['tables'][t]=[dict(r) for r in con.execute(f'SELECT * FROM {t}')]
                raw=json.dumps(data,ensure_ascii=False,indent=2).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Disposition',f'attachment; filename="kaiser-crm-backup-{date.today().isoformat()}.json"');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw);return
            if path not in ('/','/index.html','/styles.css','/app.js','/Kaiser-CRM.ico','/brand-logo-full.png'):
                return self.send_json(404,{'error':'Nicht gefunden'})
            return super().do_GET()
        except Exception as e:log('GET '+repr(e));return self.send_json(500,{'error':str(e)})

    def do_POST(self):
        path=urlparse(self.path).path
        try:
            payload=self.read_json()
            if path=='/api/settings':
                with db() as con:
                    allowed_settings={'ollama_model','ai_speed','brand_name','followup_attempted_days','followup_offer_days','stale_days'}
                    for k,v in payload.items():
                        if k in allowed_settings:con.execute('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(k,str(v)))
                    con.commit();return self.send_json(200,{'ok':True})
            if path=='/api/leads':
                with db() as con:r=create_lead(con,payload);con.commit();return self.send_json(201,r)
            if path=='/api/contacts':
                ts=now_iso();cid=int(payload.get('company_id') or 0)
                if not cid:return self.send_json(400,{'error':'Firma fehlt'})
                with db() as con:
                    cr=con.execute('INSERT INTO contacts(company_id,first_name,last_name,role,phone,email,preferred_channel,notes,is_primary,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,?,?)',(cid,payload.get('first_name',''),payload.get('last_name',''),payload.get('role',''),payload.get('phone',''),payload.get('email',''),payload.get('preferred_channel',''),payload.get('notes',''),ts,ts));contact_id=cr.lastrowid
                    if payload.get('deal_id'):con.execute('UPDATE deals SET contact_id=?,updated_at=? WHERE id=?',(contact_id,ts,int(payload['deal_id'])))
                    con.commit();return self.send_json(201,{'id':contact_id})
            if path=='/api/tasks':
                ts=now_iso();title=(payload.get('title') or '').strip()
                if not title:return self.send_json(400,{'error':'Aufgabe fehlt'})
                with db() as con:
                    did=payload.get('deal_id');cid=payload.get('company_id')
                    if did and not cid:
                        r=con.execute('SELECT company_id FROM deals WHERE id=?',(did,)).fetchone();cid=r['company_id'] if r else None
                    cr=con.execute('INSERT INTO tasks(title,due_date,priority,status,company_id,deal_id,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',(title,payload.get('due_date',''),payload.get('priority','medium'),'open',cid,did,payload.get('notes',''),ts,ts));con.commit();return self.send_json(201,{'id':cr.lastrowid})
            if path=='/api/activities':
                ts=now_iso();did=int(payload.get('deal_id') or 0)
                with db() as con:
                    d=con.execute('SELECT company_id,contact_id FROM deals WHERE id=?',(did,)).fetchone()
                    if not d:return self.send_json(404,{'error':'Lead nicht gefunden'})
                    cr=con.execute('INSERT INTO activities(type,subject,body,occurred_at,company_id,contact_id,deal_id) VALUES(?,?,?,?,?,?,?)',(payload.get('type','note'),payload.get('subject','Notiz'),payload.get('body',''),ts,d['company_id'],d['contact_id'],did));con.execute('UPDATE deals SET last_contact=?,updated_at=? WHERE id=?',(date.today().isoformat(),ts,did));con.commit();return self.send_json(201,{'id':cr.lastrowid})
            if path=='/api/projects':
                ts=now_iso();cid=int(payload.get('company_id') or 0);name=(payload.get('name') or '').strip()
                if not cid or not name:return self.send_json(400,{'error':'Firma und Projektname erforderlich'})
                with db() as con:
                    cr=con.execute('INSERT INTO projects(company_id,deal_id,name,status,value,deadline,domain,repo_url,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',(cid,payload.get('deal_id'),name,payload.get('status','planning'),safe_value(payload.get('value'),0),payload.get('deadline',''),payload.get('domain',''),payload.get('repo_url',''),payload.get('notes',''),ts,ts));con.commit();return self.send_json(201,{'id':cr.lastrowid})
            if path=='/api/import/parse':
                filename=payload.get('filename','');raw=base64.b64decode(payload.get('data',''))
                if len(raw)>MAX_BODY:return self.send_json(413,{'error':'Datei zu groß'})
                sheets=parse_workbook(filename,raw);sid=str(uuid.uuid4());IMPORT_SESSIONS[sid]={'filename':filename,'sheets':sheets,'created':time.time()}
                def rank(item):
                    _,sh=item;mp=detect_mapping(sh['headers'],sh['rows']);return (1 if 'company_name' in mp else 0,len(mp),sh['header_score'],len(sh['rows']))
                active=max(sheets.items(),key=rank)[0];sh=sheets[active];mp=detect_mapping(sh['headers'],sh['rows']);preview=import_preview(sh['rows'],sh['headers'],mp)
                unmapped=[h for i,h in enumerate(sh['headers']) if i not in set(mp.values()) and h]
                return self.send_json(200,{'session_id':sid,'sheets':list(sheets),'active_sheet':active,'headers':sh['headers'],'row_count':len(sh['rows']),'mapping':mp,'fields':FIELD_LABELS,'header_row':sh['header_row'],'recognized_count':len(mp),'unmapped':unmapped,'normalized_preview':preview})
            if path=='/api/import/select':
                s=IMPORT_SESSIONS.get(payload.get('session_id'));name=payload.get('sheet')
                if not s or name not in s['sheets']:return self.send_json(404,{'error':'Importsitzung nicht gefunden'})
                sh=s['sheets'][name];mp=detect_mapping(sh['headers'],sh['rows']);preview=import_preview(sh['rows'],sh['headers'],mp);unmapped=[h for i,h in enumerate(sh['headers']) if i not in set(mp.values()) and h]
                return self.send_json(200,{'active_sheet':name,'headers':sh['headers'],'row_count':len(sh['rows']),'mapping':mp,'fields':FIELD_LABELS,'header_row':sh['header_row'],'recognized_count':len(mp),'unmapped':unmapped,'normalized_preview':preview})
            if path=='/api/import/commit':
                s=IMPORT_SESSIONS.get(payload.get('session_id'));sheet_name=payload.get('sheet');mapping=payload.get('mapping') or {};defaults=payload.get('defaults') or {};skip=bool(payload.get('skip_duplicates',True))
                if not s or sheet_name not in s['sheets']:return self.send_json(404,{'error':'Importsitzung abgelaufen'})
                sh=s['sheets'][sheet_name];rows=sh['rows'];headers=sh['headers'];imported=dupes=excluded=errors=updated=0;details=[]
                with db() as con:
                    for offset,row in enumerate(rows,start=sh['header_row']+1):
                        con.execute('SAVEPOINT import_row')
                        try:
                            x=normalize_import_row(row,headers,mapping,defaults);name=x['company_name']
                            if not name:raise ValueError('Firmenname fehlt')
                            existing=company_duplicate(con,name,x['city'],x['company_phone'],x['website'],x['source_url'])
                            if existing:
                                ex=company_exclusion(con,existing)
                                if ex:
                                    excluded+=1;details.append({'row':offset,'info':'Bereits ausgeschlossen; Recherche und Kontaktstopp unverändert'});con.execute('RELEASE import_row');continue
                                if payload.get('update_research'):
                                    candidates=con.execute("SELECT id FROM deals WHERE company_id=? AND disposition='active' ORDER BY id DESC",(existing,)).fetchall()
                                    if len(candidates)!=1:raise ValueError('Recherche-Update benötigt genau einen aktiven Lead dieser Firma.')
                                    did=candidates[0]['id']
                                    changed=merge_research(con,did,x['research'])
                                    if changed:
                                        updated+=1
                                        con.execute('INSERT INTO activities(type,subject,body,occurred_at,company_id,deal_id) VALUES(?,?,?,?,?,?)',('research','Recherche aktualisiert','Aus '+s['filename']+'; Gesprächsdaten unverändert.',now_iso(),existing,did))
                                    else:dupes+=1
                                    con.execute('RELEASE import_row');continue
                                if skip:dupes+=1;con.execute('RELEASE import_row');continue
                            ts=now_iso();cr=con.execute('''INSERT INTO companies(name,industry,city,phone,email,website,website_status,source,source_url,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)''',(name,x['industry'],x['city'],x['company_phone'],x['company_email'],x['website'],x['website_status'],x['source'],x['source_url'],'',ts,ts));cid=cr.lastrowid
                            contact_id=None
                            if x['contact_name'] or x['contact_role'] or x['contact_phone'] or x['contact_email']:
                                fn,ln=split_contact_name(x['contact_name']);ct=con.execute('INSERT INTO contacts(company_id,first_name,last_name,role,phone,email,is_primary,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)',(cid,fn,ln,x['contact_role'],x['contact_phone'],x['contact_email'],ts,ts));contact_id=ct.lastrowid
                            dr=con.execute('''INSERT INTO deals(company_id,contact_id,title,stage,disposition,do_not_contact,disposition_at,value,score,priority,source,next_follow_up,need_summary,notes,lost_reason,import_raw,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',(cid,contact_id,f'{name} · Webdesign',x['stage'],x['disposition'],x['do_not_contact'],ts if x['disposition']!='active' else '',x['value'],x['score'],x['priority'],x['source'],x['next_follow_up'],x['need_summary'],x['notes'],x['lost_reason'],json.dumps(x['import_raw'],ensure_ascii=False),ts,ts));did=dr.lastrowid
                            merge_research(con,did,x['research'])
                            con.execute('INSERT INTO activities(type,subject,body,occurred_at,company_id,contact_id,deal_id,metadata) VALUES(?,?,?,?,?,?,?,?)',('import','Lead importiert',f'Automatisch importiert aus {s["filename"]} · {sheet_name}',ts,cid,contact_id,did,json.dumps({'raw_status':x['raw_status'],'auto_disposition':x['disposition']},ensure_ascii=False)))
                            if x['disposition']=='no_interest':
                                con.execute('INSERT INTO activities(type,subject,body,occurred_at,company_id,deal_id) VALUES(?,?,?,?,?,?)',('status','Kein Interesse erkannt','Expliziten Ausschlussstatus aus der Status-Spalte übernommen.',ts,cid,did))
                            imported+=1
                            con.execute('RELEASE import_row')
                        except Exception as e:
                            con.execute('ROLLBACK TO import_row');con.execute('RELEASE import_row')
                            errors+=1;details.append({'row':offset,'error':str(e)[:180]})
                    con.execute('INSERT INTO imports(filename,sheet_name,total_rows,imported_count,duplicate_count,excluded_count,error_count,report_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)',(s['filename'],sheet_name,len(rows),imported,dupes,excluded,errors,json.dumps({'details':details[:80],'updated':updated},ensure_ascii=False),now_iso()));con.commit()
                IMPORT_SESSIONS.pop(payload.get('session_id'),None);return self.send_json(200,{'imported':imported,'updated':updated,'duplicates':dupes,'excluded':excluded,'errors':errors,'total':len(rows),'details':details[:30]})
            if path=='/api/website/audit':
                did=int(payload.get('deal_id') or 0)
                with db() as con:
                    d=deal_detail(con,did)
                    if not d:return self.send_json(404,{'error':'Lead nicht gefunden'})
                    result=website_audit(payload.get('url') or d.get('website',''))
                    con.execute('UPDATE companies SET website=?,website_audit_json=?,website_audit_at=?,updated_at=? WHERE id=?',(result['final_url'],json.dumps(result,ensure_ascii=False),result['audited_at'],now_iso(),d['company_id']))
                    con.execute('INSERT INTO activities(type,subject,body,occurred_at,company_id,deal_id,metadata) VALUES(?,?,?,?,?,?,?)',('audit','Website Quick Audit',f"Audit Score {result['score']}/100 · {result['response_ms']} ms",now_iso(),d['company_id'],did,json.dumps(result,ensure_ascii=False)));con.commit()
                return self.send_json(200,result)
            if path=='/api/activities/log':
                with db() as con:
                    out=log_activity(con,payload)
                    con.commit()
                    return self.send_json(200,out)
            if path=='/api/activities/undo':
                did=int(payload.get('deal_id') or 0);activity_id=int(payload.get('activity_id') or 0)
                undoable={'call','email','whatsapp','response','offer','work'}
                with db() as con:
                    deal=con.execute('SELECT id FROM deals WHERE id=?',(did,)).fetchone()
                    if not deal:return self.send_json(404,{'error':'Lead nicht gefunden'})
                    rows=con.execute("SELECT * FROM activities WHERE deal_id=? AND coalesce(undone_at,'')='' ORDER BY occurred_at DESC,id DESC",(did,)).fetchall()
                    target=None
                    for row in rows:
                        if row['type'] not in undoable:continue
                        if activity_id and row['id']!=activity_id:continue
                        target=row;break
                    if not target:return self.send_json(404,{'error':'Keine passende Kontakteingabe zum Rückgängigmachen gefunden'})
                    try:target_meta=json.loads(target['metadata'] or '{}')
                    except:target_meta={}
                    batch_id=target_meta.get('batch_id');ids=[]
                    for row in rows:
                        if row['type'] not in undoable:continue
                        if batch_id:
                            try:row_meta=json.loads(row['metadata'] or '{}')
                            except:row_meta={}
                            if row_meta.get('batch_id')==batch_id:ids.append(row['id'])
                        elif row['id']==target['id']:ids.append(row['id'])
                    if not ids:ids=[target['id']]
                    ts=now_iso();marks=','.join('?'*len(ids))
                    con.execute(f"UPDATE activities SET undone_at=?,undone_reason=? WHERE id IN ({marks})",[ts,'Vom Nutzer rückgängig gemacht',*ids])
                    last=con.execute("SELECT max(substr(occurred_at,1,10)) day FROM activities WHERE deal_id=? AND coalesce(undone_at,'')='' AND type IN ('call','email','whatsapp','response','offer','meeting')",(did,)).fetchone()
                    con.execute('UPDATE deals SET last_contact=?,updated_at=? WHERE id=?',((last['day'] or '') if last else '',ts,did))
                    con.commit();return self.send_json(200,{'ok':True,'undone_count':len(ids),'subject':target['subject'] or target['type'],'activity_id':target['id']})
            if path.startswith('/api/agent/'):
                return self.send_json(410,{'error':'Die kostenpflichtige Lead-Suche wurde entfernt.'})
            if path=='/api/ai/chat':
                msg=(payload.get('message') or '').strip();did=payload.get('deal_id')
                if not msg:return self.send_json(400,{'error':'Nachricht fehlt'})
                with db() as con:ctx=lead_context(con,int(did)) if did else crm_context(con)
                return self.send_json(200,{'answer':ollama_chat([{'role':'system','content':SYSTEM_PROMPT},{'role':'user','content':ctx+'\n\n'+msg}])})
            if path=='/api/ai/analyze':
                with db() as con:return self.send_json(200,{'answer':ai_analysis(con,int(payload.get('deal_id') or 0),payload.get('mode','analyze'))})
            if path=='/api/ai/propose':
                with db() as con:return self.send_json(200,{'actions':propose_actions(con,payload.get('instruction',''))})
            if path=='/api/ai/execute':
                with db() as con:r=execute_actions(con,payload.get('actions') or []);con.commit();return self.send_json(200,{'executed':r})
            if path=='/api/restore':
                data=payload.get('backup') or {};tables=data.get('tables') or {};allowed=['companies','contacts','deals','tasks','activities','projects','imports','settings'];optional=['agent_runs']
                if not all(t in tables for t in allowed):return self.send_json(400,{'error':'Ungültiges Backup'})
                with db() as con:
                    con.execute('PRAGMA foreign_keys=OFF')
                    for t in allowed+optional:con.execute(f'DELETE FROM {t}')
                    for t in allowed+optional:
                        for r in tables.get(t,[]):
                            cols=[c for c in r.keys() if c in table_columns(con,t)]
                            if not cols:continue
                            con.execute(f"INSERT INTO {t}({','.join(cols)}) VALUES({','.join('?'*len(cols))})",[r.get(c) for c in cols])
                    con.execute('PRAGMA foreign_keys=ON');con.commit()
                return self.send_json(200,{'ok':True})
            return self.send_json(404,{'error':'Endpoint nicht gefunden'})
        except ValueError as e:return self.send_json(400,{'error':str(e)})
        except HTTPError as e:return self.send_json(e.code,{'error':e.read().decode(errors='ignore') or str(e)})
        except (URLError,TimeoutError) as e:
            msg='Ollama ist nicht erreichbar.' if path.startswith('/api/ai/') else 'Netzwerkdienst ist nicht erreichbar.'
            return self.send_json(503,{'error':msg,'detail':str(e)})
        except Exception as e:log('POST '+repr(e));return self.send_json(500,{'error':str(e)})

    def do_PATCH(self):
        path=urlparse(self.path).path
        try:
            p=self.read_json();ts=now_iso();m=re.fullmatch(r'/api/deals/(\d+)',path)
            if m:
                did=int(m.group(1));allowed={'stage','value','score','priority','source','next_follow_up','next_action','last_contact','need_summary','notes','title','disposition','do_not_contact','lost_reason','proposal_url','research_json'};sets=[];vals=[]
                with db() as con:
                    old=con.execute('SELECT * FROM deals WHERE id=?',(did,)).fetchone()
                    if not old:return self.send_json(404,{'error':'Lead nicht gefunden'})
                    for k,v in p.items():
                        if k not in allowed:continue
                        if k=='stage' and v not in STAGES:continue
                        if k=='disposition' and v not in DISPOSITIONS:continue
                        if k=='research_json':v=json.dumps(clean_research(v),ensure_ascii=False)
                        if k=='proposal_url':v=safe_web_url(v)
                        if k=='next_follow_up':v=safe_date(v)
                        if k=='score':v=safe_score(v,old['score'])
                        if k=='value':v=safe_value(v,old['value'])
                        if k=='do_not_contact':v=1 if v else 0
                        sets.append(f'{k}=?');vals.append(v)
                    if not sets:return self.send_json(400,{'error':'Keine gültigen Felder'})
                    if 'disposition' in p and p['disposition']!=old['disposition']:
                        sets.append('disposition_at=?');vals.append(ts if p['disposition']!='active' else '')
                    sets.append('updated_at=?');vals.append(ts);vals.append(did);con.execute('UPDATE deals SET '+','.join(sets)+' WHERE id=?',vals)
                    new=con.execute('SELECT * FROM deals WHERE id=?',(did,)).fetchone()
                    if new['disposition']!=old['disposition']:
                        con.execute('INSERT INTO activities(type,subject,body,occurred_at,company_id,deal_id) VALUES(?,?,?,?,?,?)',('status','Lead-Ergebnis geändert',f"{DISPOSITIONS.get(old['disposition'])} → {DISPOSITIONS.get(new['disposition'])}",ts,old['company_id'],did))
                    if new['stage']!=old['stage']:
                        con.execute('INSERT INTO activities(type,subject,body,occurred_at,company_id,deal_id) VALUES(?,?,?,?,?,?)',('stage','Pipeline geändert',f"{STAGES.get(old['stage'],old['stage'])} → {STAGES.get(new['stage'],new['stage'])}",ts,old['company_id'],did))
                        if new['disposition']=='active' and 'next_follow_up' not in p and not new['next_follow_up'] and new['stage'] in ('attempted','offer'):
                            try:days=max(1,int(setting('followup_attempted_days','2') if new['stage']=='attempted' else setting('followup_offer_days','3')))
                            except:days=2 if new['stage']=='attempted' else 3
                            auto_date=(date.today()+timedelta(days=days)).isoformat();con.execute('UPDATE deals SET next_follow_up=?,updated_at=? WHERE id=?',(auto_date,ts,did));new=con.execute('SELECT * FROM deals WHERE id=?',(did,)).fetchone()
                        if new['stage']=='won' and new['disposition']=='active':
                            exists=con.execute('SELECT id FROM projects WHERE deal_id=?',(did,)).fetchone()
                            if not exists:con.execute('INSERT INTO projects(company_id,deal_id,name,status,value,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',(old['company_id'],did,new['title'],'planning',new['value'],ts,ts))
                    changed=[]
                    for fld,label in [('value','Potenzial'),('score','Lead Score'),('priority','Priorität'),('next_follow_up','Follow-up')]:
                        if str(old[fld] or '')!=str(new[fld] or ''):changed.append(f"{label}: {old[fld] or '—'} → {new[fld] or '—'}")
                    if changed:con.execute('INSERT INTO activities(type,subject,body,occurred_at,company_id,deal_id) VALUES(?,?,?,?,?,?)',('edit','Lead aktualisiert',' · '.join(changed),ts,old['company_id'],did))
                    con.commit();return self.send_json(200,deal_detail(con,did))
            m=re.fullmatch(r'/api/companies/(\d+)',path)
            if m:
                allowed={'name','industry','city','phone','email','website','website_status','social_status','source','source_url','notes'};sets=[];vals=[]
                for k,v in p.items():
                    if k in allowed:sets.append(f'{k}=?');vals.append(v)
                if not sets:return self.send_json(400,{'error':'Keine gültigen Felder'})
                sets.append('updated_at=?');vals.extend([ts,int(m.group(1))])
                with db() as con:con.execute('UPDATE companies SET '+','.join(sets)+' WHERE id=?',vals);con.commit();return self.send_json(200,{'ok':True})
            m=re.fullmatch(r'/api/contacts/(\d+)',path)
            if m:
                allowed={'first_name','last_name','role','phone','email','preferred_channel','notes'};sets=[];vals=[]
                for k,v in p.items():
                    if k in allowed:sets.append(f'{k}=?');vals.append(v)
                if not sets:return self.send_json(400,{'error':'Keine gültigen Felder'})
                sets.append('updated_at=?');vals.extend([ts,int(m.group(1))])
                with db() as con:con.execute('UPDATE contacts SET '+','.join(sets)+' WHERE id=?',vals);con.commit();return self.send_json(200,{'ok':True})
            m=re.fullmatch(r'/api/tasks/(\d+)',path)
            if m:
                allowed={'title','due_date','priority','status','notes'};sets=[];vals=[]
                for k,v in p.items():
                    if k in allowed:sets.append(f'{k}=?');vals.append(v)
                sets.append('updated_at=?');vals.extend([ts,int(m.group(1))])
                with db() as con:con.execute('UPDATE tasks SET '+','.join(sets)+' WHERE id=?',vals);con.commit();return self.send_json(200,{'ok':True})
            m=re.fullmatch(r'/api/projects/(\d+)',path)
            if m:
                allowed={'name','status','value','deadline','domain','repo_url','notes'};sets=[];vals=[]
                for k,v in p.items():
                    if k in allowed:sets.append(f'{k}=?');vals.append(v)
                sets.append('updated_at=?');vals.extend([ts,int(m.group(1))])
                with db() as con:con.execute('UPDATE projects SET '+','.join(sets)+' WHERE id=?',vals);con.commit();return self.send_json(200,{'ok':True})
            return self.send_json(404,{'error':'Nicht gefunden'})
        except ValueError as e:return self.send_json(400,{'error':str(e)})
        except Exception as e:log('PATCH '+repr(e));return self.send_json(500,{'error':str(e)})

    def do_DELETE(self):
        m=re.fullmatch(r'/api/deals/(\d+)',urlparse(self.path).path)
        if not m:return self.send_json(404,{'error':'Nicht gefunden'})
        did=int(m.group(1))
        with db() as con:
            d=con.execute('SELECT company_id FROM deals WHERE id=?',(did,)).fetchone()
            if not d:return self.send_json(404,{'error':'Lead nicht gefunden'})
            cid=d['company_id'];con.execute('DELETE FROM deals WHERE id=?',(did,));remain=con.execute('SELECT count(*) n FROM deals WHERE company_id=?',(cid,)).fetchone()['n']
            if remain==0:con.execute('DELETE FROM companies WHERE id=?',(cid,))
            con.commit();return self.send_json(200,{'ok':True})


def validate_installation():
    required=['index.html','crm.js','crm.css','crm_backend.py','v7_backend.py','focus_backend.py','workflow_engine.py','Kaiser Webdesign CRM.pyw','START-KAISER-CRM.py','Kaiser-CRM.ico']
    missing=[name for name in required if not (APP_DIR/name).is_file()]
    if missing:
        raise RuntimeError('CRM-Installation unvollständig. Fehlende Datei(en): '+', '.join(missing))


def verify_database():
    try:
        with db() as con:
            row=con.execute('PRAGMA quick_check').fetchone()
            result=str(row[0] if row else '')
            if result.lower()!='ok':
                raise RuntimeError('SQLite quick_check: '+result)
    except Exception as e:
        raise RuntimeError('CRM-Datenbankprüfung fehlgeschlagen: '+str(e)) from e


def write_runtime(port):
    try:
        RUNTIME_PATH.write_text(json.dumps({
            'pid': os.getpid(),
            'port': port,
            'url': f'http://{HOST}:{port}/',
            'started_at': now_iso(),
            'version': APP_VERSION
        }, ensure_ascii=False), encoding='utf-8')
    except Exception as e:
        log('runtime write failed: '+repr(e))


def clear_runtime():
    try:
        if RUNTIME_PATH.exists():
            data=json.loads(RUNTIME_PATH.read_text(encoding='utf-8'))
            if int(data.get('pid') or 0)==os.getpid():
                RUNTIME_PATH.unlink(missing_ok=True)
    except Exception:
        pass


class ExclusiveThreadingHTTPServer(ThreadingHTTPServer):
    """Prevent two CRM cores from sharing one Windows port."""
    allow_reuse_address = False

    def server_bind(self):
        if os.name == 'nt' and hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def run():
    log(f'Core boot start version={APP_VERSION} python={sys.version}')
    log('Core phase: validate installation');validate_installation()
    log('Core phase: migration backup');backup_before_migration()
    log('Core phase: initialize database');init_db()
    log('Core phase: verify database');verify_database()
    log('Core phase: daily backup');daily_backup()
    port=PORT_START
    server=None
    last_error=None
    while port<PORT_START+30:
        try:
            server=ExclusiveThreadingHTTPServer((HOST,port),Handler)
            break
        except OSError as e:
            last_error=e
            port+=1
    if server is None:
        raise RuntimeError(f'Kein freier lokaler Port gefunden. Letzter Fehler: {last_error}')

    # V5 used a 35-second browser-ping watchdog. That made the CRM die after
    # standby/sleep, a suspended Edge app or short browser stalls. V5.3 keeps
    # the local core alive for the lifetime of this launcher process instead.
    write_runtime(port)
    url=f'http://{HOST}:{port}/'
    log(f'Server started pid={os.getpid()} url={url} desktop={DESKTOP_MODE}')
    print(f'Kaiser Webdesign CRM V9 läuft auf {url}', flush=True)
    if not DESKTOP_MODE:
        threading.Timer(.7,lambda:webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        log('Server stopping')
        clear_runtime()
        server.server_close()

exec(compile((APP_DIR / 'v7_backend.py').read_text(encoding='utf-8'), str(APP_DIR / 'v7_backend.py'), 'exec'), globals())

exec(compile((APP_DIR / 'focus_backend.py').read_text(encoding='utf-8'), str(APP_DIR / 'focus_backend.py'), 'exec'), globals())

exec(compile((APP_DIR / 'crm_backend.py').read_text(encoding='utf-8'), str(APP_DIR / 'crm_backend.py'), 'exec'), globals())

if __name__=='__main__':run()
