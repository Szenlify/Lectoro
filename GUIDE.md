# Lectoro — podręcznik projektu

## Zasady pracy

- Zawsze przeczytaj `GUIDE.md` przed analizą i zmianami w projekcie.
- Na bieżąco zapisuj odkryte połączenia plików: krótko, `plik → zależność — rola`. Aktualizuj opis po zmianie; dokumentuj stan rzeczywisty.
- Trzymaj SSOT (Single Source of Truth): jedna odpowiedzialność i jedno źródło reguł. Przed dodaniem logiki sprawdź istniejące moduły współdzielone.
- Nowy plik, zależność, ustawienie lub przepływ wymaga aktualizacji tej mapy. Nie kopiuj logiki do kolejnych ekranów.
- Propozycje zmian wpisuj wyłącznie na dole: `[x]` — zrobione, `[>]` — w trakcie, `[ ]` — propozycja. Propozycja nie oznacza wdrożenia.
- Testuj zmieniony przepływ i zapisuj wynik. Odróżniaj testy kodu od ręcznego sprawdzenia rozszerzenia.

## Języki i źródła reguł

- `shared/constants.js` → konsumenci ustawień — klucze, wartości domyślne, obsługiwane języki i normalizacja.
- `popup/settings.js` → `chrome.storage.local` — zapis `learningLang` (Learning language) i `targetLang` (Native language).
- `shared/translator-service.js` → `shared/constants.js`, storage — wspólny odczyt: `getReadingSettings()`, `getLearningLang()`, `getTargetLang()`.
- Wyjaśnienia AI: język źródła = `learningLang`, odpowiedź = `targetLang`. Nie ma wyboru trybu uproszczonego; stare `aiExplanationLanguage` nie steruje odpowiedzią.
- `shared/ai-prompts.js` → `shared/translator-service.js` — kontrakt promptu i walidacja języka odpowiedzi. Interfejs nie buduje własnych promptów wyjaśnień.
- `content.js` → storage, `shared/utils.js` przez `QT` — czytnik zaznaczenia pobiera Learning language przed odczytem; preferuje pasujący głos Google, potem systemowy.
- `shared/tts-service.js` → `shared/utils.js`, `shared/constants.js`, audio cache — wspólny odczyt; tłumaczenia zachowują język treści.
- `shared/subscription-config.js` / `functions/subscription-config.js` — konfiguracje planów po stronie klienta i serwera; wymagają pilnowania zgodności (propozycja SSOT na dole).

## Uruchomienie i interfejs

| Plik / moduł | Połączenie i rola |
| --- | --- |
| `manifest.json` | Uruchamia `background.js`, wskazuje `popup.html`, kolejność modułów content scripts i `styles.css`. |
| `popup.html` → `popup.css` | Układ ustawień, subskrypcji i szablony zakładek. Ładuje moduły `shared`, Firebase, `popup/firebase-ui.js`, `init.js`, `tts.js`, `settings.js`. |
| `popup/init.js` | Stan i inicjalizacja popupu; ładuje na żądanie `words.js` + `export.js`, `library.js`, `review.js`. |
| `popup/settings.js` → `SubscriptionService`, `SubscriptionConfig` | Języki, suwaki, tryby czytania, widok planów i obsługa rozliczeń. Błąd inicjalizacji ustawień może zatrzymać plany. |
| `popup/firebase-ui.js` → `firebase/firebase-sync.js` | Interfejs konta i logowania. |
| `popup/words.js` → repozytorium słów | Lista, filtrowanie i operacje na zapisanych słowach. |
| `popup/review.js` → SRS, translator, TTS | Powtórki fiszek, oceny, tłumaczenie AI; zapisana para języków fiszki ma znaczenie. |
| `popup/tts.js` → `shared/tts-service.js` | Przyciski odczytu i anulowanie mowy w popupie. |
| `popup/export.js` → `shared/quiz-export.js`, subskrypcje | Eksport i generowanie quizu, limity operacji. |
| `popup/library.js` → `shared/library-items.json` | Katalog polecanych materiałów. |
| `core.js` → moduły `shared` | Udostępnia globalny interfejs `QT`: tooltipy i połączenia z usługami. |
| `content.js` → `QT` | Zaznaczanie tekstu, pasek tłumaczenia, czytnik i podświetlanie fragmentów. |
| `styles.css` | Style interfejsu wstrzykiwanego w strony, w tym nakładek wideo. |
| `background.js` → `shared/*`, Firebase | Worker MV3: wiadomości, słownik, synchronizacja, przypomnienia i delegowane usługi. |

## Napisy i wyjaśnienia

