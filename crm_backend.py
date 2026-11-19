"""V9: explicit sales stages, one activity list, local team assignments.
This is a local workflow release, not an authenticated multi-user server.
"""
import hashlib
CrmBaseHandler = Handler
crm_previous_init = init_db
APP_VERSION = '9.7.0'
SCHEMA_VERSION = 900
CRM_PHASES = {'new':'Kontaktaufnahme','interest':'Bedarf geklärt','building':'Ausarbeitung','offer':'Angebot','followup':'Abstimmung'}
CRM_WRITE_LOCK = threading.RLock()
BACKUP_TABLES = [*BACKUP_TABLES, 'crm_members']
CRM_TABLES = ['companies','contacts','deals','tasks','appointments','projects','activities','crm_members']


def init_db():
    crm_previous_init()
    with db() as con:
        con.execute('CREATE TABLE IF NOT EXISTS crm_members (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1)')
        con.execute("INSERT INTO crm_members(name) SELECT 'Ivan' WHERE NOT EXISTS(SELECT 1 FROM crm_members)")
        for table in ('deals','tasks','appointments','projects'):
            ensure_column(con,table,'owner_id INTEGER REFERENCES crm_members(id) ON DELETE SET NULL')
        ensure_column(con,'tasks',"kind TEXT NOT NULL DEFAULT 'task'")
        ensure_column(con,'companies','do_not_contact INTEGER NOT NULL DEFAULT 0')
        con.execute('UPDATE companies SET do_not_contact=1 WHERE id IN (SELECT company_id FROM deals WHERE do_not_contact=1)')
        # Preserve old dates, texts, IDs and history exactly; display their sources together.
        con.execute('PRAGMA user_version=900')


def crm_rows(con,table):
    return [dict(r) for r in con.execute('SELECT * FROM '+table+' ORDER BY id')]


def crm_snapshot(con):
    data={t:crm_rows(con,t) for t in CRM_TABLES}
    stopped={d['company_id'] for d in data['deals'] if d['do_not_contact']}
    for c in data['companies']:
        if c['id'] in stopped:c['do_not_contact']=1
    raw=json.dumps(data,sort_keys=True,ensure_ascii=False,default=str).encode()
    data['revision']=hashlib.sha256(raw).hexdigest()
    data['version']=APP_VERSION
    return data


def crm_stopped(con,cid):
    c=crm_get(con,'companies',cid)
    return bool(c['do_not_contact'] or con.execute('SELECT id FROM deals WHERE company_id=? AND do_not_contact=1 LIMIT 1',(cid,)).fetchone())


def crm_get(con,table,id):
    row=con.execute('SELECT * FROM '+table+' WHERE id=?',(int(id or 0),)).fetchone()
    if not row: raise ValueError('Datensatz nicht gefunden.')
    return dict(row)


def crm_owner(con,value):
    if not value:return None
    m=crm_get(con,'crm_members',value)
    if not m['active']:raise ValueError('Dieses Teamprofil ist deaktiviert.')
    return m['id']


def crm_update(con,table,id,values):
    if 'updated_at' in table_columns(con,table):values={**values,'updated_at':now_iso()}
    if values:con.execute('UPDATE '+table+' SET '+','.join(k+'=?' for k in values)+' WHERE id=?',[*values.values(),id])


def crm_insert(con,table,values):
    if 'created_at' in table_columns(con,table):values={**values,'created_at':now_iso(),'updated_at':now_iso()}
    return con.execute('INSERT INTO '+table+'('+','.join(values)+') VALUES('+','.join('?' for _ in values)+')',list(values.values())).lastrowid


def crm_log(con,actor,subject,body='',deal=None,company_id=None,kind='edit',meta=None):
    return crm_insert(con,'activities',dict(type=kind,subject=subject,body=body,occurred_at=now_iso(),company_id=deal['company_id'] if deal else company_id,deal_id=deal['id'] if deal else None,metadata=json.dumps({'actor_id':actor['id'],'actor_name':actor['name'],'version':9,**(meta or {})},ensure_ascii=False)))


