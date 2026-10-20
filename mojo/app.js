/* =====================================================================
   MOJO DOJO — the one rules file.
   The guide board (/mojo), the kid page (/house) and the kids list
   (/house/guide) all import this. Change a rule here and every screen
   changes together, so they can never disagree.

   No student names, emails, tokens or keys belong in this file.
   The Supabase URL and public key are typed into the page once and
   saved in that browser (see getConfig / askForConfig below).
   ===================================================================== */

/* ---------- 1. The rules (edit these) -------------------------------- */
export const RULES = {
  EPIC_XP: 145,               // Epic day: 145+ XP and every ring closed
  MIN_XP: 120,                // Minimum day: 120–144 XP and every ring closed

  WEEK_START_DOW: 5,          // 0 Sun … 5 Fri. The week runs Friday → Thursday.
  WEEKEND_INTO_FRIDAY: true,  // Saturday + Sunday work counts toward Friday's card

  TIME_ICON_MINUTES: 120,     // Time icon: 120 active minutes that day, all subjects
  ACCURACY_ICON: 0.80,        // Accuracy icon: 80%+ across every question that day

  // Smoothie: every counted school day of the week is Epic.
  // Excused days and no-school days are not counted.
  SMOOTHIE: { excusedCounts: false },

  // Fun Friday: on 4 of the week's 5 school days, the "All Subjects" accuracy
  // ring is ABOVE 80%. All Subjects = the average of each subject's accuracy
  // that day (each subject counts equally, however many questions it had).
  // Subjects with no questions that day are left out of the average.
  // A day with no questions at all doesn't qualify.
  // Short weeks (no-school / excused days removed) allow the same one miss:
  // 5 counted days → 4 needed, 4 → 3, 3 → 2.
  FUN_FRIDAY: { accuracyAbove: 0.80, daysNeeded: 4, missesAllowed: 1 },

  // Pizza (whole class): every kid on the board reaches 600 XP in the week.
  PIZZA_WEEK_XP: 600,

  // Kid page is locked during Core Skills blocks on weekdays (local time).
  CORE_SKILLS_LOCK: [['09:00', '10:10'], ['10:30', '11:40']],

  BOARD_REFRESH_MS: 60_000,
  STALE_AFTER_HOURS: 20,      // settings drawer warns when the last sync is older
};

// Order rings are drawn in. Unknown subjects go at the end.
export const SUBJECT_ORDER = ['Math', 'FastMath', 'Reading', 'Language', 'Vocabulary',
  'Writing', 'Science', 'Social Studies'];

export const SHORT = { Math: 'Math', FastMath: 'Fast', Reading: 'Read', Language: 'Lang',
  Vocabulary: 'Vocab', Writing: 'Write', Science: 'Sci', 'Social Studies': 'SS' };

/* ---------- 2. Rules written in plain words (settings drawer) -------- */
export function rulesInWords(r = RULES) {
  const pct = n => Math.round(n * 100) + '%';
  return [
    `Epic day: ${r.EPIC_XP}+ XP and every ring closed.`,
    `Minimum day: ${r.MIN_XP}–${r.EPIC_XP - 1} XP and every ring closed.`,
    `A ring closes when that subject's Timeback daily goal is met. Day pass or Test day lets rings stay open; the XP still decides.`,
    `The week runs ${DOW[r.WEEK_START_DOW]} to ${DOW[(r.WEEK_START_DOW + 6) % 7]}` +
      (r.WEEKEND_INTO_FRIDAY ? '; Saturday and Sunday work counts toward Friday.' : '.'),
    `Smoothie: every counted day of the week is Epic. Excused and no-school days don't count.`,
    `Fun Friday: ${r.FUN_FRIDAY.daysNeeded} of 5 days with accuracy above ${pct(r.FUN_FRIDAY.accuracyAbove)} on the All Subjects ring, the average of each subject's accuracy that day (one miss allowed in short weeks).`,
    `Pizza: everyone on the board reaches ${r.PIZZA_WEEK_XP} XP in the week.`,
    `Time icon: ${r.TIME_ICON_MINUTES} active minutes. Accuracy icon: ${pct(r.ACCURACY_ICON)}+ across every question.`,
  ];
}

