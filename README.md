<p align="right">🇬🇧 <a href="README.en.md">English version</a></p>

<img src="site/logo.svg" alt="" width="64" align="left" style="margin-right:14px">

# Aria del Pavese

Mappa interattiva di tutte le centraline ARPA Lombardia della provincia di Pavia, dalla Lomellina all'Oltrepò: valori giornalieri degli ultimi dieci anni,
superamenti dei limiti di legge in evidenza, andamento per stazione su settimana, mese o anno. Sito statico su GitHub Pages, dati aggiornati ogni notte.

<br clear="left">

> **Progetto indipendente.** Non è un sito ufficiale e non è affiliato ad ARPA Lombardia, a Regione Lombardia né ad alcun ente
> locale. Le elaborazioni sono proprie del progetto; per usi ufficiali fare riferimento ai dati ARPA.

## Perché

Il progetto nasce da una domanda semplice: *com'era l'aria in provincia di Pavia in un certo giorno, e dove?*
ARPA pubblica tutto come open data, ma i valori orari grezzi non si leggono a colpo d'occhio. La pagina mostra, per ogni data
degli ultimi dieci anni, cosa hanno misurato le centraline della provincia, evidenzia i giorni oltre i limiti e permette di
seguire l'andamento di una stazione nel tempo.

## Cosa mostra

- le 13 stazioni ARPA della provincia (anche quelle dismesse, con i periodi di attività) e gli inquinanti che ciascuna misura;
- per la data scelta, i valori di ogni stazione visibile, con i superamenti dei limiti di legge in rosso e quelli del riferimento
  OMS in ambra;
- per una stazione alla volta, il grafico dell'inquinante scelto su settimana, mese o anno, con la soglia tracciata;
- una mappa vettoriale della provincia (confini comunali ISTAT); lo sfondo OpenStreetMap si può attivare a richiesta.

## Struttura del repository

| Percorso | Contenuto |
|---|---|
| `scripts/fetch_arpa.py` | scarica da dati.lombardia.it (API Socrata) e aggrega per giorno → `data/arpa-pv-AAAA.json` |
| `scripts/build_data.py` | costruisce `site/data.js`, il bundle compatto letto dalla pagina (generato dal workflow, non versionato) |
| `data/` | aggregati giornalieri degli anni **chiusi** (fino a due anni fa) e confini comunali ISTAT semplificati |
| `data/open/` | anno corrente, anno precedente e anagrafica sensori: riscaricati ogni notte, non versionati |
| `site/` | la pagina (`index.html`, `style.css`, `app.js`), il logo, i font e le librerie vendorizzate (Leaflet 1.9.4, Chart.js 4.4) |
| `.github/workflows/update.yml` | cron notturno: fetch → build → commit dei dati → deploy su Pages |

## Messa in funzione

1. Crea un repository pubblico su GitHub e fai il push di questa cartella sul branch `main`.
2. In **Settings → Pages** imposta *Source: GitHub Actions*.
3. In **Settings → Actions → General → Workflow permissions** scegli *Read and write permissions* (serve per il commit automatico dei dati).
4. Facoltativo: aggiungi il secret `SOCRATA_APP_TOKEN` (token gratuito dalle impostazioni sviluppatore di dati.lombardia.it) per
   evitare il throttling dell'API. Senza token funziona comunque.
5. Lancia il workflow da **Actions → Aggiorna dati ARPA e pubblica → Run workflow**. Il sito sarà su `https://danbas.github.io/aria-del-pavese/`.

Ogni run — anche quello scatenato dal push — scarica anno corrente e precedente (5 chiamate API, meno di un minuto) e ricostruisce il sito.

**Prima del go-live**, una riga da rimuovere in `site/index.html`: il `<meta name="robots" content="noindex">`, da tenere finché
non si è verificato che tutto funzioni online.

## Uso locale

```bash
python scripts/fetch_arpa.py --years current,previous   # oppure --years all, oppure --years 2024,2025
python scripts/build_data.py
python -m http.server -d site 8000                       # http://localhost:8000
```

Nessuna dipendenza oltre alla libreria standard di Python 3.10+. Non committare `data/open/`: è già in `.gitignore`. Per adattarlo a un'altra provincia lombarda basta cambiare
`PROVINCIA` in `fetch_arpa.py` e sostituire i due GeoJSON dei confini.

