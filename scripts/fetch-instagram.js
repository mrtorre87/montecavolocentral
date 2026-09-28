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

// Se un file dati non esiste (ancora), si parte da una lista vuota.
function readJSON(name, fallback = []) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log(`${name} non trovato: parto da vuoto.`);
      return fallback;
    }
    throw err;
  }
}
function writeJSON(name, data) {
  fs.writeFileSync(path.join(DATA, name), JSON.stringify(data, null, 2) + '\n');
}

// ---- 1. Legge i media recenti da Instagram ----

// Legge i media dell'account seguendo la paginazione (25 alla volta, dal
// piu' recente), fino a un massimo di pagine di sicurezza.
async function fetchAllMedia() {
  const fields = 'id,caption,timestamp,permalink,media_type,media_url,thumbnail_url,children{media_type,media_url,thumbnail_url}';
  let url = `https://graph.instagram.com/v21.0/${IG_ACCOUNT_ID}/media?fields=${fields}&access_token=${IG_TOKEN}&limit=25`;
  const all = [];
  const MAX_PAGES = 8;
  for (let page = 0; page < MAX_PAGES && url; page++) {
    const res = await fetch(url);
    const json = await res.json();
    if (json.error) {
      throw new Error(`Errore Instagram API: ${json.error.message}`);
    }
    all.push(...(json.data || []));
    url = json.paging && json.paging.next ? json.paging.next : null;
  }
  return all;
}

// Sceglie l'URL immagine migliore per un post: per i video usa la
// miniatura, per i caroselli la prima immagine/miniatura del gruppo.
function pickImageUrl(m) {
  if (m.media_type === 'VIDEO') return m.thumbnail_url || null;
  if (m.media_type === 'CAROUSEL_ALBUM') {
    const child = m.children && m.children.data && m.children.data[0];
    if (!child) return null;
    return child.media_type === 'VIDEO' ? child.thumbnail_url : child.media_url;
  }
  return m.media_url || null;
}

const IMG_DIR = path.join(__dirname, '..', 'assets', 'img', 'posts');

// Scarica e salva l'immagine nel repo: i media_url di Instagram sono
// temporanei (scadono), quindi non si possono solo linkare, vanno
// proprio salvati come file.
async function downloadImage(url, mediaId) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download immagine fallito (HTTP ${res.status})`);
  const type = res.headers.get('content-type') || '';
  if (!type.startsWith('image/')) throw new Error(`Il file scaricato non e' un'immagine (${type || 'tipo sconosciuto'})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(IMG_DIR, { recursive: true });
  const filename = `${mediaId}.jpg`;
  fs.writeFileSync(path.join(IMG_DIR, filename), buffer);
  return `assets/img/posts/${filename}`;
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
  fs.mkdirSync(IMG_DIR, { recursive: true });

  const media = await fetchAllMedia();
  let posts = readJSON('posts.json');
  const matches = readJSON('matches.json');
  const scorers = readJSON('scorers.json');

  // Toglie i post di esempio dello scheletro iniziale (non hanno un
  // instagram_id): restano solo post veri arrivati da Instagram.
  const before = posts.length;
  posts = posts.filter((p) => p.instagram_id);
  if (posts.length !== before) {
    console.log(`Rimossi ${before - posts.length} post di esempio.`);
  }

  const knownIds = new Set(posts.map((p) => p.instagram_id));

  // Non importa post piu' vecchi del piu' vecchio gia' presente: la storia
  // gia' importata non si allarga all'indietro senza volerlo.
  const oldestKnown = posts.length ? posts.map((p) => p.date).sort()[0] : null;
  const newMedia = media.filter(
    (m) => !knownIds.has(m.id) && (!oldestKnown || isoDate(m.timestamp) >= oldestKnown)
  );

  // Se non c'e' ancora nessun post importato, parte dai piu' recenti (max 30)
  // invece di tirare giu' tutto lo storico dell'account.
  const MAX_INITIAL = 30;
  if (!oldestKnown && newMedia.length > MAX_INITIAL) {
    newMedia.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    newMedia.length = MAX_INITIAL;
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

    let image = null;
    const imageUrl = pickImageUrl(m);
    if (imageUrl) {
      try {
        image = await downloadImage(imageUrl, m.id);
      } catch (err) {
        console.error(`  Download immagine fallito per ${m.id}: ${err.message}. Il post resta senza immagine.`);
      }
    }

    posts.unshift({
      date,
      title: extracted.title,
      excerpt: extracted.excerpt,
      type: extracted.is_match_post ? 'risultato' : 'generico',
      instagram_url: m.permalink,
      instagram_id: m.id,
      image,
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

  // Recupero immagini: i post gia' importati senza immagine (o con il file
  // mancante) la scaricano ora, se Instagram la rende ancora disponibile.
  const mediaById = new Map(media.map((m) => [m.id, m]));
  const ROOT = path.join(__dirname, '..');
  let backfilled = 0;
  let stillMissing = 0;
  for (const p of posts) {
    const hasFile = p.image && fs.existsSync(path.join(ROOT, p.image));
    if (hasFile) continue;
    const m = mediaById.get(p.instagram_id);
    const imageUrl = m ? pickImageUrl(m) : null;
    if (!imageUrl) {
      stillMissing++;
      continue;
    }
    try {
      p.image = await downloadImage(imageUrl, p.instagram_id);
      backfilled++;
    } catch (err) {
      console.error(`  Download immagine fallito per ${p.instagram_id}: ${err.message}.`);
      stillMissing++;
    }
  }

  posts.sort((a, b) => (a.date < b.date ? 1 : -1));
  matches.sort((a, b) => (a.date < b.date ? 1 : -1));

  writeJSON('posts.json', posts);
  writeJSON('matches.json', matches);
  writeJSON('scorers.json', scorers);

  console.log(`Fatto: ${newMedia.length} post nuovi, ${backfilled} immagini recuperate per post vecchi, ${stillMissing} post ancora senza immagine.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
