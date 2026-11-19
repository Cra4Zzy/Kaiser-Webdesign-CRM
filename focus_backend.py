"""V8 routes and atomic workflow updates; loaded after the compatible V7 API."""
import workflow_engine as flow

APP_VERSION = '8.0.0'
SCHEMA_VERSION = 800
FocusBaseHandler = Handler
focus_legacy_init = init_db

def init_db():
    focus_legacy_init()
    with db() as con:
        ensure_column(con,'deals',"next_follow_up_time TEXT DEFAULT ''")
        for k,v in flow.DEFAULTS.items(): con.execute('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)',(k,v))
        con.execute('PRAGMA user_version=800')

def focus_settings(con): return {r['key']:r['value'] for r in con.execute('SELECT * FROM settings')}

def focus_data(con):
    deals=list_deals(con,{'disposition':['all']})
    tasks=[dict(r) for r in con.execute('SELECT t.*,c.name company_name FROM tasks t LEFT JOIN companies c ON c.id=t.company_id')]
    appointments=[dict(r) for r in con.execute('SELECT a.*,c.name company_name FROM appointments a LEFT JOIN companies c ON c.id=a.company_id')]
    activities=[dict(r) for r in con.execute("SELECT * FROM activities WHERE coalesce(undone_at,'')='' ORDER BY occurred_at DESC,id DESC")]
    return flow.workspace(deals,tasks,appointments,activities,focus_settings(con))