| Plik / moduł | Połączenie i rola |
| --- | --- |
| `adapters/base-adapter.js` | Wspólna baza adapterów odtwarzaczy. |
| `adapters/youtube-adapter.js`, `netflix-adapter.js`, `ted-adapter.js` | Adaptery platform → wspólny system napisów; rekonstrukcja pełnych zdań i pobieranie ścieżek dwujęzycznych (YT `availableTracks` / `&tlang=`, Netflix `manifest.tracks`) wyrównanych do Master Track. |
| `adapters/generic-video-adapter.js`, `generic-adapters.js` | Obsługa pozostałych odtwarzaczy. |
| `adapters/player-registry.js` → adaptery | Dobór i rejestracja odtwarzacza. |
| `youtube-player-bridge.js`, `netflix-player-bridge.js` | Mosty działające w kontekście strony; dostęp do danych odtwarzacza. |
| `video-frame-bootstrap.js` | Uruchamianie obsługi w ramkach wideo. |
| `shared/subtitle-service.js` → adaptery / nakładka | Dane napisów, kontekst sąsiednich kwestii, łączenie klocków w pełne zdania (`reconstructFullSentenceCues`) i algorytm dopasowania ścieżki podrzędnej do nadrzędnej z synchronizacją do przodu (`alignSlaveTrackToMaster`) łączący klocki w jedną linię. |
| `video/subtitle-overlay.js` → `QT`, translator, subtitle service | Wyświetlanie napisów pojedynczych i dwujęzycznych (`doubleSubtitles`) bez użycia AI/Google Translate, wyjaśnienia Enter, kolejka odczytu i zapis fiszek. Znaczenia, etykiety i wyjaśnienia używają Native language. |
| `video/reading-modes.js` → translator, nakładka | Tryb czytania (chmurki słów) pod S; reaguje na zmianę języków i ustawień (`doubleSubtitles`, `wordCloudMode`). |
| `video/video-hotkeys.js` → nakładka / odtwarzacz | Skróty klawiaturowe wideo. |
| `shared/subtitle-translation-service.js` → worker | Wspólny przepływ tłumaczenia napisów. |

Przepływ Enter: `video/subtitle-overlay.js` → `core.js` (`QT.geminiExplainSentence`) → `shared/translator-service.js` → `shared/ai-prompts.js` + `shared/gemini-proxy.js` → backend → walidacja → nakładka / TTS / fiszka.

## Dane i usługi wspólne

| Plik / moduł | Połączenie i rola |
| --- | --- |
| `shared/utils.js` | Wspólne narzędzia: tekst, głosy, obrazy i klucze audio. |
| `shared/word-repository.js` → storage | Wspólny dostęp do zapisanych słów. |
| `shared/srs.js` → popup / worker | Reguły powtórek. |
| `shared/dictionary-store.js` → worker | Magazyn danych słownika (R2 `dictionaries/live/` dla słówek oraz statyczne pakiety fraz `dictionaries/phrase/*.json`). |
| `shared/local-dictionary.js` → dictionary store, tokenizer, utils | Dopasowanie haseł i znaczeń; wyszukiwanie wielowyrazowych fraz w trybie word-by-word. |
| `shared/dictionary-tokenizer.js` | Tokenizacja dla słownika. |
| `shared/phrase-detector.js` | Rozpoznawanie wyrażeń w tekście. |
| `shared/audio-cache.js` → TTS | Pamięć podręczna nagrań. |
| `shared/gemini-proxy.js` → worker / backend | Żądania AI, cache, uwierzytelnienie i operacje na obrazach. |
| `shared/subscription-service.js` → konfiguracja planów / backend | Profil, limity i ich odzwierciedlenie w UI. |
| `firebase/firebase-config.js` → `firebase/firebase-sync.js` | Konfiguracja połączenia, konto i synchronizacja danych. |
| `firebase/firestore.rules`, `firebase/firebase.json` | Reguły bazy i konfiguracja wdrożenia Firebase. |
| `shared/quiz-export.js` → `quiz.html`, `quiz-runner.html` | Generowanie i eksport quizów. |
| `quiz.html` → `quiz.js`, `quiz.css` | Ekran quizu. |
| `quiz-runner.html` → `quiz-runner.js` | Wykonanie quizu w sandboxie wskazanym w manifest. |

## Backend i utrzymanie

