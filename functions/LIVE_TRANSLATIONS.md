# Tłumaczenia generowane podczas oglądania

## Aktualny przepływ: R2 tylko dla `dictionaries/live/` + statyczne frazy JSON

W Cloudflare R2 przechowywane są wyłącznie zweryfikowane pojedyncze słowa w ścieżce:
`dictionaries/live/<source>-<target>/<sha256(word)>.json`.

Foldery `dictionaries/translations` oraz `dictionaries/phrase` w R2 zostały całkowicie usunięte.
Tłumaczenia zdań są wykonywane przez AI w locie bez zapisywania w R2, a powszechne frazy wielowyrazowe dla trybu Word-by-word znajdują się w statycznych plikach JSON w rozszerzeniu:
`dictionaries/phrase/<source>-<target>.json` (np. `dictionaries/phrase/en-pl.json`).

**Po kliknięciu S najpierw próbujemy Gemini (`kind: segments`).** Jedno zapytanie
analizuje cały napis i zwraca krótkie tłumaczenia słów oraz spójnych zwrotów,
z indeksami tokenów. Poprawne wyniki są zapamiętywane lokalnie dla dokładnego
tekstu, tokenów i pary języków; równoczesne kliknięcia współdzielą zapytanie.
Próba ma budżet 4 sekund (sieć 3,5 s). Brak logowania, limit, błąd lub timeout
powoduje ciche przejście do dotychczasowego słownika fraz i słów. Brakujące
słowa nadal tłumaczy mechanizm awaryjny bez dodatkowych wywołań Gemini.
Wynik nie zmienia się nagle po zakończeniu fallbacku. Zamknięcie trybu lub zmiana
języka blokuje wyświetlenie spóźnionych odpowiedzi.

Nowa analiza Gemini zużywa jedno użycie AI zgodnie z planem; błędy serwera
zwracają użycie. Wyniki kontekstowe nie są zapisywane w ogólnym słowniku R2.
Lokalny cache i dotychczasowy fallback nie zużywają AI.

### Odporność na błędy

1. R2 jest sprawdzane przed rezerwacją AI dla pojedynczych słów. Trafienie istniejącego wpisu kończy request bez AI i bez zużycia kolejnego limitu.
2. Statyczne frazy wielowyrazowe są ładowane do pamięci $O(1)$ bez zapytań sieciowych i bez ryzyka rate-limitów.
3. Błąd backendowego tłumaczenia zdania ma końcowy fallback do istniejącego tłumacza `QT.translate`, zamiast od razu pokazywać pusty ekran.

## Zapis i struktura

- Słowa w R2: `dictionaries/live/<source>-<target>/<sha256-słowa>.json`, np.
  `dictionaries/live/en-pl/<hash>.json`.
  Zawartość: `{ "słowo": { "languageValidation": 1, "t": "...", "d": {"s":"...","t":"..."}, "s": [], "e": [...] } }`.
  Wpisy są współdzielone między użytkownikami.
- Frazy w rozszerzeniu: `dictionaries/phrase/<source>-<target>.json`.
  Zawartość: `{ "play with fire": "igrać z ogniem", "on thin ice": "na cienkim lodzie", "take off": "startować", ... }`.
- W R2 pozostaje wyłącznie folder `dictionaries/live/`. Folder `dictionaries/translations/` i `dictionaries/phrase/` zostały usunięte.

Teksty źródłowe do **200 znaków włącznie** mogą być zapisywane w R2. Teksty
**powyżej 200 znaków** są tłumaczone przez AI bez odczytu ani zapisu R2 i bez
blokady współdzielonego cache. Limit jest egzekwowany na backendzie i liczony
w znakach Unicode tekstu źródłowego (nie w bajtach ani długości tłumaczenia).
Obowiązują nadal limity AI, zwrot użycia po błędzie i lokalny cache rozszerzenia.

Rozszerzenie nie pobiera `catalog.json`, plików `releases/...` ani lokalnych
pakietów `dictionaries/<język>.json`. Stare pakiety w IndexedDB są ignorowane.
Jedynym źródłem haseł są pojedyncze pliki `dictionaries/live` i ich lokalne kopie.
Hover, zaznaczenie słowa i pozostałe opcje tłumaczenia pojedynczych słów
korzystają z tej samej kolejności: lokalna kopia live → plik live na R2 → Gemini
przy braku wpisu. Odczyt istniejącego pliku R2 nie wymaga logowania;
wygenerowanie brakującego wpisu wymaga konta i limitu AI.
Na stronach zaznaczenie pojedynczego słowa (także ze skrajną interpunkcją)
pokazuje definicję, synonimy i trzy przykłady z wpisu live. Zaznaczenie kilku słów
jest tłumaczone jako cały tekst przez cache `dictionaries/translations`, bez
tworzenia hasła słownikowego dla całej frazy.
Nie trzeba uruchamiać Pythona ani aktualizować sum SHA dużych słowników.
Hash słowa to SHA-256 UTF-8 po normalizacji NFKC i usunięciu skrajnych spacji;
klucz jest sprowadzany do małych liter. Rozszerzenie usuwa też skrajną interpunkcję przed wyszukiwaniem.

Obsługiwane są wszystkie obecne języki aplikacji: cs, de, en, es, fr, it, ja,
ko, nl, pl, pt, w obu kierunkach. Zmieniając listę języków aplikacji, zaktualizuj
też listę w `live-translation.js`.

## Backend i limity

Akcja `liveTranslation` działa wewnątrz istniejącego `geminiProxy`, wymaga
Firebase ID tokenu i używa istniejących sekretów `LECTORO_GEMINI_API_KEY`,
`R2_SECRET_ACCESS_KEY` oraz ustawień R2 w `index.js`. Konto R2 musi pozwalać
na GetObject i PutObject w używanym buckecie. Klucze nie trafiają do rozszerzenia.