/* ---------- 3. Dates (all local, as 'YYYY-MM-DD' strings) ------------ */
export const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
export const dow = s => parseYmd(s).getDay();
export const today = (now = new Date()) => ymd(now);

export function weekStartOf(s, r = RULES) {
  const back = (dow(s) - r.WEEK_START_DOW + 7) % 7;
  return addDays(s, -back);
}

/** The school-day cards of a week, each with the calendar dates it covers. */
export function weekCards(start, r = RULES) {
  const cards = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i);
    const d = dow(date);
    if (d === 0 || d === 6) {
      // weekend: fold into the Friday card if that's the rule and Friday is in this week
      const fri = cards.find(c => dow(c.date) === 5);
      if (r.WEEKEND_INTO_FRIDAY && fri) fri.covers.push(date);
      continue;
    }
    cards.push({ date, covers: [date] });
  }
  return cards;
}

export const shortDay = s => {
  const d = parseYmd(s);
  return `${DOW[d.getDay()].slice(0, 3)} ${d.getMonth() + 1}/${d.getDate()}`;
};

/* ---------- 4. One day ---------------------------------------------- */
const num = v => (typeof v === 'number' && isFinite(v) ? v : Number(v) || 0);

function sumSubjects(rows) {
  const out = {};
  for (const row of rows) {
    for (const [name, m] of Object.entries((row && row.subjects) || {})) {
      const o = out[name] || (out[name] = { xp: 0, questions: 0, correct: 0, minutes: 0 });
      o.xp += num(m.xp); o.questions += num(m.questions);
      o.correct += num(m.correct); o.minutes += num(m.minutes);
    }
  }
  return out;
}

/** Which rings count for this kid on this day, with their goals. */
export function ringsFor({ goals, subjects, kid, appsOut }) {
  const off = new Set([...(kid.rings_off || []), ...(appsOut || [])]);
  const open = new Set(kid.open_subjects || []);
  const g = { ...(goals || {}) };
  const s = JSON.parse(JSON.stringify(subjects || {}));

  if (kid.language_with_reading && ('Language' in g || 'Language' in s)) {
    g.Reading = num(g.Reading) + num(g.Language); delete g.Language;
    if (s.Language) {
      const r = s.Reading || (s.Reading = { xp: 0, questions: 0, correct: 0, minutes: 0 });
      for (const k of ['xp', 'questions', 'correct', 'minutes']) r[k] += num(s.Language[k]);
      delete s.Language;
    }
    if (open.has('Language')) open.add('Reading');
  }

  // A ring counts only when there's a goal AND the kid has an app (or worked it today).
  return Object.entries(g)
    .filter(([name, goal]) => num(goal) > 0 && !off.has(name) && (open.has(name) || name in s))
    .map(([name, goal]) => {
      const xp = num(s[name] && s[name].xp);
      return { subject: name, goal: num(goal), xp: Math.round(xp), closed: xp >= num(goal),
        left: Math.max(0, Math.ceil(num(goal) - xp)) };
    })
    .sort((a, b) => order(a.subject) - order(b.subject));
}
const order = s => { const i = SUBJECT_ORDER.indexOf(s); return i < 0 ? 99 : i; };

/** Tier from XP and rings alone. */
export function tierOf(xp, ringsOk, r = RULES) {
  if (!ringsOk) return 'notyet';
  if (xp >= r.EPIC_XP) return 'epic';
  if (xp >= r.MIN_XP) return 'minimum';
  return 'notyet';
}

/** "All Subjects" accuracy ring: average of each worked subject's accuracy, or null. */
export function allSubjectsAccuracy(subjects) {
  const worked = Object.values(subjects || {}).filter(m => num(m.questions) > 0);
  if (!worked.length) return null;
  return worked.reduce((a, m) => a + num(m.correct) / num(m.questions), 0) / worked.length;
}

