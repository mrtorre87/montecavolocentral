// Pipeline giornaliera: legge i post nuovi dall'account Instagram della
// squadra, li classifica ed estrae i dati (risultato, marcatori) con
// l'API di Claude, e aggiorna i file in /data. Zero dipendenze esterne
// (usa fetch, gia' incluso in Node 20).
//
// Variabili d'ambiente richieste (impostate come Secrets in GitHub Actions):
//   INSTAGRAM_ACCESS_TOKEN
//   INSTAGRAM_ACCOUNT_ID
//   ANTHROPIC_API_KEY

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');

const IG_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
const IG_ACCOUNT_ID = process.env.INSTAGRAM_ACCOUNT_ID;
const CLAUDE_API_KEY = process.env.ANTHROPIC_API_KEY; // opzionale: vedi sotto
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';

if (!IG_TOKEN || !IG_ACCOUNT_ID) {
  console.error('Mancano INSTAGRAM_ACCESS_TOKEN o INSTAGRAM_ACCOUNT_ID.');
  process.exit(1);
}

// Se ANTHROPIC_API_KEY non e' impostata, la pipeline funziona comunque:
// i post vengono importati cosi' come sono (didascalia -> titolo/estratto),
// senza classificazione ne' estrazione di risultato/marcatori. Utile per
// partire subito; quando si aggiunge la chiave, questa parte "intelligente"
// si attiva da sola, senza altre modifiche.
if (!CLAUDE_API_KEY) {
  console.log("ANTHROPIC_API_KEY non impostata: importo i post cosi' come sono, senza estrazione dati.");
}

function readJSON(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8'));
}
function writeJSON(name, data) {
  fs.writeFileSync(path.join(DATA, name), JSON.stringify(data, null, 2) + '\n');
}

// ---- 1. Legge i media recenti da Instagram ----

async function fetchRecentMedia() {
  const fields = 'id,caption,timestamp,permalink,media_type,media_url';
  const url = `https://graph.instagram.com/v21.0/${IG_ACCOUNT_ID}/media?fields=${fields}&access_token=${IG_TOKEN}&limit=25`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) {
    throw new Error(`Errore Instagram API: ${json.error.message}`);
  }
  return json.data || [];
}

// ---- 2. Classifica ed estrae i dati con Claude ----

const EXTRACTION_SYSTEM_PROMPT = `Sei un assistente che legge la didascalia di un post Instagram di una squadra di calcio amatoriale (Montecavolo Central) e ne estrae dati strutturati.

Rispondi SOLO con un oggetto JSON valido, senza testo prima o dopo, senza markdown, con esattamente questi campi:

{
  "title": "titolo breve per il post del blog, in italiano",
  "excerpt": "riassunto di una o due frasi del post, in italiano",
  "is_match_post": true oppure false (true solo se il post riporta il risultato di una partita giocata),
  "opponent": "nome della squadra avversaria, oppure null",
  "score_us": numero di gol del Montecavolo Central, oppure null,
  "score_them": numero di gol dell'avversario, oppure null,
  "competition": "nome del campionato/coppa se menzionato, altrimenti null",
  "home_away": "casa" oppure "trasferta" oppure null se non deducibile,
  "scorers": [{"name": "nome giocatore", "goals": numero}] (lista vuota se non ci sono marcatori nominati o non e' un post risultato)
}

Se il post non riporta un risultato di partita (es. allenamento, sponsor, auguri), metti is_match_post a false e lascia null i campi relativi alla partita, ma compila comunque title ed excerpt.
Se un giocatore ha fatto una "doppietta" conta 2 gol, una "tripletta" 3 gol.`;

async function extractWithClaude(caption) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1000,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: caption || '(post senza didascalia)' },
      ],
    }),
  });
  const json = await res.json();
  if (json.error) {
    throw new Error(`Errore API Claude: ${json.error.message}`);
  }
  const text = json.content.map((b) => b.text || '').join('');
  const cleaned = text.replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned);
}

// ---- 2b. Versione semplice, senza Claude: usa la didascalia cosi' com'e' ----

function simpleExtract(caption) {
  const text = (caption || '(post senza didascalia)').trim();
  // Prima riga (o frase) come titolo, il resto come estratto.
  const firstLine = text.split('\n')[0];
  const title = firstLine.length > 80 ? firstLine.slice(0, 77) + '...' : firstLine;
  const excerpt = text.length > 280 ? text.slice(0, 277) + '...' : text;
  return {
    title,
    excerpt,
    is_match_post: false,
    opponent: null,
    score_us: null,
    score_them: null,
    competition: null,
    home_away: null,
    scorers: [],
  };
}

// ---- 3. Aggiorna i file dati ----

function isoDate(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function updateScorers(scorers, extracted) {
  for (const s of extracted.scorers || []) {
    const existing = scorers.find((p) => p.name.toLowerCase() === s.name.toLowerCase());
    if (existing) existing.goals += s.goals;
    else scorers.push({ name: s.name, goals: s.goals });
  }
  scorers.sort((a, b) => b.goals - a.goals);
}

async function main() {
  const media = await fetchRecentMedia();
  const posts = readJSON('posts.json');
  const matches = readJSON('matches.json');
  const scorers = readJSON('scorers.json');

  const knownIds = new Set(posts.map((p) => p.instagram_id).filter(Boolean));
  const newMedia = media.filter((m) => !knownIds.has(m.id));

  if (newMedia.length === 0) {
    console.log('Nessun post nuovo trovato.');
    return;
  }

  // Dal piu' vecchio al piu' nuovo, cosi' l'ordine cronologico resta coerente
  newMedia.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  for (const m of newMedia) {
    console.log(`Elaboro post ${m.id} (${m.timestamp})...`);
    let extracted;
    if (CLAUDE_API_KEY) {
      try {
        extracted = await extractWithClaude(m.caption || '');
      } catch (err) {
        console.error(`  Estrazione con Claude fallita per ${m.id}: ${err.message}. Uso la versione semplice.`);
        extracted = simpleExtract(m.caption);
      }
    } else {
      extracted = simpleExtract(m.caption);
    }

    const date = isoDate(m.timestamp);

    posts.unshift({
      date,
      title: extracted.title,
      excerpt: extracted.excerpt,
      type: extracted.is_match_post ? 'risultato' : 'generico',
      instagram_url: m.permalink,
      instagram_id: m.id,
    });

    if (extracted.is_match_post && extracted.opponent) {
      matches.unshift({
        date,
        competition: extracted.competition || 'Campionato',
        home_away: extracted.home_away || 'casa',
        opponent: extracted.opponent,
        score_us: extracted.score_us,
        score_them: extracted.score_them,
        instagram_id: m.id,
      });
      updateScorers(scorers, extracted);
    }
  }

  posts.sort((a, b) => (a.date < b.date ? 1 : -1));
  matches.sort((a, b) => (a.date < b.date ? 1 : -1));

  writeJSON('posts.json', posts);
  writeJSON('matches.json', matches);
  writeJSON('scorers.json', scorers);

  console.log(`Fatto: ${newMedia.length} post nuovi elaborati.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
