// GENERATED from chutznik/index.html by scripts/gen-events-lib.py — do not edit.
// The site's own calendar logic, run on the droplet for the daily "TODAY" sheet.
'use strict';
const S={allPosts:[],_updates:[],_waPosts:[]};
function isPreview(p){ return !!(p && p._localPreview && !(p.comments||[]).length); }
function threadKind(p){ const id=String(p&&p.id||'').replace(/^up_/,''); return id==='wa_BABYSIT'||id==='BABYSIT'?'babysit':(id==='wa_CLEANERS'?'clean':''); }
const EV_KIND=[
  ['sale',    /\b(sale|clearance|% ?off|discount|pop[- ]?up|boutique|trunk show|bazaar|shuk|market|fair|gemach)\b/i, '🛍️'],
  ['kids',    /\b(kids?|children|toddlers?|babies|family|families|camp|chugim?|puppet|story ?time|playgroup|bounce|carnival)\b/i, '🧒'],
  ['show',    /\b(concert|performance|show|play|theat(?:er|re)|musical|comedy|dance|singer|band|kumzitz|screening|movie|film|circus)\b/i, '🎭'],
  ['class',   /\b(workshop|class(?:es)?|course|seminar|training|lesson|masterclass|webinar|tutorial|painting|pottery|art|crafts?|baking|cooking|challah)\b/i, '🎨'],
  ['torah',   /\b(shiur(?:im)?|lecture|talk|speaker|panel|evening of|inspiration|chizuk|tehillim|farbrengen|melave malka|melaveh|shabbaton|siyum|hachnasas|kiddush|tish)\b/i, '🎤'],
  ['health',  /\b(yoga|pilates|zumba|fitness|exercise|wellness|meditation|breath|retreat|spa|massage|health|nutrition|support group)\b/i, '💆'],
  ['tour',    /\b(tour|trip|tiyul|hike|walk|outing|visit|museum|exhibit(?:ion)?|gallery|garden|zoo|aquarium|nature|excursion)\b/i, '🗺️'],
  ['food',    /\b(dinner|lunch|brunch|breakfast|buffet|tasting|wine|bbq|barbecue|picnic|cafe|restaurant night|food)\b/i, '🍽️'],
  ['chesed',  /\b(fundrais\w+|tzedaka|charity|volunteer\w*|blood drive|drive|donation|campaign|auction|chinese auction)\b/i, '❤️'],
  ['meet',    /\b(meet ?up|gathering|get[- ]together|social|networking|mixer|party|celebration|launch|open house|grand opening|opening|ladies'? night|women'?s (?:evening|night|event)|event)\b/i, '🎉'],
];
const EV_ANY=new RegExp(EV_KIND.map(k=>k[1].source).join('|'),'i');
const EV_NOT=/^\s*(?:wanted|seeking|looking for|iso\b|anyone|does anyone|need(?:ed)?\b|is there|where can|who (?:has|knows)|recommend)/i;
const EV_MONTHS={jan:0,january:0,feb:1,february:1,mar:2,march:2,apr:3,april:3,may:4,jun:5,june:5,jul:6,july:6,aug:7,august:7,sep:8,sept:8,september:8,oct:9,october:9,nov:10,november:10,dec:11,december:11};
const EV_DAYS={sunday:0,sun:0,monday:1,mon:1,tuesday:2,tue:2,tues:2,wednesday:3,wed:3,thursday:4,thu:4,thurs:4,friday:5,fri:5,shabbos:6,shabbat:6,saturday:6,sat:6};
function evDate(y,m,d){ const x=new Date(y,m,d); return isNaN(x)?null:x; }
function evKey(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
// All dates a text talks about, relative to when it was written.
// ── Hebrew dates (Miriam, 9 Sep 2026): "17 Tishrei", "י"ז תשרי", "Elul 12" —
//    read through the browser's Hebrew calendar, so "Monday 17 Tishrei" lands
//    on the right Monday and every calendar cell can show its Hebrew date.
const HEB_MONTHS={tishrei:'tishrei',tishri:'tishrei',heshvan:'cheshvan',cheshvan:'cheshvan',marcheshvan:'cheshvan',marheshvan:'cheshvan',kislev:'kislev',tevet:'tevet',teves:'tevet',shevat:'shevat',shvat:'shevat',adar:'adar',adari:'adar1',adar1:'adar1',adarii:'adar2',adar2:'adar2',nisan:'nisan',nissan:'nisan',iyar:'iyar',iyyar:'iyar',sivan:'sivan',tamuz:'tamuz',tammuz:'tamuz',av:'av',menachemav:'av',elul:'elul',ellul:'elul',
  'תשרי':'tishrei','חשון':'cheshvan','חשוון':'cheshvan','מרחשון':'cheshvan','מרחשוון':'cheshvan','כסלו':'kislev','כסליו':'kislev','טבת':'tevet','שבט':'shevat','אדר':'adar','ניסן':'nisan','אייר':'iyar','סיון':'sivan','סיוון':'sivan','תמוז':'tamuz','אב':'av','אלול':'elul'};
const HEB_NICE={tishrei:'Tishrei',cheshvan:'Cheshvan',kislev:'Kislev',tevet:'Teves',shevat:'Shevat',adar:'Adar',adar1:'Adar I',adar2:'Adar II',nisan:'Nisan',iyar:'Iyar',sivan:'Sivan',tamuz:'Tamuz',av:'Av',elul:'Elul'};
function hebNormMonth(x){ const k=String(x||'').toLowerCase().replace(/[^a-z\u05d0-\u05ea]/g,''); return HEB_MONTHS[k]||''; }
function hebParts(d){ try{ const ps=new Intl.DateTimeFormat('en-u-ca-hebrew',{day:'numeric',month:'long',year:'numeric'}).formatToParts(d); const g=(t)=>(ps.find(x=>x.type===t)||{}).value||''; return {day:Number(g('day')), month:hebNormMonth(g('month'))||g('month').toLowerCase(), year:Number(g('year'))}; }catch(e){ return null; } }
function hebLabel(d,withYear){ const h=hebParts(d); if(!h) return ''; return h.day+' '+(HEB_NICE[h.month]||h.month)+(withYear?' '+h.year:''); }
let _hebTable=null, _hebTableAt=0;
function hebTable(){
  const today=new Date(); today.setHours(0,0,0,0);
  if(_hebTable && Date.now()-_hebTableAt<6*3600e3) return _hebTable;
  const t={}; const d=new Date(today); d.setDate(d.getDate()-120);
  for(let i=0;i<560;i++){ const h=hebParts(d); if(h){ const k=h.month+'-'+h.day; (t[k]=t[k]||[]).push(new Date(d)); } d.setDate(d.getDate()+1); }
  _hebTable=t; _hebTableAt=Date.now(); return t;
}
function gematria(str){ const v={'א':1,'ב':2,'ג':3,'ד':4,'ה':5,'ו':6,'ז':7,'ח':8,'ט':9,'י':10,'כ':20,'ל':30}; let n=0; for(const ch of String(str).replace(/["׳״']/g,'')){ if(v[ch]==null) return 0; n+=v[ch]; } return n; }
function hebDatesIn(text, base){
  const t=String(text||''); const out=[]; const tbl=hebTable();
  const pick=(month,day)=>{ if(!month||!day||day<1||day>30) return; const list=tbl[month+'-'+day]||[]; const from=base.getTime()-30*864e5; const d=list.find(x=>x.getTime()>=from)||list[0]; if(d && !out.some(x=>x.getTime()===d.getTime())) out.push(d); };
  const mon='(tishrei|tishri|cheshvan|heshvan|marcheshvan|marheshvan|kislev|tevet|teves|shevat|shvat|adar(?:\\s*(?:i{1,2}|[12]|aleph|bet))?|nisan|nissan|iyy?ar|sivan|tam+uz|av|elul|ellul)';
  let m; const r1=new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?'+mon+'\\b','gi'); while((m=r1.exec(t))) pick(hebNormMonth(m[2]), Number(m[1]));
  const r2=new RegExp('\\b'+mon+'\\s+(\\d{1,2})\\b(?!\\s*(?:am|pm|:))','gi'); while((m=r2.exec(t))) pick(hebNormMonth(m[1]), Number(m[2]));
  const r3=/(?:^|[\s(,])([\u05d0-\u05ea]["׳״']?[\u05d0-\u05ea]?["׳״']?)\s*ב?(תשרי|חשון|חשוון|מרחשון|מרחשוון|כסלו|כסליו|טבת|שבט|אדר|ניסן|אייר|סיון|סיוון|תמוז|אב|אלול)(?![\u05d0-\u05ea])/g; while((m=r3.exec(t))) pick(hebNormMonth(m[2]), gematria(m[1]));
  return out;
}
function evDatesIn(text, created){
  const t=String(text||'').replace(/\s+/g,' ');
  const base=new Date(created||Date.now()); base.setHours(0,0,0,0);
  const out=[]; const add=(d)=>{ if(!d) return; if(!out.some(x=>x.getTime()===d.getTime())) out.push(d); };
  const yearFix=(d)=>{ if(!d) return d; if(d.getTime()<base.getTime()-45*864e5) d=new Date(d.getFullYear()+1,d.getMonth(),d.getDate()); return d; };
  let m;
  // a Hebrew date settles it: no guessing from the weekday
  try{ const hd=hebDatesIn(t, base); if(hd.length){ hd.forEach(add); return out.slice(0,8); } }catch(e){}
  // "Sept 11", "September 11-13", "Sep 11th, 12th", "11 September", "12,13,14 Sept"
  const mon='(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const re1=new RegExp('\\b'+mon+'\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?![a-z:\\d])((?:\\s*(?:[,&/-]|\\band\\b)\\s*(?:and\\s+)?\\d{1,2}(?:st|nd|rd|th)?(?![a-z:\\d]))*)(?:,?\\s*(20\\d\\d))?','gi');
  while((m=re1.exec(t))){ const mo=EV_MONTHS[m[1].toLowerCase()]; const y=m[4]?Number(m[4]):base.getFullYear();
    const days=[Number(m[2])].concat((m[3]||'').split(/[,&/-]|\band\b/).map(x=>parseInt(x,10)).filter(n=>n>0&&n<=31));
    if(days.length===2 && /-/.test(m[3]||'') && days[1]>days[0]) { for(let d=days[0]; d<=Math.min(days[1],days[0]+6); d++) add(yearFix(evDate(y,mo,d))); }
    else days.slice(0,6).forEach(d=>add(yearFix(evDate(y,mo,d)))); }
  const re2=new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?'+mon+'\\b(?:,?\\s*(20\\d\\d))?','gi');
  while((m=re2.exec(t))){ const mo=EV_MONTHS[m[2].toLowerCase()]; const y=m[3]?Number(m[3]):base.getFullYear(); add(yearFix(evDate(y,mo,Number(m[1])))); }
  // numeric: 9/12, 12.9, 9/12/26, 23/9 — a slash reads month/day (the Anglo
  // way) unless the first number cannot be a month; a dot reads day.month
  const re3=/\b(\d{1,2})([./])(\d{1,2})(?:\2(\d{2,4}))?\b(?!\s*(?:am|pm|:))/g;
  while((m=re3.exec(t))){ let a=Number(m[1]), b=Number(m[3]); let y=m[4]?Number(m[4]):base.getFullYear(); if(y<100) y+=2000;
    let mo,d; if(m[2]==='.'){ d=a; mo=b-1; } else if(a>12){ d=a; mo=b-1; } else { mo=a-1; d=b; }
    if(mo>=0&&mo<12&&d>=1&&d<=31) add(yearFix(evDate(y,mo,d))); }
  // weekdays: "this Thursday", "Tuesday at 8", "motzei shabbos" → the next one
  const re4=/\b(?:this|next|coming|on)?\s*(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thu|friday|fri|shabbos|shabbat|saturday|sat)\b/gi;
  while((m=re4.exec(t))){ const wd=EV_DAYS[m[1].toLowerCase()]; if(wd==null) continue; const d=new Date(base); let diff=(wd-d.getDay()+7)%7; if(/\bnext\b/i.test(m[0])&&diff===0) diff=7; d.setDate(d.getDate()+diff); add(d); }
  if(/\bmotz(?:a|e)i\s+shabb?(?:os|at)\b|מוצ"?ש/i.test(t)){ const d=new Date(base); d.setDate(d.getDate()+((6-d.getDay()+7)%7)); add(d); }
  if(/\b(?:tonight|today|this evening|this morning|this afternoon)\b|היום|הערב/i.test(t)) add(new Date(base));
  if(/\btomorrow\b|מחר/i.test(t)){ const d=new Date(base); d.setDate(d.getDate()+1); add(d); }
  const heb={'ראשון':0,'שני':1,'שלישי':2,'רביעי':3,'חמישי':4,'שישי':5,'שבת':6};
  const re5=/יום\s+(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)/g;
  while((m=re5.exec(t))){ const wd=heb[m[1]]; const d=new Date(base); d.setDate(d.getDate()+((wd-d.getDay()+7)%7)); add(d); }
  return out.slice(0,8);
}
function evTimeIn(text){
  const m=String(text||'').match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i) || String(text||'').match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if(!m) return '';
  let h=Number(m[1]); const mi=m[2]?m[2]:'00'; const ap=(m[3]||'').toLowerCase();
  if(ap==='pm'&&h<12) h+=12; if(ap==='am'&&h===12) h=0;
  if(!ap && !m[2]) return '';
  return String(h)+':'+mi;
}
function evClean(title){
  return String(title||'').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu,'').replace(/^\s*(?:from|posting for|posted for)\s+[^:]{0,40}:\s*/i,'').replace(/[*_~]/g,'').replace(/\s+/g,' ').replace(/^[\-–—:.!,\s]+/,'').trim();
}
// the 1–3 words that name the event on the calendar (the full title is in the day list)
const EV_STOP=/^(?:the|a|an|this|next|tomorrow|tonight|today|join|us|for|to|at|on|in|of|and|with|by|from|come|our|your|new|now|big|huge|b|h|bh|bsd|presents?|tickets?|only|two|days?|-|–|—|sunday|monday|tuesday|wednesday|thursday|friday|shabbos|shabbat|boker|tov|shavua|night|morning|evening)$/i;
function evTiny(title){
  const words=evClean(title).replace(/[^\p{L}\p{N}\s'’]/gu,' ').split(/\s+/).filter(w=>w && !EV_STOP.test(w)).map(w=>w.length>3&&w===w.toUpperCase()?w.charAt(0)+w.slice(1).toLowerCase():w);
  let out=[]; for(const w of words){ out.push(w); if(out.join(' ').length>=16 || out.length===3) break; }
  if(!out.length) out=words.slice(0,2);
  return out.join(' ')||'Event';
}
function evShort(title){
  let s=String(title||'').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu,'').replace(/^\s*(?:from|posting for|posted for)\s+[^:]{0,40}:\s*/i,'').replace(/[*_~]/g,'').replace(/\s+/g,' ').trim();
  s=s.replace(/^[\-–—:.!,\s]+/,'');
  if(s.length>34) s=s.slice(0,33).replace(/\s+\S*$/,'')+'…';
  return s||'Event';
}
function evKindOf(text){ for(const k of EV_KIND){ if(k[1].test(text)) return {kind:k[0],icon:k[2]}; } return {kind:'meet',icon:'📌'}; }
function evNormTitle(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9֐-׿]+/g,' ').replace(/\b(the|a|an|at|in|on|for|and|of|to|with)\b/g,'').replace(/\s+/g,' ').trim().slice(0,40); }
// Every event the loaded posts describe, one per (day, event), newest source wins.
function collectEvents(){
  const seen=new Map(); const out=[];
  const now=Date.now(); const lo=now-30*864e5, hi=now+200*864e5;
  const src=[]
    .concat((S.allPosts||[]).filter(p=>p&&!p._ad&&!p._cfg&&!isPreview(p)).map(p=>({p, id:String(p.id), ext:false})))
    .concat((S._updates||[]).filter(u=>u&&(!u.status||u.status==='public')).map(u=>({p:u, id:'up_'+u.id, ext:true})))
    .concat((S._waPosts||[]).map(w=>({p:w, id:(String(w.id).startsWith('wa')?String(w.id):'wa_'+w.id), ext:true})));
  for(const {p,id,ext} of src){
    try{
      const types=(p.types||[]).map(t=>String(t).toLowerCase());
      if(types.includes('rental')||types.includes('jobs')||threadKind(p)) continue;
      // a magazine ad (opening hours, "valid to 31.12") is not a happening unless it was filed as an event
      if(String(p.source||'')==='magazine' && !types.includes('events')) continue;
      const title=String(p.title||''); const memo=String(p.memo||'').replace(/<[^>]+>/g,' ');
      const text=title+'\n'+memo;
      if(EV_NOT.test(title)) continue;
      if(!EV_ANY.test(text)) continue;
      if(/\b(babysit|nanny|apartment|apt\b|for rent|sublet|hiring|salary)\b/i.test(title)) continue;
      const dates=evDatesIn(text, p.created);
      if(!dates.length) continue;
      const kind=evKindOf(text); const short=evShort(title||memo); const norm=evNormTitle(short); const time=evTimeIn(memo)||evTimeIn(title);
      for(const d of dates){
        if(d.getTime()<lo||d.getTime()>hi) continue;
        const key=evKey(d)+'|'+norm;
        if(seen.has(key)) continue;          // the same event from another group: once
        seen.set(key,1);
        out.push({day:evKey(d), ts:d.getTime(), time, title:short, full:evClean(title)||evClean(memo.slice(0,80)), icon:kind.icon, kind:kind.kind, id, ext, created:p.created||0});
      }
    }catch(e){}
  }
  out.sort((a,b)=>a.ts-b.ts || (a.time||'99').localeCompare(b.time||'99'));
  return out;
}
function evByDay(list){ const m={}; for(const e of list){ (m[e.day]=m[e.day]||[]).push(e); } return m; }

module.exports={ S, collectEvents, evByDay, evKey, evClean, evTimeIn, evKindOf, evDatesIn };
