import express from 'express';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dir, 'data.json');
const ADMIN_KEY = process.env.ADMIN_KEY || 'changeme';

// FIFA World Cup on TheSportsDB (free test key "123", no paid API).
const API = 'https://www.thesportsdb.com/api/v1/json/123';
// All three group matchdays give the full 72-game group schedule (incl. future
// games); past/next league sweeps catch knockout games the moment they're added.
const SOURCES = [
  `${API}/eventsround.php?id=4429&r=1&s=2026`,
  `${API}/eventsround.php?id=4429&r=2&s=2026`,
  `${API}/eventsround.php?id=4429&r=3&s=2026`,
  `${API}/eventspastleague.php?id=4429`,
  `${API}/eventsnextleague.php?id=4429`,
];
const REFRESH_MS = 60_000; // pull fresh scores every minute

// The knockout fixtures aren't published by the free feed until teams are known.
// We show every game anyway as "to be decided" placeholders, using the official
// 2026 schedule. Each is replaced automatically once the real game appears.
const KNOCKOUT_SKELETON = [
  { stage: 'Round of 32', count: 16, start: '2026-06-28' },
  { stage: 'Round of 16', count: 8, start: '2026-07-04' },
  { stage: 'Quarter-final', count: 4, start: '2026-07-09' },
  { stage: 'Semi-final', count: 2, start: '2026-07-14' },
  { stage: 'Third place', count: 1, start: '2026-07-18' },
  { stage: 'Final', count: 1, start: '2026-07-19' },
];

// ---- Scoring model ----------------------------------------------------------
// GROUP STAGE: per match — win 3, draw 1, loss 0.
// KNOCKOUT: a bonus that stacks for every round a team reaches.
const KNOCK_AWARD = { r32: 3, r16: 4, qf: 5, sf: 6, final: 7, champ: 8 };
const KNOCK_ORDER = ['r32', 'r16', 'qf', 'sf', 'final', 'champ'];
const KNOCK_LABEL = { r32: 'Round of 32', r16: 'Round of 16', qf: 'Quarter-final', sf: 'Semi-final', final: 'Final', champ: 'Champion' };

function knockoutPoints(reachedKey) {
  if (!reachedKey) return 0;
  let total = 0;
  for (const k of KNOCK_ORDER) {
    total += KNOCK_AWARD[k];
    if (k === reachedKey) break;
  }
  return total;
}

// TheSportsDB intRound: 1/2/3 = group matchdays. Anything else = knockout.
// These codes are best-effort and easy to adjust once knockouts begin.
const ROUND_MAP = { '125': 'final', '126': 'sf', '127': 'qf', '128': 'r16', '129': 'r32' };
function classifyRound(intRound) {
  const r = String(intRound);
  if (r === '1' || r === '2' || r === '3') return { group: true };
  return { group: false, key: ROUND_MAP[r] || 'r32' };
}

// ---- Family picks (from the sheet) -----------------------------------------
const SEED = {
  Charlie: ['Morocco', 'Senegal', 'Australia', 'Iraq', 'Turkey', 'Switzerland', 'England', 'Mexico'],
  Aarsh:   ['Paraguay', 'Japan', "Cote d'Ivoire", 'Haiti', 'New Zealand', 'Tunisia', 'Brazil', 'Argentina'],
  Devon:   ['Croatia', 'South Korea', 'Ghana', 'Austria', 'Colombia', 'Ecuador', 'USA', 'France'],
  Dad:     ['Bosnia', 'Algeria', 'Qatar', 'Uzbekistan', 'Jordan', 'South Africa', 'Belgium', 'Netherlands'],
  Sam:     ['Congo', 'Curacao', 'Sweden', 'Saudi Arabia', 'Uruguay', 'Norway', 'Portugal', 'Germany'],
  Mum:     ['Cape Verde', 'Egypt', 'Iran', 'Czech Republic', 'Panama', 'Scotland', 'Spain', 'Canada'],
};

