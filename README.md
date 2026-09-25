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

## Cosa manca (prossimi passi)

- **Dati reali**: sostituire i JSON in `/data` con squadra, partite e
  marcatori veri.
- **Pipeline Instagram**: un secondo workflow schedulato (cron
  giornaliero) che legge i nuovi post via Instagram Graph API,
  li classifica/estrae con l'API di Claude, scrive i risultati dentro
  `/data` e fa push — a quel punto questo workflow di build/deploy
  scatta da solo.
- **Classifica campionato**: eventuale terza sorgente dati dal sito
  della lega, se si decide di importarla.
- **Dominio personalizzato**: da collegare più avanti su GitHub Pages,
  quando è pronto.
