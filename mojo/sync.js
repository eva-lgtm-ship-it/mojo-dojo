/* =====================================================================
   MOJO DOJO — Timeback sync
   Runs inside a guide's signed-in alpha.timeback.com tab (as the "Sync"
   bookmark, or as a DevTools snippet). It reads the class from Timeback
   and hands the numbers to the Mojo Dojo board that opened this tab.
   The board saves them to Supabase with the guide's own sign-in.

   This script never sees or stores a Supabase key, and nothing it reads
   is written into any file. If no board opened this tab, it copies the
   data to the clipboard instead, for the board's "Paste sync" box.
   ===================================================================== */
(async () => {
  if (!/(^|\.)timeback\.com$/.test(location.hostname)) {
    alert('Run the Mojo sync on a tab that is signed in to alpha.timeback.com');
    return;
  }
  const DAYS_BACK = 13;                 /* this week + last week, so late work lands */
  const STORE = 'mojo-sync:v1';         /* remembers the class and trusted board */
  const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; } })();
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch {} };

  /* Same subject rules as the Alpha XP board: app class name → subject. */
  const SUBJECT_RULES = [
    [/math raiders|fastmath/i, 'FastMath'],
    [/lalilo/i, 'Language'],
    [/alphaphonics|reading/i, 'Reading'],
    [/alphawrite|writing/i, 'Writing'],
    [/vocabloco|vocabulary/i, 'Vocabulary'],
    [/language/i, 'Language'],
    [/social studies/i, 'Social Studies'],
    [/science/i, 'Science'],
    [/math/i, 'Math'],
  ];

  /* ---- talk to the board that opened us -------------------------- */
  let board = null;                       /* {origin, classMatch} */
  const hello = new Promise(res => {
    const on = e => {
      if (!e.data || e.data.type !== 'mojo-hello') return;
      board = { origin: e.origin, classMatch: e.data.classMatch || '', since: /^\d{4}-\d{2}-\d{2}$/.test(e.data.since || '') ? e.data.since : '' };
      window.removeEventListener('message', on);
      res();
    };
    window.addEventListener('message', on);
    setTimeout(res, 2500);
  });

  /* ---- Timeback server functions --------------------------------- */
  /* Since Nov 2026 Timeback's server functions speak a "seroval" wire format: requests and
     answers are JSON trees of typed nodes ({t:10} object, {t:9} array, {t:1} string, {t:0}
     number, {t:2} constant, {t:4} reference). enc/dec below translate plain values both ways. */
  const SFN = '/_serverFn/';
  const enc = (v) => {
    let id = 0;
    const e = (x) => {
      if (x === null) return { t: 2, s: 0 };
      if (x === undefined) return { t: 2, s: 1 };
      if (x === true) return { t: 2, s: 2 };
      if (x === false) return { t: 2, s: 3 };
      if (typeof x === 'number') return { t: 0, s: x };
      if (typeof x === 'string') return { t: 1, s: x };
      if (Array.isArray(x)) return { t: 9, i: id++, a: x.map(e), o: 0 };
      const keys = Object.keys(x);
      const node = { t: 10, i: id++, p: null, o: 0 };
      node.p = { k: keys, v: keys.map(k => e(x[k])) };
      return node;
    };
    return JSON.stringify({ t: e(v), f: 127, m: [] });
  };
  const unesc = (s) => typeof s !== 'string' ? s : s.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|.)/g, (m, g) =>
    g[0] === 'x' && g.length === 3 ? String.fromCharCode(parseInt(g.slice(1), 16))
      : g[0] === 'u' && g.length === 5 ? String.fromCharCode(parseInt(g.slice(1), 16))
        : ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', 0: '\0' }[g] ?? g));
  const dec = (root) => {
    const refs = {};
    const CONST = [null, undefined, true, false, -0, Infinity, -Infinity, NaN];
    const d = (n) => {
      if (n === null || n === undefined) return undefined;
      switch (n.t) {
        case 0: return n.s;
        case 1: return unesc(n.s);
        case 2: return CONST[n.s];
        case 3: return Number(n.s);
        case 4: return refs[n.i];
        case 5: return n.s;
        case 7: { const a = []; refs[n.i] = a; (n.a || []).forEach(x => a.push(d(x))); return a; }
        case 8: { const o = {}; refs[n.i] = o; const ks = n.e ? n.e.k : [], vs = n.e ? n.e.v : [];
          ks.forEach((k, j) => { o[String(d(k))] = d(vs[j]); }); return o; }
        case 9: { const a = []; refs[n.i] = a; (n.a || []).forEach((x, k) => { a[k] = d(x); }); return a; }
        case 10: case 11: { const o = {}; refs[n.i] = o; const p = n.p || { k: [], v: [] };
          p.k.forEach((k, j) => { o[unesc(k)] = d(p.v[j]); }); return o; }
        default: return (n.s && typeof n.s === 'object' && n.s.v) ? d(n.s.v) : undefined;
      }
    };
    return d(root);
  };
  const call = async (h, data) => {
    const r = await fetch(SFN + h, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tsr-serverfn': 'true', accept: 'application/json' },
      body: enc({ data, context: {} }) });
    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch (e) { throw new Error('Timeback answered ' + r.status); }
    if (j && j.isSerializedRedirect) throw new Error('Timeback redirected the request; reload Timeback and sign in');
    const v = (j && typeof j.t === 'number') ? dec(j) : j;
    if (v && v.error) throw new Error((v.error && v.error.message) || 'Timeback error');
    if (j && j.$error) throw new Error(j.$error.message || 'Timeback error');
    return v && typeof v === 'object' && 'result' in v ? v.result : v;
  };
  const callGet = call;   /* Timeback now refuses GET for these; POST works */
  const FN = {
    scope:   'src_features_xp-stats_actions_getXpStatsCampusScope_ts--getXpStatsCampusScope_createServerFn_handler',
    metrics: 'src_features_learning-metrics_actions_getBatchActivityMetrics_ts--getBatchActivityMetrics_createServerFn_handler',
    goals:   'src_features_goals_actions_goals-batch-api_ts--getStudentSubjectGoalsBatch_createServerFn_handler',
    tests:   'src_features_teacher_actions_getAssignedTestsBatch_ts--getAssignedTestsBatch_createServerFn_handler',
    enroll:  'src_features_teacher_actions_getEnrollmentsForMultipleStudents_ts--getEnrollmentsForMultipleStudents_createServerFn_handler',
    /* one student at a time; unlike the batch call it includes timeSpentMetrics (minutes) */
    single:  'src_features_learning-metrics_actions_getActivityMetrics_ts--getActivityMetrics_createServerFn_handler',
  };

  /* Metric field names vary a little; take the first one that's there. */
  const pick = (o, keys) => { for (const k of keys) if (o && typeof o[k] === 'number') return o[k]; return 0; };
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  /* Plain dates stay as they are; timestamps become the local (campus) date. */
  const dayKey = (k) => /^\d{4}-\d{2}-\d{2}$/.test(k) ? k : ymd(new Date(k));

  const toast = (msg) => {
    let el = document.getElementById('mojo-sync-toast');
    if (!el) {
      el = document.createElement('div'); el.id = 'mojo-sync-toast';
      el.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:360px;' +
        'background:#110068;color:#fff;font:600 14px/1.4 Montserrat,system-ui,sans-serif;' +
        'padding:14px 16px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.3)';
      document.body.appendChild(el);
    }
    el.textContent = msg;
  };

  try {
    toast('Mojo sync: reading your class…');
    await hello;

    /* 1. Class + roster */
    const scope = await call(FN.scope, { orgId: 'all-accessible-campuses', mode: 'teacher' });
    if (!scope || !scope.success) throw new Error((scope && scope.error) || 'could not list your classes');
    const classes = (scope.classesWithStudents || []).map(c => ({
      id: c.classInfo.sourcedId, title: (c.classInfo.title || '').trim(),
      students: (c.students || []).filter(u => u.givenName),
    }));
    const match = (board && board.classMatch) || saved.classMatch || '';
    let cls = classes.find(c => c.id === saved.classId);
    if (!cls && match) {
      const hits = classes.filter(c => c.title.toLowerCase().includes(match.toLowerCase()));
      if (hits.length === 1) cls = hits[0];
    }
    if (!cls) {
      const list = classes.map((c, i) => `${i + 1}. ${c.title} (${c.students.length})`).join('\n');
      const n = parseInt(prompt(`Which class is your Mojo Dojo class?\n\n${list}`, '1'), 10);
      cls = classes[n - 1];
      if (!cls) throw new Error('no class picked');
    }
    saved.classId = cls.id; saved.classMatch = match; save();

    const students = cls.students.map(u => ({
      id: u.sourcedId,
      name: u.name || [u.givenName, u.familyName].filter(Boolean).join(' '),
      email: (u.email || '').toLowerCase(),
    }));
    const ids = students.map(s => s.id);
    if (!ids.length) throw new Error('that class has no students');

    /* 2. Goals and which subjects have an app */
    const goalsRaw = await call(FN.goals, { studentIds: ids });
    const goals = {};
    for (const g of (goalsRaw || [])) goals[g.studentId] = g.subjectGoals || {};

    const open = {};
    try {
      const er = await callGet(FN.enroll, { studentSourcedIds: ids });
      for (const e of ((er.data || er).enrollments || [])) {
        const id = e.user && e.user.sourcedId, name = e.class && e.class.name;
        const rule = name && SUBJECT_RULES.find(([re]) => re.test(name));
        if (id && rule) (open[id] || (open[id] = [])).includes(rule[1]) || open[id].push(rule[1]);
      }
    } catch (e) { console.warn('[Mojo sync] enrollments skipped:', e.message); }

    /* 3. Per-day, per-subject metrics */
    const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - DAYS_BACK);
    /* reach back further when the board asks (e.g. to the start of Mobile Squad), at most 90 days */
    if (board && board.since) {
      const [y, mo, d] = board.since.split('-').map(Number);
      const since = new Date(y, mo - 1, d);
      const floor = new Date(); floor.setHours(0, 0, 0, 0); floor.setDate(floor.getDate() - 90);
      if (since < start) start.setTime(Math.max(since.getTime(), floor.getTime()));
    }
    /* Timeback files days by UTC unless told a time zone; use this computer's (the campus's), so
       work after 4 pm stays on the right day */
    const TZ = (Intl.DateTimeFormat().resolvedOptions().timeZone) || 'America/Los_Angeles';
    const mr = await call(FN.metrics, { studentIds: ids, startDate: start.toISOString(), endDate: new Date().toISOString(), timezone: TZ });
    const days = {};   /* "kid|day" → row */
    let shown = false;
    for (const m of ((mr.data && mr.data.metrics) || [])) {
      for (const [k, perSubject] of Object.entries(m.facts || {})) {
        const day = dayKey(k);
        const row = days[m.studentId + '|' + day] || (days[m.studentId + '|' + day] = { kid: m.studentId, day, subjects: {}, tests: 0 });
        for (const [subject, s] of Object.entries(perSubject || {})) {
          const am = s.activityMetrics || {};
          const tm = s.timeSpentMetrics || s.timeMetrics || {};
          if (!shown) { console.log('[Mojo sync] metric fields seen:', Object.keys(am), Object.keys(tm)); shown = true; }
          const secs = pick(tm, ['activeSeconds', 'activeTimeSeconds', 'totalSeconds']) || pick(am, ['activeSeconds', 'timeSpentSeconds']);
          row.subjects[subject] = {
            xp: pick(am, ['xpEarned']),
            questions: pick(am, ['totalQuestions', 'questionsAnswered', 'questionsAttempted', 'attempted']),
            correct: pick(am, ['correctQuestions', 'questionsCorrect', 'correct']),
            minutes: secs ? secs / 60 : pick(am, ['activeMinutes', 'minutes']),
          };
        }
      }
    }

    /* 3b. Active minutes: the batch call leaves them out, so ask per student (4 at a time) */
    toast('Mojo sync: reading active minutes…');
    let minutesFound = 0, minutesFailed = 0;
    const queue = ids.slice();
    const worker = async () => {
      while (queue.length) {
        const id = queue.shift();
        try {
          const one = await call(FN.single, { studentId: id, startDate: start.toISOString(), endDate: new Date().toISOString(), timezone: TZ });
          const facts = (one && one.data && one.data.facts) || {};
          for (const [k, perSubject] of Object.entries(facts)) {
            const day = dayKey(k);
            const row = days[id + '|' + day] || (days[id + '|' + day] = { kid: id, day, subjects: {}, tests: 0 });
            for (const [subject, s] of Object.entries(perSubject || {})) {
              const secs = pick(s.timeSpentMetrics || {}, ['activeSeconds']);
              const am = s.activityMetrics || {};
              const sub = row.subjects[subject] || (row.subjects[subject] = {
                xp: pick(am, ['xpEarned']), questions: pick(am, ['totalQuestions']),
                correct: pick(am, ['correctQuestions']), minutes: 0 });
              sub.minutes = secs / 60;
              if (secs) minutesFound++;
            }
          }
        } catch (e) { minutesFailed++; console.warn('[Mojo sync] minutes skipped for one student:', e.message); }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    console.log('[Mojo sync] minutes found for', minutesFound, 'subject-days;', minutesFailed, 'students failed');

    /* 4. Tests finished in Timeback, counted on the day they were done */
    try {
      const tr = await call(FN.tests, { studentIds: ids });
      for (const [id, arr] of Object.entries(tr.data || {})) {
        for (const t of (arr || [])) {
          if (t.scoreStatus === 'not submitted') continue;
          const when = t.scoreDate || t.submittedAt || t.completedAt || t.dateLastModified;
          if (!when) continue;
          const day = dayKey(when);
          if (day < ymd(start)) continue;
          const row = days[id + '|' + day] || (days[id + '|' + day] = { kid: id, day, subjects: {}, tests: 0 });
          row.tests += 1;
        }
      }
    } catch (e) { console.warn('[Mojo sync] tests skipped:', e.message); }

    /* Every kid gets a row for every date in range, empty if no work: this clears rows an
       older sync filed under the wrong date */
    for (let d = new Date(start); d <= new Date(); d.setDate(d.getDate() + 1)) {
      const day = ymd(d);
      for (const id of ids) if (!days[id + '|' + day]) days[id + '|' + day] = { kid: id, day, subjects: {}, tests: 0 };
    }

    const payload = { class: { id: cls.id, title: cls.title }, students, goals, open, days: Object.values(days) };
    const summary = `${students.length} kids, ${payload.days.length} kid-days from “${cls.title}”`;

    /* 5. Hand it over */
    if (board && window.opener) {
      const ok = saved.trusted === board.origin ||
        confirm(`Send ${summary} to the Mojo Dojo board at\n${board.origin}?`);
      if (!ok) { toast('Mojo sync: cancelled.'); return; }
      saved.trusted = board.origin; save();
      window.opener.postMessage({ type: 'mojo-sync', payload }, board.origin);
      toast(`Mojo sync: sent ${summary}. You can switch back to the board.`);
    } else {
      await navigator.clipboard.writeText(JSON.stringify(payload));
      toast(`Mojo sync: copied ${summary}. On the board, open ⚙ → Paste sync.`);
    }
  } catch (e) {
    console.error('[Mojo sync]', e);
    toast('Mojo sync failed: ' + e.message + '. Make sure you are signed in to Timeback as a guide.');
  }
})();
