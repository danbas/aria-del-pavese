#!/usr/bin/env python3
"""Scarica dagli open data ARPA Lombardia (dati.lombardia.it, API Socrata) i dati dei sensori
della provincia di Pavia e li aggrega a livello giornaliero, un file JSON per anno in data/.

Uso:
  python scripts/fetch_arpa.py                    # anno corrente + precedente (default), più gli anni mancanti
  python scripts/fetch_arpa.py --years all        # tutto dal primo anno
  python scripts/fetch_arpa.py --years 2024,2025  # anni specifici

Dove finiscono i file:
  data/       anni "chiusi" (<= anno corrente - 2): non cambiano più, sono versionati nel repository
  data/open/  anno corrente e precedente, più l'anagrafica sensori: riscaricati ogni notte, NON versionati (.gitignore)
Quando un anno matura (a gennaio, due anni dopo) viene scritto in data/ e il workflow lo committa una volta sola.

Variabili d'ambiente opzionali:
  SOCRATA_APP_TOKEN  token applicativo Socrata (evita il throttling; non è obbligatorio)
  ARPA_FIRST_YEAR    primo anno della finestra (default: anno corrente - 9, cioè dieci anni)

Metriche per sensore e giorno (calendario, per data del timestamp):
  a = media dei valori orari validi (stato VA), m = massimo orario, n = numero di ore valide,
  x = massimo giornaliero della media mobile su 8 ore (solo O3 e CO; finestra valida con >= 6 ore su 8).
Per i sensori giornalieri (PM10, PM2.5) a == m e n == 1.
"""
import argparse, datetime as dt, json, os, sys, time, urllib.parse, urllib.request

BASE = 'https://www.dati.lombardia.it/resource/'
DS_STATIONS = 'ib47-atvt'          # Stazioni qualità dell'aria (anagrafica sensori)
WINDOW_YEARS = 10                  # deve coincidere con build_data.py
FIRST_YEAR = int(os.environ.get('ARPA_FIRST_YEAR', dt.date.today().year - WINDOW_YEARS + 1))
PROVINCIA = 'PV'
O3CO = ('Ozono', 'Monossido di Carbonio')
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
OPEN_DIR = os.path.join(DATA_DIR, 'open')


def is_closed(year: int) -> bool:
    """Un anno è chiuso (e versionabile) quando ARPA ha avuto tutto l'anno successivo per validarlo."""
    return year <= dt.date.today().year - 2


def year_path(year: int) -> str:
    return os.path.join(DATA_DIR if is_closed(year) else OPEN_DIR, f'arpa-pv-{year}.json')


def dataset_for(year: int) -> str:
    """ARPA suddivide la serie storica in più dataset; quello dell'anno corrente cambia a inizio anno."""
    if year <= 2009:
        return 'cthp-zqrr'          # Dati sensori aria 2000-2009
    if year <= 2017:
        return 'nr8w-tj77'          # Dati sensori aria 2010-2017
    if year < dt.date.today().year:
        return 'g2hp-ar79'          # Dati sensori aria dal 2018 (anni chiusi)
    return 'nicp-bhqi'              # Dati sensori aria (anno corrente)


def soda(dataset: str, params: dict, retries: int = 4) -> list:
    url = BASE + dataset + '.json?' + urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
    headers = {'Accept': 'application/json', 'User-Agent': 'aria-del-pavese (GitHub Actions)'}
    token = os.environ.get('SOCRATA_APP_TOKEN')
    if token:
        headers['X-App-Token'] = token
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=300) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            if attempt == retries - 1:
                raise
            wait = 5 * (attempt + 1)
            print(f'  tentativo {attempt + 1} fallito ({e}); riprovo tra {wait}s', file=sys.stderr)
            time.sleep(wait)


def fetch_sensors() -> list:
    rows = soda(DS_STATIONS, {
        'provincia': PROVINCIA, '$limit': 1000,
        '$select': 'idsensore,nometiposensore,unitamisura,idstazione,nomestazione,quota,comune,storico,datastart,datastop,lat,lng',
    })
    keep = [r for r in rows if not r.get('datastop') or r['datastop'] >= f'{FIRST_YEAR}-01-01']
    keep.sort(key=lambda r: (r['nomestazione'], r['nometiposensore']))
    return keep


