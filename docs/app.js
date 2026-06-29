// ============================================================================
// Family World Cup 2026 — fully client-side (deployable to GitHub Pages).
// Pulls live scores straight from the free TheSportsDB API (CORS-enabled) and
// works out the standings in the browser. No backend needed.
// ============================================================================

const API = 'https://www.thesportsdb.com/api/v1/json/123';
const SOURCES = [
  // Group matchdays
  `${API}/eventsround.php?id=4429&r=1&s=2026`,
  `${API}/eventsround.php?id=4429&r=2&s=2026`,
  `${API}/eventsround.php?id=4429&r=3&s=2026`,
  // Knockout rounds — this feed numbers them round-of-N (32, 16, 8, 4).
  // Fetched directly so every game loads (the past/next windows only return a
  // couple at a time, which was hiding most of the Round of 32).
  `${API}/eventsround.php?id=4429&r=32&s=2026`,
  `${API}/eventsround.php?id=4429&r=16&s=2026`,
  `${API}/eventsround.php?id=4429&r=8&s=2026`,
  `${API}/eventsround.php?id=4429&r=4&s=2026`,
  `${API}/eventspastleague.php?id=4429`,
  `${API}/eventsnextleague.php?id=4429`,
];

// ---- Scoring ----
const KNOCK_AWARD = { r32: 1, r16: 3, qf: 4, sf: 5, final: 6, champ: 7 };
const KNOCK_ORDER = ['r32', 'r16', 'qf', 'sf', 'final', 'champ'];
const KNOCK_LABEL = { r32: 'Round of 32', r16: 'Round of 16', qf: 'Quarter-final', sf: 'Semi-final', final: 'Final', champ: 'Champion' };
function knockoutPoints(key) { if (!key) return 0; let t = 0; for (const k of KNOCK_ORDER) { t += KNOCK_AWARD[k]; if (k === key) break; } return t; }

// This feed numbers knockout rounds by teams remaining (32/16/8/4); the 125–129
// codes are kept as a fallback for other seasons. Final/3rd-place codes will be
// added once that round is published by the feed.
const ROUND_MAP = { '32': 'r32', '16': 'r16', '8': 'qf', '4': 'sf', '125': 'final', '126': 'sf', '127': 'qf', '128': 'r16', '129': 'r32' };
function classifyRound(r) { r = String(r); if (r === '1' || r === '2' || r === '3') return { group: true }; return { group: false, key: ROUND_MAP[r] || 'r32' }; }

const KNOCKOUT_SKELETON = [
  { stage: 'Round of 32', count: 16, start: '2026-06-28' },
  { stage: 'Round of 16', count: 8, start: '2026-07-04' },
  { stage: 'Quarter-final', count: 4, start: '2026-07-09' },
  { stage: 'Semi-final', count: 2, start: '2026-07-14' },
  { stage: 'Third place', count: 1, start: '2026-07-18' },
  { stage: 'Final', count: 1, start: '2026-07-19' },
];

// ---- Family picks ----
const SEED = {
  Charlie: ['Morocco', 'Senegal', 'Australia', 'Iraq', 'Turkey', 'Switzerland', 'England', 'Mexico'],
  Aarsh:   ['Paraguay', 'Japan', "Cote d'Ivoire", 'Haiti', 'New Zealand', 'Tunisia', 'Brazil', 'Argentina'],
  Devon:   ['Croatia', 'South Korea', 'Ghana', 'Austria', 'Colombia', 'Ecuador', 'USA', 'France'],
  Dad:     ['Bosnia', 'Algeria', 'Qatar', 'Uzbekistan', 'Jordan', 'South Africa', 'Belgium', 'Netherlands'],
  Sam:     ['Congo', 'Curacao', 'Sweden', 'Saudi Arabia', 'Uruguay', 'Norway', 'Portugal', 'Germany'],
  Mum:     ['Cape Verde', 'Egypt', 'Iran', 'Czech Republic', 'Panama', 'Scotland', 'Spain', 'Canada'],
};
function norm(n) { return String(n).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, ''); }
const ALIAS = { bosniaherzegovina: 'Bosnia', ivorycoast: "Cote d'Ivoire", holland: 'Netherlands', korearepublic: 'South Korea', unitedstates: 'USA', czechia: 'Czech Republic', turkiye: 'Turkey', caboverde: 'Cape Verde', drcongo: 'Congo', congodr: 'Congo' };
const TEAM_INDEX = {};
for (const [owner, list] of Object.entries(SEED)) for (const t of list) TEAM_INDEX[norm(t)] = { owner, canonical: t };
function resolveTeam(name) { const n = norm(name); if (TEAM_INDEX[n]) return TEAM_INDEX[n]; if (ALIAS[n]) return TEAM_INDEX[norm(ALIAS[n])]; return null; }

