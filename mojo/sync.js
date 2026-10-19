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
      board = { origin: e.origin, classMatch: e.data.classMatch || '' };
      window.removeEventListener('message', on);
      res();
    };
    window.addEventListener('message', on);
    setTimeout(res, 2500);
  });

  /* ---- Timeback server functions --------------------------------- */
  const SFN = '/_serverFn/';
  const call = async (h, data) => {
    const r = await fetch(SFN + h + '?createServerFn', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data, context: {} }) });
    const j = await r.json(); if (j.$error) throw new Error(j.$error.message || 'Timeback error'); return j.result;
  };
  const callGet = async (h, data) => {
    const r = await fetch(`${SFN}${h}?payload=` + encodeURIComponent(JSON.stringify({ data, context: {} })) + '&createServerFn');
    const j = await r.json(); if (j.$error) throw new Error(j.$error.message || 'Timeback error'); return j.result;
  };
  const FN = {
    scope:   'src_features_xp-stats_actions_getXpStatsCampusScope_ts--getXpStatsCampusScope_createServerFn_handler',
    metrics: 'src_features_learning-metrics_actions_getBatchActivityMetrics_ts--getBatchActivityMetrics_createServerFn_handler',
    goals:   'src_features_goals_actions_goals-batch-api_ts--getStudentSubjectGoalsBatch_createServerFn_handler',
    tests:   'src_features_teacher_actions_getAssignedTestsBatch_ts--getAssignedTestsBatch_createServerFn_handler',
    enroll:  'src_features_teacher_actions_getEnrollmentsForMultipleStudents_ts--getEnrollmentsForMultipleStudents_createServerFn_handler',
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
    const mr = await call(FN.metrics, { studentIds: ids, startDate: start.toISOString(), endDate: new Date().toISOString() });
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