def valid_clock(value, day):
    value=str(value or '')
    if value and (not day or not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d',value)):
        raise ValueError('Bitte ein Datum und eine gültige Uhrzeit angeben.')
    return value

def workflow_patch(con,p):
    did=int(p.get('deal_id') or 0)
    row=con.execute('SELECT * FROM deals WHERE id=?',(did,)).fetchone()
    if not row: raise ValueError('Kontakt nicht gefunden.')
    d=dict(row);kind=p.get('type','call');result=p.get('result','')
    if kind not in ('call','email','whatsapp','offer','response','meeting','note','work','linkedin'): raise ValueError('Unbekannte Aktivität.')
    if result and result not in flow.OUTCOMES: raise ValueError('Unbekanntes Ergebnis.')
    if kind=='note' and result: raise ValueError('Eine Notiz hat kein Kontaktergebnis.')
    if kind not in ('note','work') and (d['disposition']!='active' or con.execute('SELECT id FROM deals WHERE company_id=? AND do_not_contact=1',(d['company_id'],)).fetchone()):
        raise ValueError('Dieser Kontakt ist aus der Akquise genommen. Bitte den Kontaktstatus zuerst prüfen.')
    raw=str(p.get('occurred_at') or now_iso())
    try: event=datetime.fromisoformat(raw)
    except (TypeError,ValueError): raise ValueError('Ungültiger Aktivitätszeitpunkt.')
    if event.tzinfo: event=event.astimezone().replace(tzinfo=None)
    if event>datetime.now()+timedelta(minutes=5): raise ValueError('Aktivitäten werden nach dem Kontakt protokolliert. Plane zukünftige Schritte als Wiedervorlage.')
    occurred=event.isoformat(timespec='seconds')
    latest=con.execute("SELECT max(occurred_at) ts FROM activities WHERE deal_id=? AND coalesce(undone_at,'')='' AND type IN ('call','email','whatsapp','offer','response','meeting','work','plan','stage','status','edit')",(did,)).fetchone()['ts']
    historical=bool(latest and occurred<latest)
    suggestion=flow.suggestion(d,kind,result,focus_settings(con),event.date(),event.strftime('%H:%M'))
    patch={}
    if not historical and result and flow.active(d):
        patch={k:v for k,v in suggestion.items() if k!='explanation'}
        if result in flow.STOP_RESULTS:
            patch['disposition_at']=occurred
        else:
            if 'follow_up' in p: patch['next_follow_up']=safe_date(p['follow_up'])
            if 'next_action' in p:
                action=str(p.get('next_action') or '')
                if action and action not in flow.ACTIONS: raise ValueError('Unbekannter nächster Schritt.')
                patch['next_action']=action
            if 'follow_up_time' in p: patch['next_follow_up_time']=valid_clock(p['follow_up_time'],patch.get('next_follow_up',''))
            elif 'follow_up' in p and p['follow_up']!=d['next_follow_up']: patch['next_follow_up_time']=''
            if not patch.get('next_follow_up'): patch['next_follow_up_time']=''
        if result in ('page_building','page_sent'): patch['proposal_url']=safe_web_url(p.get('proposal_url',d.get('proposal_url','')))
        if result=='page_sent': patch['proposal_sent_at']=occurred
    if kind in ('call','email','whatsapp','offer','response','meeting','linkedin'):
        patch['last_contact']=max(d.get('last_contact') or '',event.date().isoformat())
    message=suggestion['explanation']
    if historical: message='Früherer Eintrag: der aktuelle Status und die Planung bleiben erhalten.'
    elif patch.get('next_follow_up') and 'follow_up' in p: message='Gewählte Wiedervorlage wird gespeichert.'
    elif patch.get('next_action') and not patch.get('next_follow_up'): message='Ohne Datum: der Kontakt bleibt unter „Ohne Planung“ sichtbar.'
    return d,patch,occurred,historical,message

def log_activity(con,payload):
    # Serialized transaction makes double submissions and undo snapshots consistent.
    if not con.in_transaction: con.execute('BEGIN IMMEDIATE')
    d,patch,occurred,historical,message=workflow_patch(con,payload)
    kind=payload.get('type','call');result=payload.get('result','')
    try: count=int(payload.get('count') or 1)
    except (TypeError,ValueError): raise ValueError('Ungültige Anzahl.')
    if not 1<=count<=25: raise ValueError('Anzahl muss zwischen 1 und 25 liegen.')
    token=str(payload.get('request_id') or '')[:100]
    if token:
        for a in con.execute('SELECT metadata FROM activities WHERE deal_id=? ORDER BY id DESC LIMIT 50',(d['id'],)):
            try: meta=json.loads(a['metadata'] or '{}')
            except ValueError: continue
            if meta.get('request_id')==token:
                out=deal_detail(con,d['id']);out.update(logged_count=0,duplicate=True);return out
    batch=str(uuid.uuid4());ids=[]
    before={k:d.get(k) for k in patch}
    labels={'call':'Anruf','email':'E-Mail','whatsapp':'WhatsApp','offer':'Angebot','response':'Antwort','meeting':'Termin','note':'Notiz','work':'Entwurf','linkedin':'LinkedIn'}
    for i in range(count):
        meta=dict(result=result,batch_id=batch,batch_count=count,batch_index=i+1,historical=historical,
            workflow_version=8,before=before,after=patch,request_id=token,explanation=message)
        cur=con.execute('INSERT INTO activities(type,subject,body,occurred_at,company_id,contact_id,deal_id,metadata) VALUES(?,?,?,?,?,?,?,?)',
            (kind,flow.OUTCOMES.get(result) or labels[kind],str(payload.get('body') or '').strip() if i==0 else '',occurred,d['company_id'],d['contact_id'],d['id'],json.dumps(meta,ensure_ascii=False)))
        ids.append(cur.lastrowid)
    if patch: con.execute('UPDATE deals SET '+','.join(k+'=?' for k in patch)+',updated_at=? WHERE id=?',list(patch.values())+[now_iso(),d['id']])
    out=deal_detail(con,d['id']);out.update(logged_count=count,activity_ids=ids,historical=historical,workflow_message=message)
    return out

def undo_workflow(con,p):
    con.execute('BEGIN IMMEDIATE')
    did=int(p.get('deal_id') or 0);aid=int(p.get('activity_id') or 0)
    candidates=con.execute("SELECT * FROM activities WHERE deal_id=? AND coalesce(undone_at,'')='' ORDER BY id DESC",(did,)).fetchall()
    target=next((a for a in candidates if (a['id']==aid if aid else a['type'] in ('call','email','whatsapp','offer','work','response','meeting','plan'))),None)
    if not target: raise ValueError('Dieser Eintrag ist bereits zurückgenommen oder nicht vorhanden.')
    meta=json.loads(target['metadata'] or '{}');batch=meta.get('batch_id')
    group=[a for a in candidates if a['id']==target['id'] or batch and json.loads(a['metadata'] or '{}').get('batch_id')==batch]
    if meta.get('workflow_version')==8:
        last_id=max(a['id'] for a in group)
        if any(a['id']>last_id and a['type'] in ('call','email','whatsapp','offer','work','response','meeting','plan','edit','stage','status','workflow_undo') for a in candidates):
            raise ValueError('Es gibt neuere Änderungen an diesem Kontakt. Nimm zuerst die neueste Änderung zurück oder passe die Planung bewusst an.')
        current=dict(con.execute('SELECT * FROM deals WHERE id=?',(did,)).fetchone())
        if any(current.get(k)!=v for k,v in meta.get('after',{}).items()): raise ValueError('Die Planung wurde inzwischen geändert. Bitte zuerst die aktuelle Planung prüfen.')
        before=meta.get('before',{})
        if before: con.execute('UPDATE deals SET '+','.join(k+'=?' for k in before)+',updated_at=? WHERE id=?',list(before.values())+[now_iso(),did])
    stamp=now_iso()
    for a in group: con.execute('UPDATE activities SET undone_at=?,undone_reason=? WHERE id=?',(stamp,'Vom Nutzer zurückgenommen',a['id']))
    if not meta.get('workflow_version'):
        latest=con.execute("SELECT max(substr(occurred_at,1,10)) day FROM activities WHERE deal_id=? AND coalesce(undone_at,'')='' AND type IN ('call','email','whatsapp','response','offer','meeting')",(did,)).fetchone()['day']
        con.execute('UPDATE deals SET last_contact=?,updated_at=? WHERE id=?',(latest or '',stamp,did))
    # No new state-changing event: this permits consecutive stack-like undo.
    return dict(ok=True,undone_count=len(group),subject=target['subject'],restored_plan=meta.get('workflow_version')==8)

class Handler(FocusBaseHandler):
    server_version='KaiserCRM/8.0'
    def do_GET(self):
        if not self.origin_ok(): return
        path=urlparse(self.path).path
        try:
            if path in ('/focus.css',): return SimpleHTTPRequestHandler.do_GET(self)
            if path=='/api/focus':
                with db() as con: return self.send_json(200,focus_data(con))
            return super().do_GET()
        except Exception as e: log('Focus GET '+repr(e));return self.send_json(500,{'error':str(e)})

    def do_POST(self):
        if not self.origin_ok(): return
        path=urlparse(self.path).path
        if path not in ('/api/workflow/preview','/api/activities/log','/api/activities','/api/activities/undo','/api/settings'): return super().do_POST()
        try:
            p=self.read_json()
            with db() as con:
                if path=='/api/settings':
                    for k,v in p.items():
                        if k in flow.DEFAULTS:
                            if k=='workflow_business_days': v=valid_choice(str(v),('0','1'),'Werktage')
                            else:
                                v=int(v)
                                if not 1<=v<=90: raise ValueError('Abstände müssen zwischen 1 und 90 Tagen liegen.')
                        elif k not in ('ollama_model','ai_speed','brand_name'): continue
                        con.execute('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(k,str(v)))
                    con.commit();return self.send_json(200,{'ok':True})
                if path=='/api/workflow/preview':
                    d,patch,occurred,historical,message=workflow_patch(con,p)
                    return self.send_json(200,{'patch':patch,'historical':historical,'message':message,'before_stage':d['stage']})
                if path=='/api/activities/undo': out=undo_workflow(con,p)
                else: out=log_activity(con,p)
                con.commit();return self.send_json(200,out)
        except (ValueError,TypeError,sqlite3.IntegrityError) as e: return self.send_json(400,{'error':str(e)})
        except Exception as e: log('Focus POST '+repr(e));return self.send_json(500,{'error':str(e)})

    def do_PATCH(self):
        if not self.origin_ok():return
        match=re.fullmatch(r'/api/deals/(\d+)',urlparse(self.path).path)
        if not match:return super().do_PATCH()
        try:
            p=self.read_json();did=int(match[1]);ts=now_iso()
            with db() as con:
                con.execute('BEGIN IMMEDIATE')
                row=con.execute('SELECT * FROM deals WHERE id=?',(did,)).fetchone()
                if not row:return self.send_json(404,{'error':'Kontakt nicht gefunden.'})
                old=dict(row);data={}
                for k,v in p.items():
                    if k in ('title','source','need_summary','notes','lost_reason'):data[k]=str(v or '')
                    elif k=='stage':data[k]=valid_choice(v,tuple(STAGES),'Phase')
                    elif k=='disposition':data[k]=valid_choice(v,tuple(DISPOSITIONS),'Kontaktstatus')
                    elif k=='priority':data[k]=valid_choice(v,('high','medium','low'),'Priorität')
                    elif k=='next_action':data[k]=valid_choice(v,('',*flow.ACTIONS),'Nächster Schritt')
                    elif k=='next_follow_up':data[k]=safe_date(v)
                    elif k=='next_follow_up_time':data[k]=valid_clock(v,p.get('next_follow_up',old['next_follow_up']))
                    elif k=='last_contact':data[k]=safe_date(v)
                    elif k=='do_not_contact':data[k]=int(bool(v))
                    elif k=='value':data[k]=valid_money(v)
                    elif k=='score':data[k]=safe_score(v)
                    elif k=='proposal_url':data[k]=safe_web_url(v)
                    elif k=='research_json':data[k]=json.dumps(clean_research(v),ensure_ascii=False)
                if 'next_follow_up' in data and data['next_follow_up']!=old['next_follow_up'] and 'next_follow_up_time' not in data: data['next_follow_up_time']=''
                new={**old,**data}
                if not data:raise ValueError('Keine gültigen Änderungen.')
                if new['disposition']!=old['disposition']:data['disposition_at']=ts if new['disposition']!='active' else ''
                if new['disposition']!='active' or new['do_not_contact'] or new['stage']=='won':data.update(next_follow_up='',next_follow_up_time='',next_action='')
                elif data.get('next_follow_up')=='':data['next_follow_up_time']=''
                data={k:v for k,v in data.items() if old.get(k)!=v}
                if data:
                    before={k:old.get(k) for k in data}
                    con.execute('UPDATE deals SET '+','.join(k+'=?' for k in data)+',updated_at=? WHERE id=?',list(data.values())+[ts,did])
                    # Won creates exactly one project. Project creation is deliberately excluded from plan undo.
                    won=data.get('stage')=='won' and new['disposition']=='active'
                    if won and not con.execute('SELECT id FROM projects WHERE deal_id=?',(did,)).fetchone():
                        con.execute('INSERT INTO projects(company_id,deal_id,name,status,value,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',(old['company_id'],did,new['title'],'planning',new['value'],ts,ts))
                    meta=dict(workflow_version=8,before=before,after=data) if not won else {}
                    con.execute('INSERT INTO activities(type,subject,body,occurred_at,company_id,deal_id,metadata) VALUES(?,?,?,?,?,?,?)',('stage' if won else 'plan','Auftrag gewonnen' if won else 'Kontakt / Planung aktualisiert',' · '.join(k+': '+str(v or '—') for k,v in data.items() if k not in ('research_json','notes','need_summary')),ts,old['company_id'],did,json.dumps(meta,ensure_ascii=False)))
                con.commit();return self.send_json(200,deal_detail(con,did))
        except (ValueError,TypeError,sqlite3.IntegrityError) as e:return self.send_json(400,{'error':str(e)})
        except Exception as e:log('Focus PATCH '+repr(e));return self.send_json(500,{'error':str(e)})
