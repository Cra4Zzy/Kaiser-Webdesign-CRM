"""Shared, deterministic CRM rules. No network, background sends or hidden writes."""
from datetime import datetime, date, timedelta

DEFAULTS = {
    'followup_attempted_days': '2', 'followup_offer_days': '3',
    'followup_contacted_days': '3', 'followup_interested_days': '1',
    'followup_building_days': '2', 'followup_later_days': '30',
    'workflow_business_days': '1', 'retry_review_after': '3', 'stale_days': '7',
}
ACTIONS = {'call':'Anrufen', 'followup':'Nachfassen', 'build_page':'Angebotsseite bauen',
           'send_page':'Angebotsseite senden', 'email':'E-Mail schreiben',
           'whatsapp':'WhatsApp schreiben', 'offer':'Angebot senden',
           'meeting':'Termin vereinbaren', 'other':'Sonstiges'}
OUTCOMES = {
    'not_reached':'Nicht erreicht', 'reached':'Gespräch geführt', 'interested':'Interesse bestätigt',
    'page_building':'Entwurf vorbereiten', 'page_sent':'Seite gesendet', 'offer_sent':'Angebot gesendet',
    'later':'Später wieder melden', 'no_interest':'Kein Interesse', 'contact_stop':'Kontaktstopp',
    'inactive':'Firma inaktiv', 'email_sent':'E-Mail gesendet', 'whatsapp_sent':'WhatsApp gesendet',
    'response_received':'Antwort erhalten', 'followup':'Nachfassen geplant', 'called':'Anrufversuch',
}
STOP_RESULTS = {'no_interest','contact_stop','inactive'}

def number(settings, key):
    try: return max(1, min(90, int(settings.get(key, DEFAULTS.get(key, '3')))))
    except (ValueError, TypeError): return int(DEFAULTS.get(key, '3'))

def add_days(day, days, business=True):
    result = day
    for _ in range(days):
        result += timedelta(days=1)
        while business and result.weekday() > 4: result += timedelta(days=1)
    return result.isoformat()

def active(d):
    return d.get('disposition') == 'active' and not d.get('do_not_contact') and not d.get('company_contact_stop') and d.get('stage') != 'won'

def default_action(d):
    return d.get('next_action') or {'new':'call','attempted':'call','building':'build_page',
        'interest':'call','offer':'followup','followup':'followup','contacted':'call','meeting':'meeting'}.get(d.get('stage'), 'other')

def due_state(day, clock='', now=None):
    now = now or datetime.now()
    if not day: return 'unplanned'
    today = now.date().isoformat()
    if day < today or day == today and clock and clock < now.strftime('%H:%M'): return 'overdue'
    return 'today' if day == today else 'upcoming'

