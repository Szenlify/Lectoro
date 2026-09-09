# Słownik EN → PL przez Gemini 2.5 Flash-Lite

Generator używa Twojego płatnego klucza Gemini. Zapisuje jeden polski odpowiednik,
definicję po angielsku i po polsku, 0–3 angielskie synonimy i trzy angielskie zdania z polskimi tłumaczeniami. Gotowy JSON jest pobierany
przez Lectoro z R2, a szczegóły pojawiają się pod tłumaczeniem słowa na wideo.

## 1. Otwórz PowerShell w folderze `python`

Jeżeli terminal jest w głównym katalogu repozytorium `Lectoro`, wpisz:

```powershell
cd python
```

**Wszystkie dalsze komendy wykonuj w `Lectoro/python`.** Nie dopisuj do nich ponownie `python/`.
Potrzebujesz zainstalowanego Pythona 3.10 lub nowszego.

## 2. Przygotuj środowisko — jednorazowo

Jeżeli nie masz jeszcze folderu `.venv`, utwórz go:

```powershell
python -m venv .venv
```

Zainstaluj zależności:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Nie musisz aktywować środowiska ani zmieniać zasad uruchamiania skryptów PowerShell.
Jedyna bezpośrednia zależność to `wordfreq`, używana jako lista angielskich słów.

## 3. Ustaw swój klucz — przy każdym nowym terminalu

Wpisz lokalnie swój klucz zamiast `TWOJ_KLUCZ`:

```powershell
$env:GEMINI_API_KEY = "TWOJ_KLUCZ"
```

Klucz obowiązuje w tej sesji terminala. Nie umieszczaj go w plikach projektu ani nie wysyłaj
do repozytorium. Skrypt nie odczytuje plików `.env`. Wywołania są rozliczane na projekcie
powiązanym z kluczem; ponowienia również mogą zużywać płatne tokeny.

## 4. Najpierw sprawdź 10 słów

Ta komenda już korzysta z płatnego API:

```powershell
.\.venv\Scripts\python.exe generate_dictionary.py --count 10 --export-every 10
```

Model jest domyślnie ustawiony na `gemini-2.5-flash-lite`. W konsoli zobaczysz aktualne słowo,
liczbę zapisanych wpisów, pasek 0–100%, liczbę błędów i prób, tempo oraz orientacyjny czas do końca.
W terminalu jeden wiersz aktualizuje się na miejscu, również podczas oczekiwania na API.
Błędy trafiają także do `work/compact/errors.log`; ostatni błąd pozostaje w statusie
(długi wiersz jest skracany do szerokości terminala). Po przekierowaniu wyjścia do pliku
statusy są zapisywane jako osobne linie. Eksport trafia do `dist/dictionaries/`.

## 5. Generuj 50 000 słów

```powershell
.\.venv\Scripts\python.exe generate_dictionary.py --count 50000
```

Poprawne wpisy z próby 10 słów zostaną wykorzystane. Skrypt nie płaci ponownie za ich generowanie.
Domyślnie następne zapytanie startuje od razu po zakończeniu poprzedniego (`--interval 0`).
Oczekiwanie po błędach i limitach API nadal działa. Jeśli chcesz ograniczyć tempo,
możesz ustawić przerwę po udanych zapytaniach:

```powershell
.\.venv\Scripts\python.exe generate_dictionary.py --count 50000 --interval 1
```

Każdy poprawny wpis jest od razu zapisywany w SQLite. Eksport plików do R2 następuje
co 250 nowych wpisów, po zakończeniu i po `Ctrl+C`. Nie uruchamiaj jednocześnie dwóch
generatorów na tej samej bazie; blokada procesu temu zapobiega.

### Zatrzymanie i wznowienie

Zatrzymaj przez `Ctrl+C`. Aktywne zapytanie może najpierw czekać na timeout (domyślnie 120 s).
Aby wznowić, uruchom ponownie komendę z tym samym `--count` i folderem pracy.
Po otwarciu nowego terminala ustaw ponownie klucz z kroku 3.

Błędne wpisy są ponawiane od razu, ze wskazówką dla modelu opisującą błąd walidacji.
Domyślnie limit wynosi 3 próby na brakujące hasło w jednym uruchomieniu
(`--max-attempts 3`). Po wyczerpaniu prób generator przechodzi do pozostałych słów.
Błędy sieci mają rosnące opóźnienie, a HTTP 429 co najmniej 30 sekund; dłuższy
numeryczny `Retry-After` serwera jest respektowany. Po wyczerpaniu prób dla błędu
API/sieci skrypt kończy pracę z zapisanym wynikiem częściowym. HTTP 400/401/403/404
zatrzymują generowanie od razu, aby można było poprawić klucz, model lub konfigurację.
Błędy zapisu są ponawiane maksymalnie 3 razy.

