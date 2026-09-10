# Tłumaczenia generowane podczas oglądania

Po S tryb **Word-by-word translation** najpierw pokazuje lokalnie zapisane wpisy live.
Pozostałe hasła odczytuje z pojedynczych plików R2; dopiero HTTP 404 pozwala na
generowanie przez Gemini, maksymalnie trzy jednocześnie w workerze
rozszerzenia. Każdy wynik pojawia się osobno, bez czekania na pozostałe.
Zamknięcie trybu lub zmiana języka blokuje wyświetlenie spóźnionych wyników.
Trwające żądanie może nadal dokończyć zapis na serwerze.
Podczas oczekiwania słowo ma delikatnie pulsujące niebieskie tło. Animacja znika
po wyniku, błędzie albo zamknięciu trybu; przy ograniczeniu ruchu jest zastępowana
stałym podświetleniem.

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
Hover, zaznaczenie słowa, S i pozostałe opcje tłumaczenia pojedynczych słów
korzystają z tej samej kolejności: lokalna kopia live → plik live na R2 → Gemini
przy braku wpisu. Odczyt istniejącego pliku R2 nie wymaga logowania;
wygenerowanie brakującego wpisu wymaga konta i limitu AI.
Na stronach zaznaczenie pojedynczego słowa (także ze skrajną interpunkcją)
pokazuje definicję, synonimy i trzy przykłady z wpisu live. Zaznaczenie kilku słów
jest tłumaczone jako cały tekst przez cache `dictionaries/translations`, bez
tworzenia hasła słownikowego dla całej frazy.
Nie trzeba uruchamiać Pythona ani aktualizować sum SHA dużych słowników.
Hash słowa to SHA-256 UTF-8 po normalizacji NFKC i usunięciu skrajnych spacji;
wielkość liter jest zachowana. Rozszerzenie usuwa też skrajną interpunkcję przed wyszukiwaniem.

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