def crm_complete_followup(con,actor,d):
    if not d['next_follow_up']:
        raise ValueError('Diese Wiedervorlage ist bereits abgeschlossen.')
    action=d.get('next_action') or 'other'
    title=flow.ACTIONS.get(action,'Wiedervorlage')
    kind={'call':'call','email':'email','meeting':'meeting'}.get(action,'task')
    tid=crm_insert(con,'tasks',dict(title=title,kind=kind,status='done',due_date=d['next_follow_up'],due_time=d.get('next_follow_up_time') or '',company_id=d['company_id'],deal_id=d['id'],owner_id=d['owner_id'],notes='Abgeschlossene Vertriebswiedervorlage.'))
    crm_update(con,'deals',d['id'],dict(next_follow_up='',next_follow_up_time='',next_action=''))
    crm_log(con,actor,'Wiedervorlage erledigt',title,deal=d,meta={'task_id':tid})
    return tid


def crm_quick_status(con, actor, d, status, reason='', day='', clock=''):
    if d['stage']=='won' and d['disposition']=='active':
        raise ValueError('Ein gewonnener Auftrag kann hier nicht geändert werden.')
    if status=='no_interest':
        values=dict(disposition='no_interest',lost_reason=reason or 'Kein Interesse',disposition_at=now_iso(),next_follow_up='',next_follow_up_time='',next_action='')
        subject='Kein Interesse'
    else:
        if crm_stopped(con,d['company_id']):raise ValueError('Kontaktstopp zuerst in der Firmenakte aufheben.')
        values=dict(disposition='active',lost_reason='',disposition_at='')
        if status=='followup':
            values.update(stage='followup')
            if day:values.update(next_follow_up=day,next_follow_up_time=clock,next_action='followup')
            subject='Nachfassen'
        else:
            values.update(stage='new')
            subject='Wieder offen'
    crm_update(con,'deals',d['id'],values)
    crm_log(con,actor,subject,reason,deal=d,meta={'before':{'stage':d['stage'],'disposition':d['disposition']},'after':values})


