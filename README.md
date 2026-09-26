# Montecavolo Central — sito

Scheletro del sito, statico, senza hosting a parte: generato con un
piccolo script Node (zero dipendenze esterne) e pubblicato su GitHub
Pages tramite GitHub Actions.

## Struttura

```
data/                 dati del sito (finti per ora)
  players.json         rosa
  matches.json          risultati
  scorers.json           classifica marcatori
  posts.json               post del blog
scripts/generate.js   genera le pagine HTML in /dist a partire da /data
assets/                css e immagini (logo pulito incluso)
dist/                  output generato (non modificare a mano)
.github/workflows/    build + deploy automatico su GitHub Pages
```

## Come si vede in locale

Basta Node (nessun `npm install` necessario):

```
node scripts/generate.js
```

Poi apri `dist/index.html` nel browser, oppure servilo con
`npx serve dist` se vuoi i link relativi puliti.

## Come pubblicarlo

1. Crea un repository su GitHub e carica questi file.
2. Nelle impostazioni del repo, in *Pages*, imposta la sorgente su
   **GitHub Actions**.
3. Ad ogni push su `main`, il workflow rigenera il sito e lo pubblica.

## Pipeline Instagram (automatica, giornaliera)

`scripts/fetch-instagram.js` + `.github/workflows/fetch-instagram.yml`:
ogni giorno legge i post nuovi dall'account Instagram della squadra,
li passa all'API di Claude per classificarli (è un post-risultato o
no?) ed estrarne i dati strutturati (avversario, punteggio,
marcatori), poi aggiorna `data/posts.json`, `data/matches.json` e
`data/scorers.json` e fa push. Quel push fa scattare in automatico
anche il workflow di build/deploy, quindi il sito si aggiorna da
solo.

Richiede questi Secrets nel repo (Settings → Secrets and variables →
Actions): `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_ACCOUNT_ID`.

`ANTHROPIC_API_KEY` è **facoltativo**: senza, i post vengono importati
così come sono (didascalia → titolo/estratto del blog), senza capire
se sono referti partita né estrarre punteggio/marcatori. Aggiungendo
quel secret in un secondo momento, la pipeline passa da sola alla
modalità "intelligente" — non serve toccare altro.

Il token Instagram dura 60 giorni e va rinnovato manualmente dalla
dashboard Meta prima della scadenza (nessun avviso automatico, per
ora — da tenere a mente).

Per testare la pipeline senza aspettare il cron: tab Actions → "Aggiorna
dati da Instagram" → "Run workflow".

## Cosa manca (prossimi passi)

- **Dati reali**: sostituire i giocatori in `data/players.json` con
  la rosa vera (la pipeline non li tocca, sono gestiti a mano).
- **Classifica campionato**: eventuale terza sorgente dati dal sito
  della lega, se si decide di importarla.
- **Dominio personalizzato**: da collegare più avanti su GitHub Pages,
  quando è pronto.
- **Rinnovo token Instagram**: da fare manualmente ogni ~60 giorni.
