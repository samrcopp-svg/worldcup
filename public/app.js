const medals = ['🥇', '🥈', '🥉'];
const ownerColors = {}; // assigned on first render for the match badges
const palette = ['#1b8a5a', '#2563eb', '#db2777', '#d97706', '#7c3aed', '#0891b2'];

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---- Tabs ----
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-table').hidden = btn.dataset.tab !== 'table';
    document.getElementById('tab-matches').hidden = btn.dataset.tab !== 'matches';
  });
});

function colorFor(owner) {
  if (!owner) return '#9ca3af';
  if (!(owner in ownerColors)) ownerColors[owner] = palette[Object.keys(ownerColors).length % palette.length];
  return ownerColors[owner];
}

async function loadStandings() {
  const data = await (await fetch('/api/standings')).json();
  setUpdated(data.source);
  renderScoring(data.scoring);
  renderStandings(data.table);
  renderBreakdown(data.table);
}

async function loadMatches() {
  const data = await (await fetch('/api/matches')).json();
  renderMatches(data.matches, data.source);
}

function setUpdated(source) {
  const t = source.fetchedAt ? new Date(source.fetchedAt) : new Date();
  document.getElementById('updated').textContent =
    'live · updated ' + t.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function renderScoring(scoring) {
  document.getElementById('scoring-list').innerHTML = scoring.order
    .map(k => `<li><strong>${esc(scoring.label[k])}</strong> — +${scoring.knockout[k]} pts</li>`)
    .join('');
}

function renderStandings(table) {
  document.getElementById('standings-body').innerHTML = table.map((row, i) => {
    const medal = medals[i] ? `<span class="medal">${medals[i]}</span>` : (i + 1);
    return `<tr class="${i === 0 ? 'top' : ''}">
      <td class="rank">${medal}</td>
      <td class="player">${esc(row.owner)}</td>
      <td class="wdl"><span class="w">${row.w}</span><span class="sep">·</span><span class="d">${row.d}</span><span class="sep">·</span><span class="l">${row.l}</span></td>
      <td class="grp">${row.groupPts}</td>
      <td class="ko">${row.knockPts}</td>
      <td class="pts"><span class="pts-val">${row.points}</span></td>
    </tr>`;
  }).join('');
}

function renderBreakdown(table) {
  document.getElementById('breakdown').innerHTML = table.map(row => `
    <div class="player-block">
      <div class="player-head" style="border-left:5px solid ${colorFor(row.owner)}">
        <span class="name">${esc(row.owner)}</span>
        <span class="total">${row.points} pts</span>
      </div>
      <div class="team-rows">
        ${row.teams.map(teamRow).join('')}
      </div>
    </div>`).join('');
}

function teamRow(t) {
  const out = t.eliminated;
  const live = t.knockPts > 0;
  const detail = t.played
    ? `${esc(t.record)}${live ? ' · ' + esc(t.stageLabel) : ''}`
    : 'not played yet';
  return `<div class="team-row ${out ? 'out' : ''}">
    <span class="tname">${esc(t.name)}
      <span class="stage-tag ${live ? 'live' : ''}">${detail}</span>
    </span>
    <span class="tpts">${t.points} pt${t.points === 1 ? '' : 's'}</span>
  </div>`;
}

function renderMatches(matches, source) {
  document.getElementById('match-note').textContent =
    matches.length ? `${matches.length} matches · scores update automatically` : 'No fixtures published yet — check back when the tournament kicks off.';
  // group by NZ date
  const groups = [];
  let cur = null;
  for (const m of matches) {
    if (!cur || cur.key !== m.nzDateKey) { cur = { key: m.nzDateKey, date: m.nzDate, rows: [] }; groups.push(cur); }
    cur.rows.push(m);
  }
  document.getElementById('matches').innerHTML = groups.map(g => `
    <div class="day">
      <div class="day-head">${esc(g.date)}</div>
      ${g.rows.map(matchRow).join('')}
    </div>`).join('');
}

function matchRow(m) {
  const played = m.homeScore !== null;
  const score = played ? `${m.homeScore} – ${m.awayScore}`
    : m.placeholder ? 'TBD'
    : (m.status === 'NS' ? m.nzTime : esc(m.status));
  const scoreClass = played ? 'score' : 'kickoff';
  return `<div class="match ${m.placeholder ? 'tbd' : ''}">
    <div class="side home">
      <span class="team">${esc(m.home)}</span>
      <span class="owner" style="color:${colorFor(m.homeOwner)}">${esc(m.homeOwner || '—')}</span>
    </div>
    <div class="mid"><span class="${scoreClass}">${score}</span>
      <span class="stagebadge">${esc(m.stage)}</span></div>
    <div class="side away">
      <span class="team">${esc(m.away)}</span>
      <span class="owner" style="color:${colorFor(m.awayOwner)}">${esc(m.awayOwner || '—')}</span>
    </div>
  </div>`;
}

function loadAll() { loadStandings(); loadMatches(); }
loadAll();
setInterval(loadAll, 60000); // keep families on fresh data