// Normalise a team name so API spellings match the family sheet.
function norm(name) {
  return String(name)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z]/g, '');
}
const ALIAS = {
  bosniaherzegovina: 'Bosnia',
  ivorycoast: "Cote d'Ivoire",
  holland: 'Netherlands',
  korearepublic: 'South Korea',
  unitedstates: 'USA',
  czechia: 'Czech Republic',
  turkiye: 'Turkey',
  caboverde: 'Cape Verde',
  drcongo: 'Congo', congodr: 'Congo',
};
// Build normalised-name -> { owner, canonical } index.
const TEAM_INDEX = {};
for (const [owner, teams] of Object.entries(SEED)) {
  for (const t of teams) TEAM_INDEX[norm(t)] = { owner, canonical: t };
}
function resolveTeam(apiName) {
  const n = norm(apiName);
  if (TEAM_INDEX[n]) return TEAM_INDEX[n];
  if (ALIAS[n]) return TEAM_INDEX[norm(ALIAS[n])];
  return null; // not a family-owned team
}

// ---- Manual knockout overrides (safety net) --------------------------------
function loadOverrides() {
  if (existsSync(DATA_FILE)) return JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  return { overrides: {} };
}
let STORE = loadOverrides();
function saveOverrides() { writeFileSync(DATA_FILE, JSON.stringify(STORE, null, 2)); }

// ---- Live data cache --------------------------------------------------------
let cache = { events: [], fetchedAt: null, ok: false, note: 'starting up' };

async function refresh() {
  try {
    const results = await Promise.all(SOURCES.map(async url => {
      try { const j = await (await fetch(url)).json(); return Array.isArray(j.events) ? j.events : []; }
      catch { return []; }
    }));
    const byId = new Map();
    for (const ev of results.flat()) if (ev && ev.idEvent) byId.set(ev.idEvent, ev);
    if (byId.size) {
      cache = { events: [...byId.values()], fetchedAt: new Date().toISOString(), ok: true, note: 'live' };
    } else {
      cache = { events: cache.events, fetchedAt: new Date().toISOString(), ok: true, note: 'no fixtures published yet' };
    }
  } catch (err) {
    cache.note = 'using last good data (' + err.message + ')';
  }
}
refresh();
setInterval(refresh, REFRESH_MS);

// ---- Helpers ----------------------------------------------------------------
const nzDate = new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', weekday: 'short', day: 'numeric', month: 'short' });
const nzTime = new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', hour: '2-digit', minute: '2-digit', hour12: true });
const nzKey  = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit' });

function hasScore(e) { return e.intHomeScore !== null && e.intHomeScore !== '' && e.intAwayScore !== null && e.intAwayScore !== ''; }
function utcDate(e) { return new Date(e.strTimestamp + 'Z'); }

function placeholderMatches(realStages) {
  const out = [];
  for (const s of KNOCKOUT_SKELETON) {
    if (realStages.has(s.stage)) continue; // real games exist for this round
    for (let i = 0; i < s.count; i++) {
      const d = new Date(s.start + 'T12:00:00Z');
      d.setUTCHours(d.getUTCHours() + i);
      out.push({
        id: `tbd-${s.stage}-${i}`,
        utc: d.toISOString(),
        nzDateKey: nzKey.format(d), nzDate: nzDate.format(d), nzTime: '',
        home: 'To be decided', away: 'To be decided',
        homeOwner: null, awayOwner: null, homeScore: null, awayScore: null,
        finished: false, status: 'TBD', stage: s.stage, isGroup: false, placeholder: true,
      });
    }
  }
  return out;
}

function normalisedMatches() {
  const real = cache.events
    .map(e => {
      const d = utcDate(e);
      const home = resolveTeam(e.strHomeTeam);
      const away = resolveTeam(e.strAwayTeam);
      const round = classifyRound(e.intRound);
      return {
        id: e.idEvent,
        utc: d.toISOString(),
        nzDateKey: nzKey.format(d),
        nzDate: nzDate.format(d),
        nzTime: nzTime.format(d),
        home: e.strHomeTeam, away: e.strAwayTeam,
        homeOwner: home?.owner || null, awayOwner: away?.owner || null,
        homeScore: hasScore(e) ? Number(e.intHomeScore) : null,
        awayScore: hasScore(e) ? Number(e.intAwayScore) : null,
        finished: e.strStatus === 'FT' || (hasScore(e) && e.strStatus !== 'NS'),
        status: e.strStatus,
        stage: round.group ? 'Group' : (KNOCK_LABEL[round.key] || 'Knockout'),
        isGroup: round.group,
        placeholder: false,
      };
    });
  const realStages = new Set(real.filter(m => !m.isGroup).map(m => m.stage));
  return real.concat(placeholderMatches(realStages))
    .sort((a, b) => a.utc.localeCompare(b.utc));
}

