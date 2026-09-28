# Montecavolo Central — sito

Sito statico della squadra, senza hosting a parte: le pagine vengono
generate da uno script Node (nessuna dipendenza da installare) e
pubblicate su GitHub Pages tramite GitHub Actions.

## Struttura

```
.github/workflows/
  build-deploy.yml       genera il sito e lo pubblica su GitHub Pages
  fetch-instagram.yml    ogni giorno legge i nuovi post Instagram
assets/
  css/style.css          stile del sito
  img/logo.png           stemma
  img/posts/             immagini dei post (scaricate in automatico)
data/
  posts.json             post del blog (scritto in automatico)
  matches.json           risultati
  scorers.json           marcatori interni
  players.json           rosa (da compilare a mano)
  league-standings.json  classifica del girone (dal PDF della lega)
  league-scorers.json    marcatori del girone (dal PDF della lega)
scripts/
  generate.js            costruisce le pagine HTML in /dist
  fetch-instagram.js     legge Instagram e aggiorna /data
```

## Aggiornamenti

- **Post e immagini**: automatici ogni giorno alle 6:00 UTC. Per
  forzarli: tab Actions → "Aggiorna dati da Instagram" → Run workflow.
- **Classifica e marcatori del girone**: il sito della lega (CSI) è
  protetto da Cloudflare e non si può leggere in automatico. Si
  scaricano i due PDF dal sito CSI e si aggiornano a mano
  `data/league-standings.json` e `data/league-scorers.json`.
- **Rosa**: si compila a mano in `data/players.json`, con elementi
  del tipo `{ "number": 9, "name": "Nome Cognome", "role": "Attaccante" }`.

## Secrets del repository

Settings → Secrets and variables → Actions:

- `INSTAGRAM_ACCESS_TOKEN` e `INSTAGRAM_ACCOUNT_ID` (obbligatori)
- `ANTHROPIC_API_KEY` (facoltativo): senza, i post vengono importati
  così come sono; con la chiave, lo script prova anche a riconoscere
  risultati e marcatori dalle didascalie.

Il token Instagram dura 60 giorni: va rigenerato dalla dashboard Meta
for Developers e aggiornato nel secret prima della scadenza.

## Note

- Non cancellare intere cartelle del repo prima di caricare file nuovi:
  basta caricare sopra, i file con lo stesso nome vengono sostituiti.
- Pages: Settings → Pages → Source = "GitHub Actions".
- In locale: `node scripts/generate.js`, poi apri `dist/index.html`.