| Plik / moduł | Połączenie i rola |
| --- | --- |
| `functions/index.js` | Endpointy; łączy konfigurację planów, Stripe, R2, tłumaczenia i walidację AI. |
| `functions/ai-response.js` → `index.js` | Parsowanie odpowiedzi modelu i konfiguracja generowania. |
| `functions/live-translation.js` → `index.js`, R2 | Tłumaczenia i słownik generowane na żądanie. |
| `functions/r2-storage.js` | Wspólny dostęp backendu do zasobów R2. |
| `functions/elevenlabs-policy.js` → `index.js` | Zasady dostępu do ElevenLabs. |
| `functions/stripe-billing.js` → konfiguracja planów | Rozliczenia i integracja Stripe. |
| `functions/set-user-plan.js`, `remove-user-plan.js` | Narzędzia administracyjne planów użytkownika. |
| `functions/firebase.json`, `functions/functions.yaml`, `functions/package.json` | Wdrożenie i zależności backendu. |
| `functions/SUBSCRIPTIONS.md`, `functions/LIVE_TRANSLATIONS.md` | Szczegółowa dokumentacja backendu. |
| `CHROMEWEBSTORE.md` | SSOT publikacji w Chrome Web Store: specyfikacja uprawnień, uzasadnienia i deklaracje prywatności. |
| `tests/*.test.js`, `tests/helpers.js`, `tests/fixtures/*` | Testy rozszerzenia, atrapy środowiska, algorytmy SRS i parsery. |
| `functions/*.test.js` | Testy backendu i kontraktów współdzielonych. |
| `scripts/check-syntax.js` | Weryfikacja składniowa wszystkich plików JS (`node --check`). |
| `scripts/build-cws-zip.js` → pliki rozszerzenia | Przygotowanie paczki Chrome Web Store z uwzględnieniem `dictionaries/`. |
| `package.json` | Polecenia `npm test`, `npm run check:syntax`, `npm run build`, `npm run audit`. |
| `icons/*` | Ikony wskazane w manifest. |
| `todo.md`, `p.md` | Notatki robocze; reguły architektury utrzymuj tutaj. |

## Zmiany i propozycje SSOT

- [x] **Naprawa reguł `SIMPLE_WORDS` w `shared/constants.js`:**
  - Przywrócono angielskie czasowniki posiłkowe (`do`, `does`, `did`, `have`, `has`, `had`, `can`, `will` itd.) oraz zaimki do `SIMPLE_WORDS`.
  - Naprawiono rozpoznawanie skrótów (`don't`, `doesn't`, `didn't`), dzięki czemu `tests/local-dictionary.test.js` przechodzi w 100% (6/6 PASS).
- [x] **Eliminacja martwego kodu i przestarzałych trybów:**
  - Wycofano nasłuchiwanie `changes.subtitleTTS` w `video/reading-modes.js`.
  - Usunięto martwą opcję `scope === "all"` w `shared/quiz-export.js`, zabezpieczając dozwolony zakres generowania quizu.
- [x] **Formalizacja testów i oczyszczenie `scratch/`:**
  - Utworzono `tests/srs-algorithm.test.js` (formalny test algorytmu powtórek SRS w `node:test`).
  - Utworzono `tests/youtube-captions-parse.test.js` (test parsera JSON3, rekonstrukcji ASR i czyszczenia znaczników).
  - Utworzono `tests/subscription-parity.test.js` (automatyczna weryfikacja 100% zgodności planów i limitów między `shared/` a `functions/`).
  - Usunięto przestarzałe skrypty ze `scratch/`.
- [x] **Uporządkowanie `package.json` i skryptów utrzymania:**
  - Skrypt `npm test` uruchamia wyłącznie aktywne testy (`node --test tests/*.test.js functions/*.test.js`).
  - Zaimplementowano `scripts/check-syntax.js` sprawdzający składnię każdego pliku `.js` w repozytorium (`npm run check:syntax`).
  - Dodano skrypt `npm run build` do generowania paczki dystrybucyjnej.
- [x] **Zgodność z Chrome Web Store (CWS MV3):**
  - Dołączono katalog `dictionaries/` do `INCLUDED_ENTRIES` w `scripts/build-cws-zip.js`, gwarantując obecność pakietów fraz w dystrybucji.
  - Utworzono plik `CHROMEWEBSTORE.md` z pełnym zestawem metadanych, tabelą uzasadnień uprawnień (`storage`, `alarms`, `identity`, `scripting`, `activeTab`, host permissions) oraz deklaracjami prywatności.
- [x] **Weryfikacja:**
  - `npm test`: 223/223 testów PASS.
  - `npm run check:syntax`: 87/87 plików JS bez błędów składniowych.
  - `npm run build`: paczka `dist/lectoro-cws-v1.0.0.zip` (339.2 KB) zweryfikowana pomyślnie.