R2 jest sprawdzane przed rezerwacją limitu AI. Jedno nowe hasło lub nowe zdanie
zużywa jedno użycie AI; trafienie w cache nie zużywa kolejnego. `sentence` wykonuje
jedno wywołanie generacji (pełne `t` + opcjonalne frazy), bez drugiego review AI.
`segments` nie rezerwuje użycia i nigdy nie wywołuje AI. Rezerwacja słowa/zdania
jest transakcyjna; błąd generowania lub walidacji zwalnia rezerwację. Jeśli AI
zwróciło poprawne `t`, ale sam zapis R2 zawiedzie, wynik jest zwracany użytkownikowi
zamiast błędu i użycie pozostaje zużyte. Blokada Firestore w `liveTranslationLocks`
zapobiega równoczesnemu generowaniu tego samego klucza między instancjami.

## Uruchomienie

Z katalogu głównego repozytorium wdrażamy tylko zmieniony backend:

```powershell
firebase deploy --only functions:geminiProxy --project extension-eng --config functions/firebase.json
```

Następnie przeładuj rozszerzenie w `chrome://extensions` i odśwież stronę filmu.
Trzeba zaktualizować zarówno backend, jak i rozszerzenie. Uruchomiona wcześniej
wersja backendu lub starszy ZIP może nadal używać poprzednich ścieżek. Istniejące
pliki z poprzednich folderów nie są automatycznie przenoszone ani usuwane.
Sprawdź S dla hasła nieobecnego w głównym słowniku, jego szczegóły po najechaniu,
powtórzenie po restarcie rozszerzenia oraz obie opcje tłumaczenia osobno i razem.
Pierwsza generacja zależy od czasu API; nie gwarantujemy czasu w milisekundach.

Testy bez płatnych wywołań API:

```powershell
node --test functions/live-translation.test.js functions/r2-storage.test.js tests/live-dictionary-store.test.js tests/translation-routing.test.js tests/reading-modes.test.js
```

API użyte w implementacji:
- https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite
- https://ai.google.dev/gemini-api/docs/structured-output
- https://developers.cloudflare.com/r2/api/s3/api/

## Dictionary language validation

Before a new live word entry is saved, a separate AI review checks every field:
`t`, `d.t` and `e[].t` must use the target language; `d.s`, `s[]` and `e[].s`
must use the source language. It also checks translation accuracy and a shared
meaning. Dictionary keys use NFKC, trimming and lowercase on both client and
server, so `wounds`, `WOUNDS` and `wOunDS` share the same R2 object, offline
cache and in-flight request. Definitions, examples and sentence translations
retain natural capitalization. Existing lowercase objects are reused; uppercase
legacy objects are no longer addressed.
The review returns the complete corrected entry in the same response. A new
entry needs at most two AI calls (generation and review); an unmarked legacy
entry goes directly to review and needs only one. Accepted cached entries need
no AI calls. If review fails or is malformed, nothing is saved and the usage
reservation is refunded. The user's usage is reserved only once. AI review reduces errors but cannot
guarantee perfect language identification or translation.

Only the backend adds `languageValidation: 1` to an accepted entry. Unmarked
legacy live entries in R2 or IndexedDB are treated as missing and replaced on
next online lookup through the normal authenticated generation flow. Their
replacement requires available AI usage. Paths stay unchanged; no bulk deletion
is performed. New R2 objects use `If-None-Match: *`; replacement uses the ETag
from the last read in `If-Match`, so repairing an existing entry does not fail
just because its file already exists and cannot overwrite a concurrent update.
See [R2 conditional operations](https://developers.cloudflare.com/r2/api/s3/api/).
Deploy the backend before releasing the updated extension.

Word generation/review calls each have a 12-second network timeout; R2 reads
and writes each have a 5-second request timeout. The client deadline also covers
reading the response body. Backend errors identify the failing stage without
exposing provider details, and concurrent update conflicts use the existing
bounded polling flow. Verified IndexedDB entries are promoted into the bounded
in-memory cache to avoid reading IndexedDB again on each hover.
This validation applies to live dictionary words; sentence translations and
the standalone Python pack generator do not use this review step.

## Nightly R2 pack consolidation

`consolidateDictionaryDaily` runs at 03:00 Europe/Warsaw in europe-west1.
It merges validated entries from `dictionaries/live/en-<target>/` into
`dictionaries/packs/en-<target>.json`, including corrections to existing words.
Live objects are retained. Unmarked legacy entries remain excluded.

Both `geminiProxy` and the scheduled function require `R2_ACCESS_KEY_ID` in
`functions/.env.extension-eng`, alongside the R2 account, bucket and public URL.
`R2_SECRET_ACCESS_KEY` remains in Secret Manager. The access key ID and secret
must belong to the same R2 credentials. There is no hardcoded access key fallback.
Preserve the project environment file when deploying; it is intentionally ignored
by Git. The CLI can load it with Node's `--env-file=functions/.env.extension-eng`
option; supply the secret separately through the environment.

Deploy from `functions/` with:

```sh
firebase deploy --only functions:consolidateDictionaryDaily,functions:geminiProxy --project extension-eng
```

Do not commit a generated `functions.yaml`: Firebase prioritizes it over source
code discovery, which can silently deploy outdated schedule/resource settings.
R2 read/list failures prevent publishing an incomplete pack and fail the run.
Other language pairs are still attempted; any failed pair makes the overall job
fail. Cloud Scheduler retries failures up to three times with 60–300s backoff.
Check the final per-pair results in Cloud Logging, including `uploaded`,
`newWordsAdded`, `updatedWords`, and `liveFilesExamined`.