// ---- NZ time formatters ----
const nzDate = new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', weekday: 'short', day: 'numeric', month: 'short' });
const nzTime = new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', hour: '2-digit', minute: '2-digit', hour12: true });
const nzKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit' });

// ---- Data ----
let EVENTS = [];
let fetchedAt = null;

async function refresh() {
  const results = await Promise.all(SOURCES.map(async u => {
    try { const j = await (await fetch(u)).json(); return Array.isArray(j.events) ? j.events : []; }
    catch { return []; }
  }));
  const byId = new Map();
  for (const e of results.flat()) if (e && e.idEvent) byId.set(e.idEvent, e);
  if (byId.size) { EVENTS = [...byId.values()]; fetchedAt = new Date(); }
}

const hasScore = e => e.intHomeScore !== null && e.intHomeScore !== '' && e.intAwayScore !== null && e.intAwayScore !== '';
const utcDate = e => new Date(e.strTimestamp + 'Z');

function buildStandings() {
  const owners = {}, teams = {};
  for (const [owner, list] of Object.entries(SEED)) {
    owners[owner] = { owner, groupPts: 0, knockPts: 0, points: 0, w: 0, d: 0, l: 0, teams: [] };
    for (const t of list) teams[t] = { name: t, owner, groupPts: 0, played: 0, w: 0, d: 0, l: 0, knock: null, eliminated: false, eliminatedAt: null };
  }
  for (const e of EVENTS) {
    const round = classifyRound(e.intRound);
    const home = resolveTeam(e.strHomeTeam), away = resolveTeam(e.strAwayTeam);
    if (round.group) {
      if (!hasScore(e)) continue;
      const hs = Number(e.intHomeScore), as = Number(e.intAwayScore);
      if (home) { const t = teams[home.canonical]; t.played++; if (hs > as) { t.w++; t.groupPts += 3; } else if (hs === as) { t.d++; t.groupPts += 1; } else t.l++; }
      if (away) { const t = teams[away.canonical]; t.played++; if (as > hs) { t.w++; t.groupPts += 3; } else if (as === hs) { t.d++; t.groupPts += 1; } else t.l++; }
    } else {
      // Appearing in a knockout fixture (even before it's played) means the team
      // reached that round — that's how we award the "out of group" points.
      const idx = KNOCK_ORDER.indexOf(round.key);
      const reach = rec => { if (rec && idx > KNOCK_ORDER.indexOf(rec.knock)) rec.knock = round.key; };
      reach(home && teams[home.canonical]);
      reach(away && teams[away.canonical]);
      if (hasScore(e)) {
        const hs = Number(e.intHomeScore), as = Number(e.intAwayScore);
        if (hs !== as) {
          const winR = hs > as ? home : away, loseR = hs > as ? away : home;
          // Winning a knockout game advances the team to the next round (and so
          // earns that round's bonus) even before the next fixture is published.
          const nextKey = KNOCK_ORDER[KNOCK_ORDER.indexOf(round.key) + 1];
          if (winR && nextKey) { const t = teams[winR.canonical]; if (t && KNOCK_ORDER.indexOf(nextKey) > KNOCK_ORDER.indexOf(t.knock)) t.knock = nextKey; }
          if (loseR) { teams[loseR.canonical].eliminated = true; teams[loseR.canonical].eliminatedAt = round.key; } // lost a knockout
        }
      }
    }
  }
  // Once the knockouts exist, any team that never qualified is out of the group.
  if (EVENTS.some(e => !classifyRound(e.intRound).group)) {
    for (const t of Object.values(teams)) if (!t.knock) { t.eliminated = true; if (!t.eliminatedAt) t.eliminatedAt = 'group'; }
  }
  for (const t of Object.values(teams)) {
    const kp = knockoutPoints(t.knock), total = t.groupPts + kp, o = owners[t.owner];
    o.groupPts += t.groupPts; o.knockPts += kp; o.points += total; o.w += t.w; o.d += t.d; o.l += t.l;
    const outLabel = t.eliminatedAt === 'group' ? 'Group stage' : (KNOCK_LABEL[t.eliminatedAt] || 'Knockout');
    o.teams.push({ name: t.name, points: total, groupPts: t.groupPts, knockPts: kp, played: t.played, record: `${t.w}W ${t.d}D ${t.l}L`, stageLabel: t.knock ? KNOCK_LABEL[t.knock] : 'Group stage', eliminated: t.eliminated, eliminatedLabel: outLabel });
  }
  const table = Object.values(owners).sort((a, b) => b.points - a.points);
  for (const o of table) o.teams.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  return table;
}