/** Did this day qualify for Fun Friday? */
export function funFridayDay(subjects, r = RULES) {
  const avg = allSubjectsAccuracy(subjects);
  return avg !== null && avg > r.FUN_FRIDAY.accuracyAbove;
}

/**
 * Evaluate one card.
 *  rows      — days rows for every date the card covers
 *  kid       — {rings_off, language_with_reading, open_subjects, goals}
 *  flag      — day_flags row or null
 *  classDay  — class_days row or null
 *  todayStr  — 'YYYY-MM-DD'
 */
export function evalCard({ card, rows, kid, flag, classDay, todayStr }, r = RULES) {
  const f = flag || {};
  const c = classDay || {};
  const subjects = sumSubjects(rows);
  const first = rows.find(x => x && x.day === card.date) || rows[0];
  const goals = (first && first.goals && Object.keys(first.goals).length) ? first.goals : (kid.goals || {});
  const appsOut = [...(f.apps_out || []), ...(c.apps_out || [])];
  const rings = ringsFor({ goals, subjects, kid, appsOut });

  const all = Object.values(subjects);
  const xp = Math.round(all.reduce((a, m) => a + m.xp, 0));
  const minutes = Math.round(all.reduce((a, m) => a + m.minutes, 0));
  const questions = all.reduce((a, m) => a + m.questions, 0);
  const correct = all.reduce((a, m) => a + m.correct, 0);
  const accuracy = questions ? correct / questions : null;
  const tests = rows.reduce((a, x) => a + num(x && x.tests), 0);

  const test = !!f.test || tests > 0;           // a Timeback test does this on its own
  const waived = !!f.pass || test;
  const ringsOk = waived || rings.every(x => x.closed);
  const tier = tierOf(xp, ringsOk, r);

  const last = card.covers[card.covers.length - 1];
  const phase = c.no_school ? 'noschool'
    : card.date > todayStr ? 'future'
    : last >= todayStr ? 'today' : 'past';

  return {
    date: card.date, covers: card.covers, phase,
    tier,                                   // what it is right now
    xp, minutes, questions, correct, accuracy, rings, ringsOk,
    timeIcon: minutes >= r.TIME_ICON_MINUTES,
    accIcon: accuracy !== null && accuracy >= r.ACCURACY_ICON,
    allSubjectsAcc: allSubjectsAccuracy(subjects),
    funDay: funFridayDay(subjects, r),
    pass: !!f.pass, test, autoTest: tests > 0 && !f.test, excused: !!f.excused,
    appsOut, kidAppsOut: f.apps_out || [], callTime: f.call_time || null,
    noSchool: !!c.no_school,
    toMin: Math.max(0, r.MIN_XP - xp), toEpic: Math.max(0, r.EPIC_XP - xp),
    openRings: rings.filter(x => !x.closed),
  };
}

/* ---------- 5. The week --------------------------------------------- */
export function evalWeek(cards, todayStr, r = RULES) {
  const weekOver = cards.length && cards[cards.length - 1].covers.slice(-1)[0] < todayStr;
  const counted = cards.filter(c => !c.noSchool && (r.SMOOTHIE.excusedCounts || !c.excused));
  const epic = counted.filter(c => c.tier === 'epic').length;

  // Smoothie: every counted day Epic
  const brokeSmoothie = counted.some(c => c.phase === 'past' && c.tier !== 'epic');
  const smoothie = {
    epic, counted: counted.length,
    status: brokeSmoothie || (weekOver && !counted.length) ? 'out'
      : weekOver ? 'won' : 'alive',
  };

  // Fun Friday: N of the counted days qualify
  const FF = r.FUN_FRIDAY;
  const needed = Math.max(1, Math.min(FF.daysNeeded, counted.length - FF.missesAllowed));
  const qualifying = counted.filter(c => c.funDay).length;
  const stillOpen = counted.filter(c => c.phase === 'future' || (c.phase === 'today' && !c.funDay)).length;
  const funFriday = {
    qualifying, needed,
    status: qualifying >= needed ? 'won'
      : qualifying + stillOpen < needed || weekOver ? 'out' : 'alive',
    toGo: Math.max(0, needed - qualifying),
  };

  return { smoothie, funFriday };
}

