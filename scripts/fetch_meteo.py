#!/usr/bin/env python3
"""Scarica dati meteo storici da Open-Meteo (archive API, rianalisi ERA5/ERA5-Land di ECMWF, licenza CC BY 4.0)
per le coordinate delle centraline ARPA della provincia di Pavia, un file JSON per anno in data/ (stesso schema
di fetch_arpa.py: anni "chiusi" in data/, anno corrente e precedente in data/open/).

Uso:
  python scripts/fetch_meteo.py                    # anno corrente + precedente (default)
  python scripts/fetch_meteo.py --years all         # tutta la finestra di dieci anni (backfill iniziale)
  python scripts/fetch_meteo.py --years 2024,2025   # anni specifici

Non serve una chiave API per uso non commerciale (nessun secret da configurare). Attenzione: questo non è un
dato ARPA — è il rianalisi meteorologico del punto griglia più vicino alla centralina (risoluzione ~9-25 km a
seconda del modello), quindi rappresentativo della zona ma non una misura fatta sul posto. Gli ultimi giorni
possono mancare (l'archivio ERA5 ha qualche giorno di latenza rispetto a oggi): lo script scarica quello che
l'API restituisce e scarta le righe senza alcun valore, senza bloccarsi.

Richiede che scripts/fetch_arpa.py sia già stato eseguito almeno una volta (legge le coordinate delle centraline
da arpa-pv-stazioni.json).
"""
import argparse, datetime as dt, json, os, sys, time, urllib.parse, urllib.request

BASE = 'https://archive-api.open-meteo.com/v1/archive'
WINDOW_YEARS = 10                  # deve coincidere con fetch_arpa.py e build_data.py
FIRST_YEAR = int(os.environ.get('ARPA_FIRST_YEAR', dt.date.today().year - WINDOW_YEARS + 1))
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
OPEN_DIR = os.path.join(DATA_DIR, 'open')
DAILY_VARS = 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max'


def is_closed(year: int) -> bool:
    """Un anno è chiuso (e versionabile) quando non cambierà più: stessa regola di fetch_arpa.py."""
    return year <= dt.date.today().year - 2


def year_path(year: int) -> str:
    return os.path.join(DATA_DIR if is_closed(year) else OPEN_DIR, f'meteo-pv-{year}.json')


def http_json(url: str, retries: int = 4) -> dict | list:
    headers = {'Accept': 'application/json', 'User-Agent': 'aria-del-pavese (GitHub Actions)'}
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


def load_stations() -> list:
    """Una riga per centralina: (idstazione, lat, lng). Le coordinate vengono da arpa-pv-stazioni.json
    (anagrafica sensori ARPA), già scaricata da fetch_arpa.py."""
    for d in (OPEN_DIR, DATA_DIR):
        p = os.path.join(d, 'arpa-pv-stazioni.json')
        if os.path.exists(p):
            rows = json.load(open(p))['sensors']
            seen = {}
            for s in rows:
                sid = s['idstazione']
                seen.setdefault(sid, (sid, float(s['lat']), float(s['lng'])))
            return sorted(seen.values())
    raise SystemExit('manca arpa-pv-stazioni.json: eseguire prima scripts/fetch_arpa.py')


def fetch_range(stations: list, start: str, end: str) -> dict:
    """Una chiamata sola per tutte le centraline: l'API accetta coordinate multiple separate da virgola e
    restituisce un array di risultati nello stesso ordine delle coordinate richieste (non un dict per id)."""
    params = {
        'latitude': ','.join(str(s[1]) for s in stations),
        'longitude': ','.join(str(s[2]) for s in stations),
        'start_date': start, 'end_date': end,
        'daily': DAILY_VARS, 'timezone': 'Europe/Rome',
    }
    url = BASE + '?' + urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
    data = http_json(url)
    if isinstance(data, dict):  # con una sola centralina l'API non avvolge il risultato in un array
        data = [data]
    return {st[0]: entry.get('daily', {}) for st, entry in zip(stations, data)}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--years', default='current,previous', help='"all", "current,previous" oppure lista di anni separati da virgola')
    args = ap.parse_args()
    today = dt.date.today()
    if args.years == 'all':
        years = list(range(FIRST_YEAR, today.year + 1))
    elif args.years == 'current,previous':
        years = sorted({today.year - 1, today.year})
    else:
        years = sorted(int(y) for y in args.years.split(','))
    years = [y for y in years if y >= FIRST_YEAR]
    if not years:
        print('nessun anno nella finestra da scaricare', file=sys.stderr)
        return

    stations = load_stations()
    start = f'{years[0]}-01-01'
    end = min(dt.date(years[-1], 12, 31), today).isoformat()
    print(f'{len(stations)} centraline, {start} — {end} (fonte: open-meteo.com, ERA5/ERA5-Land, CC BY 4.0)', file=sys.stderr)

    by_station = fetch_range(stations, start, end)

    # spacchetta la risposta per anno, nello stesso formato compatto (liste, non oggetti) di fetch_arpa.py
    rows_by_year: dict[int, list] = {y: [] for y in years}
    for sid, daily in by_station.items():
        times = daily.get('time', [])
        for i, day in enumerate(times):
            y = int(day[:4])
            if y not in rows_by_year:
                continue
            wc, tmax, tmin = daily['weather_code'][i], daily['temperature_2m_max'][i], daily['temperature_2m_min'][i]
            pr, wmax, wg = daily['precipitation_sum'][i], daily['wind_speed_10m_max'][i], daily['wind_gusts_10m_max'][i]
            if wc is None and tmax is None:   # giorno non ancora pubblicato dall'archivio (latenza ERA5)
                continue
            rows_by_year[y].append([sid, day, wc, tmax, tmin, pr, wmax, wg])

    for y in years:
        rows = sorted(rows_by_year[y], key=lambda r: (r[0], r[1]))
        out = {
            'year': y, 'source': 'open-meteo.com (ERA5/ERA5-Land, CC BY 4.0)',
            'generated': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'rows': rows,
        }
        path = year_path(y)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        json.dump(out, open(path, 'w'), ensure_ascii=False, separators=(',', ':'))
        print(f'  {y}: {len(rows)} righe -> {path}', file=sys.stderr)


if __name__ == '__main__':
    main()