def crm_command(con,p):
    con.execute('BEGIN IMMEDIATE')
    if p.get('revision')!=crm_snapshot(con)['revision']:
        raise RuntimeError('Der Datenstand wurde inzwischen geändert. Bitte neu laden und deine Eingabe erneut prüfen. Deine Eingabe bleibt im Formular erhalten.')
    actor=crm_get(con,'crm_members',p.get('actor_id'))
    if not actor['active']:raise ValueError('Bitte ein aktives Arbeitsprofil auswählen.')
    op=p.get('op');v=p.get('values') or {};target=p.get('id');out={}
    if op=='member':
        name=required_text(v.get('name'),'Name')
        if target:
            crm_get(con,'crm_members',target)
            active=int(bool(v.get('active',1)))
            if not active and int(target)==actor['id']:raise ValueError('Das aktuell verwendete Arbeitsprofil kann nicht deaktiviert werden.')
            crm_update(con,'crm_members',target,dict(name=name,active=active))
        else:target=crm_insert(con,'crm_members',dict(name=name))
        crm_log(con,actor,'Teamprofil aktualisiert',name)
    elif op=='company':
        values={k:str(v.get(k,'')).strip() for k in ('name','industry','city','phone','email','website','notes')}
        values['name']=required_text(values['name'],'Unternehmen')
        values['website']=safe_web_url(values['website'])
        if target:crm_get(con,'companies',target);crm_update(con,'companies',target,values)
        else:target=crm_insert(con,'companies',values)
        crm_log(con,actor,'Unternehmensdaten gespeichert',company_id=target)
    elif op=='contact':
        cid=crm_get(con,'companies',v.get('company_id'))['id']
        values={k:str(v.get(k,'')).strip() for k in ('first_name','last_name','role','phone','email','notes')}
        if not (values['first_name'] or values['last_name']):raise ValueError('Bitte einen Namen angeben.')
        values['company_id']=cid
        if target:
            old=crm_get(con,'contacts',target)
            if old['company_id']!=cid:raise ValueError('Die Firmenzuordnung bestehender Ansprechpartner bleibt erhalten.')
            crm_update(con,'contacts',target,values)
        else:target=crm_insert(con,'contacts',values)
        crm_log(con,actor,'Ansprechpartner gespeichert',company_id=cid)
    elif op=='deal':
        old=crm_get(con,'deals',target) if target else None
        cid=old['company_id'] if old else crm_get(con,'companies',v.get('company_id'))['id']
        contact_id=int(v.get('contact_id') or 0) or None
        if contact_id and crm_get(con,'contacts',contact_id)['company_id']!=cid:raise ValueError('Ansprechpartner gehört nicht zum Unternehmen.')
        values=dict(title=required_text(v.get('title'),'Bezeichnung'),company_id=cid,contact_id=contact_id,value=valid_money(v.get('value')),need_summary=str(v.get('need_summary','')),owner_id=crm_owner(con,v.get('owner_id')))
        if old:crm_update(con,'deals',target,values)
        else:target=crm_insert(con,'deals',{**values,'stage':'new','disposition':'active'})
        crm_log(con,actor,'Verkaufschance gespeichert',deal=crm_get(con,'deals',target))
    elif op in ('quick_status','company_quick_status'):
        if op=='company_quick_status':
            cid=crm_get(con,'companies',target)['id']
            if con.execute('SELECT 1 FROM deals WHERE company_id=?',(cid,)).fetchone():raise ValueError('Diese Firma hat bereits einen Vertriebsvorgang. Bitte die Firmenakte aktualisieren.')
            target=crm_insert(con,'deals',dict(company_id=cid,title='Kundenkontakt',stage='new',disposition='active',owner_id=actor['id'],value=0))
        d=crm_get(con,'deals',target)
        status=valid_choice(v.get('status'),('no_interest','followup','open'),'Status')
        day=safe_date(v.get('due_date')) if status=='followup' else ''
        if status=='followup' and not day:raise ValueError('Bitte ein Datum zum Nachfassen auswählen.')
        clock=valid_clock(v.get('due_time'),day) if day else ''
        crm_quick_status(con,actor,d,status,str(v.get('reason','')).strip(),day,clock)
    elif op=='stage':
        d=crm_get(con,'deals',target)
        status=valid_choice(v.get('status'),('open','won','lost'),'Abschluss')
        stage=valid_choice(v.get('stage'),tuple(CRM_PHASES),'Verkaufsphase')
        company=crm_get(con,'companies',d['company_id'])
        if status=='open' and crm_stopped(con,d['company_id']):raise ValueError('Für dieses Unternehmen gilt ein Kontaktstopp. Diesen zuerst in der Unternehmensakte prüfen.')
        reason=str(v.get('reason','')).strip()
        if status=='lost' and not reason:raise ValueError('Bitte einen Verlustgrund angeben.')
        values=dict(stage='won' if status=='won' else stage,disposition='lost' if status=='lost' else 'active',lost_reason=reason if status=='lost' else '',disposition_at=now_iso() if status=='lost' else '')
        if status!='open':values.update(next_follow_up='',next_follow_up_time='',next_action='')
        crm_update(con,'deals',target,values)
        if status=='won' and not con.execute('SELECT id FROM projects WHERE deal_id=?',(target,)).fetchone():
            crm_insert(con,'projects',dict(company_id=d['company_id'],deal_id=d['id'],name=d['title'],value=d['value'],status='planning',owner_id=d['owner_id']))
        crm_log(con,actor,'Auftrag gewonnen' if status=='won' else 'Verkaufschance verloren' if status=='lost' else 'Verkaufsphase geändert',reason,deal=d,meta={'before':{'stage':d['stage'],'disposition':d['disposition']},'after':values})
    elif op=='stop':
        c=crm_get(con,'companies',target);stop=int(bool(v.get('stop')))
        crm_update(con,'companies',target,{'do_not_contact':stop})
        for row in con.execute('SELECT * FROM deals WHERE company_id=?',(target,)).fetchall():
            d=dict(row);values={'do_not_contact':stop}
            if stop:values.update(next_follow_up='',next_follow_up_time='',next_action='')
            crm_update(con,'deals',d['id'],values)
        crm_log(con,actor,'Kontaktstopp gesetzt' if stop else 'Kontaktstopp aufgehoben',str(v.get('reason','')),company_id=target)
    elif op=='log':
        d=crm_get(con,'deals',v.get('deal_id'))
        kind=valid_choice(v.get('kind'),('note','call','email','meeting','whatsapp','work'),'Aktivität')
        body=str(v.get('body','')).strip()
        if kind=='note' and not body:raise ValueError('Bitte eine Notiz eingeben.')
        result=str(v.get('result','')).strip()
        if kind!='note' and not result:raise ValueError('Bitte das Ergebnis angeben.')
        if kind in ('call','email','meeting','whatsapp') and crm_stopped(con,d['company_id']):raise ValueError('Kontaktstopp aktiv. Interne Notizen sind weiterhin möglich.')
        crm_log(con,actor,'Notiz' if kind=='note' else result,body,deal=d,kind=kind)
        # Logging never changes pipeline stage or schedules a follow-up implicitly.
        if kind in ('call','email','meeting','whatsapp'):crm_update(con,'deals',d['id'],{'last_contact':date.today().isoformat()})
    elif op=='conversation':
        cid=crm_get(con,'companies',v.get('company_id'))['id']
        d=crm_get(con,'deals',v['deal_id']) if v.get('deal_id') else None
        if d and d['company_id']!=cid:raise ValueError('Der Vorgang gehört nicht zu dieser Firma.')
        kind=valid_choice(v.get('kind'),('note','call','email','meeting','whatsapp'),'Kontaktart')
        body=str(v.get('body','')).strip()
        result=required_text(v.get('result'),'Ergebnis') if kind!='note' else 'Notiz'
        if kind=='note' and not body:raise ValueError('Bitte eine Notiz eingeben.')
        if kind!='note' and crm_stopped(con,cid):raise ValueError('Kontaktstopp aktiv. Interne Notizen sind weiterhin möglich.')
        status=valid_choice(v.get('sales_status','keep'),('keep','no_interest','followup','open'),'Status')
        if not d and status!='keep' and kind!='note' and not con.execute('SELECT 1 FROM deals WHERE company_id=?',(cid,)).fetchone():
            did=crm_insert(con,'deals',dict(company_id=cid,title='Kundenkontakt',stage='new',disposition='active',owner_id=actor['id'],value=0))
            d=crm_get(con,'deals',did)
        plan=valid_choice(v.get('planning','keep'),('keep','plan'),'Planung')
        task=None
        if plan=='plan':
            day=safe_date(v.get('due_date'))
            if not day:raise ValueError('Bitte ein Datum für den nächsten Schritt angeben.')
            task_kind=valid_choice(v.get('task_kind','call'),('call','email','meeting','task','work'),'Aufgabenart')
            if task_kind in ('call','email','meeting') and crm_stopped(con,cid):raise ValueError('Kontaktstopp aktiv. Nur interne Aufgaben sind möglich.')
            task=dict(title=required_text(v.get('title'),'Nächster Schritt'),kind=task_kind,due_date=day,due_time=valid_clock(v.get('due_time'),day),owner_id=crm_owner(con,v.get('owner_id')),company_id=cid,deal_id=d['id'] if d else None)
        complete=str(v.get('complete') or '')
        if complete:
            match=re.fullmatch(r'(task|appointment|followup):(\d+)',complete)
            if not match:raise ValueError('Ungültige Aufgabe zum Abschließen.')
            source,key=match[1],int(match[2]);table={'task':'tasks','appointment':'appointments','followup':'deals'}[source]
            old=crm_get(con,table,key)
            if old['company_id']!=cid:raise ValueError('Diese Aufgabe gehört zu einer anderen Firma.')
            if source=='followup':
                crm_complete_followup(con,actor,old)
            else:
                if old['status']!=('open' if source=='task' else 'planned'):raise ValueError('Diese Aufgabe ist bereits abgeschlossen.')
                crm_update(con,table,key,{'status':'done'})
                crm_log(con,actor,'Aufgabe abgeschlossen',old['title'],deal=crm_get(con,'deals',old['deal_id']) if old.get('deal_id') else None,company_id=cid)
        crm_log(con,actor,result,body,deal=d,company_id=cid,kind=kind)
        if d and kind!='note':crm_update(con,'deals',d['id'],{'last_contact':date.today().isoformat()})
        status=valid_choice(v.get('sales_status','keep'),('keep','no_interest','followup','open'),'Status')
        if status!='keep':
            if not d:raise ValueError('Bitte ein Anliegen für die Statusänderung auswählen.')
            if kind=='note':raise ValueError('Interne Notizen ändern keinen Status.')
            if status=='followup' and not task:raise ValueError('Bitte einen nächsten Schritt mit Datum planen.')
            if status=='no_interest' and task:raise ValueError('Bei Kein Interesse bitte keine neue Aufgabe planen.')
            crm_quick_status(con,actor,d,status,body)
            if status=='followup' and d['next_follow_up']:
                crm_update(con,'deals',d['id'],dict(next_follow_up='',next_follow_up_time='',next_action=''))
        if task:
            crm_insert(con,'tasks',task)
            crm_log(con,actor,'Nächster Schritt geplant',task['title'],deal=d,company_id=cid)
    elif op=='task':
        old=crm_get(con,'tasks',target) if target else None
        did,cid=references(con,v)
        day=safe_date(v.get('due_date'))
        kind=valid_choice(v.get('kind','task'),('task','call','email','meeting','work'),'Aktivitätsart')
        values=dict(title=required_text(v.get('title'),'Titel'),due_date=day,due_time=valid_clock(v.get('due_time'),day),notes=str(v.get('notes','')),kind=kind,deal_id=did,company_id=cid,owner_id=crm_owner(con,v.get('owner_id')),priority=valid_choice(v.get('priority','medium'),('high','medium','low'),'Priorität'))
        if cid and kind in ('call','email','meeting') and crm_stopped(con,cid):raise ValueError('Kontaktstopp aktiv. Bitte nur interne Aufgaben planen.')
        if old:crm_update(con,'tasks',target,values)
        else:target=crm_insert(con,'tasks',values)
        crm_log(con,actor,'Aktivität geplant',values['title'],deal=crm_get(con,'deals',did) if did else None,company_id=cid)
    elif op=='task_status':
        t=crm_get(con,'tasks',target)
        status=valid_choice(v.get('status'),('open','done','cancelled'),'Aktivitätsstatus')
        crm_update(con,'tasks',target,{'status':status})
        crm_log(con,actor,{'open':'Aktivität wieder geöffnet','done':'Aktivität erledigt','cancelled':'Aktivität abgesagt'}[status],t['title'],deal=crm_get(con,'deals',t['deal_id']) if t['deal_id'] else None,company_id=t['company_id'])
    elif op=='complete_followup':
        target=crm_complete_followup(con,actor,crm_get(con,'deals',target))
    elif op=='followup':
        d=crm_get(con,'deals',target)
        day=safe_date(v.get('due_date'))
        if day and (d['stage']=='won' or d['disposition']!='active' or crm_stopped(con,d['company_id'])):raise ValueError('Für diesen Vorgang ist keine Vertriebswiedervorlage möglich.')
        values={'next_follow_up':day,'next_follow_up_time':valid_clock(v.get('due_time'),day),'next_action':valid_choice(v.get('next_action','call'),tuple(flow.ACTIONS),'Nächster Schritt') if day else ''}
        crm_update(con,'deals',target,values)
        crm_log(con,actor,'Bestehende Wiedervorlage geändert' if day else 'Bestehende Wiedervorlage abgeschlossen',deal=d)
    elif op=='appointment':
        a=crm_get(con,'appointments',target)
        values=appointment_values(con,v,a)
        if values['company_id'] and values['status']=='planned' and values['kind'] in ('call','meeting') and crm_stopped(con,values['company_id']):raise ValueError('Kontaktstopp aktiv. Termin zuerst prüfen.')
        crm_update(con,'appointments',target,values)
        crm_log(con,actor,'Termin aktualisiert',values['title'],deal=crm_get(con,'deals',a['deal_id']) if a['deal_id'] else None,company_id=a['company_id'])
    elif op=='project':
        old=crm_get(con,'projects',target)
        values=dict(name=required_text(v.get('name'),'Projektname'),status=valid_choice(v.get('status'),('planning','active','review','done','on_hold'),'Projektstatus'),deadline=safe_date(v.get('deadline')),notes=str(v.get('notes','')),owner_id=crm_owner(con,v.get('owner_id')))
        crm_update(con,'projects',target,values)
        crm_log(con,actor,'Projekt aktualisiert',values['name'],deal=crm_get(con,'deals',old['deal_id']) if old['deal_id'] else None,company_id=old['company_id'])
    else:raise ValueError('Unbekannte Aktion.')
    con.commit()
    return {'ok':True,'id':target}