function placeholderMatches(realStages) {
  const out = [];
  for (const s of KNOCKOUT_SKELETON) {
    if (realStages.has(s.stage)) continue;
    for (let i = 0; i < s.count; i++) {
      const d = new Date(s.start + 'T12:00:00Z'); d.setUTCHours(d.getUTCHours() + i);
      out.push({ id: `tbd-${s.stage}-${i}`, utc: d.toISOString(), nzDateKey: nzKey.format(d), nzDate: nzDate.format(d), nzTime: '', home: 'To be decided', away: 'To be decided', homeOwner: null, awayOwner: null, homeScore: null, awayScore: null, finished: false, status: 'TBD', stage: s.stage, isGroup: false, placeholder: true });
    }
  }
  return out;
}

function buildMatches() {
  const real = EVENTS.map(e => {
    const d = utcDate(e), home = resolveTeam(e.strHomeTeam), away = resolveTeam(e.strAwayTeam), round = classifyRound(e.intRound);
    return { id: e.idEvent, utc: d.toISOString(), nzDateKey: nzKey.format(d), nzDate: nzDate.format(d), nzTime: nzTime.format(d), home: e.strHomeTeam, away: e.strAwayTeam, homeOwner: home?.owner || null, awayOwner: away?.owner || null, homeScore: hasScore(e) ? Number(e.intHomeScore) : null, awayScore: hasScore(e) ? Number(e.intAwayScore) : null, finished: e.strStatus === 'FT' || (hasScore(e) && e.strStatus !== 'NS'), status: e.strStatus, stage: round.group ? 'Group' : (KNOCK_LABEL[round.key] || 'Knockout'), isGroup: round.group, placeholder: false };
  });
  const realStages = new Set(real.filter(m => !m.isGroup).map(m => m.stage));
  return real.concat(placeholderMatches(realStages)).sort((a, b) => a.utc.localeCompare(b.utc));
}

// ---- Rendering ----
const medals = ['🥇', '🥈', '🥉'];
const ownerColors = {};
const palette = ['#1b8a5a', '#2563eb', '#db2777', '#d97706', '#7c3aed', '#0891b2'];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function colorFor(o) { if (!o) return '#9ca3af'; if (!(o in ownerColors)) ownerColors[o] = palette[Object.keys(ownerColors).length % palette.length]; return ownerColors[o]; }

document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-table').hidden = btn.dataset.tab !== 'table';
  document.getElementById('tab-matches').hidden = btn.dataset.tab !== 'matches';
}));

