// Run with: node tests/rules.test.mjs   (made-up sample data only)
import assert from 'node:assert/strict';
import { RULES, weekStartOf, weekCards, buildKidWeek, pizzaStatus, funFridayDay, allSubjectsAccuracy,
  lockedNow, todayLine } from '../mojo/app.js';

const kid = { rings_off: [], language_with_reading: false, open_subjects: ['Math', 'Reading'],
  goals: { Math: 60, Reading: 60 } };
const sub = (mxp, rxp, q = 20, c = 18) => ({
  Math: { xp: mxp, questions: q, correct: c, minutes: 30 },
  Reading: { xp: rxp, questions: q, correct: c, minutes: 30 } });
const row = (day, s, tests = 0) => ({ day, subjects: s, goals: kid.goals, tests });

// Week starts Friday; Oct 18 2026 is a Sunday → week of Fri Oct 16
assert.equal(weekStartOf('2026-10-18'), '2026-10-16');
assert.equal(weekStartOf('2026-10-22'), '2026-10-16');   // Thursday
assert.equal(weekStartOf('2026-10-23'), '2026-10-23');   // Friday
const cards = weekCards('2026-10-16');
assert.deepEqual(cards.map(c => c.date), ['2026-10-16', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22']);
assert.deepEqual(cards[0].covers, ['2026-10-16', '2026-10-17', '2026-10-18']);

// All-Epic week, viewed after Thursday
const start = '2026-10-16';
const epicDays = ['2026-10-16', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'].map(d => row(d, sub(80, 70)));
let w = buildKidWeek({ kid, days: epicDays, flags: [], classDays: [], start, todayStr: '2026-10-23' });
assert.deepEqual(w.cards.map(c => c.tier), ['epic', 'epic', 'epic', 'epic', 'epic']);
assert.equal(w.smoothie.status, 'won');
assert.equal(w.funFriday.status, 'won');          // 90% accuracy every day
assert.equal(w.weekXp, 750);

// Weekend XP counts toward Friday: Fri 100 + Sat 50 = 150 → Epic
w = buildKidWeek({ kid, days: [row('2026-10-16', sub(50, 50)), row('2026-10-17', sub(30, 20))],
  flags: [], classDays: [], start, todayStr: '2026-10-19' });
assert.equal(w.cards[0].xp, 150);
assert.equal(w.cards[0].tier, 'epic');

// 150 XP but Reading ring open → Not yet; Day pass → Epic
const open = [row('2026-10-19', sub(120, 30))];
w = buildKidWeek({ kid, days: open, flags: [], classDays: [], start, todayStr: '2026-10-20' });
assert.equal(w.cards[1].tier, 'notyet');
assert.equal(w.smoothie.status, 'out');
w = buildKidWeek({ kid, days: open, flags: [{ day: '2026-10-19', pass: true }], classDays: [], start, todayStr: '2026-10-20' });
assert.equal(w.cards[1].tier, 'epic');
// Timeback test on the day waives rings on its own
w = buildKidWeek({ kid, days: [row('2026-10-19', sub(120, 30), 1)], flags: [], classDays: [], start, todayStr: '2026-10-20' });
assert.equal(w.cards[1].tier, 'epic');
assert.equal(w.cards[1].autoTest, true);
// App out removes the Reading ring
w = buildKidWeek({ kid, days: open, flags: [{ day: '2026-10-19', apps_out: ['Reading'] }], classDays: [], start, todayStr: '2026-10-20' });
assert.equal(w.cards[1].tier, 'epic');

// Minimum band
w = buildKidWeek({ kid, days: [row('2026-10-19', sub(65, 65))], flags: [], classDays: [], start, todayStr: '2026-10-20' });
assert.equal(w.cards[1].tier, 'minimum');

// Smoothie skips excused and no-school days
const four = epicDays.filter(d => d.day !== '2026-10-20');
w = buildKidWeek({ kid, days: four, flags: [{ day: '2026-10-20', excused: true }], classDays: [], start, todayStr: '2026-10-23' });
assert.equal(w.smoothie.status, 'won');
assert.equal(w.smoothie.counted, 4);
w = buildKidWeek({ kid, days: four, flags: [], classDays: [{ day: '2026-10-20', no_school: true }], start, todayStr: '2026-10-23' });
assert.equal(w.smoothie.status, 'won');
w = buildKidWeek({ kid, days: four, flags: [], classDays: [], start, todayStr: '2026-10-23' });
assert.equal(w.smoothie.status, 'out');          // a plain missed day breaks it

// Mid-week: today not Epic yet is still alive
w = buildKidWeek({ kid, days: [epicDays[0], row('2026-10-19', sub(10, 10))], flags: [], classDays: [], start, todayStr: '2026-10-19' });
assert.equal(w.smoothie.status, 'alive');

// Fun Friday: All Subjects ring = AVERAGE of each subject's accuracy, ABOVE 80%
assert.equal(funFridayDay({ Math: { questions: 10, correct: 9 }, Reading: { questions: 0, correct: 0 } }), true); // unworked left out → 90%
assert.equal(funFridayDay({ Math: { questions: 10, correct: 8 } }), false);   // exactly 80% isn't above
// (90% + 70%) / 2 = 80% → not above
assert.equal(funFridayDay({ Math: { questions: 10, correct: 9 }, Reading: { questions: 10, correct: 7 } }), false);
// each subject counts equally, however many questions: Math 100% (2 Qs) + Reading 75% (40 Qs) → 87.5% ✓
// (adding questions together would give 32/42 = 76% ✗)
assert.equal(funFridayDay({ Math: { questions: 2, correct: 2 }, Reading: { questions: 40, correct: 30 } }), true);
// and the reverse: Math 96.7% (30 Qs) + Reading 60% (10 Qs) → 78.3% ✗  (added together would be 87.5%)
assert.equal(funFridayDay({ Math: { questions: 30, correct: 29 }, Reading: { questions: 10, correct: 6 } }), false);
assert.equal(Math.round(allSubjectsAccuracy({ A: { questions: 4, correct: 4 }, B: { questions: 10, correct: 7 }, C: { questions: 5, correct: 4 } }) * 1000), 833);
assert.equal(funFridayDay({}), false);
// 4 of 5 qualifying → won; 3 of 5 → out
const ff = (good) => ['2026-10-16', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22']
  .map((d, i) => row(d, i < good ? sub(80, 70, 10, 9) : sub(80, 70, 10, 7)));
assert.equal(buildKidWeek({ kid, days: ff(4), flags: [], classDays: [], start, todayStr: '2026-10-23' }).funFriday.status, 'won');
assert.equal(buildKidWeek({ kid, days: ff(3), flags: [], classDays: [], start, todayStr: '2026-10-23' }).funFriday.status, 'out');
// Short week: 4 counted days → 3 needed
w = buildKidWeek({ kid, days: ff(3), flags: [], classDays: [{ day: '2026-10-22', no_school: true }], start, todayStr: '2026-10-23' });
assert.equal(w.funFriday.needed, 3);
assert.equal(w.funFriday.status, 'won');

// Pizza: everyone ≥ 600
assert.equal(pizzaStatus([600, 700, 650]).won, true);
assert.equal(pizzaStatus([600, 599]).won, false);
assert.equal(pizzaStatus([600, 520]).lowestToGo, 80);

// Kid page lock
assert.equal(lockedNow(new Date(2026, 9, 19, 9, 30)), '10:10');
assert.equal(lockedNow(new Date(2026, 9, 19, 10, 15)), null);
assert.equal(lockedNow(new Date(2026, 9, 18, 9, 30)), null);   // Sunday

// Kid words
w = buildKidWeek({ kid, days: [row('2026-10-19', sub(60, 40))], flags: [], classDays: [], start, todayStr: '2026-10-19' });
assert.match(todayLine(w.cards[1]), /20 XP to a Minimum day.*Reading 20 more/);

assert.equal(RULES.EPIC_XP, 145);
console.log('all rules tests passed');
