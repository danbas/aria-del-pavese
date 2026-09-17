"""Costruisce site/data.js (bundle compatto per la pagina) dai file giornalieri in data/ (anni chiusi, versionati)
e data/open/ (anno corrente e precedente, scaricati dal workflow). Include solo gli ultimi WINDOW_YEARS anni: la pagina
resta a dimensione costante e la finestra scorre da sola a ogni cambio d'anno."""
import json, glob, datetime, collections, os

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data') + os.sep
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'site', 'data.js')
WINDOW_YEARS = 10
FIRST_YEAR = datetime.date.today().year - WINDOW_YEARS + 1

# pollutant code, label, unit, regulatory metric, threshold, threshold kind
POLL = {
    'PM10 (SM2005)':            dict(code='PM10', label='PM10',          metric='a', limit=50,  kind='legge', desc='media giornaliera > 50 µg/m³ (max 35 superamenti/anno)'),
    'Particelle sospese PM2.5': dict(code='PM25', label='PM2.5',         metric='a', limit=15,  kind='oms',   desc='media giornaliera > 15 µg/m³ (linea guida OMS 2021; la legge fissa solo un limite annuale di 25)'),
    'Biossido di Azoto':        dict(code='NO2',  label='NO₂',           metric='m', limit=200, kind='legge', desc='massimo orario > 200 µg/m³ (max 18 superamenti/anno)'),
    'Ozono':                    dict(code='O3',   label='O₃',            metric='x', limit=120, kind='legge', desc='massimo giornaliero della media mobile su 8 ore > 120 µg/m³ (valore obiettivo, max 25 gg/anno)'),
    'Biossido di Zolfo':        dict(code='SO2',  label='SO₂',           metric='a', limit=125, kind='legge', desc='media giornaliera > 125 µg/m³ (max 3/anno); orario > 350'),
    'Monossido di Carbonio':    dict(code='CO',   label='CO',            metric='x', limit=10,  kind='legge', desc='massimo giornaliero della media mobile su 8 ore > 10 mg/m³'),
    'Benzene':                  dict(code='C6H6', label='Benzene',       metric='a', limit=None, kind=None,   desc='solo limite annuale (5 µg/m³): nessuna soglia giornaliera'),
    'Ammoniaca':                dict(code='NH3',  label='NH₃',           metric='a', limit=None, kind=None,   desc='nessun limite di legge'),
    'Ossidi di Azoto':          dict(code='NOX',  label='NOₓ',           metric='a', limit=None, kind=None,   desc='nessun limite di legge (limite vegetazione annuale 30 µg/m³)'),
    'BlackCarbon':              dict(code='BC',   label='Black carbon',  metric='a', limit=None, kind=None,   desc='nessun limite di legge'),
}
ORDER = ['PM10', 'PM25', 'NO2', 'O3', 'SO2', 'CO', 'C6H6', 'NH3', 'NOX', 'BC']

def find(name):
    for d in (D + 'open' + os.sep, D):
        if os.path.exists(d + name): return d + name
    raise SystemExit(f'manca {name}: eseguire prima scripts/fetch_arpa.py')

year_files = {}
for f in glob.glob(D + 'arpa-pv-20??.json') + glob.glob(D + 'open' + os.sep + 'arpa-pv-20??.json'):
    y = int(f[-9:-5])
    if y >= FIRST_YEAR: year_files.setdefault(y, f)   # data/open ha la precedenza (è il più fresco)
if not year_files: raise SystemExit('nessun file annuale in data/: eseguire prima scripts/fetch_arpa.py')

sens_raw = json.load(open(find('arpa-pv-stazioni.json')))['sensors']
stations = {}
sensors = {}
for s in sens_raw:
    if s.get('datastop') and s['datastop'] < f'{FIRST_YEAR}-01-01': continue   # dismesso prima della finestra
    p = POLL[s['nometiposensore']]
    st = stations.setdefault(s['idstazione'], dict(
        id=int(s['idstazione']), name=s['nomestazione'], comune=s['comune'],
        lat=float(s['lat']), lng=float(s['lng']), quota=int(s['quota']), sensors=[]))
    sid = int(s['idsensore'])
    st['sensors'].append(sid)
    sensors[sid] = dict(id=sid, st=int(s['idstazione']), p=p['code'], unit=s['unitamisura'],
                        start=s['datastart'][:10], stop=(s.get('datastop') or '')[:10] or None)

# series: sensor -> year -> {a:[...366], m:[...], x:[...]} (index = day of year - 1)
series = collections.defaultdict(dict)
years = []
minday, maxday = None, None
for y in sorted(year_files):
    d = json.load(open(year_files[y]))
    y = d['year']; years.append(y)
    ndays = 366 if (y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)) else 365
    for sid, day, a, m, n, x in d['rows']:
        dt = datetime.date.fromisoformat(day)
        i = dt.timetuple().tm_yday - 1
        ys = series[sid].setdefault(y, dict(a=[None]*ndays, m=[None]*ndays, x=[None]*ndays, n=[None]*ndays))
        ys['a'][i] = a; ys['m'][i] = m; ys['x'][i] = x; ys['n'][i] = n
        if minday is None or day < minday: minday = day
        if maxday is None or day > maxday: maxday = day