function buildStandings() {
  // Seed every owner/team at zero.
  const owners = {};
  const teams = {}; // canonical -> record
  for (const [owner, list] of Object.entries(SEED)) {
    owners[owner] = { owner, groupPts: 0, knockPts: 0, points: 0, w: 0, d: 0, l: 0, teams: [] };
    for (const t of list) {
      teams[t] = { name: t, owner, groupPts: 0, played: 0, w: 0, d: 0, l: 0, knock: null, eliminated: false };
    }
  }

  for (const e of cache.events) {
    if (!hasScore(e)) continue;
    const round = classifyRound(e.intRound);
    const home = resolveTeam(e.strHomeTeam);
    const away = resolveTeam(e.strAwayTeam);
    const hs = Number(e.intHomeScore), as = Number(e.intAwayScore);

    if (round.group) {
      if (home) {
        const t = teams[home.canonical]; t.played++;
        if (hs > as) { t.w++; t.groupPts += 3; } else if (hs === as) { t.d++; t.groupPts += 1; } else { t.l++; }
      }
      if (away) {
        const t = teams[away.canonical]; t.played++;
        if (as > hs) { t.w++; t.groupPts += 3; } else if (as === hs) { t.d++; t.groupPts += 1; } else { t.l++; }
      }
    } else {
      // Knockout: both teams reached this round; loser is eliminated.
      const stageIdx = KNOCK_ORDER.indexOf(round.key);
      const bump = (rec, won) => {
        if (!rec) return;
        const cur = KNOCK_ORDER.indexOf(rec.knock);
        if (stageIdx > cur) rec.knock = round.key;
        if (round.key === 'final' && won) rec.knock = 'champ';
        if (!won) rec.eliminated = true;
      };
      bump(home && teams[home.canonical], hs > as);
      bump(away && teams[away.canonical], as > hs);
    }
  }

  // Apply manual overrides (knockout stage reached) if present.
  for (const [name, key] of Object.entries(STORE.overrides || {})) {
    if (teams[name] && key) teams[name].knock = key;
  }

  // Totals.
  for (const t of Object.values(teams)) {
    const kp = knockoutPoints(t.knock);
    const total = t.groupPts + kp;
    const o = owners[t.owner];
    o.groupPts += t.groupPts; o.knockPts += kp; o.points += total;
    o.w += t.w; o.d += t.d; o.l += t.l;
    o.teams.push({
      name: t.name, points: total, groupPts: t.groupPts, knockPts: kp,
      played: t.played, record: `${t.w}W ${t.d}D ${t.l}L`,
      stageLabel: t.knock ? KNOCK_LABEL[t.knock] : 'Group stage',
      eliminated: t.eliminated,
    });
  }
  const table = Object.values(owners).sort((a, b) => b.points - a.points);
  for (const o of table) o.teams.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  return { table, source: cache, scoring: { knockout: KNOCK_AWARD, order: KNOCK_ORDER, label: KNOCK_LABEL } };
}

// ---- Routes -----------------------------------------------------------------
const app = express();
app.use(express.json());
app.use(express.static(join(__dir, 'public')));

app.get('/api/standings', (_, res) => res.json(buildStandings()));
app.get('/api/matches', (_, res) => res.json({ matches: normalisedMatches(), source: cache }));

// Manual knockout override (safety net while round codes settle).
app.post('/api/admin/override', (req, res) => {
  if (req.get('x-admin-key') !== ADMIN_KEY) return res.status(401).json({ error: 'Bad admin key' });
  const { team, stage } = req.body;
  if (!team) return res.status(400).json({ error: 'team required' });
  STORE.overrides = STORE.overrides || {};
  if (!stage) delete STORE.overrides[team]; else STORE.overrides[team] = stage;
  saveOverrides();
  res.json({ ok: true, overrides: STORE.overrides });
});

app.get('/api/teams', (_, res) => {
  const teams = [];
  for (const [owner, list] of Object.entries(SEED)) for (const name of list) teams.push({ name, owner });
  teams.sort((a, b) => a.name.localeCompare(b.name));
  res.json({ teams, stages: KNOCK_ORDER.map(k => ({ key: k, label: KNOCK_LABEL[k] })), overrides: STORE.overrides || {} });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`World Cup sweepstake running at http://localhost:${PORT}`));