class Handler(CrmBaseHandler):
    server_version='KaiserCRM/9.7'
    def do_GET(self):
        if not self.origin_ok():return
        path=urlparse(self.path).path
        if path in ('/crm.js','/crm.css'):return SimpleHTTPRequestHandler.do_GET(self)
        if path=='/api/crm':
            with db() as con:
                con.execute('BEGIN')
                return self.send_json(200,crm_snapshot(con))
        if path=='/api/backup':
            with db() as con:
                con.execute('BEGIN')
                tables={t:crm_rows(con,t) if t!='settings' else [dict(r) for r in con.execute('SELECT * FROM settings')] for t in [*CRM_TABLES,'settings','imports','agent_runs']}
            raw=json.dumps({'version':APP_VERSION,'created_at':now_iso(),'tables':tables},ensure_ascii=False,indent=2).encode()
            self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Disposition','attachment; filename="Kaiser-CRM-V9-Backup.json"');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw);return
        return super().do_GET()

    def do_POST(self):
        if not self.origin_ok():return
        path=urlparse(self.path).path
        if path=='/api/crm':
            try:
                with CRM_WRITE_LOCK, db() as con:out=crm_command(con,self.read_json())
                return self.send_json(200,out)
            except RuntimeError as e:return self.send_json(409,{'error':str(e)})
            except (ValueError,TypeError,sqlite3.IntegrityError) as e:return self.send_json(400,{'error':str(e)})
            except Exception as e:log('CRM '+repr(e));return self.send_json(500,{'error':'Speichern fehlgeschlagen. Bitte erneut versuchen.'})
        if path=='/api/crm-restore':
            try:
                p=self.read_json();backup=p.get('backup') or {}
                if backup.get('version') not in ('9.0.0','9.1.0','9.2.0','9.3.0','9.4.0','9.5.0','9.6.0','9.7.0') or not all(isinstance(backup.get('tables',{}).get(t),list) for t in BACKUP_TABLES):
                    raise ValueError('Bitte ein vollständiges V9-Backup auswählen.')
                if not any(m.get('active')==1 for m in backup['tables']['crm_members']):
                    raise ValueError('Das Backup enthält kein aktives Arbeitsprofil.')
                with CRM_WRITE_LOCK:
                    with db() as con:
                        if p.get('revision')!=crm_snapshot(con)['revision']:raise RuntimeError('Die Daten wurden inzwischen geändert. Bitte neu laden und die Wiederherstellung erneut prüfen.')
                    name=checked_restore(backup)
                return self.send_json(200,{'ok':True,'safety_backup':name})
            except RuntimeError as e:return self.send_json(409,{'error':str(e)})
            except (ValueError,TypeError,sqlite3.Error) as e:return self.send_json(400,{'error':str(e)})
        # Import is kept compatible; all normal edits go through the explicit V9 API.
        if path in ('/api/import/parse','/api/import/select','/api/import/commit','/api/backup/checkpoint'):
            with CRM_WRITE_LOCK:return super().do_POST()
        return self.send_json(403,{'error':'Bitte die neue CRM-Oberfläche verwenden.'})

    def do_PATCH(self):return self.send_json(403,{'error':'Bitte die neue CRM-Oberfläche verwenden.'})
    def do_DELETE(self):return self.send_json(403,{'error':'Dauerhaftes Löschen ist in dieser Version nicht vorgesehen. Vorgänge können abgeschlossen und Aktivitäten abgesagt werden.'})