def suggestion(d, kind, result, settings, event_day=None, event_time=None):
    """Defaults for a newly recorded outcome; advanced phases never regress on a missed call."""
    event_day = event_day or date.today()
    stage = d.get('stage','new')
    action = default_action(d)
    key = 'followup_contacted_days'
    if result in ('not_reached','called'): action, key = 'call', 'followup_attempted_days'
    elif result == 'interested':
        action, key = 'call', 'followup_interested_days'
        if stage in ('new','attempted','contacted','interest'): stage = 'interest'
    elif result == 'page_building': stage, action, key = 'building','build_page','followup_building_days'
    elif result in ('page_sent','offer_sent'): stage, action, key = 'offer','followup','followup_offer_days'
    elif result == 'later': action, key = 'call','followup_later_days'
    elif result == 'email_sent': action = 'followup'
    elif result == 'whatsapp_sent': action = 'whatsapp'
    elif result == 'followup': action = 'followup'
    elif result in ('reached','response_received'): action = 'call'
    if result in ('not_reached','called') and stage in ('new','attempted'): stage = 'attempted'
    if result in ('reached','response_received','email_sent','whatsapp_sent') and stage in ('new','attempted'): stage = 'contacted'
    days = number(settings, key)
    business = settings.get('workflow_business_days','1') == '1' and result != 'later'
    follow = add_days(event_day, days, business)
    explanation = f'{days} '+('Werktag' if days == 1 else 'Werktage') if business else f'{days} Kalendertage'
    if result in STOP_RESULTS:
        return dict(stage=stage, next_action='', next_follow_up='', next_follow_up_time='',
                    disposition='no_interest', do_not_contact=int(result=='contact_stop'),
                    lost_reason=OUTCOMES[result], explanation='Aus der aktiven Akquise nehmen; Verlauf bleibt erhalten.')
    if not result or kind == 'note' or not active(d):
        return dict(stage=d.get('stage'), next_action=d.get('next_action',''),
                    next_follow_up=d.get('next_follow_up',''), next_follow_up_time=d.get('next_follow_up_time',''),
                    explanation='Nur protokollieren; die bestehende Planung bleibt erhalten.')
    # Existing future promises take precedence unless the process actually moves forward.
    future = d.get('next_follow_up','') > event_day.isoformat() or (d.get('next_follow_up') == event_day.isoformat() and bool(d.get('next_follow_up_time')) and d['next_follow_up_time'] > (event_time or datetime.now().strftime('%H:%M')))
    keep = future and result not in ('page_building','page_sent','offer_sent','later')
    if keep: follow = d['next_follow_up']
    return dict(stage=stage, next_action=action, next_follow_up=follow,
                next_follow_up_time=d.get('next_follow_up_time','') if keep else '',
                explanation='Bestehender zukünftiger Termin bleibt erhalten.' if keep else 'Automatische Wiedervorlage: '+explanation+'.')