/** Week XP for one kid: every calendar date in the week, weekends included. */
export function weekXp(dayRows) {
  let t = 0;
  for (const row of dayRows) for (const m of Object.values(row.subjects || {})) t += num(m.xp);
  return Math.round(t);
}

/** Pizza: whole class. xps = one week total per kid on the board. */
export function pizzaStatus(xps, r = RULES) {
  const done = xps.filter(x => x >= r.PIZZA_WEEK_XP).length;
  return { done, total: xps.length, won: xps.length > 0 && done === xps.length,
    lowestToGo: xps.length ? Math.max(0, r.PIZZA_WEEK_XP - Math.min(...xps)) : 0 };
}

/**
 * Build a kid's whole week from raw rows. Used by both screens.
 *  kid       — kids row (or house_card kid)
 *  days      — days rows for this kid
 *  flags     — day_flags rows for this kid
 *  classDays — class_days rows
 */
export function buildKidWeek({ kid, days, flags, classDays, start, todayStr }, r = RULES) {
  const byDay = Object.fromEntries(days.map(d => [d.day, d]));
  const flagBy = Object.fromEntries(flags.map(f => [f.day, f]));
  const classBy = Object.fromEntries(classDays.map(c => [c.day, c]));
  const cards = weekCards(start, r).map(card => evalCard({
    card,
    rows: card.covers.map(d => byDay[d]).filter(Boolean),
    kid, flag: flagBy[card.date], classDay: classBy[card.date], todayStr,
  }, r));
  const end = addDays(start, 6);
  const inWeek = days.filter(d => d.day >= start && d.day <= end);
  return { cards, ...evalWeek(cards, todayStr, r), weekXp: weekXp(inWeek) };
}

/* ---------- 6. Words for kids --------------------------------------- */
export function todayLine(card, r = RULES) {
  if (!card) return 'No school day today.';
  if (card.noSchool) return 'No school today. Enjoy!';
  const bits = [];
  if (card.xp < r.MIN_XP) bits.push(`${card.toMin} XP to a Minimum day`);
  else if (card.xp < r.EPIC_XP) bits.push(`${card.toEpic} XP to an Epic day`);
  else bits.push(`${card.xp} XP — that's Epic XP!`);
  if (!card.ringsOk && card.openRings.length)
    bits.push('rings still open: ' + card.openRings.map(x => `${x.subject} ${x.left} more`).join(', '));
  else if (card.pass || card.test) bits.push(card.test ? 'test day — rings can stay open' : 'day pass — rings can stay open');
  else if (card.rings.length) bits.push('every ring closed');
  return bits.join(' · ');
}

export function tierLabel(t) {
  return t === 'epic' ? 'Epic' : t === 'minimum' ? 'Minimum' : 'Not yet';
}

/* ---------- 7. Kid page lock ---------------------------------------- */
export function lockedNow(now = new Date(), r = RULES) {
  const d = now.getDay();
  if (d === 0 || d === 6) return null;
  const mins = now.getHours() * 60 + now.getMinutes();
  const hm = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const block = r.CORE_SKILLS_LOCK.find(([a, b]) => mins >= hm(a) && mins < hm(b));
  return block ? block[1] : null;
}

