# Tłumaczenia generowane podczas oglądania

S continues to translate independent words through the existing live dictionary:
local entries first, then R2 and generation for missing words. It additionally
analyzes the full subtitle to find genuine multiword expressions such as `get up`.
The analysis returns the complete sentence translation (`t`) and only detected
phrases (`phrases` with `start`, `length`, `t`). It does not translate every word
again. The UI combines detected expressions and keeps the other words separate.
Simple-word filtering runs after phrase detection, so `get` and `up` can form
one expression even if they would be skipped independently.

Storage:
- Full sentence: `dictionaries/translations/<source>-<target>/<sha256(sentence)>.json`.
  Data includes `t`, `phrases`, `tokens`, and `phraseAnalysis: 2`. Ordinary sentence
  translation requests reuse `t` from the same file. An older record containing
  only `t` is enriched on the next phrase-analysis request.
- Extracted expression: `dictionaries/phrase/<source>-<target>/<sha256(phrase)>.json`.
  For example, `{ "get up": { "t": "wstać" } }`.
  Phrase keys use normalized lowercase text and collapsed whitespace. Phrase
  files contain only `t`: no context, tokens or verification metadata. Existing
  records are replaced by reviewed corrections, removing legacy context fields;
  conditional writes protect concurrent updates.
  The sentence retains its contextual phrase translations, since an expression
  can have different meanings in different sentences.
- Independent words remain in `dictionaries/live/...`.

No new `dictionaries/segments` objects are written. The internal request kind
`segments` now means sentence translation plus phrase extraction. At most 12
non-overlapping multi-token expressions are accepted per subtitle, with at most
150 displayed tokens and 4000 characters. An empty phrase list is valid.
Detected phrases undergo one batched language review which corrects translations
in the selected target language. A normalized source copy is rejected even if
AI approves it. Rejected or malformed reviews save nothing and refund usage.
AI review reduces language mistakes but is not an absolute semantic guarantee.
Legacy analyses are re-reviewed on access; the local analysis cache uses a new
namespace to avoid displaying old unverified results. This is migration on use,
not a bulk rewrite of the bucket. Generation and review each have a 12-second
timeout. The complete analysis uses one AI reservation; single-word generation retains
its existing usage rules. Analysis results also have an offline local cache.
Phrases are saved before the sentence is marked analyzed, so failed extraction
storage can be retried. The bounded analysis can be cached above 200 characters;
the existing limit for ordinary sentence translation requests remains unchanged.
Deploy the backend before updating the extension.

The following single-word dictionary flow applies to hover and word selection:

Nowe wpisy zawierają `t`, `d`, `s`, `e`, w tym definicję i trzy przykłady wraz
z tłumaczeniami. Dopuszczamy tłumaczenie kilkoma słowami. Słownik wybiera jedno
powszechne znaczenie; tłumaczenie całego zdania uwzględnia kontekst tego zdania.
Proste angielskie słowa nadal są pomijane zgodnie z dotychczasową logiką.

**AI Translate full sentence** używa tej samej akcji backendu, z osobnym typem
`sentence`. Gość i użytkownik bez dostępnych środków AI zachowują dotychczasowe
tłumaczenie Google; wyczerpany limit nie blokuje odczytu istniejącego wyniku R2.
Awaria Gemini/R2 jest pokazywana z możliwością ponowienia.

## Zapis

- Słowa: `dictionaries/live/<source>-<target>/<sha256-słowa>.json`, np.
  `dictionaries/live/en-pl/<hash>.json`, bez poziomu `v1`.
  Zawartość: `{ "słowo": { "t": "...", "d": {"s":"...","t":"..."}, "s": [], "e": [...] } }`.
  Wpisy są współdzielone między użytkownikami.
- Zdania i teksty z więcej niż jednym słowem:
  `dictionaries/translations/<source>-<target>/<sha256-tekstu>.json`.
  Zawartość: `{ "t": "tłumaczenie" }`. Cache jest współdzielony między kontami.
  Oba foldery używają pary języków bezpośrednio po nazwie folderu, bez `v1` i UID.
- Hasła są również zapisywane w IndexedDB. Zdania korzystają z istniejącego
  lokalnego cache tłumaczeń.

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
zużywa jedno użycie AI; trafienie w cache nie zużywa kolejnego. Rezerwacja jest
transakcyjna. Błąd generowania, walidacji lub zapisu zwalnia rezerwację.
Blokada Firestore w `liveTranslationLocks` zapobiega równoczesnemu generowaniu
tego samego klucza między instancjami. Zapis R2 używa `If-None-Match: *`.

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