def fetch_year(year: int, sensors: list) -> dict:
    ds = dataset_for(year)
    ids = [s['idsensore'] for s in sensors]
    inlist = ','.join(f"'{i}'" for i in ids)
    rng = f"data >= '{year}-01-01T00:00:00' and data < '{year + 1}-01-01T00:00:00'"
    print(f'{year}: dataset {ds}, {len(ids)} sensori', file=sys.stderr)
    grouped_params = {
        '$select': 'idsensore as s,date_trunc_ymd(data) as d,avg(valore) as a,max(valore) as m,count(valore) as n',
        '$where': f"idsensore in({inlist}) and stato='VA' and valore > -999 and {rng}",
        '$group': 's,d', '$limit': 200000,
    }
    grouped = soda(ds, grouped_params)
    if not grouped and year == dt.date.today().year - 1 and ds != 'nicp-bhqi':
        # a inizio anno ARPA impiega qualche settimana a spostare l'anno appena chiuso nel dataset storico:
        # nel frattempo è ancora in quello "corrente"
        ds = 'nicp-bhqi'
        print(f'  {year} non ancora nel dataset storico: riprovo su {ds}', file=sys.stderr)
        grouped = soda(ds, grouped_params)
    o3co = [s['idsensore'] for s in sensors if s['nometiposensore'] in O3CO]
    hourly = soda(ds, {
        '$select': 'idsensore,data,valore',
        '$where': f"idsensore in({','.join(repr(i) for i in o3co)}) and stato='VA' and valore > -999 and {rng}",
        '$order': 'idsensore,data', '$limit': 400000,
    }) if o3co else []
    # massimo giornaliero della media mobile su 8 ore
    by_sensor: dict[str, dict[int, float]] = {}
    for r in hourly:
        h = int(dt.datetime.fromisoformat(r['data']).replace(tzinfo=dt.timezone.utc).timestamp() // 3600)
        by_sensor.setdefault(r['idsensore'], {})[h] = float(r['valore'])
    x8: dict[tuple, float] = {}
    for sid, hours in by_sensor.items():
        for h in hours:
            vals = [hours[k] for k in range(h - 7, h + 1) if k in hours]
            if len(vals) >= 6:
                mean = sum(vals) / len(vals)
                key = (sid, dt.datetime.fromtimestamp(h * 3600, dt.timezone.utc).strftime('%Y-%m-%d'))
                if key not in x8 or x8[key] < mean:
                    x8[key] = mean
    rows = []
    for g in grouped:
        day = g['d'][:10]
        x = x8.get((g['s'], day))
        rows.append([int(g['s']), day, round(float(g['a']), 1), float(g['m']), int(g['n']), round(x, 1) if x is not None else None])
    rows.sort(key=lambda r: (r[0], r[1]))
    print(f'  {len(grouped)} righe giornaliere, {len(hourly)} righe orarie O3/CO', file=sys.stderr)
    return {'year': year, 'dataset': ds, 'generated': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'rows': rows}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--years', default='current,previous', help='"all", "current,previous" oppure lista di anni separati da virgola')
    args = ap.parse_args()
    today = dt.date.today()
    if args.years == 'all':
        years = list(range(FIRST_YEAR, today.year + 1))
    else:
        years = []
        for tok in args.years.split(','):
            tok = tok.strip()
            years.append(today.year if tok == 'current' else today.year - 1 if tok == 'previous' else int(tok))
    # gli anni senza file vengono comunque scaricati, così un clone vuoto si popola da solo
    for y in range(FIRST_YEAR, today.year + 1):
        if y not in years and not os.path.exists(year_path(y)):
            years.append(y)
    years = sorted(set(years))
    os.makedirs(OPEN_DIR, exist_ok=True)
    sensors = fetch_sensors()
    with open(os.path.join(OPEN_DIR, 'arpa-pv-stazioni.json'), 'w', encoding='utf-8') as f:
        json.dump({'generated': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'sensors': sensors}, f, ensure_ascii=False)
    print(f'{len(sensors)} sensori in provincia di {PROVINCIA}; anni: {years}', file=sys.stderr)
    for y in years:
        out = fetch_year(y, sensors)
        if not out['rows'] and os.path.exists(year_path(y)):
            print(f'  nessuna riga per il {y}: mantengo il file esistente', file=sys.stderr)
            continue
        with open(year_path(y), 'w', encoding='utf-8') as f:
            json.dump(out, f, ensure_ascii=False, separators=(',', ':'))


if __name__ == '__main__':
    main()