/* ---------- 8. Small helpers ---------------------------------------- */
export const esc = s => String(s ?? '').replace(/[&<>"']/g,
  ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
export const pct = a => (a === null || a === undefined) ? '—' : Math.round(a * 100) + '%';
export const kidName = k => k.display_name || (k.timeback_name || '').split(' ')[0] || 'Kid';

/* ---------- 9. Supabase connection (kept out of the code) ----------- */
const CFG_KEY = 'mojo-dojo:supabase:v1';

export function getConfig() {
  // A guide's connect link (#connect=…) saves the connection, then is wiped from the address bar.
  try {
    const m = location.hash.match(/connect=([^&]+)/);
    if (m) {
      const c = JSON.parse(atob(decodeURIComponent(m[1])));
      if (c.url && c.key) localStorage.setItem(CFG_KEY, JSON.stringify({ url: c.url, key: c.key }));
      history.replaceState(null, '', location.pathname + location.search);
    }
  } catch {}
  try { const c = JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); return c && c.url && c.key ? c : null; }
  catch { return null; }
}

/** Link that connects a kid's browser to Alpha House without typing anything. */
export function connectLink(path = '/house') {
  const c = getConfig(); if (!c) return null;
  return location.origin + path + '#connect=' + encodeURIComponent(btoa(JSON.stringify(c)));
}
export function forgetConfig() { try { localStorage.removeItem(CFG_KEY); } catch {} }

/** Ask for the Supabase URL and public (anon) key once; saves in this browser. */
export function askForConfig(root) {
  return new Promise(resolve => {
    root.innerHTML = `
      <form class="setup" id="cfg">
        <h2>Connect to Supabase</h2>
        <p>Paste your project's URL and its <b>publishable</b> (or <b>anon public</b>) key from Supabase → Project Settings → API Keys.
        They're saved in this browser only, never in the code.</p>
        <label>Project URL<input name="url" required placeholder="https://xxxx.supabase.co"></label>
        <label>Anon public key<input name="key" required autocomplete="off"></label>
        <button class="btn primary">Save</button>
      </form>`;
    root.querySelector('#cfg').addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const url = String(fd.get('url')).trim().replace(/\/+$/, '');
      const key = String(fd.get('key')).trim();
      if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) { alert('That URL should look like https://xxxx.supabase.co'); return; }
      if (/^sb_secret_/.test(key) || /service_role/.test(atobSafe(key.split('.')[1] || ''))) {
        alert('That is the service_role key. Use the anon public key — the service key must never be in a browser.'); return;
      }
      try { localStorage.setItem(CFG_KEY, JSON.stringify({ url, key })); } catch {}
      resolve({ url, key });
    });
  });
}
const atobSafe = s => { try { return atob(s.replace(/-/g, '+').replace(/_/g, '/')); } catch { return ''; } };

let _sb = null;
export async function supa(root) {
  if (_sb) return _sb;
  const cfg = getConfig() || await askForConfig(root);
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  _sb = createClient(cfg.url, cfg.key, { auth: { persistSession: true, detectSessionInUrl: true } });
  return _sb;
}

export async function signIn(sb) {
  await sb.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: location.origin + location.pathname,
      queryParams: { hd: 'alpha.school', prompt: 'select_account' },
    },
  });
}

/** Signed-in session, or null. */
export async function session(sb) {
  const { data } = await sb.auth.getSession();
  return data.session;
}

export async function isGuide(sb) {
  const { data, error } = await sb.rpc('townhall_is_guide');
  return !error && data === true;
}

/** Everything the guide screens need for one week. */
export async function loadWeek(sb, start) {
  const end = addDays(start, 6);
  const [kids, days, flags, classDays, sync, settings] = await Promise.all([
    sb.from('kids').select('*').eq('active', true),
    sb.from('days').select('*').gte('day', start).lte('day', end),
    sb.from('day_flags').select('*').gte('day', start).lte('day', end),
    sb.from('class_days').select('*').gte('day', start).lte('day', end),
    sb.from('sync_log').select('*').order('ran_at', { ascending: false }).limit(1),
    sb.from('settings').select('*'),
  ]);
  for (const r of [kids, days, flags, classDays, sync, settings]) if (r.error) throw r.error;
  return {
    kids: kids.data, days: days.data, flags: flags.data, classDays: classDays.data,
    lastSync: sync.data[0] || null,
    settings: Object.fromEntries(settings.data.map(s => [s.key, s.value])),
  };
}

/** Sign-in gate shared by the three pages. */
export function signInCard(root, sb, message) {
  root.innerHTML = `
    <div class="setup">
      <h2>Sign in</h2>
      <p>${esc(message || 'Use your Alpha School Google account.')}</p>
      <button class="btn primary" id="go">Sign in with Google</button>
    </div>`;
  root.querySelector('#go').onclick = () => signIn(sb);
}