## Come sono calcolati i valori

Un valore per sensore e per giorno solare (data del timestamp ARPA), usando solo i dati con stato «validato» (`VA`):

- **media giornaliera** per PM10, PM2.5, SO₂, benzene, NH₃, NOₓ, black carbon;
- **massimo orario** per NO₂ (e SO₂, per il limite orario di 350 µg/m³);
- **massimo giornaliero della media mobile su 8 ore** per O₃ e CO (finestra valida con almeno 6 ore su 8).

I giorni con meno di 18 ore valide sono segnati come parziali. Le soglie sono quelle del D.Lgs. 155/2010 (direttiva 2008/50/CE).
Il PM2.5 ha solo un limite annuale (25 µg/m³): come soglia giornaliera viene usata la linea guida OMS 2021 (15 µg/m³), etichettata
come riferimento OMS e non come limite di legge. La direttiva (UE) 2024/2881 introdurrà dal 2030 limiti più severi.

Dataset usati: `ib47-atvt` (stazioni), `nr8w-tj77` (2010-2017), `g2hp-ar79` (dal 2018, anni chiusi), `nicp-bhqi` (anno corrente).

**Finestra mobile e dimensioni.** La pagina mostra gli ultimi dieci anni solari (`WINDOW_YEARS` in `build_data.py`), quindi il
bundle `data.js` resta di dimensione costante (~1,5 MB) anche col passare degli anni. Nel repository sono versionati solo gli
anni *chiusi* (fino a due anni fa), che non cambiano più: la storia git cresce di circa mezzo megabyte l'anno, in un solo
commit a gennaio, quando un anno matura. Anno corrente e precedente vengono riscaricati ogni notte in `data/open/` (ignorato
da git), perché ARPA valida a posteriori e valori di settimane prima possono cambiare. Quando ARPA sposta un anno appena chiuso
da `nicp-bhqi` a `g2hp-ar79` può esserci una finestra in cui il download torna vuoto: in quel caso lo script mantiene il file
esistente.

## Avvertenze

Le aggregazioni, i conteggi dei superamenti e la media mobile su 8 ore sono elaborazioni proprie dei dati validati ARPA e possono
differire dalle statistiche ufficiali. Le informazioni sono fornite così come sono, senza garanzia di completezza o esattezza,
e non sostituiscono le comunicazioni ufficiali di ARPA Lombardia o delle autorità sanitarie.

**Privacy.** La pagina non usa cookie né tracciamento e non raccoglie dati personali; le preferenze restano nel `localStorage`
del visitatore. Font e librerie sono serviti insieme alla pagina, quindi nessuna richiesta parte verso terzi — tranne le mappe
OpenStreetMap, che vengono richieste ai server OSM solo se il visitatore attiva lo sfondo.

## Prossimi passi

- **Report PDF**: esportazione di un report per stazione e periodo (grafico, tabella dei valori, conteggio dei superamenti). Prima
  con un foglio di stile di stampa, poi con un pulsante di esportazione nella pagina; in prospettiva, report mensili per tutte le
  stazioni generati dal workflow notturno.
- Fiumi principali (Po, Ticino) sulla mappa vettoriale, per orientarsi senza attivare OpenStreetMap.
- Confronto tra due stazioni sullo stesso grafico.

Suggerimenti e segnalazioni sono benvenuti nelle issue.

## Come è nato

Il progetto è stato realizzato con l'aiuto di [Claude](https://claude.ai) (Anthropic), in modalità Cowork: le scelte su fonti,
metriche normative e architettura sono state discusse in conversazione; il codice degli script, della pagina e del workflow
è stato scritto da Claude e verificato prima della pubblicazione.

## Licenze

Codice e pagina: [MIT](LICENSE). Dati ARPA Lombardia via Regione Lombardia Open Data: IODL 2.0, rielaborati come descritto
sopra. Confini ISTAT via [openpolis/geojson-italy](https://github.com/openpolis/geojson-italy): CC BY 4.0. Leaflet (BSD-2),
Chart.js (MIT), IBM Plex (OFL 1.1). Tile di sfondo opzionali © OpenStreetMap contributors (ODbL). Dettagli in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
