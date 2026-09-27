// Legge la pagina del girone sul sito CSI (Centro Sportivo Italiano) e ne
// estrae la classifica del campionato e la classifica marcatori del
// girone, salvandole in /data. Nessuna dipendenza esterna: parsing HTML
// fatto con un piccolo parser di tabelle basato su espressioni regolari
// (la struttura delle pagine CSI e' semplice HTML con <table>/<tr>/<td>).
//
// N.B. i dati pubblicati dal CSI sono ufficiosi fino all'omologazione.

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');

// URL della pagina del girone. Da aggiornare se la squadra cambia
// girone/stagione in futuro.
const LEAGUE_URL = process.env.LEAGUE_URL ||
  'https://live.centrosportivoitaliano.it/26/Calcio-a-11/Emilia-Romagna/Reggio-Emilia/C36124/?j=NEU9REhGJjRGPVBOWSY0Rz1HSkVGSCY0SD1GTEdLSk0mNEk9VHY0MTByIE8mNEw9REhGJjQyPWU=';

// Nome esatto della squadra come compare sul sito della lega (puo'
// differire da come si chiama sul nostro sito, per via dello sponsor).
const LEAGUE_TEAM_NAME = process.env.LEAGUE_TEAM_NAME || 'Saxum Un. Montecavolo Central';

function writeJSON(name, data) {
  fs.writeFileSync(path.join(DATA, name), JSON.stringify(data, null, 2) + '\n');
}

// ---- Piccolo parser di tabelle HTML, senza dipendenze ----

function decodeEntities(str) {
  return str
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

function extractTables(html) {
  const tables = [];
  const re = /<table[\s\S]*?<\/table>/gi;
  let m;
  while ((m = re.exec(html))) tables.push(m[0]);
  return tables;
}

function parseTableRows(tableHtml) {
  const rows = [];
  const rowRe = /<tr[\s\S]*?<\/tr>/gi;
  let m;
  while ((m = rowRe.exec(tableHtml))) {
    const cells = [];
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let c;
    while ((c = cellRe.exec(m[0]))) cells.push(stripTags(c[1]));
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function findTableByHeaders(tables, mustInclude) {
  for (const t of tables) {
    const rows = parseTableRows(t);
    if (!rows.length) continue;
    const header = rows[0].map((h) => h.toLowerCase());
    if (mustInclude.every((needle) => header.some((h) => h.includes(needle)))) {
      return rows;
    }
  }
  return null;
}

// ---- Estrazione classifica ----

function parseStandings(rows) {
  // Intestazione attesa: #, Squadra, Pt, PG, V, N, P, GF, GS, DR
  const body = rows.slice(1);
  return body
    .map((cells) => {
      if (cells.length < 9) return null;
      const [pos, squadra, pt, pg, v, n, p, gf, gs, dr] = cells;
      return {
        position: parseInt(pos, 10) || null,
        team: squadra,
        points: parseInt(pt, 10) || 0,
        played: parseInt(pg, 10) || 0,
        wins: parseInt(v, 10) || 0,
        draws: parseInt(n, 10) || 0,
        losses: parseInt(p, 10) || 0,
        goals_for: parseInt(gf, 10) || 0,
        goals_against: parseInt(gs, 10) || 0,
        goal_diff: parseInt(dr, 10) || 0,
        is_us: squadra.trim() === LEAGUE_TEAM_NAME,
      };
    })
    .filter(Boolean);
}

// ---- Estrazione classifica marcatori del girone ----

function parseLeagueScorers(rows) {
  // Intestazione attesa: Giocatore, Gol, Squadra, ..., Rigori
  const body = rows.slice(1);
  return body
    .map((cells) => {
      if (cells.length < 3) return null;
      const [player, goals, team] = cells;
      return {
        name: player,
        goals: parseInt(goals, 10) || 0,
        team,
        is_us: team.trim() === LEAGUE_TEAM_NAME,
      };
    })
    .filter(Boolean);
}

async function main() {
  const res = await fetch(LEAGUE_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'Referer': 'https://www.google.com/',
    },
  });
  if (!res.ok) {
    // Log diagnostico: aiuta a capire la causa esatta se fallisce di nuovo,
    // senza dover rifare un giro di debug da zero.
    const bodySnippet = (await res.text().catch(() => '')).slice(0, 300);
    console.error(`Risposta HTTP ${res.status} da ${LEAGUE_URL}`);
    console.error('Prime righe del corpo della risposta:', bodySnippet);
    throw new Error(`Impossibile leggere la pagina della lega (HTTP ${res.status})`);
  }
  const html = await res.text();

  const tables = extractTables(html);

  const standingsRows = findTableByHeaders(tables, ['squadra', 'pt']);
  const scorersRows = findTableByHeaders(tables, ['giocatore', 'gol']);

  if (!standingsRows) {
    console.error('Tabella classifica non trovata: la struttura della pagina potrebbe essere cambiata.');
  }
  if (!scorersRows) {
    console.error('Tabella marcatori non trovata: la struttura della pagina potrebbe essere cambiata.');
  }

  const standings = standingsRows ? parseStandings(standingsRows) : [];
  const leagueScorers = scorersRows ? parseLeagueScorers(scorersRows) : [];

  writeJSON('league-standings.json', {
    updated: new Date().toISOString(),
    source_url: LEAGUE_URL,
    rows: standings,
  });
  writeJSON('league-scorers.json', {
    updated: new Date().toISOString(),
    source_url: LEAGUE_URL,
    rows: leagueScorers,
  });

  console.log(`Fatto: ${standings.length} squadre in classifica, ${leagueScorers.length} marcatori.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
