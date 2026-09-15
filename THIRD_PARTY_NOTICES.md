# Componenti e dati di terze parti

| Componente | Percorso | Licenza | Fonte |
|---|---|---|---|
| Dati qualità dell'aria (sensori, stazioni) | `data/arpa-pv-*.json` (rielaborati: aggregazione giornaliera) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/legalcode) (pubblico dominio; attribuzione «ARPA LOMBARDIA» indicata nei metadati) | ARPA Lombardia, via [Regione Lombardia Open Data](https://www.dati.lombardia.it) |
| Confini comunali | `data/comuni_pv.geojson`, `data/provincia_pv.geojson` (semplificati) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | ISTAT, via [openpolis/geojson-italy](https://github.com/openpolis/geojson-italy) |
| Dati meteo storici (condizioni del giorno per centralina) | `data/meteo-pv-*.json` (rielaborati: un valore per centralina e giorno) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (attribuzione Open-Meteo) | [Open-Meteo](https://open-meteo.com) — Historical Weather API, rianalisi ERA5/ERA5-Land di ECMWF |
| Leaflet 1.9.4 | `site/vendor/leaflet.js`, `leaflet.css` | BSD-2-Clause | https://leafletjs.com |
| Chart.js 4.4 | `site/vendor/chart.umd.js` | MIT | https://www.chartjs.org |
| jsPDF 4.2.1 | `site/vendor/jspdf.umd.min.js` (caricato solo all'uso del report PDF) | MIT | https://github.com/parallax/jsPDF |
| jsPDF-AutoTable 5.0.8 | `site/vendor/jspdf.plugin.autotable.min.js` (idem) | MIT | https://github.com/simonbengtsson/jsPDF-AutoTable |
| IBM Plex Sans / Mono | `site/fonts/` (sottoinsieme latin, via @fontsource) | [SIL OFL 1.1](site/fonts/LICENSE-OFL.txt) | IBM |
| Tile di mappa (opzionali, caricate dal browser solo su richiesta) | — | [ODbL](https://www.openstreetmap.org/copyright) | © OpenStreetMap contributors |

I dati ARPA sono stati **rielaborati**: da valori orari a un valore per sensore e giorno (media, massimo orario, massimo della
media mobile su 8 ore). La licenza CC0 non impone obblighi, ma per correttezza la fonte è sempre citata e le elaborazioni sono
dichiarate come proprie: non sono statistiche ufficiali ARPA. Il periodo di validazione ARPA si chiude il 30 marzo dell'anno
successivo; fino ad allora i dati dell'anno precedente vanno considerati provvisori.

I dati meteo sono il rianalisi del punto griglia più vicino a ciascuna centralina (risoluzione ~9-25 km a seconda del modello),
non una misura fatta sul posto: sono un contesto meteorologico del giorno, non un dato ufficiale locale. La licenza CC BY 4.0
richiede l'attribuzione a Open-Meteo, sempre indicata nella pagina e nel report PDF dove compaiono questi dati.