# drop empty arrays: PM sensors have m==a and no x; keep m only if it differs anywhere; keep x only if any value.
# 'p' lists day indexes with partial hourly coverage (< 18 of 24 hours) for hourly sensors.
for sid, ysd in series.items():
    hourly = any((v or 0) > 1 for arr in ysd.values() for v in arr['n'])
    for y, arr in ysd.items():
        if all(v is None for v in arr['x']): del arr['x']
        if all((arr['m'][i] is None) or (arr['a'][i] == arr['m'][i]) for i in range(len(arr['a']))): del arr['m']
        if hourly:
            p = [i for i, v in enumerate(arr['n']) if v is not None and v < 18]
            if p: arr['p'] = p
        del arr['n']

# meteo: stazione -> anno -> {wc, tmax, tmin, pr, wmax, wg} (indice = giorno dell'anno - 1), stesso schema
# di 'series' ma per centralina invece che per sensore. Fonte: Open-Meteo (open-meteo.com), rianalisi
# ERA5/ERA5-Land di ECMWF, licenza CC BY 4.0 — è il dato del punto griglia più vicino alla centralina
# (risoluzione ~9-25 km), non una misura fatta sul posto. File opzionali: se mancano (fetch_meteo.py non
# ancora eseguito) il bundle resta valido, semplicemente senza il campo 'meteo'.
meteo_files = {}
for f in glob.glob(D + 'meteo-pv-20??.json') + glob.glob(D + 'open' + os.sep + 'meteo-pv-20??.json'):
    y = int(f[-9:-5])
    if y >= FIRST_YEAR: meteo_files.setdefault(y, f)   # data/open ha la precedenza (è il più fresco)
meteo = collections.defaultdict(dict)
# I valori meteo vengono arrotondati qui, non nei file sorgente (che restano fedeli a quanto risponde l'API):
# la pagina mostra comunque temperature e vento come interi e le precipitazioni con un decimale, quindi a schermo
# non cambia nulla, mentre il bundle scende di circa un terzo sulla parte meteo. Un float intero viene scritto
# come intero (0 invece di 0.0): le giornate senza pioggia sono la maggioranza e risparmiano due caratteri l'una.
def r0(v): return None if v is None else int(round(v))
def r1(v):
    if v is None: return None
    v = round(v, 1)
    return int(v) if v == int(v) else v
for y in sorted(meteo_files):
    d = json.load(open(meteo_files[y]))
    ndays = 366 if (y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)) else 365
    for sid, day, wc, tmax, tmin, pr, wmax, wg in d['rows']:
        if sid not in stations: continue   # centralina fuori dalla finestra corrente: meteo non utile
        i = datetime.date.fromisoformat(day).timetuple().tm_yday - 1
        ys = meteo[sid].setdefault(y, dict(wc=[None]*ndays, tmax=[None]*ndays, tmin=[None]*ndays, pr=[None]*ndays, wmax=[None]*ndays, wg=[None]*ndays))
        ys['wc'][i] = wc; ys['tmax'][i] = r0(tmax); ys['tmin'][i] = r0(tmin); ys['pr'][i] = r1(pr); ys['wmax'][i] = r0(wmax); ys['wg'][i] = r0(wg)

# sort station sensors by pollutant order
for st in stations.values():
    st['sensors'].sort(key=lambda sid: (ORDER.index(sensors[sid]['p']), sensors[sid]['start']))

bundle = dict(
    generated=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%MZ'),
    range=[minday, maxday],
    years=years,
    pollutants={p['code']: dict(label=p['label'], metric=p['metric'], limit=p['limit'], kind=p['kind'], desc=p['desc']) for p in POLL.values()},
    order=ORDER,
    stations=sorted(stations.values(), key=lambda s: s['name']),
    sensors=sensors,
    series={str(k): v for k, v in series.items()},
    meteo={str(k): {str(y): v for y, v in yd.items()} for k, yd in meteo.items()},
    geo=json.load(open(D + 'comuni_pv.geojson')),
    prov=json.load(open(D + 'provincia_pv.geojson')),
)
js = 'window.ARPA_DATA=' + json.dumps(bundle, ensure_ascii=False, separators=(',', ':')) + ';'
open(OUT, 'w').write(js)

# Sitemap: una sola pagina, con lastmod pari all'ultimo giorno di dati (non alla data di build: il file
# viene riscritto ogni notte, ma la pagina cambia davvero solo quando arrivano dati nuovi). Va sottomessa
# da Google Search Console: robots.txt vale solo alla radice dell'host, che questo repository non serve.
SITE_URL = os.environ.get('SITE_URL', 'https://danbas.github.io/aria-del-pavese/')
open(os.path.join(os.path.dirname(OUT), 'sitemap.xml'), 'w').write(
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    f'  <url>\n    <loc>{SITE_URL}</loc>\n    <lastmod>{maxday}</lastmod>\n'
    '    <changefreq>daily</changefreq>\n  </url>\n</urlset>\n')
print('window', FIRST_YEAR, '-', years[-1], 'stations', len(stations), 'sensors', len(sensors), 'range', minday, maxday, 'bytes', len(js.encode()))