function renderScoring() {
  document.getElementById('scoring-list').innerHTML = KNOCK_ORDER.map(k => `<li><strong>${KNOCK_LABEL[k]}</strong> — +${KNOCK_AWARD[k]} pts</li>`).join('');
}
function renderStandings(table) {
  document.getElementById('standings-body').innerHTML = table.map((row, i) => {
    const medal = medals[i] ? `<span class="medal">${medals[i]}</span>` : (i + 1);
    return `<tr class="${i === 0 ? 'top' : ''}"><td class="rank">${medal}</td><td class="player">${esc(row.owner)}</td>
      <td class="wdl"><span class="w">${row.w}</span><span class="sep">·</span><span class="d">${row.d}</span><span class="sep">·</span><span class="l">${row.l}</span></td>
      <td class="grp">${row.groupPts}</td><td class="ko">${row.knockPts}</td><td class="pts"><span class="pts-val">${row.points}</span></td></tr>`;
  }).join('');
}
function renderBreakdown(table) {
  document.getElementById('breakdown').innerHTML = table.map(row => `
    <div class="player-block">
      <div class="player-head" style="border-left:5px solid ${colorFor(row.owner)}"><span class="name">${esc(row.owner)}</span><span class="total">${row.points} pts</span></div>
      <div class="team-rows">${row.teams.map(teamRow).join('')}</div>
    </div>`).join('');
}
function teamRow(t) {
  const out = t.eliminated, live = t.knockPts > 0;
  const record = t.played ? `<span class="stage-tag">${esc(t.record)}</span>` : `<span class="stage-tag">not played yet</span>`;
  let tags;
  if (out) tags = `${record}<span class="stage-tag gone">Out · ${esc(t.eliminatedLabel)}</span>`;
  else if (live) tags = `${record}<span class="stage-tag live">${esc(t.stageLabel)}</span>`;
  else tags = record;
  return `<div class="team-row ${out ? 'out' : ''}"><span class="tname"><span class="tn-name">${esc(t.name)}</span>${tags}</span><span class="tpts">${t.points} pt${t.points === 1 ? '' : 's'}</span></div>`;
}
function renderMatches(matches) {
  document.getElementById('match-note').textContent = matches.length ? `${matches.length} matches · scores update automatically` : 'No fixtures yet.';
  const groups = []; let cur = null;
  for (const m of matches) { if (!cur || cur.key !== m.nzDateKey) { cur = { key: m.nzDateKey, date: m.nzDate, rows: [] }; groups.push(cur); } cur.rows.push(m); }
  document.getElementById('matches').innerHTML = groups.map(g => `<div class="day"><div class="day-head">${esc(g.date)}</div>${g.rows.map(matchRow).join('')}</div>`).join('');
}
function matchRow(m) {
  const played = m.homeScore !== null;
  const score = played ? `${m.homeScore} – ${m.awayScore}` : m.placeholder ? 'TBD' : (m.status === 'NS' ? m.nzTime : esc(m.status));
  return `<div class="match ${m.placeholder ? 'tbd' : ''}">
    <div class="side home"><span class="team">${esc(m.home)}</span><span class="owner" style="color:${colorFor(m.homeOwner)}">${esc(m.homeOwner || '—')}</span></div>
    <div class="mid"><span class="${played ? 'score' : 'kickoff'}">${score}</span><span class="stagebadge">${esc(m.stage)}</span></div>
    <div class="side away"><span class="team">${esc(m.away)}</span><span class="owner" style="color:${colorFor(m.awayOwner)}">${esc(m.awayOwner || '—')}</span></div>
  </div>`;
}

async function loadAll() {
  await refresh();
  document.getElementById('updated').textContent = fetchedAt ? 'live · updated ' + fetchedAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : 'live';
  document.getElementById('src-note').textContent = 'Live scores via TheSportsDB (free)';
  renderScoring();
  renderStandings(buildStandings());
  renderBreakdown(buildStandings());
  renderMatches(buildMatches());
}
loadAll();
setInterval(loadAll, 60000);
