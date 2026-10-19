/* Mojo Dojo — shared drawing for the guide board and the kid page.
   Rules come from app.js; this file only turns results into HTML. */
import { esc, pct, tierLabel, shortDay, SHORT, RULES } from './app.js';

export const ICON = {
  time: `<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 4.5V8l2.5 1.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  acc: `<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8" cy="8" r="1" fill="currentColor"/></svg>`,
  star: `<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l1.9 4.1 4.4.5-3.3 3 1 4.4L8 11.3 4 13.5l1-4.4-3.3-3 4.4-.5z" fill="currentColor"/></svg>`,
};

export const ringDots = rings => rings.length
  ? `<span class="rings" title="${rings.filter(r => r.closed).length} of ${rings.length} rings closed">` +
    rings.map(r => `<span class="ring${r.closed ? ' on' : ''}" title="${esc(r.subject)}"></span>`).join('') + '</span>'
  : '';

/** One day card. `asButton` false for future/no-school days. */
export function cardHtml(c, { kidId = '', compact = false } = {}) {
  const cls = ['cell', c.phase, c.phase === 'future' || c.noSchool ? '' : c.tier, c.excused ? 'excused' : ''].join(' ');
  if (c.noSchool) return `<div class="${cls}"><span class="tier">No school</span></div>`;
  if (c.phase === 'future') return `<div class="${cls}" aria-label="${esc(shortDay(c.date))}, not yet"></div>`;
  const tags = [
    c.pass && '<span class="tag">Pass</span>',
    c.test && '<span class="tag">Test</span>',
    c.excused && '<span class="tag">Excused</span>',
    c.callTime && `<span class="tag call">Call ${esc(c.callTime)}</span>`,
    ...c.appsOut.map(s => `<span class="tag">−${esc(SHORT[s] || s)}</span>`),
  ].filter(Boolean).join('');
  const label = `${shortDay(c.date)}: ${c.xp} XP, ${tierLabel(c.tier)}`;
  return `<button class="${cls}" data-kid="${esc(kidId)}" data-day="${c.date}" aria-label="${esc(label)}">
    <span class="row1"><span class="xp">${c.xp}</span><span class="tier">${c.phase === 'today' && c.tier === 'notyet' ? 'Today' : tierLabel(c.tier)}</span></span>
    ${ringDots(c.rings)}
    <span class="icons">${c.timeIcon ? ICON.time : ''}${c.accIcon ? ICON.acc : ''}</span>
    ${compact || !tags ? '' : `<span class="tags">${tags}</span>`}
  </button>`;
}

/** Read-only details of a day (kid page, and the top of the guide dialog). */
export function dayDetailHtml(c, title) {
  const rings = c.rings.length ? c.rings.map(r => `
    <div class="ringrow ${r.closed ? 'closed' : ''}">
      <span>${esc(r.subject)}<br><span class="meta">${r.xp} of ${r.goal} XP${r.closed ? ' · closed' : ` · ${r.left} to go`}</span></span>
      <span></span><span>${r.closed ? '✓' : ''}</span>
    </div>`).join('') : '<p class="sub">No rings count this day.</p>';
  const notes = [
    c.pass && 'Day pass: rings could stay open.',
    c.test && (c.autoTest ? 'Test taken in Timeback: rings could stay open.' : 'Test day: rings could stay open.'),
    c.excused && 'Excused: left out of the smoothie and Fun Friday count.',
    c.appsOut.length && `App out: ${c.appsOut.join(', ')}.`,
    c.covers.length > 1 && 'Includes weekend work.',
  ].filter(Boolean);
  return `
    <h3>${esc(title)}</h3>
    <p class="sub">${esc(shortDay(c.date))} · ${c.tier === 'notyet' ? 'Not yet' : tierLabel(c.tier) + ' day'}${c.funDay ? ' · Fun Friday accuracy ✓' : ''}</p>
    <div class="stats">
      <div class="stat"><b>${c.xp}</b><span>XP</span></div>
      <div class="stat"><b>${c.minutes}</b><span>Minutes${c.timeIcon ? ' ✓' : ''}</span></div>
      <div class="stat"><b>${pct(c.accuracy)}</b><span>Accuracy${c.accIcon ? ' ✓' : ''}</span></div>
    </div>
    <div class="ringlist">${rings}</div>
    ${notes.length ? `<p class="sub">${notes.map(esc).join(' ')}</p>` : ''}`;
}

/** Weekly column tiles. */
export function smoothieHtml(w) {
  const s = w.smoothie;
  const cls = s.status === 'won' ? 'won' : s.status === 'out' ? 'out' : '';
  return `<div class="wk ${cls}"><span class="big">${s.epic}/${s.counted}</span>
    <span class="small">${s.status === 'won' ? 'Smoothie!' : s.status === 'out' ? 'not this week' : 'Epic days'}</span></div>`;
}
export function funFridayHtml(w) {
  const f = w.funFriday;
  const cls = f.status === 'won' ? 'won' : f.status === 'out' ? 'out' : '';
  return `<div class="wk ${cls}"><span class="big">${f.qualifying}/${f.needed}</span>
    <span class="small">${f.status === 'won' ? 'Fun Friday!' : f.status === 'out' ? 'not this week' : 'days >80%'}</span></div>`;
}
export function weekXpHtml(w) {
  const p = Math.min(100, Math.round(w.weekXp / RULES.PIZZA_WEEK_XP * 100));
  const won = w.weekXp >= RULES.PIZZA_WEEK_XP;
  return `<div class="wk ${won ? 'won' : ''}"><span class="big">${w.weekXp}</span>
    <span class="bar"><i style="width:${p}%"></i></span>
    <span class="small">${won ? 'pizza line ✓' : `${RULES.PIZZA_WEEK_XP - w.weekXp} to ${RULES.PIZZA_WEEK_XP}`}</span></div>`;
}

export function toast(msg, ms = 3000) {
  const el = document.createElement('div');
  el.className = 'toast'; el.setAttribute('role', 'status'); el.textContent = msg;
  document.body.appendChild(el); setTimeout(() => el.remove(), ms);
}
