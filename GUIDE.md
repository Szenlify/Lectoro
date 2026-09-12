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
| `video/reading-modes.js` → translator, nakładka | Tryby czytania i tłumaczenia pod S; reaguje na zmianę języków i ustawień (`doubleSubtitles`, `wordCloudMode`, `subtitleTTS`). |
| `video/video-hotkeys.js` → nakładka / odtwarzacz | Skróty klawiaturowe wideo. |
| `shared/subtitle-translation-service.js` → worker | Wspólny przepływ tłumaczenia napisów. |

Przepływ Enter: `video/subtitle-overlay.js` → `core.js` (`QT.geminiExplainSentence`) → `shared/translator-service.js` → `shared/ai-prompts.js` + `shared/gemini-proxy.js` → backend → walidacja → nakładka / TTS / fiszka.

## Dane i usługi wspólne

| Plik / moduł | Połączenie i rola |
| --- | --- |
| `shared/utils.js` | Wspólne narzędzia: tekst, głosy, obrazy i klucze audio. |
| `shared/word-repository.js` → storage | Wspólny dostęp do zapisanych słów. |
| `shared/srs.js` → popup / worker | Reguły powtórek. |
| `shared/dictionary-store.js` → worker | Magazyn danych słownika. |
| `shared/local-dictionary.js` → dictionary store, tokenizer, utils | Dopasowanie haseł i znaczeń. |
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
| `tests/*.test.js`, `tests/helpers.js`, `tests/fixtures/*` | Testy rozszerzenia, atrapy środowiska i dane testowe. |
| `functions/*.test.js` | Testy backendu i kontraktów współdzielonych. |
| `scratch/*` | Skrypty pomocnicze, audyty i starsze testy; część uruchamia `npm test`. |
| `package.json` | Polecenia `npm test`, `npm run check:syntax`, audyty. |
| `scripts/build-cws-zip.js` → pliki rozszerzenia | Przygotowanie paczki Chrome Web Store. |
| `icons/*` | Ikony wskazane w manifest. |
| `todo.md`, `p.md` | Notatki robocze; reguły architektury utrzymuj tutaj. |

## Weryfikacja ostatniej zmiany

- **Ochrona przed ścianą tekstu (teksty piosenek / ASR bez kropek):**
  - W `shared/subtitle-service.js` w `reconstructFullSentenceCues` wdrożono twarde ograniczenia jedno-wierszowe: maks. 11 słów / 65 znaków w klastrze, podział na interpunkcji zdań podrzędnych (`,`, `;`, `:`, `-`, `—`) gdy liczba słów wynosi >= 5, oraz podział przy pauzach > 0.65s (lub > 0.15s przy >= 7 słowach).
  - W `alignSlaveTrackToMaster` zredukowano limit łączenia klocków do maks. 12 słów / 70 znaków.
  - Eliminuje to 30–40 słowne zbitki w piosenkach (np. tekst Martin Garrix "Rewind, repeat it...") i długich wypowiedziach ASR bez interpunkcji, dzieląc je na naturalne, jedno-wierszowe klocki.
- **Naprawa braku podwójnych napisów i błędu HTTP 429 na YouTube:**
  - Przyczyna 429: YouTube podpisuje strumienie ASR parametrami `sparams`. Wymuszanie `&fmt=json3` / `&fmt=vtt` na podpisanym adresie unieważnia sygnaturę Google i wywołuje 429 (Too Many Requests / Unusual Traffic). Ponadto `window.fetch` jest bardziej podatny na blokady WAF niż odtwarzaczowe XHR.
  - W `adapters/youtube-adapter.js`: w `slaveCandidateUrls` jako pierwszy podawany jest natywny format bez parametrów formatu (`fmt: ""`), zachowujący poprawny podpis URL.
  - W `youtube-player-bridge.js`: `FETCH_REQUEST_EVENT` korzysta w pierwszej kolejności z `XMLHttpRequest` z `withCredentials = true` (identyczny transport jak odtwarzacz YouTube).
  - Przechwytywanie ścieżki slave: `youtube-player-bridge.js` przechwytuje odpowiedzi XHR/fetch zawierające `tlang=` i emituje zdarzenie `__lectoro_youtube_slave_timed_text` (`SLAVE_TIMED_TEXT_EVENT`), które `youtube-adapter.js` natychmiast przypisuje i wyrównuje do `cueIndex`.
  - Fallback odtwarzacza YouTube: jeśli bezpośrednie pobranie zwróci pusty wynik lub 429, wysyłane jest zdarzenie `REQUEST_TRANSLATION_EVENT`, w wyniku którego mostek wywołuje `player.setOption("captions", "translationLanguage", { languageCode: targetLang })`. Odtwarzacz sam pobiera oficjalną ścieżkę XHR (200 OK), która jest przechwytywana i podpinana jako napisy podrzędne.
- **Netflix:**
  - Zgodnie z wytycznymi kod Netflixa (`adapters/netflix-adapter.js`) nie był modyfikowany.
- **Testy jednostkowe:**
  - `node --test tests/dual-subtitles.test.js`: 10/10 testów zaliczonych (w tym test unpunctuated lyrics / single line bounds).
  - Składnia JS zweryfikowana (`node --check`).

## Zmiany i propozycje SSOT

- [x] Zaimplementować dwujęzyczne napisy Master-Slave (Language Reactor) dla YouTube i Netflix z przełącznikiem doubleSubtitles, synchronizacją do przodu i bez AI/Google Translate.
- [x] Zabezpieczyć napisy YouTube przed ścianą tekstu (twardy limit wiersza i podział piosenek/ASR) oraz błędem HTTP 429 (unformatted URL + XHR transport + player API translation fallback).
<!-- - [ ] Wydzielić obsługę subskrypcji z `popup/settings.js`, aby awaria ustawienia nie zatrzymywała widoku planów.
- [ ] Ustalić jedno źródło konfiguracji planów i generować kopię wdrożeniową; dodać kontrolę zgodności obu plików.
- [ ] Przenieść czytnik zaznaczenia z własnej obsługi syntezy w `content.js` na wspólny TTS, zachowując podświetlanie i anulowanie.
- [ ] Wydzielić przepływ wyjaśnień i zapisu fiszek z dużego `video/subtitle-overlay.js` do modułu korzystającego z usług wspólnych.
- [ ] Wyjaśnić dwa istniejące błędy testów fraz słownika, porównując kontrakt `segments` z obsługą cache offline. -->