def workspace(deals, tasks, appointments, activities, settings, now=None):
    """One source for the dashboard, call queue, lead list and pipeline badges."""
    now = now or datetime.now()
    today = now.date().isoformat()
    blocked = {d['company_id'] for d in deals if d.get('do_not_contact') or d.get('company_contact_stop')}
    history = {}
    for a in activities:
        if not a.get('undone_at'): history.setdefault(a.get('deal_id'), []).append(a)
    agenda, enriched = [], []
    by_deal = {d['id']:d for d in deals}
    for task in tasks:
        if task['status'] != 'open': continue
        d = by_deal.get(task.get('deal_id'), {})
        agenda.append(dict(key='task:'+str(task['id']), source='task', source_id=task['id'],
            deal_id=task.get('deal_id'), company_name=d.get('company_name') or task.get('company_name') or 'Allgemeine Aufgabe',
            title=task['title'], date=task.get('due_date',''), time=task.get('due_time',''), action='task',
            status=due_state(task.get('due_date',''),task.get('due_time',''),now), priority=task.get('priority','medium'),
            context=task.get('notes',''), blocked=d.get('company_id') in blocked or bool(d and not active(d))))
    for a in appointments:
        if a['status'] != 'planned': continue
        d = by_deal.get(a.get('deal_id'), {})
        agenda.append(dict(key='appointment:'+str(a['id']),source='appointment',source_id=a['id'],
            deal_id=a.get('deal_id'),company_name=d.get('company_name') or a.get('company_name') or 'Termin',
            title=a['title'],date=a['start_at'][:10],time=a['start_at'][11:16],action=a['kind'],
            status=due_state(a['start_at'][:10],a['start_at'][11:16],now),priority='high',
            context='Termin noch nicht abgeschlossen' if a['end_at'] < now.isoformat(timespec='minutes') else a.get('notes',''),
            blocked=d.get('company_id') in blocked or bool(d and not active(d))))
    for original in deals:
        d = dict(original)
        if d['company_id'] in blocked: d['company_contact_stop'] = True
        rows = sorted(history.get(d['id'], []), key=lambda a:(a['occurred_at'],a['id']), reverse=True)
        calls = [a for a in rows if a['type'] == 'call']
        misses = 0
        for a in calls:
            if a.get('subject') not in ('Nicht erreicht','Anrufversuch','Angerufen'): break
            misses += 1
        contacts = [a for a in rows if a['type'] in ('call','email','whatsapp','offer','response','meeting','linkedin')]
        recent = contacts[0] if contacts else None
        notes = next((a['body'] for a in rows if a.get('body') and a['type'] not in ('edit','stage','import','created','plan','status','workflow_undo')), '')
        action = default_action(d)
        research = d.get('research_json') or '{}'
        import json
        try: research = json.loads(research) if isinstance(research,str) else research
        except (ValueError,TypeError): research = {}
        review = research.get('activity_status') in ('Prüfen','Inaktiv')
        linked = [a for a in agenda if a.get('deal_id') == d['id']]
        if active(d) and d.get('next_follow_up'):
            item=dict(key='lead:'+str(d['id']),source='lead',source_id=d['id'],deal_id=d['id'],
                company_name=d['company_name'],title=ACTIONS.get(action,'Nächsten Schritt klären'),action=action,
                date=d['next_follow_up'],time=d.get('next_follow_up_time',''),
                status=due_state(d['next_follow_up'],d.get('next_follow_up_time',''),now),priority=d.get('priority','medium'),
                context=notes or d.get('need_summary') or d.get('notes',''), blocked=False)
            agenda.append(item); linked.append(item)
        dated = sorted((a for a in linked if a.get('date')),key=lambda a:(a['date'],a['time'] or '23:59'))
        primary = dated[0] if dated else (linked[0] if linked else None)
        contact_day = (recent['occurred_at'] if recent else d.get('last_contact') or d['created_at'])[:10]
        try: quiet_days = max(0,(now.date()-date.fromisoformat(contact_day)).days)
        except ValueError: quiet_days = 0
        unplanned = active(d) and not dated
        stalled = active(d) and quiet_days >= number(settings,'stale_days') and not any(a['status']=='upcoming' for a in dated)
        d['focus'] = dict(active=active(d),action=action,plan=primary,unplanned=unplanned,stalled=stalled,
            quiet_days=quiet_days,consecutive_misses=misses,review_attempts=misses>=number(settings,'retry_review_after'),
            research_review=review,missing_phone=not bool(d.get('contact_phone') or d.get('company_phone')),call_eligible=active(d) and not review and bool(d.get('contact_phone') or d.get('company_phone')),
            last_result=recent['subject'] if recent else 'Kein Kontaktergebnis protokolliert',last_at=recent['occurred_at'] if recent else d.get('last_contact',''),
            context=notes or d.get('need_summary') or d.get('notes') or 'Noch keine Gesprächsnotiz.',
            reason=('Recherche prüfen' if review else 'Telefonnummer ergänzen' if not (d.get('contact_phone') or d.get('company_phone')) else f'{misses} Anrufe in Folge ohne Gespräch' if misses>=number(settings,'retry_review_after')
                    else 'Kein datierter nächster Schritt' if unplanned else f'Seit {quiet_days} Tagen ohne Kontakt' if stalled else ''))
        enriched.append(d)
    order = {'overdue':0,'today':1,'unplanned':2,'upcoming':3}
    agenda.sort(key=lambda a:(order[a['status']],a['date'] or '9999',a['time'] or '23:59',{'high':0,'medium':1,'low':2}.get(a['priority'],1),a['company_name'].casefold(),a['key']))
    return dict(now=now.isoformat(timespec='minutes'),today=today,deals=enriched,agenda=agenda,
        counts=dict(overdue=sum(a['status']=='overdue' for a in agenda),today=sum(a['status']=='today' for a in agenda),
            overdue_calls=sum(a['source']=='lead' and a['action']=='call' and a['status']=='overdue' for a in agenda),
            unplanned=sum(d['focus']['unplanned'] for d in enriched),stalled=sum(d['focus']['stalled'] for d in enriched),
            active=sum(d['focus']['active'] for d in enriched),review=sum(d['focus']['active'] and (d['focus']['review_attempts'] or d['focus']['research_review'] or d['focus']['missing_phone']) for d in enriched)),
        tasks=tasks,appointments=appointments,settings={k:settings.get(k,v) for k,v in DEFAULTS.items()})
