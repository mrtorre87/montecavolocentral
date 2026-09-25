// Generatore statico del sito Montecavolo Central.
// Nessuna dipendenza esterna: usa solo i moduli built-in di Node,
// cosi' puo' girare in GitHub Actions senza un passo "npm install".
//
// Legge i file JSON in /data e scrive le pagine HTML finali in /dist.
// Quando in futuro la pipeline Instagram scrivera' nuovi dati dentro
// /data (nuovi post, partite, marcatori), basta rilanciare questo
// script per rigenerare il sito.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const DIST = path.join(ROOT, 'dist');

const TEAM_NAME = 'Montecavolo Central';
const FOUNDED = 2016;

function readJSON(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8'));
}

const players = readJSON('players.json');
const matches = readJSON('matches.json');
const scorers = readJSON('scorers.json').sort((a, b) => b.goals - a.goals);
const posts = [...readJSON('posts.json')].sort((a, b) => (a.date < b.date ? 1 : -1));

const MONTHS = ['GEN','FEB','MAR','APR','MAG','GIU','LUG','AGO','SET','OTT','NOV','DIC'];

function formatDateBadge(iso) {
  const d = new Date(iso + 'T00:00:00');
  return { day: d.getDate(), month: MONTHS[d.getMonth()] };
}

function formatDateLong(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---- Layout shell shared by every page ----

function layout({ title, active, body }) {
  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · ${TEAM_NAME}</title>
<link rel="stylesheet" href="assets/css/style.css">
</head>
<body>
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="index.html">
      <img src="assets/img/logo.png" alt="Stemma ${TEAM_NAME}">
      <span class="brand-name">${TEAM_NAME}<span>Dal ${FOUNDED}</span></span>
    </a>
    <nav class="main-nav">
      <a href="index.html" class="${active === 'blog' ? 'active' : ''}">Blog</a>
      <a href="squadra.html" class="${active === 'squadra' ? 'active' : ''}">Squadra</a>
      <a href="risultati.html" class="${active === 'risultati' ? 'active' : ''}">Risultati</a>
      <a href="marcatori.html" class="${active === 'marcatori' ? 'active' : ''}">Marcatori</a>
    </nav>
  </div>
</header>
${body}
<footer class="site-footer">
  <div class="wrap">
    <div><strong>${TEAM_NAME}</strong> &middot; fondata nel ${FOUNDED}</div>
    <div>Aggiornato automaticamente dai post Instagram della squadra</div>
  </div>
</footer>
</body>
</html>`;
}

// ---- Home / blog ----

function resultClass(m) {
  if (m.score_us > m.score_them) return 'result-w';
  if (m.score_us < m.score_them) return 'result-l';
  return 'result-d';
}

function heroBlock() {
  const last = matches[0];
  if (!last) return '';
  const cls = resultClass(last);
  return `<section class="hero">
  <div class="wrap">
    <p class="hero-eyebrow">Ultimo risultato &middot; ${escapeHtml(last.competition)}</p>
    <p class="hero-score">
      <span class="${cls}">${TEAM_NAME.toUpperCase()} ${last.score_us}</span>
      <span class="vs">&ndash;</span>
      <span>${last.score_them} ${escapeHtml(last.opponent.toUpperCase())}</span>
    </p>
    <p class="hero-meta">${last.home_away === 'casa' ? 'In casa' : 'In trasferta'} &middot; ${formatDateLong(last.date)}</p>
    <span class="ribbon">Forza Montecavolo</span>
  </div>
</section>`;
}

function postItem(post) {
  const badge = formatDateBadge(post.date);
  const tag = post.type === 'risultato' ? '<span class="post-tag">Risultato</span>' : '';
  return `<li class="post-item">
    <div class="post-date"><span class="day">${badge.day}</span>${badge.month}</div>
    <div>
      ${tag}
      <h3 class="post-title">${escapeHtml(post.title)}</h3>
      <p class="post-excerpt">${escapeHtml(post.excerpt)}</p>
      <a class="post-link" href="${escapeHtml(post.instagram_url)}" target="_blank" rel="noopener">Vedi il post originale</a>
    </div>
  </li>`;
}

function pageHome() {
  const body = `${heroBlock()}
<div class="wrap">
  <div class="section-head">
    <h2>Ultime dal campo</h2>
    <span class="count">${posts.length} post</span>
  </div>
  <ul class="post-list">
    ${posts.map(postItem).join('\n')}
  </ul>
</div>`;
  return layout({ title: 'Blog', active: 'blog', body });
}

// ---- Squadra ----

function playerCard(p) {
  return `<div class="player-card">
    <div class="player-number">${p.number}</div>
    <div class="player-name">${escapeHtml(p.name)}</div>
    <div class="player-role">${escapeHtml(p.role)}</div>
  </div>`;
}

function pageSquadra() {
  const body = `<div class="wrap">
  <div class="section-head">
    <h2>La rosa</h2>
    <span class="count">${players.length} giocatori</span>
  </div>
  <div class="roster-grid">
    ${players.map(playerCard).join('\n')}
  </div>
</div>`;
  return layout({ title: 'Squadra', active: 'squadra', body });
}

// ---- Risultati ----

function matchRow(m) {
  const cls = resultClass(m);
  return `<tr>
    <td>${formatDateLong(m.date)}</td>
    <td>${escapeHtml(m.competition)}</td>
    <td>${m.home_away === 'casa' ? 'Casa' : 'Trasferta'}</td>
    <td>${escapeHtml(m.opponent)}</td>
    <td class="score ${cls}">${m.score_us} &ndash; ${m.score_them}</td>
  </tr>`;
}

function pageRisultati() {
  const body = `<div class="wrap">
  <div class="section-head">
    <h2>Risultati</h2>
    <span class="count">${matches.length} partite</span>
  </div>
  <table class="data-table">
    <thead>
      <tr><th>Data</th><th>Competizione</th><th>Sede</th><th>Avversario</th><th>Risultato</th></tr>
    </thead>
    <tbody>
      ${matches.map(matchRow).join('\n')}
    </tbody>
  </table>
</div>`;
  return layout({ title: 'Risultati', active: 'risultati', body });
}

// ---- Marcatori ----

function scorerRow(s, i) {
  return `<tr>
    <td class="score">${i + 1}</td>
    <td>${escapeHtml(s.name)}</td>
    <td class="score">${s.goals}</td>
  </tr>`;
}

function pageMarcatori() {
  const body = `<div class="wrap">
  <div class="section-head">
    <h2>Classifica marcatori</h2>
    <span class="count">stagione in corso</span>
  </div>
  <table class="data-table">
    <thead>
      <tr><th>#</th><th>Giocatore</th><th>Gol</th></tr>
    </thead>
    <tbody>
      ${scorers.map(scorerRow).join('\n')}
    </tbody>
  </table>
</div>`;
  return layout({ title: 'Classifica marcatori', active: 'marcatori', body });
}

// ---- Build ----

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

fs.writeFileSync(path.join(DIST, 'index.html'), pageHome());
fs.writeFileSync(path.join(DIST, 'squadra.html'), pageSquadra());
fs.writeFileSync(path.join(DIST, 'risultati.html'), pageRisultati());
fs.writeFileSync(path.join(DIST, 'marcatori.html'), pageMarcatori());
copyDir(path.join(ROOT, 'assets'), path.join(DIST, 'assets'));

console.log(`Sito generato in ${DIST}`);
console.log(`- ${posts.length} post, ${players.length} giocatori, ${matches.length} partite, ${scorers.length} marcatori`);