**50 000 oznacza liczbę wybranych haseł.** Nie każde ma jeden polski odpowiednik. Brak synonimów jest dozwolony (`s: []`).
Niepoprawne wpisy nie są zapisywane. Jeśli pozostały braki, skrypt eksportuje poprawne
wpisy, zapisuje listę w `work/compact/pending.json` i kończy się kodem 2 ze statusem
`WYNIK CZESCIOWY` (bez udawania 100%). Ponowne uruchomienie próbuje tylko brakujących
haseł; poprawne wpisy pozostają w bazie. Walidacja sprawdza
format, długość i duplikaty, ale nie gwarantuje poprawności językowej odpowiedzi modelu.

### Eksport zapisanych wpisów bez wywoływania API

```powershell
.\.venv\Scripts\python.exe generate_dictionary.py --count 50000 --export-only
```

Klucz nie jest wymagany. Użyj takiego samego `--count` jak podczas generowania.
Jeśli korzystasz z własnej listy (`--words lista.txt`), niestandardowego `--work` lub `--output`,
powtórz te same opcje przy wznowieniu i eksporcie. Lista UTF-8: jedno angielskie słowo na wiersz.

## 6. Znajdź gotowe pliki

```text
python/
  generate_dictionary.py       generator Gemini i eksport do R2
  test_compact_generator.py    testy bez prawdziwych wywołań API
  requirements.txt             zależności
  README.md                    ta instrukcja
  .venv/                       lokalne środowisko Pythona
  work/
    compact/
      compact.sqlite3          zapisany postęp — zachowaj!
      compact.sqlite3-wal      może istnieć podczas pracy — nie usuwaj
      compact.sqlite3-shm      może istnieć podczas pracy — nie usuwaj
      run.lock                 blokada procesu
      pending.json             brakujące słowa i ostatnie błędy na chwilę eksportu
  dist/
    dictionaries/
      catalog.json
      sources-en-pl.json
      releases/
        compact-HASH/
          en-pl.json
          en-pl.json.gz
```

Foldery wyniku powstają po pierwszym poprawnym eksporcie. W `work/` mogą być także zachowane
bazy i listy ze starszego generatora; obecny korzysta z `work/compact/`.

`en-pl.json` zawiera wyłącznie mapę słów w takim formacie:

```json
{"work":{"t":"praca","d":{"source":"an activity you do as part of your job","target":"czynność wykonywana w ramach pracy"},"s":["job","labor","employment"],"e":[{"source":"I have work today.","target":"Mam dziś pracę."},{"source":"Her work is important.","target":"Jej praca jest ważna."},{"source":"We work every day.","target":"Pracujemy codziennie."}]}}
```

Każdy eksport może tworzyć nowe wydanie `compact-HASH`. **Aktualne wydanie wskazuje
`catalog.json`; nie wybieraj folderu na podstawie nazwy ani kolejności alfabetycznej.**

Starsze wpisy bez tłumaczeń przykładów lub z czterema synonimami generator automatycznie
kolejkuje do ponownego wygenerowania przy zwykłym uruchomieniu. To wymaga zapytań do API;
kopia starych wpisów zostaje w tabeli `legacy_entries` w SQLite. Sam `--export-only`
nie uzupełnia tłumaczeń i odrzuca wpisy w starym formacie. Dla testowej bazy uruchom
`generate_dictionary.py --count 10 --export-every 10` i wgraj nowy folder `dictionaries`.

Definicja ma format `d: {source, target}`: tekst angielski i jego polskie tłumaczenie.
Jeśli istniejący wpis ma poprawne przykłady i synonimy, ale definicję jako pojedynczy tekst,
zwykłe uruchomienie generatora uzupełni przez Gemini tylko polską definicję. Pozostała treść
zostaje zachowana; kopia wpisu jest w tabeli `definition_upgrades`. Przerwaną aktualizację
można wznowić tą samą komendą. `--export-only` nie wykonuje tłumaczeń.
W hoverze polską definicję rozwija się kliknięciem definicji angielskiej.
Te pary definicji i przykładów można później wykorzystać do indeksu PL → EN;
polskie synonimy wymagają osobnego uzupełnienia dla danego znaczenia.

W hoverze kliknięcie przykładowego zdania rozwija tłumaczenie. Oba teksty mają TTS,
a gwiazdka zapisuje zdanie z tłumaczeniem do powtórek i staje się żółta.
Aby wyświetlić dokładny plik do wysłania:

```powershell
$catalog = Get-Content .\dist\dictionaries\catalog.json -Raw | ConvertFrom-Json
$catalog.pairs.'en-pl'.path
$catalog.pairs.'en-pl'.entryCount
```

## 7. Wgraj pliki do Cloudflare R2

Użyj istniejącego bucketu Lectoro, udostępnionego pod adresem:

```text
https://pub-ee4534784e534bd9af38ba8022bc5e1e.r2.dev/
```

Wgraj cały folder **`python/dist/dictionaries/` do głównego katalogu bucketu R2**.
Struktura lokalna odpowiada strukturze R2 przedstawionej w tabeli. Nie dodawaj poziomu
`dist/` ani `dictionaries/dictionaries/` w buckecie.

Przesyłaj oryginalne pliki z dysku, bez wklejania JSON do edytora i formatowania.
Nawet zmiana wcięć zmienia rozmiar i SHA-256, przez co rozszerzenie odrzuci słownik.

Starszy eksport możesz odtworzyć w nowym folderze bez API:

```powershell
.\.venv\Scripts\python.exe generate_dictionary.py --count 10 --export-only
```

Użyj dotychczasowego `--count` (powyżej: test 10 słów). Postęp pozostaje w
`work/compact/`; stary `dist/compact/` nie jest folderem do publikacji.

| Kolejność | Plik na komputerze, względem `python/` | Klucz obiektu w R2 |
| --- | --- | --- |
| 1 | `dist/dictionaries/releases/compact-HASH/en-pl.json` | `dictionaries/releases/compact-HASH/en-pl.json` |
| 2 | `dist/dictionaries/sources-en-pl.json` | `dictionaries/sources-en-pl.json` |
| 3 — na końcu | `dist/dictionaries/catalog.json` | `dictionaries/catalog.json` |

Po przesłaniu całego folderu wgraj ponownie `catalog.json` do `dictionaries/catalog.json`,
aby katalog został opublikowany po plikach wydania.
Jeśli katalog na CDN zawiera inne pary języków, zachowaj ich wpisy w `pairs` i podmień tylko
`en-pl`. Nowy lokalny katalog może zawierać tylko tę jedną parę.

Dla plików JSON ustaw `Content-Type: application/json`. Zalecane nagłówki cache:

- `catalog.json` i `sources-en-pl.json`: `Cache-Control: no-cache`;
- wersjonowany `en-pl.json`: `Cache-Control: public,max-age=31536000,immutable`.

Bucket musi pozwalać na publiczny odczyt tych obiektów. W razie ograniczeń CORS dopuść GET
z rozszerzenia. Nie zmieniaj zawartości `en-pl.json` po eksporcie: jego rozmiar i SHA-256
muszą zgadzać się z katalogiem. Limit aplikacji to 32 MiB; generator ogranicza długość wpisów.

**Nie wysyłaj na R2** folderów `work/`, `.venv/`, plików `.py` ani klucza API.
`sources-en-pl.json` zawiera atrybucję listy słów `wordfreq`; zachowaj ten plik przy publikacji.

### Opcjonalnie: mniejszy transfer przez gzip

Na początek możesz wysłać zwykły `.json` zgodnie z tabelą. Wersja `.json.gz` jest już wygenerowana.
Aby jej użyć, wgraj jej bajty **pod tym samym kluczem kończącym się na `en-pl.json`**, ustawiając:

```text
Content-Type: application/json
Content-Encoding: gzip
```

Katalog zostaje bez zmian, ponieważ rozmiar i SHA-256 dotyczą rozpakowanego JSON.
Samo wgranie `.json.gz` obok `.json` nie sprawi, że aplikacja zacznie z niego korzystać.

## 8. Sprawdź po publikacji

Otwórz publiczny `dictionaries/catalog.json`, a następnie adres z prefiksem `dictionaries/`
i ścieżką `pairs.en-pl.path`. Oba powinny odpowiadać i zawierać właściwy JSON.

Adres R2 jest już skonfigurowany w `../shared/dictionary-store.js`. Po pobraniu aplikacja
sprawdza rozmiar, sumę SHA-256 i format, a potem zapisuje słownik offline w IndexedDB.
Sprawdzenie nowego katalogu może nastąpić dopiero po wygaśnięciu cache, do 6 godzin.
Na wideo sprawdź słowo obecne w pliku: pod pojedynczym tłumaczeniem powinny być definicja,
synonimy i trzy przykłady. Nie trzeba generować niczego przez API przy najechaniu na słowo.

## Testy generatora — bez płatnych zapytań

```powershell
.\.venv\Scripts\python.exe -B -m unittest discover -s . -p test_compact_generator.py
```
