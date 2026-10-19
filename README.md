# Mojo Dojo — my class version

Plain HTML/JS, no build step. Three screens share one rules file:

| Path | Who | What |
|---|---|---|
| `/mojo` | guides | weekly board on the projector, day marks, sync, settings |
| `/house` | kids | their own week and rewards, read-only, locked during Core Skills |
| `/house/guide` | guides | who can sign in (emails), focus lines, fun facts, kid sign-in link |

```
supabase/schema.sql   tables, row-level security, townhall_is_guide, mojo_sync, house_card
mojo/app.js           ALL scoring rules + Supabase connection helpers (the one rules file)
mojo/ui.js            card drawing shared by board and kid page
mojo/sync.js          Timeback sync, runs in a signed-in Timeback tab
mojo/mojo.css         shared Alpha-brand styles
tests/rules.test.mjs  rules tests with made-up data  (npm test)
```

## My class's rules (in `mojo/app.js` → `RULES`)

- **Epic** 145+ XP, **Minimum** 120–144 XP — both need every ring closed (Day pass / Test day lets rings stay open).
- **Week** Friday → Thursday; Saturday and Sunday work counts toward Friday.
- **Smoothie** every counted day Epic; excused and no-school days aren't counted.
- **Fun Friday** 4 of 5 days with accuracy *above* 80% in each subject worked that day; subjects not worked are skipped. Short weeks allow the same one miss (4 counted days → 3 needed).
- **Pizza** every kid on the board reaches 600 XP in the week.

## Setup (nothing here is done yet)

1. **Create a Supabase project.** SQL Editor → paste `supabase/schema.sql` → Run.
2. **Turn on Google sign-in.** Authentication → Providers → Google (needs a Google OAuth client). Under Authentication → URL Configuration add the site URL and redirect URLs for `/mojo`, `/house` and `/house/guide`.
3. **Add guides** in the SQL editor (lowercase email):
   `insert into guides(email) values ('you@alpha.school');`
4. **Host the folder** at the root of a domain (Vercel, Netlify or GitHub Pages; no build settings). Paths are absolute, so it must sit at `/`.
5. **Open `/mojo`**, paste the Project URL and the **anon public** key (Project Settings → API). They're saved in that browser only. Never use the service_role key; the page refuses it.
6. **First sync.** Press **Sync** (allow pop-ups) → Timeback opens. ⚙ → drag **Mojo sync** to the bookmarks bar, then click it in the Timeback tab. It finds the class whose title contains the text in ⚙ (starts as `L1`); if more than one matches it asks once.
7. **Kids list.** `/house/guide` → add or check each kid's school email → **Copy kid sign-in link** and put it on the L1 Links board. Kids open it once per device and sign in with their own Google account.

## Daily

Sync in the morning (and whenever you want fresher numbers). Mark no-school days by tapping a day heading; tap a kid's day for Day pass, Test day, Excused, App out, or a coaching call.

## Safety

- No student names, emails, tokens or keys are in any file. Names and emails come from Timeback through `mojo_sync` or are typed on `/house/guide`, and live only in Supabase.
- Kids have no table access at all. `house_card` returns only the signed-in kid's own data, plus classmates' week XP as bare numbers for the Pizza bar.
- The sync script never touches Supabase. It hands data to the board tab that opened it, which saves with the guide's sign-in. The first time, it asks which board address to trust.

## Things to check on the first real sync

- Timeback's metric field names for questions, correct answers and active minutes are read from a few likely names. Open DevTools in the Timeback tab: the sync logs `metric fields seen`. If accuracy or minutes show 0, tell Claude what it printed.
- Test days come from Timeback's assigned-tests list (finished tests, by date). If a test day isn't picked up, mark it with **Test day**.
