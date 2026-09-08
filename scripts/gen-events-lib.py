#!/usr/bin/env python3
# Regenerates events-lib.js from the site's calendar code (index.html), so the
# droplet reads the same events the site's calendar shows.
import re,sys
src=open(sys.argv[1] if len(sys.argv)>1 else '/home/claude/chutznik/index.html').read()
a=src.index('const EV_KIND=['); b=src.index('function evByDay(list)'); b=src.index('\n',b)+1
block=src[a:b]
out="""// GENERATED from chutznik/index.html by scripts/gen-events-lib.py — do not edit.
// The site's own calendar logic, run on the droplet for the daily "TODAY" sheet.
'use strict';
const S={allPosts:[],_updates:[],_waPosts:[]};
function isPreview(p){ return !!(p && p._localPreview && !(p.comments||[]).length); }
function threadKind(p){ const id=String(p&&p.id||'').replace(/^up_/,''); return id==='wa_BABYSIT'||id==='BABYSIT'?'babysit':(id==='wa_CLEANERS'?'clean':''); }
"""+block+"""
module.exports={ S, collectEvents, evByDay, evKey, evClean, evTimeIn, evKindOf, evDatesIn };
"""
open('/home/claude/collectors/scripts/events-lib.js','w').write(out)
print('events-lib.js written,',len(block),'chars')
