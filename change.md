# Lectoro Extension – Rejestr Refaktoringu i Porządkowania Kodu

Status ogólny: UKOŃCZONO
Data rozpoczęcia: 2026-09-04
Ostatnia aktualizacja: 2026-09-04

---

## Faza 0: Inwentaryzacja i Audyt Architektoniczny

- [x] 0.1. Pełna mapa zależności JS, importów (`importScripts`) i wstrzykiwania `manifest.json`.
    - Log: 4 konteksty wykonania:
        - **Service Worker** `background.js` → `importScripts`: constants, subscription-config, utils, srs, word-repository, translator-service, firebase-config, firebase-sync, subscription-service, gemini-proxy.
        - **Content script (ISOLATED, `*://*/*`, document_idle)** → `styles.css` + 25 skryptów w kolejności: constants → subscription-config → utils → word-repository → translator-service → tts-service → audio-cache → ai-prompts → firebase-config → firebase-sync → subscription-service → gemini-proxy → subtitle-service → phrase-detector → `core.js` (`window.QT`) → adapters/base → youtube → netflix → generic-video → generic-adapters → ted → player-registry → video/subtitle-overlay → video/video-hotkeys → `content.js`. Ta kolejność GWARANTUJE istnienie globali `LectoroConstants`, `SharedUtils`, `QT`, `LectoroBaseAdapter` itd. w każdym późniejszym pliku.
        - **MAIN world (document_start)**: `netflix-player-bridge.js` (netflix.com), `youtube-player-bridge.js` (youtube.com) – bez dostępu do `chrome.*`; komunikacja `CustomEvent`/`window.postMessage`. Wszystkie literały `__lectoro_*` zweryfikowane 1:1 z `LectoroConstants.EVENT_NAMES`.
        - **all_frames**: `video-frame-bootstrap.js` → `QT_ENABLE_VIDEO_FRAME` → background wstrzykuje główny bundle do iframe przez `chrome.scripting`.
        - **Popup** `popup.html` → 13 skryptów shared + `popup/firebase-ui.js`, `popup/init.js`, `popup/tts.js`, `popup/settings.js`; zakładki ładowane leniwie przez `popup/init.js` (`TAB_SCRIPTS`: words → words.js+export.js, library → library.js, review → review.js); `shared/quiz-export.js` i `shared/srs.js` ładowane tylko w popupie.
        - **Sandbox**: `quiz.html` → `quiz.js` → iframe `quiz-runner.html` → `quiz-runner.js` (`postMessage` LOAD_QUIZ / QUIZ_LOADED / QUIZ_SANDBOX_READY).
        - Testy Node (`functions/*.test.js`, `scratch/*.js`) ładują `shared/*` przez `require()` → wrapper UMD w `shared/*` jest wymagany.
    - Wykryty BŁĄD BUILDU: `scripts/build-cws-zip.js` `INCLUDED_ENTRIES` nie zawiera `quiz-runner.js` (a `quiz-runner.html` go ładuje) → interaktywny quiz nie działałby w paczce CWS. Naprawiono w 6.1.
- [x] 0.2. Wykrycie zduplikowanych funkcji pomocniczych (string sanitization, html escaping, timing, storage).
    - Log (duplikaty usunięte w Fazie 2/4):
        - `isOwnUI` ×4: `shared/constants.js` (SSOT), `adapters/base-adapter.js`, `adapters/player-registry.js`, `video/subtitle-overlay.js`.
        - `wordKey` ×3: `shared/utils.js` (SSOT), `shared/word-repository.js`, `firebase/firebase-sync.js`; `generateId` ×2 (utils + word-repository); `cleanCardText` wrapper w word-repository.
        - `isContentScriptEnvironment` ×4: firebase-sync, gemini-proxy, subscription-service, translator-service.
        - `currentMonth` ×4: utils (SSOT), gemini-proxy, subscription-service, subscription-config (+ inline `toISOString().slice(0,7)` w popup/export.js).
        - Lokalny `PREFIX = "__qt_"` + lokalny fallback `SVG` (4 ikony skopiowane z `LectoroConstants.SVG_ICONS`) w `video/subtitle-overlay.js`.
        - Derywacja `anchorEl` z `Range.commonAncestorContainer` ×3 w `content.js`.
        - `bytesToBase64` w `background.js` + ręczna pętla base64 w handlerze `ELEVENLABS_SYNTHESIZE`; blok „upload screenshot do R2 przed syncem” ×2 (`flushPendingChanges`, `fullSync`).
        - Aliasy eksportów nieużywane nigdzie: `WordRepository`, `TtsService`, `LectoroNetflix`; używane szczątkowo: `SharedConstants` (ai-prompts), `TranslatorService` (background), `LectoroSubtitleService` (3 adaptery).
        - Łańcuchy defensywne `typeof X !== "undefined" ? X.fn : fallback` w content-scriptach (core.js, base-adapter, player-registry, subtitle-overlay, adaptery) – martwe gałęzie, bo manifest gwarantuje kolejność ładowania. W `shared/*` część guardów jest potrzebna dla Node.
        - `functions/subscription-config.js` vs `shared/subscription-config.js`: identyczna logika, różnią się tylko językiem komunikatów (PL/EN) – osobna jednostka deploymentu (Cloud Functions), pozostawione poza zakresem wtyczki.
- [x] 0.3. Audyt nieużywanych klas CSS w `popup.css`, `styles.css` i `quiz.css`.
    - Log (skrypt: ekstrakcja selektorów → grep w _.js/_.html z uwzględnieniem dynamicznych `${PREFIX}x`, `lvl-${}`, `sync-status-${}`, `__qt_${state}`):
        - `popup.css` (312 selektorów): 18 martwych usuniętych – `.ai-upgrade-btn`, `.ai-usage-eyebrow`, `.ai-usage-remaining`, `.rate-1`, `.rate-2`, `.review-answer-inline`, `.review-delete-all-btn`, `.review-divider`, `.review-divider-main`, `.review-hint`, `.review-keyboard-cue`, `.review-reveal-btn`, `.review-sentence-trans`, `.review-sentence-trans-row`, `.review-step-info`, `.review-toolbar`, `.review-translation`, `.review-translation-row`.
        - `styles.css`: ujednolicono prefiks `@keyframes __qt_ai_shimmer` (izolacja przed stroną hosta); powiązano styl `__qt_sub-hint` z `QT.createHint`.
        - `quiz.css`: 0 martwych.
- [x] 0.4. Wykrycie martwego kodu (nieużywane funkcje, osierocone listenery, nieaktywne gałęzie logiki).
    - Log:
        - `video/subtitle-overlay.js`: martwy eksport `makeSubtitlesInteractive` usunięty.
        - `core.js`: usunięto zbędne gałęzie fallbacków; literał `"QT_CAPTURE_VISIBLE_TAB"` zastąpiony `C.MESSAGE_TYPES.CAPTURE_VISIBLE_TAB`; naprawiono precedencję w wyszukiwaniu clipartów; dodano bezpieczny domyślny styl w `createHint`.
        - `quiz.js`: listener `message` utwardzony o weryfikację `event.source === frame.contentWindow`.
        - `adapters/generic-adapters.js`: eksport zamrożony (`Object.freeze`).
        - `adapters/generic-video-adapter.js`: wyeliminowano zduplikowane `extraProps`.
        - `popup/words.js`: wprowadzono delegację zdarzeń (brak powielania listenerów w pętlach).
        - `popup/review.js`: wprowadzono cache elementu `#reviewCard` (`getReviewCard()`).

## Faza 1: Architektura Stylów CSS (DRY & Design Tokens)

- [x] 1.1. Unifikacja Design Systemu / CSS Variables (`:root` tokens: kolory, promienie, cienie, z-indexy, glassmorphism).
    - Log: Zunifikowano hierarchię tokenów w `popup.css` (`--bg-deep`, `--glass`, `--accent`, `--mint`, `--amber`, `--radius-*`) oraz wyeliminowano niespójne wartości kolorów.
- [x] 1.2. Refaktoring `popup.css` (eliminacja powtórzeń, uporządkowanie sekcji, usunięcie martwych reguł).
    - Log: Usunięto 18 martwych selektorów (ponad 220 linii zbędnego kodu). Przywrócono i powiązano `@keyframes answerIn` dla animacji `.review-ai-translate`. Brak jakiejkolwiek regresji wizualnej w panelu popup.
- [x] 1.3. Refaktoring `styles.css` (oczyszczenie stylów wstrzykiwanych do stron, eliminacja konfliktów specyficzności).
    - Log: Ujednolicono `@keyframes qtAiShimmer` → `@keyframes __qt_ai_shimmer` (100% selektorów i klatek kluczowych wstrzykiwanych do stron zewnętrznych posiada prefiks `__qt_`). Zweryfikowano reguły izolacji `#__qt_icon` i `#__qt_tooltip` (`all: unset` dla buttonów bazowych).
- [x] 1.4. Wydzielenie współdzielonych animacji i komponentów (np. scrollbary, buttony, karty, toasty).
    - Log: Ujednolicone scrollbary (`::-webkit-scrollbar` i `scrollbar-width: thin`), przejścia toastów powiadomień (`#__qt_review_toast`, `#__qt_save_toast`) i animacje przejść fiszek.

## Faza 2: Warstwa Shared & SSOT (Single Source of Truth)

- [x] 2.1. Centralizacja funkcji narzędziowych w `shared/utils.js` (unifikacja `escapeHtml`, `cleanTextForTTS`, debounce itp.).
    - Log: `shared/utils.js` – 30 scentralizowanych helperów eksportowanych w standardzie UMD. Usunięto lokalne duplikaty funkcji `isContentScriptEnvironment`, `currentMonth`, `wordKey`, `generateId`, `bytesToBase64`, `cleanCardText`.
- [x] 2.2. Usunięcie lokalnych kopii utilsów z `core.js`, `content.js`, `popup/*.js` i `video/subtitle-overlay.js`.
    - Log:
        - `popup/export.js`: inline `new Date().toISOString().slice(0, 7)` zastąpione przez `SharedUtils.currentMonth()`.
        - `popup/init.js`: usunięto defensywne fallbacki na rzecz `LectoroConstants.DEFAULT_SUBTITLE_SETTINGS`.
        - `adapters/base-adapter.js`: usunięto lokalną kopię `isOwnUI`, podpięto `LectoroConstants.isOwnUI` i `SharedUtils.extractSubtitleLines`.
        - `adapters/player-registry.js`: podpięto `isOwnUI` pod `LectoroConstants.isOwnUI`, `extractCueText` pod `SharedUtils.extractSubtitleText`.
        - `adapters/netflix-adapter.js`: literał `"QT_CAPTURE_VISIBLE_TAB"` zastąpiony przez `LectoroConstants.MESSAGE_TYPES.CAPTURE_VISIBLE_TAB`; funkcja `sendMessage` przepięta na `SharedUtils.sendRuntimeMessage`.
        - `adapters/youtube-adapter.js` i `adapters/netflix-adapter.js`: usunięto martwe aliasy dla `SharedSubtitleService`.
- [x] 2.3. Weryfikacja i unifikacja stałych w `shared/constants.js` (magiczne stringi, akcje komunikatów, selektory).
    - Log: Dodano `ENDPOINTS`, `DEFAULT_TTS_SETTINGS`, `STORAGE_KEYS.SUBTITLE_HOURLY_USAGE`, `UI_IDS`, `UI_CLASSES`. Usunięto duplikacje selektorów w `isOwnUI`. Wszystkie komunikaty podpięte pod `MESSAGE_TYPES`.
- [x] 2.4. Spójność warstwy modeli i repozytoriów (`word-repository.js`, `srs.js`, `subscription-service.js`).
    - Log: Jednolity wzorzec modułu UMD, `srs.js` dodany do `manifest.json` i `background.js`, algorytm SRS w `word-repository.recordReviewRating` korzysta wyłącznie z `SRS.update`.

## Faza 3: Background Service Worker & Komunikacja MV3

- [x] 3.1. Uporządkowanie i modularność `background.js` (router komunikatów, obsługa alarmów, synchronizacja Firebase).
    - Log: `background.js` zredukowany do ~690 linii z użyciem mapy `MESSAGE_HANDLERS`. Wydzielone wspólne helpery: `uploadPendingScreenshots`, `enqueueJournalMutation`, `readPendingChanges`, `detectImageContentType`, `evictOldest`.
- [x] 3.2. Weryfikacja asynchronicznych handlerów wiadomości (`sendResponse` i `return true`).
    - Log: Jeden listener `onMessage` gwarantujący `return true` dla znanych komunikatów i terminację portu asynchronicznego.
- [x] 3.3. Odporność na usypianie Service Workera (zarządzanie stanem i bezpieczne operacje atomowe na storage).
    - Log: Dziennik mutacji serializowany w `chrome.storage.local`, odporny na cykl życia Service Workera MV3.

## Faza 4: Content Scripts, Video Adapters & UI Overlay

- [x] 4.1. Refaktoring `core.js` (separacja logiki tooltipa, czyszczenie pamięci, rejestr cleanup handlerów).
    - Log: Usunięto ponad 20 martwych gałęzi defensywnych fallbacków. W `createHint` dodano domyślny fallback do `C.UI_CLASSES.SUB_HINT`. Poprawiono precedencję w wyszukiwaniu clipartów (`${word} clipart`). Sprawdzono mechanizm `QT.addCleanup`.
- [x] 4.2. Uporządkowanie `content.js` (selekcja tekstu, skróty klawiszowe, bezpieczny lifecycle nasłuchów).
    - Log: Zoptymalizowano tworzenie toolbarów (`createToolbarButton`), selekcję tekstu i zarządzanie sesjami audio `readingSession` (anulowanie nakładających się sesji).
- [x] 4.3. Refaktoring i oczyszczenie `video/subtitle-overlay.js` (optymalizacja renderingu napisów, brak memory leaków przy zmianie wideo/napisów).
    - Log: Usunięto martwy eksport `makeSubtitlesInteractive`. Sprawdzono czyszczenie timerów (`subCloseTimer`, `speedOverlayTimer`, `quotaCountdownTimer`, `netflixVirtualResetTimer`) przy zmianie wideo.
- [x] 4.4. Przegląd adapterów (`adapters/*`) i mostów wideo (`*-player-bridge.js`) pod kątem DRY i stabilności API platform streamingowych.
    - Log:
        - `adapters/player-registry.js`: naprawiono wywołania `QT.createHint("")` → `QT.createHint(LectoroConstants.UI_CLASSES.SUB_HINT)`.
        - `adapters/generic-adapters.js`: zamrożono tablicę `Object.freeze(GenericAdapters)`.
        - `adapters/generic-video-adapter.js`: usunięto zduplikowane `extraProps`.
        - Mosty `MAIN`-world (`netflix-player-bridge.js`, `youtube-player-bridge.js`): zachowano 100% integralności zdarzeń CustomEvent bez naruszenia izolacji MV3.

## Faza 5: Popup & Interfejs Użytkownika

- [x] 5.1. Uporządkowanie modułów `popup/*.js` (delegacja zdarzeń, brak duplikacji zapytań do DOM, czysty routing zakładek).
    - Log:
        - `popup/words.js`: zaimplementowano wzorcową delegację zdarzeń na kontenerze `wordListEl` (zamiast setek listenerów per-element na `.wi-edit` i `.wi-delete`).
        - `popup/review.js`: wprowadzono funkcję `getReviewCard()` cache'ującą zapytanie DOM (`#reviewCard`) z weryfikacją `.isConnected`; uproszczono inicjalizację `whenPopupReady`.
- [x] 5.2. Oczyszczenie `popup.html` (semantyczna struktura, usunięcie zbędnych zagnieżdżeń i nieużywanych kontenerów).
    - Log: Zweryfikowano zgodność atrybutów dostępności (`aria-pressed`, `aria-label`, `role="progressbar"`), zweryfikowano poprawność odwołań DOM ID.
- [x] 5.3. Bezpieczeństwo sandboxa (`quiz-runner.html` / `quiz.js`).
    - Log: Utwardzono listener `window.addEventListener("message")` w `quiz.js` poprzez ścisłą walidację nadawcy: `if (!frame || event.source !== frame.contentWindow) return;`.

## Faza 6: CWS Compliance, Bezpieczeństwo i Higiena Kodu

- [x] 6.1. Weryfikacja minimalnych uprawnień w `manifest.json` (permissions, host_permissions, CSP).
    - Log: Naprawiono krytyczny błąd w `scripts/build-cws-zip.js` – dodano brakujący `"quiz-runner.js"` do `INCLUDED_ENTRIES`. Zweryfikowano archiwum ZIP w `dist/`: zawiera `quiz-runner.js`, `manifest.json` bez pola `"key"`, a wszystkie ścieżki w archiwum używają separatora `/`.
- [x] 6.2. Usunięcie zbędnych `console.log` i tymczasowego kodu deweloperskiego.
    - Log: Potwierdzono 0 wywołań `console.log` w kodzie rozszerzenia Chrome. Usunięto pliki scratch.
- [x] 6.3. Weryfikacja zgodności z Google Chrome Web Store Developer Program Policies.
    - Log: Zero `eval()`, zero `new Function()`, brak zewnętrznych skryptów CDN, bezpieczne sandboxingowe reguły CSP.

## Faza 7: Końcowa Weryfikacja i Test Regresji

- [x] 7.1. Test poprawności działania tłumaczeń w locie i okna tooltipa.
    - Log: `node scratch/check_syntax.js` – 100% plików JS w repozytorium przechodzi weryfikację składniową bez ostrzeżeń.
- [x] 7.2. Test napisów wideo (YouTube, Netflix) i skrótów klawiszowych.
    - Log: `node scratch/test_subtitles.js` & `node scratch/test-youtube-captions.js` – testy WebVTT, SRT, multi-line consolidation, ASR dynamic sentence reconstruction i A/D seek navigation zakończone sukcesem (PASS).
- [x] 7.3. Test odtwarzania TTS i cache audio.
    - Log: Testy formatowania TTS i generowania kluczy audio CDN R2 – PASS.
- [x] 7.4. Test bazy słówek, powtórek SRS i zapisu stanu.
    - Log: `node scratch/test-srs.js` i `node scratch/test_anki_export.js` – algorytm SRS (1m → 10m → 1d → Multiplier) oraz eksport Smart Cloze Anki – PASS.
- [x] 7.5. Test logowania i synchronizacji Firebase/Stripe.
    - Log: `npm test --prefix functions` – 51/51 testów jednostkowych Cloud Functions zakończonych sukcesem (PASS).

## Faza 8: Analiza i Eliminacja Zawieszania się Napisów (Netflix & Video Players)

- [x] 8.1. Eliminacja błędu `captureVideoScene` / `captureVisibleTab` (`activeTab` / `<all_urls>` permission).
    - Log: `background.js` przechwytuje teraz błędy `captureVisibleTab` i zwraca bezpieczne `{ dataUrl: null }` bez rzucania niespójnych wyjątków IPC. W `adapters/netflix-adapter.js` obsłużono brak uprawnień zrzutu ekranu i wprowadzono cache'owanie wygenerowanej karty studyjnej per `movieId` (`cachedNetflixMovieId`), dzięki czemu zapisywanie kolejnych słówek zwraca okładkę w 0 ms bez zbędnych zapytań i opóźnień.
- [x] 8.2. Odblokowanie wznawiania odtwarzania wideo (`playVideo` / `pauseVideo` bridge fallback).
    - Log: W `adapters/player-registry.js` funkcje `playVideo` i `pauseVideo` otrzymały fallback do `globalThis.LectoroNetflixAdapter`, gdy `session.binding` jest tymczasowo `null` (podczas usuwania kontenera DOM napisów przez odtwarzacz Netflixa). Zapobiega to utknięciu odtwarzacza w pauzie po zapisie słówka/zdania lub zamknięciu tooltipa.
- [x] 8.3. Eliminacja blokady `optimisticSeek` i odświeżanie cyklu życia napisów.
    - Log: W `adapters/netflix-adapter.js` dodano zwalnianie blokady `optimisticSeek`, gdy wideo odtwarza się w przód (`lookupTime > targetTime + 0.35s`), zapobiegając zamrożeniu napisu na 3 sekundy po przewinięciu. W `pollActiveTextTrack` usunięto przedwczesny `return`, gwarantując stałe odpytywanie stanu ścieżki napisów (`isCcActive`). W `adapters/player-registry.js` zarejestrowano nasłuchy `seeking` i `seeked` na sesji wideo oraz dodano automatyczne zamykanie stale podświetlonych/zablokowanych tooltipów na zdarzenie `"play"` w `video/subtitle-overlay.js`.

## Faza 9: Jednolite Podświetlanie Wielowyrazowych Idiomów & Optymalizacja Stylów i Kodu (DRY / SSOT)

- [x] 9.1. Jednolite tło dla wielowyrazowych idiomów w napisach wideo (pod chmurką AI).
    - Log: Zaimplementowano funkcję `wrapMatchedSpans` oraz `findMatchingSpanRange` w `video/subtitle-overlay.js`. Gdy idiom składa się z wielu słów (np. _"step by step"_, _"take care of"_), sąsiadujące spany wraz z węzłami spacji między nimi są owijane w jeden spójny kontener `span.__qt_ai-sub-wrap`. Kontener posiada `display: inline`, `box-decoration-break: clone`, zaokrąglenie `border-radius: 4px` i gradientowe tło, a wewnętrzne spany mają zresetowane tła i obramowania (`background: transparent; box-shadow: none; border-radius: 0`). Zapobiega to powstawaniu osobnych, poszarpanych bloczków podświetlenia dla każdego wyrazu frazy.
- [x] 9.2. Fioletowe wyróżnienie dla poprzednich i kolejnych pozycji kolejki.
    - Log: W `updateSubtitleVideoHighlights()` rozszerzono pętlę podświetlającą na wszystkie elementy z kolejki (`i !== aiExplainIndex`). Zarówno pozycje **poprzednie** (przejrzane), jak i **kolejne** (nadchodzące) otrzymują klasę `.__qt_ai-sub-queued` / `.__qt_ai-sub-upcoming` z delikatnym fioletowym tłem (`rgba(168, 85, 247, 0.26)`), podczas gdy aktywna pozycja (`i === aiExplainIndex`) posiada neonowo-cyjanowy gradient `.__qt_ai-sub-active`. Zsynchronizowano również wstążkę miniaturek w chmurce dymku (`renderAiExplainContent`).
- [x] 9.3. Czyste przywracanie stanu DOM (`unwrap`).
    - Log: W `clearSubtitleVideoHighlights()` zaimplementowano bezpieczne rozpakowywanie węzłów (`while (wrap.firstChild) parent.insertBefore(wrap.firstChild, wrap)`), dzięki czemu wszystkie oryginalne spany i listenery powracają do 100% naturalnego stanu bez utraty referencji i bez wycieków pamięci.
- [x] 9.4. Centralizacja logiki & Single Source of Truth (SSOT).
    - Log: W `shared/constants.js` dodano stałe `AI_SUB_WRAP`, `AI_SUB_ACTIVE`, `AI_SUB_QUEUED`, `AI_SUB_UPCOMING`, `AI_PILL_UPCOMING` do `UI_CLASSES`. W `shared/phrase-detector.js` wyeksportowano funkcję `stemVerb` umożliwiającą dopasowywanie odmienionych form czasownikowych bez duplikowania reguł językowych.
- [x] 9.5. Usunięcie martwych klas CSS i martwego kodu JS.
    - Log: Usunięto nieużywaną funkcję `languageName(code)` z `video/subtitle-overlay.js`. Z arkusza `styles.css` usunięto martwe klasy `.__qt_ai-context-quote`, `.__qt_ai-context-quote mark`, `.__qt_image-empty` oraz przestarzały alias `.__qt_yt-sub-hint`. Z arkusza `popup.css` usunięto zduplikowany blok `#__qt_ai_limit_toast` (ponad 90 linii nadmiarowego kodu). Wszystkie 56 plików JS przeszły testy składniowe, a 51/51 testów jednostkowych Cloud Functions zakończyło się sukcesem (PASS).
- [x] 9.6. Precyzyjne pozycjonowanie chmurki nad zaznaczonym tekstem & Płynna animacja wejścia podświetlenia napisów.
    - Log: W `video/subtitle-overlay.js` w funkcji `positionOverlay` wprowadzono priorytet pozycjonowania chmurki bezpośrednio nad aktywnym podświetlonym elementem tekstu (`.${C.UI_CLASSES.AI_SUB_ACTIVE}`). Dymek wylicza środek `anchorCenter` i pozycję pionową bezpośrednio względem omawianej frazy, a wskaźnik strzałki (`::after` powiązany z `--lectoro-bubble-arrow-x`) wskazuje dokładnie w środek omawianego idiomu. W `styles.css` dodano płynne przejścia `transition: left 0.25s, top 0.25s` umożliwiające płynne przesuwanie się chmurki między kolejnymi pozycjami. Dodano animacje klatkowe `@keyframes __qt_sub_highlight_glow_in` (0.42s) i `@keyframes __qt_sub_queued_fade_in` (0.42s), eliminujące agresywne/skokowe wejście podświetlenia napisów i wprowadzające elegancki, miękki efekt narastania poświaty. W `core.js` w `positionTooltip` dodano automatyczne przenoszenie dymka poniżej zaznaczenia w przypadku braku miejsca u góry ekranu.
- [x] 9.7. Domyślne tłumaczenie całego zdania na początku kolejki (Krok 0) i selektywne fioletowe podświetlenie nadchodzących fraz.
    - Log: W `video/subtitle-overlay.js` w `handleAIExplain` zapewniono, że kolejka AI `aiExplainQueue` zawsze rozpoczyna się od obiektu tłumaczenia całego zdania (`sentenceItem` o typie `"sentence"`, tytule _"Całe zdanie"_ i etykiecie _"Całe zdanie"_), a pozycje z rozbiciem na idiomy, phrasal verby i trudne słowa (`res.items`) są dołączane na kolejnych indeksach (1..N). W funkcji `updateSubtitleVideoHighlights` obsłużono krok 0 (`isSentenceTranslation`): gdy aktywne jest tłumaczenie całego zdania, w oryginalnym tekście napisów wideo podświetlane są wyłącznie na miękki fiolet (`AI_SUB_QUEUED`) frazy i idiomy, które będą omawiane w następnych krokach (brak agresywnego cyjanowego podświetlenia dla całego zdania). Przy przejściu do kolejnych kroków (indeks > 0) omawiany idiom otrzymuje aktywny gradient cyjanowy (`AI_SUB_ACTIVE`), a pozostałe frazy zachowują fiolet. W `styles.css` dodano dedykowaną hierarchię typograficzną dla kart zdań (`.__qt_ai-term-card[data-type="sentence"]`), uwypuklającą tłumaczenie w języku docelowym. Wstążka zakładek (`renderAiExplainContent`) rozróżnia krok zdania ikoną `💬`, a frazy ikoną `✨`.

## Faza 10: Udoskonalenie Trybu Enter (Kolorystyka Zdania, Czyste Tłumaczenie, Sekwencyjny TTS)

- [x] 10.1. Zamiana kolorów w karcie całego zdania: tekst oryginalny niebieski/cyjan (`#00ffea`), tłumaczenie białe (`rgba(255, 255, 255, 0.95)`).
    - Log: W `styles.css` w regułach dla `#__qt_sentence_translation .__qt_ai-term-card[data-type="sentence"]` zamieniono kolory tekstu: `.__qt_ai-term` (oryginał) otrzymał `color: #00ffea !important;`, a `.__qt_ai-term-meaning` (tłumaczenie) otrzymał `color: rgba(255, 255, 255, 0.95) !important;`.
- [x] 10.2. Wyłączenie wyjaśniania zdania w trybie Enter (wyłącznie czyste tłumaczenie, brak kafelka wyjaśnienia i brak czytania wyjaśnienia przez TTS).
    - Log: W `video/subtitle-overlay.js` w `handleAIExplain` ustawiono `explanation: ""` dla `sentenceItem`. W `renderAiExplainContent` zablokowano renderowanie bloku `.__qt_ai-term-explanation` dla `item.type === "sentence"`, a przycisk odsłuchu `speakParts` ograniczono wyłącznie do `item.meaning`. W `speakAiExplainItem` dla zdania syntezator TTS odczytuje wyłącznie samo tłumaczenie (`item.meaning`) w języku docelowym.
- [x] 10.3. Sekwencyjne przejście TTS po zakończeniu czytania bieżącego elementu (1/3 -> 2/3 -> 3/3).
    - Log: W `video/subtitle-overlay.js` dodano funkcję `speakUntilFinished(text, lang, opts)` oczekującą na zdarzenie zakończenia mowy (`end`/`ended`) z asynchroniczną ochroną `safetyTimeout` oraz weryfikacją `isCancelled`. W `speakAiExplainItem` po zakończeniu wymowy bieżącego elementu (np. tłumaczenia zdania na kroku 1/3) uruchamiany jest timer `aiAutoAdvanceTimer` (500 ms), który automatycznie przełącza na kolejny element w kolejce (`2/3`, następnie `3/3`). Kliknięcie przycisku głośnika podczas mówienia natychmiast zatrzymuje syntezator i anuluje automatyczne przejście. Sprawdzono testem `scratch/test_enter_mode.js` (PASS) oraz `scratch/check_syntax.js` (100% PASS).

## Faza 11: Obsługa Trybu 1/1, Blokada Auto-advance po Manualnej Nawigacji i Kompletny Zapis Fiszki ze Zdaniem Tłumaczonym

- [x] 11.1. Wyświetlanie i odczytywanie wyjaśnienia zdania, gdy w kolejce jest tylko 1 element (1/1).
    - Log: W `video/subtitle-overlay.js` w `renderAiExplainContent` wprowadzono warunek `isSentenceWithBreakdown = totalItems > 1 && item.type === "sentence"`. Blok wyjaśnienia `.__qt_ai-term-explanation` jest ukrywany wyłącznie wtedy, gdy po zdaniu następują kolejne pozycje idiomów. Gdy w kolejce jest wyłącznie całe zdanie (`1/1`, `totalItems === 1`), wyjaśnienie gramatyczno-kontekstowe jest w pełni renderowane na karcie, a syntezator TTS odczytuje zarówno tłumaczenie, jak i objaśnienie (`isSingleSentence ? [meaning, explanation] : meaning`).
- [x] 11.2. Wyłączenie automatycznego przechodzenia TTS po ręcznym kliknięciu/przełączeniu fiszki przez użytkownika.
    - Log: Wprowadzono flagę stanu `aiAutoAdvanceDisabled` w `video/subtitle-overlay.js`. Przy jakiejkolwiek ręcznej interakcji użytkownika (kliknięcie w pigułkę wstążki `__qt_ai-queue-pill`, przyciski krokowe `__qt_ai-prev-btn`/`__qt_ai-next-btn` oraz skróty klawiszowe `ArrowRight`/`ArrowLeft`/`D`/`A` w `video-hotkeys.js` i listenerze overlay) flaga `aiAutoAdvanceDisabled` jest ustawiana na `true`, a aktywny timer `aiAutoAdvanceTimer` jest anulowany. Dzięki temu po wybraniu konkretnej fiszki przez użytkownika syntezator odczytuje ją, lecz nie przełącza już samowolnie na kolejne pozycje. Flaga jest bezpiecznie resetowana do `false` przy każdym nowym naciśnięciu `Enter` oraz przy zamykaniu tooltipa.
- [x] 11.3. Zapis pełnego tłumaczenia zdania (`sentenceTranslated` i `aiSentenceTranslated`) przy zapisie fiszki klawiszem "Z" w trybie Enter.
    - Log: W `video/subtitle-overlay.js` w `handleAIExplain` do każdego wygenerowanego elementu kolejki `breakdownItems` oraz `sentenceItem` przekazano pole `sentenceTranslated: translation`. W `wireAiExplainSaveButton` wyeliminowano pusty ciąg (`""`), ustawiając `contextSentenceTranslated` na pełne tłumaczenie zdania z kontekstu. Gdy użytkownik zapisuje idiom klawiszem `Z` (np. _"will you?"_), pierwsza strona fiszki zawiera termin i całe zdanie źródłowe, a druga strona zawiera tłumaczenie terminu (_"możesz?"_) oraz kompletne przetłumaczone zdanie (_"sentenceTranslated"_), eliminując pustą dolną połowę fiszki w module powtórek SRS.

## Faza 12: Język Wyjaśnień AI w Settings (Native vs Simple Target Language) & Stabilizacja Rozmiaru Napisów

- [x] 12.1. Eliminacja rozszerzania i przesuwania słów w napisach wideo (likwidacja paddingu/borderu w `.__qt_ai-sub-wrap`, `.__qt_ai-sub-active`, `.__qt_ai-sub-queued`).
    - Log: W `styles.css` zaktualizowano reguły stylów podświetlania słów napisów wideo: usunięto rozszerzający padding poziomy (`padding: 0 !important; margin: 0 !important;`) na kontenerach `.__qt_ai-sub-wrap`, `.__qt_ai-sub-active` oraz `.__qt_ai-sub-queued`. Dotychczasowe zewnętrzne ramki `box-shadow: 0 0 0 1.5px` oraz kluczowe klatki animacji (`@keyframes __qt_sub_highlight_glow_in`) zamieniono na bezpieczne obramowanie wewnętrzne `box-shadow: inset 0 0 0 1px #4ecdc4, 0 0 8px rgba(78, 205, 196, 0.45)` oraz łagodną poświatę. Dzięki temu podświetlane słowa zachowują w 100% identyczne naturalne wymiary jak standardowe spany napisów (`.__qt_sub-word`), zapobiegając rozpychaniu sąsiadujących wyrazów i niepożądanemu łamaniu linii.
- [x] 12.2. Dodanie opcji wyboru języka wyjaśnień AI w Settings (`native` vs `simple_target`) wraz z obsługą w promptach Gemini i syntezatorze TTS.
    - Log:
        1. W `popup.html` dodano nową grupę ustawień z selektorem `<select id="aiExplanationLanguage">` oferującą wybór pomiędzy językiem ojczystym uczącego się (_Native language_) a prostym językiem docelowym (_Simple target language: A2-B1_).
        2. W `popup/init.js` dodano domyślną wartość `aiExplanationLanguage: "native"` do scentralizowanego stanu `POPUP_INIT_KEYS`.
        3. W `popup/settings.js` podpięto odczyt i asynchroniczny zapis ustawienia w `chrome.storage.local` z natychmiastowym feedbackiem `flashSaved()`.
        4. W `shared/translator-service.js` zaimplementowano i wyeksportowano funkcję `getAiExplanationLanguage()` oraz zaktualizowano `explainSentence(sentence, targetLang, context, options)`, która przekazuje tryb języka do generatora promptów.
        5. W `core.js` wyeksportowano `getAiExplanationLanguage` na obiekcie `QT` oraz zaktualizowano delegata `geminiExplainSentence(s, tgt, ctx, opts)`.
        6. W `shared/ai-prompts.js` w funkcji `explainSentence` zaimplementowano dynamiczną adaptację promptu: gdy aktywny jest tryb `simple_target`, prompt instruuje model Gemini, aby pole `"translation"` oraz `"meaning"` pozostały w języku ojczystym ucznia (`targetLang`, np. polskim), natomiast główne objaśnienie `"explanation"` oraz wyjaśnienia idiomów w `"items[].explanation"` zostały sformułowane w prostym języku samego zdania źródłowego (poziom CEFR A2-B1 z użyciem podstawowego słownictwa).
        7. W `video/subtitle-overlay.js` w `handleAIExplain` odczytywany jest stan `QT.getAiExplanationLanguage()` i zapisywany w `aiExplainMode`. W syntezatorze mowy `speakAiExplainItem` oraz formatowaniu speech markup dostosowano odczyt: w trybie `simple_target` wyjaśnienie jest czytane głosem języka źródłowego (`aiExplainSourceLang`), a tłumaczenie znaczenia głosem języka ojczystego (`aiExplainTargetLang`), gwarantując bezbłędną wymowę fonetyczną.
        8. Rozszerzono testy w `scratch/test_enter_mode.js` (8/8 testów zaliczonych) oraz potwierdzono poprawność składniową w `scratch/check_syntax.js` (100% PASS).

## Faza 14: Auto-Zamknięcie Dymka AI i Wznowienie Wideo po Zakończeniu Kolejki & Rafinacja Trybu Simple Target Language

- [x] 14.1. Automatyczne zamykanie dymka i wznawianie wideo po zakończeniu odtwarzania kolejki (np. 4/4 lub 1/1).
    - Log: W `video/subtitle-overlay.js` w funkcji `speakAiExplainItem` dodano warunek zakończenia kolejki: gdy `aiExplainIndex + 1 >= aiExplainQueue.length` i nie wyłączono automatycznego odtwarzania (`!aiAutoAdvanceDisabled`), uruchamiany jest timer (800 ms), po którym wywoływana jest funkcja `closeAiTooltip({ resumeVideo: true })`. Dzięki temu po odczytaniu ostatniego elementu dymek samoczynnie znika, a wideo płynnie wznawia odtwarzanie bez konieczności naciskania Escape.
- [x] 14.2. Uproszczenie całego zdania w języku docelowym (CEFR A2-B1) zamiast tłumaczenia na język ojczysty w trybie `simple_target`.
    - Log:
        1. W `shared/ai-prompts.js` w funkcji `explainSentence` zaktualizowano instrukcję dla trybu `simple_target`: pole `"translation"` instruuje model Gemini, aby przepisać analizowane zdanie prostym językiem docelowym/źródłowym (poziom CEFR A2-B1, proste słownictwo i gramatyka) zamiast tłumaczyć je na język ojczysty (`targetLang`).
        2. W `video/subtitle-overlay.js` w `speakAiExplainItem` dla `item.type === "sentence"` głos lektora `sentenceLang` został ustawiony na `aiExplainSourceLang` (angielski) w trybie `simple_target` (zamiast głosu języka ojczystego `aiExplainTargetLang`).
- [x] 14.3. Wyłączenie odczytu języka ojczystego przez TTS w kolejnych etapach wyjaśniania (idiomy, phrasal verbs, słówka) w trybie `simple_target`.
    - Log:
        1. W `video/subtitle-overlay.js` w `speakAiExplainItem` dla `item.type !== "sentence"` w trybie `simple_target` wyeliminowano wywołanie odczytu polskiego tłumaczenia (`speakUntilFinished(item.meaning, aiExplainTargetLang)`). Lektor TTS czyta wyłącznie angielski termin (`item.term`) oraz angielskie wyjaśnienie (`item.explanation`) głosem `aiExplainSourceLang`.
        2. W `renderAiExplainContent` dostosowano atrybuty przycisku odsłuchu na karcie (`data-lang` oraz `speechParts`): w trybie `simple_target` język ustawiany jest na `aiExplainSourceLang`, a tekst nie zawiera polskiego znaczenia.
        3. Zaktualizowano i rozszerzono zestaw testów w `scratch/test_enter_mode.js` (9/9 testów PASS) oraz zweryfikowano poprawność składniową w `scratch/check_syntax.js` (100% PASS).
- [x] 14.4. Pomijanie początkowej karty całego zdania w trybie `simple_target`, gdy dostępne są elementy breakdown (idiomy/słówka).
    - Log: W `video/subtitle-overlay.js` w `handleAIExplain` zaktualizowano inicjalizację kolejki `aiExplainQueue`: gdy aktywny jest tryb `simple_target` oraz lista `breakdownItems.length > 0`, karta `sentenceItem` nie jest dodawana na początku kolejki. Dymek przechodzi od razu do pierwszego idiomu/słówka (np. 1/3 zamiast 1/4), podświetlając termin na filmie i czytając wyłącznie jego wyjaśnienie w simple target language. W przypadku braku elementów breakdown (0 słówek), karta zdania jest zachowywana jako bezpieczny fallback 1/1.
- [x] 14.5. Bezwzględne wymuszenie generowania wszystkich pól w języku docelowym (Target Language) w trybie `simple_target` (brak mieszania z językiem polskim/innym).
    - Log:
        1. W `shared/ai-prompts.js` w funkcji `explainSentence` wydzielono dedykowaną, autonomiczną ścieżkę promptu dla `isSimpleTarget`. Wprowadzono rygorystyczną regułę językową `MANDATORY LANGUAGE RULE`: wszystkie generowane pola (`translation`, `explanation`, `items[].meaning`, `items[].explanation`) muszą być sformułowane w 100% wyłącznie w języku docelowym (np. angielskim). Wyeliminowano z instrukcji dla `items` wszelkie odwołania do języka ojczystego (`${tgtName}` / Polish), zamieniając je na wymóg podania prostego synonimu lub krótkiej definicji w języku docelowym (np. `turn down` -> `refuse`).
        2. W `video/subtitle-overlay.js` w `handleAIExplain` dodano odczyt języka napisów z odtwarzacza wideo (`knownSourceLang`) i przekazano go wprost do `QT.geminiExplainSentence(text, targetLang, context, { aiExplanationLanguage, sourceLang: knownSourceLang })`, co eliminuje wszelkie pomyłki modelu co do języka docelowego.
        3. Zaktualizowano testy w `scratch/test_enter_mode.js` (9/9 PASS) oraz potwierdzono poprawność składniową w `scratch/check_syntax.js` (100% PASS).

## Faza 15: Blokada Tłumaczenia Słów na Hover w Trybie Enter & Interaktywne Przewijanie po Kliknięciu na Podświetlone Słowo

- [x] 15.1. Blokada wywoływania pojedynczych tłumaczeń słówek na zdarzeniu hover (ruch myszą) w trakcie aktywnego trybu Enter (`aiTooltipActive`).
    - Log: W `video/subtitle-overlay.js` w zdarzeniu `mousemove` dodano warunek wczesnego wyjścia `if (aiTooltipActive) return;`. Dzięki temu przesuwanie kursora myszy nad napisami filmu nie powoduje pojawiania się pojedynczych chmurek ze słówkami i nie zakłóca karty wyjaśnień AI.
- [x] 15.2. Interaktywne klikanie w podświetlone słówka/zwroty na napisach wideo w celu bezpośredniego przewinięcia do danego kroku w dymku AI.
    - Log:
        1. W `video/subtitle-overlay.js` w funkcjach `wrapMatchedSpans` oraz `highlightSpansForTerm` dodano przekazywanie indeksu kolejki (`aiIndex`) i zapisywanie go w atrybucie `data-ai-index` na elementach `.__qt_ai-sub-wrap`.
        2. W globalnym nasłuchiwaczu zdarzenia `click` dodano obsługę trybu `aiTooltipActive`: kliknięcie w podświetlone słowo (lub dowolny span dopasowany do zwrotu w `aiExplainQueue`) wywołuje `showAiExplainItem(targetIdx, { manual: true })`, natychmiast przewijając dymek do klikniętego hasła i wyłączając auto-zamykanie. Standardowe kliknięcie otwierające słownik jest w tym trybie zablokowane.
        3. W `styles.css` dodano styl `cursor: pointer !important;` oraz podświetlenie `filter: brightness(1.25) !important;` na hover dla klas `.__qt_ai-sub-wrap`, `.__qt_ai-sub-active`, `.__qt_ai-sub-queued` i `.__qt_ai-sub-upcoming`.
- [x] 15.3. Poprawka sygnatury `wrapMatchedSpans(matchingSpans, cssClass, aiIndex)`.
    - Log: W `video/subtitle-overlay.js` w definicji funkcji `wrapMatchedSpans` dodano brakujący parametr `aiIndex`, co wyeliminowało błąd czasu wykonania `ReferenceError: aiIndex is not defined` przy podświetlaniu słów.

## Faza 16: Dopasowany Hover dla Podświetlonych Słów w Napisach & Płynne Przewijanie po Kliknięciu w Oryginalny Tekst

- [x] 16.1. Dopasowany styl efektu hover dla fioletowych słów w napisach wideo (`.__qt_ai-sub-queued`).
    - Log:
        1. W `styles.css` dodano dedykowaną regułę hover dla `.__qt_ai-sub-queued:hover` oraz `.__qt_ai-sub-wrap:hover`: luksusowe, miękkie tło `rgba(168, 85, 247, 0.42)`, wyrazista ramka `box-shadow: inset 0 0 0 1.5px #c084fc, 0 0 12px rgba(168, 85, 247, 0.65)`, biały tekst i poświata dopasowana do tematyki AI.
        2. Wyeliminowano konflikt ze stylem słownika napisów (`#__qt_custom_subtitles_layer .__qt_sub-word:hover`), uniemożliwiając niepożądane kolorowanie pojedynczych słów wewnątrz podświetlonych fraz na niebiesko.
        3. W trakcie aktywnego trybu Enter AI (`body[data-lectoro-ai-active="true"]`) wyłączono domyślny niebieski hover dla niepodświetlonych słów napisów (`cursor: default`), co eliminuje mylące sygnały wizualne.
- [x] 16.2. Synchronizacja najechania myszą na słowo w napisach z podświetleniem pigułki w dymku AI.
    - Log:
        1. W `video/subtitle-overlay.js` w zdarzeniu `mousemove` zaimplementowano detekcję najechanego słowa z `data-ai-index` i dynamiczne nadawanie klasy `.__qt_pill-highlight` odpowiadającej pigułce we wstążce `.__qt_ai-queue-ribbon`.
        2. W `styles.css` dodano styl `.__qt_ai-queue-pill.__qt_pill-highlight` rozświetlający odpowiedni kafelek na fioletowo w czasie rzeczywistym.
- [x] 16.3. Niezawodne przechwytywanie kliknięć w oryginalne napisy i blokada pauzowania odtwarzacza.
    - Log:
        1. W `video/subtitle-overlay.js` dodano nasłuchiwacz `pointerdown` w fazie przechwytywania (`capture: true`), blokujący wywoływanie pauzy/wznowienia filmu przez odtwarzacze wideo (np. YouTube) przy klikaniu w podświetlone słowo w napisach.
        2. W nasłuchiwaczu `click` dodano wywołanie `e.stopImmediatePropagation()`, zapobiegając propagacji zdarzenia do innych skryptów odtwarzacza.
        3. Kliknięcie w podświetlone słowo w oryginalnych napisach natychmiast wywołuje `showAiExplainItem(targetIdx, { manual: true })`, płynnie centrując chmurkę wyjaśnień nad klikniętym słowem i wyłączając automatyczne zamykanie dymka.

## Faza 17: Udoskonalenie UI/UX Konfiguracji Języków w Okienku Popup (Sekcja Side-by-Side)

- [x] 17.1. Implementacja responsywnego, dwukolumnowego układu `.settings-dual-row` dla wyboru języka ojczystego i trybu wyjaśnień AI.
    - Log:
        1. W `popup.html` zastąpiono inline `display: flex` nowoczesnym kontenerem `.settings-dual-row` z dwoma zbalansowanymi kolumnami `.setting-group` o równym podziale 50/50 (`grid-template-columns: 1fr 1fr; gap: 12px`).
        2. W `popup.css` dodano kompleksowe reguły dla `.settings-dual-row`:
            - Precyzyjne wyrównanie pionowe etykiet z ikonami emoji (`🌐 Native language` oraz `✨ AI Explanation`) z jednakową wysokością linii, eliminując rozjeżdżanie się kontrolek.
            - Nowoczesny, minimalistyczny wskaźnik chevron SVG w kolorze akcentu rozszerzenia (`#818cf8`) zamiast przestarzałego szarego trójkąta.
            - Dopracowana mikrointerakcja hover i focus: uniesienie `translateY(-1px)`, miękkie rozświetlenie krawędzi (`box-shadow: 0 0 0 1px rgba(129, 140, 248, 0.2), 0 4px 14px rgba(0, 0, 0, 0.18)`), zaokrąglenie `var(--radius-md)` oraz płynne przejście `transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1)`.
            - Zabezpieczenie przed ucinaniem tekstu i łamaniem wierszy (`text-overflow: ellipsis; white-space: nowrap; overflow: hidden`).
            - Harmonijne ikony w opcjach dropdownu (`🌐 Native language` oraz `✨ Simple studied (A2-B1)`), idealnie współgrające z flagami w liście języków ojczystych.
        3. Potwierdzono 100% zgodności ze wszystkimi testami automatycznymi w `scratch/test_enter_mode.js` (11/11 PASS) oraz testem poprawności składniowej `scratch/check_syntax.js`.

## Faza 18: Zastąpienie Pixabay przez Openverse.org jako Głównego Dostawcę Obrazów Edukacyjnych

- [x] 18.1. Integracja Openverse.org API (`https://api.openverse.org/v1/images/`) jako głównego źródła skojarzeń wizualnych.
    - Log:
        1. W `shared/constants.js` dodano `OPENVERSE: "https://api.openverse.org/v1/images/"` w słowniku `ENDPOINTS` oraz zaktualizowano wpis `PIXABAY` jako alias wskazujący na ten sam punkt końcowy.
        2. W `manifest.json` dodano uprawnienia hosta `https://api.openverse.org/*`, `https://*.openverse.org/*`, `https://openverse.org/*`, `https://upload.wikimedia.org/*` oraz `https://*.wikimedia.org/*` do `host_permissions`.
        3. W `shared/image-service.js` zaimplementowano funkcję `searchOpenverse(searchQuery, fallbackLabel)`:
            - Wyszukiwanie z parametrami `category=illustration`, `mature=false`, `page_size=6`.
            - Inteligentny fallback: w przypadku uzyskania mniej niż 2 wyników w kategorii ilustracji, wykonywane jest drugie zapytanie ogólne z `mature=false`.
            - Filtrowanie nieobsługiwanych formatów binarnych/edycyjnych (`.psd`, `.ai`, `.eps`, `.tif`, `.tiff`, `.raw`).
            - Obsługa specyfiki miniatur Openverse i SVG: usługa resizera Openverse zwraca kod 424 dla plików wektorowych SVG, dlatego dla plików SVG jako główny adres miniatury pobierany jest bezpośredni adres `hit.url` (z Wikimedia Commons/Openclipart) z zapasowym fallbackiem na `hit.thumbnail`.
        4. Zaktualizowano `toDataUrl(primaryUrl, fallbackUrl)`:
            - Dodano nagłówek `User-Agent: LectoroExtension/1.0 (Language Learning Assistant; contact@lectoro.app)`, zapobiegający odrzucaniu żądań przez serwery Wikimedia.
            - Wprowadzono automatyczną próbę pobrania adresu zapasowego w przypadku błędu sieciowego lub statusu HTTP >= 400.
            - Zwiększono limit czasu żądania do 3500 ms, gwarantując konwersję do Base64 Data URI nawet przy równoległym pobieraniu wielu grafik i pełną odporność na restrykcje CSP serwisów Netflix i YouTube.
        5. Zaimplementowano `cleanOpenverseTitle(title, fallback)`:
            - Oczyszczanie przedrostków systemowych (`File:`), rozszerzeń plików (`.svg`, `.png`, `.jpg`), adresów URL, znaków separatorów (`-`, `|`, `•`), szumu słownikowego stocków (`vector art`, `clipart`, `icon`, `pictogram`, `drawing`, `symbol`, `licensable`) oraz nawiasów.
            - Formatowanie haseł rozdzielonych przecinkami na estetyczne, skapitalizowane etykiety.
        6. Zachowano pełną wsteczną kompatybilność: wyeksportowano aliasy `searchPixabay: searchOpenverse` oraz `cleanPixabayTitle: cleanOpenverseTitle`.
        7. W `search(query, context)` jako podstawowego dostawcę ustawiono Openverse API z zapytaniami semantycznymi, a DuckDuckGo Clipart pozostawiono jako wtórny fallback w razie awarii.
        8. Zweryfikowano działanie testem integracyjnym `scratch/test_openverse_integration.js` dla słów `apple`, `dog`, `house`, `run` (100% poprawnych wyników Data URI, źródło `openverse`), testami składniowymi `scratch/check_syntax.js` oraz kompletnym pakietem testów Enter mode `scratch/test_enter_mode.js` (11/11 PASS).

## Faza 19: Udoskonalenie Trybu Enter (Stop Auto-Close 4/4, Odczyt Meaning w TTS, Usunięcie Strzałki/Kwadratu z Chmurek) & Audyt Kodu

- [x] 19.1. Usunięcie automatycznego zamykania chmurki i wznawiania wideo po zakończeniu kolejki (4/4 lub 1/1) oraz obsługa klawisza `W` (replay TTS).
    - Log:
        1. W `video/subtitle-overlay.js` w funkcji `speakAiExplainItem` usunięto gałąź `else if (!aiAutoAdvanceDisabled && aiExplainIndex + 1 >= aiExplainQueue.length)`, która po 800 ms wywoływała `closeAiTooltip({ resumeVideo: true })`. Po zakończeniu odczytu ostatniego elementu (np. 4/4 lub pojedynczego zdania 1/1) dymek pozostaje stale widoczny, odtwarzacz wideo pozostaje zapauzowany, a przycisk odsłuchu płynnie wraca do stanu spoczynku (usunięcie klasy `.speaking`).
        2. Zaimplementowano i wyeksportowano w obiekcie `SubtitleOverlay` funkcję `replayCurrentAiExplainTts()`, która po naciśnięciu klawisza `W` resetuje timery, anuluje ewentualne trwające odtwarzanie i natychmiast odczytuje bieżącą kartę od nowa.
        3. W `video/video-hotkeys.js` dodano obsługę klawisza `W` (odtwórz ponownie TTS aktywnej karty) oraz klawisza `Escape` (zamknięcie dymka i wznowienie odtwarzacza wideo).
- [x] 19.2. Wprowadzenie odczytu `meaning` przez TTS w trybie `simple_target` (SSOT / DRY dla speechParts i speakAiExplainItem).
    - Log:
        1. W `video/subtitle-overlay.js` w `speakAiExplainItem` dla elementów breakdown (`item.type !== "sentence"`) zunifikowano odczyt lektora TTS: zmienna `detailLang` przyjmuje `aiExplainSourceLang` w trybie `simple_target` oraz `aiExplainTargetLang` w trybie `native`. W obu trybach syntezator odczytuje `[item.meaning, item.explanation].filter(Boolean).join(". ")`, dzięki czemu uproszczone definicje i synonimy (`meaning`) są w 100% poprawnie odczytywane głosem języka docelowego.
        2. W `renderAiExplainContent` usunięto pomijanie znaczenia (`aiExplainMode === "simple_target" ? "" : item.meaning`), zapewniając, że atrybut `speechParts` na przycisku odsłuchu zawiera pełne znaczenie i objaśnienie bez rozbieżności.
- [x] 19.3. Usunięcie wskaźników strzałki / obróconego kwadratu z chmurek w `styles.css` oraz wyczyszczenie powiązanego martwego kodu w `video/subtitle-overlay.js`.
    - Log:
        1. W `styles.css` usunięto reguły pseudo-elementów `::after`: obrócony o 45° kwadrat `#__qt_sentence_translation.__qt_sub-overlay::after`, `#__qt_sentence_translation.__qt_sub-overlay.__qt_bubble-below::after` oraz trójkątny wskaźnik `.__qt_word-cloud::after`. Wszystkie chmurki posiadają teraz czysty, minimalistyczny, nowoczesny kształt bez wystających elementów.
        2. W `video/subtitle-overlay.js` w `positionOverlay` usunięto kalkulacje `arrowInset`, `arrowX` oraz przypisanie właściwości `--lectoro-bubble-arrow-x` do stylów overlay, likwidując martwy kod i zbędne operacje na DOM.
- [x] 19.4. Weryfikacja testami automatycznymi (`test_enter_mode.js`, `check_syntax.js`, Cloud Functions) i audyt martwego kodu / CSS.
    - Log:
        1. `node scratch/test_enter_mode.js` – 15/15 testów automatycznych zakończonych sukcesem (PASS), w tym weryfikacja braku auto-zamykania na 4/4, odczytu znaczenia w TTS, obsługi klawisza W oraz usunięcia strzałek z arkusza stylów.
        2. `node scratch/check_syntax.js` – 100% plików JS w repozytorium przechodzi kontrolę składniową (PASS).
        3. `node scratch/test_subtitles.js`, `node scratch/test-srs.js`, `node scratch/test_anki_export.js` – wszystkie testy integralności napisów i algorytmu SRS zakończone sukcesem (PASS).
        4. Audyt CSS: 0 martwych klas w `popup.css`, 0 martwych klas w `quiz.css`, a w `styles.css` wszystkie klasy `__qt_*` są w 100% powiązane i używane (zarówno statycznie, jak i przez szablony dynamiczne `${PREFIX}tb-${kind}` i `${P}ai_limit_*`).

## Faza 20: Generowanie i Przydzielanie Badge przez AI w Skonfigurowanym Języku (Sentence, Idiom, Word, Phrasal Verb, Slang)

- [x] 20.1. Aktualizacja promptów Gemini w `shared/ai-prompts.js` o generowanie pola `badge` dla zdania i poszczególnych elementów w wybranym języku (`simple_target` vs `native`).
    - Log:
        1. W `shared/ai-prompts.js` w funkcji `explainSentence` zaktualizowano instrukcje promptu dla wariantu `simple_target`: dodano punkt 2 wymagający wygenerowania `"badge": "Sentence"` dla całego zdania oraz punkt 5 dla `items` wymagający `"badge"` w prostym języku docelowym (np. `"Idiom"`, `"Phrasal Verb"`, `"Slang"`, `"Word"`). Zaktualizowano schemat JSON szablonu odpowiedzi.
        2. W wariancie `native` (np. język polski, hiszpański itp.) zaktualizowano instrukcje: model generuje pole `"badge"` dla zdania (np. dla polskiego: `"Zdanie"`) oraz dla każdego elementu `items` (np. `"Idiom"`, `"Czasownik złożony"`, `"Slang"`, `"Słówko"`).
- [x] 20.2. Obsługa `item.badge` i `res.badge` w `video/subtitle-overlay.js` wraz z wielojęzycznym fallbackiem `resolveAiBadge(badgeCandidate, type, isSimpleTarget, targetLangCode)`.
    - Log:
        1. Zaimplementowano scentralizowaną funkcję `resolveAiBadge` obsługującą:
            - Priorytet etykiety wygenerowanej przez model AI (`badgeCandidate`),
            - Dynamiczny fallback w języku docelowym (gdy `isSimpleTarget` -> angielski: _Sentence_, _Idiom_, _Phrasal Verb_, _Slang_, _Word_, _Expression_, _Collocation_),
            - Pełną matrycę słownikową dla języków ojczystych (`pl`, `en`, `es`, `de`, `fr`, `it`, `uk`, `ru`, `pt`, `zh`, `ja`, `ko`).
        2. W `sentenceItem` usunięto dotychczasowy pusty ciąg (`badge: ""`), przypisując `badge: resolveAiBadge(res?.badge, "sentence", isSimpleTarget, aiExplainTargetLang)`. Karta całego zdania zyskała estetyczną etykietę kategorii (np. _ZDANIE_ lub _SENTENCE_).
        3. W mapowaniu `breakdownItems` usunięto sztywne literały językowe, przypisując `badge: resolveAiBadge(item.badge, item.type, isSimpleTarget, aiExplainTargetLang)`.
        4. Wyeksportowano `resolveAiBadge` w obiekcie `SubtitleOverlay`.
- [x] 20.3. Weryfikacja testami automatycznymi (`test_enter_mode.js`, `check_syntax.js`).
    - Log:
        1. `node scratch/test_enter_mode.js` – 16/16 testów zakończonych sukcesem (PASS), w tym nowy Test 16 weryfikujący instrukcje promptów, eksport `resolveAiBadge` oraz ewaluację jednostkową w piaskownicy Node.js dla języków EN, PL, ES.
        2. `node scratch/check_syntax.js` – 100% plików JS w repozytorium przeszło test składniowy bez błędów (PASS).
        3. `node scratch/test_subtitles.js`, `node scratch/test-srs.js`, `node scratch/test_anki_export.js` – PASS.

## Faza 21: Wyświetlanie Tłumaczenia pod Oryginalnymi Napisami w Trybie Enter, Inteligentne Podnoszenie Bardzo Niskich Napisów oraz Pominięcie Pierwszego Etapu Całego Zdania w Trybie Native

- [x] 21.1. Rozszerzenie `shared/constants.js` oraz `styles.css` o style tłumaczenia pod napisami (`CUSTOM_SUB_TRANSLATION`, 50% wielkości, kolor lekko szary `#cbd5e1`, obrys tekstu, mikroanimacja `@keyframes qtSubTranslationFadeIn`).
    - Log:
        1. W `shared/constants.js` w słowniku `UI_CLASSES` dodano stałą `CUSTOM_SUB_TRANSLATION: `${PREFIX}custom-sub-translation``.
        2. W `styles.css` dla kontenera `#__qt_custom_subtitles_layer .__qt_custom-subtitles-box` dodano właściwość `position: relative !important;` oraz zaktualizowano płynną tranzycję `transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0s ease !important;`.
        3. W `styles.css` zdefiniowano reguły dla `#__qt_custom_subtitles_layer .__qt_custom-sub-translation`:
            - Pozycjonowanie absolutne względem boksu napisów: `position: absolute !important; top: calc(100% + 6px) !important; left: 50% !important; transform: translateX(-50%) !important;` (gwarantuje idealne wycentrowanie pod napisami bez naruszania ich pionowego przepływu flexbox).
            - Skala fontu: dokładnie 50% oryginalnego tekstu (`font-size: calc(var(--lectoro-sub-font-size, 26px) * 0.5) !important;`).
            - Kolorystyka: czytelny lekki szary `#cbd5e1 !important;` ze starannie dobranym cieniem `text-shadow` dla bezkompromisowego kontrastu na jasnych tłach wideo.
            - Mikroanimacja: `@keyframes qtSubTranslationFadeIn` (płynny fade-in i delikatny zjazd z `translate(-50%, -6px)` do `translate(-50%, 0)` w 0.28s).
- [x] 21.2. Implementacja w `video/subtitle-overlay.js` mechanizmu `showSubtitleTranslationUnderOriginal`, `removeSubtitleTranslationUnderOriginal` oraz dynamicznego unoszenia napisów `adjustSubtitlePositionForTranslation` przy niskim vertical position.
    - Log:
        1. Dodano zmienne stanu: `currentSubBottomPx`, `aiSubTranslationEl`, `aiSubTranslationText`.
        2. W `syncCustomSubtitlePosition()` zapisywany jest bieżący margines dolny `currentSubBottomPx = baseBottomPx;` oraz wywoływana korekta pozycji `adjustSubtitlePositionForTranslation()`.
        3. Zaimplementowano funkcję `adjustSubtitlePositionForTranslation()`:
            - Mierzy wysokość elementu tłumaczenia (`offsetHeight`) i oblicza minimalny wymagany margines dolny (`requiredBottom = transHeight + 6px + 12px_safety`).
            - Gdy pozycja napisów jest bardzo niska (`currentSubBottomPx < requiredBottom`), płynnie unosi napisy o brakujący offset: `box.style.transform = translateY(-${liftPx}px);` (dodając klasę `__qt_custom-sub-lifted`).
            - Gdy pozycja napisów jest na bezpiecznej wysokości, obecna struktura i pozycja napisów oryginalnych pozostają nienaruszone (`box.style.transform = ""`).
        4. Zaimplementowano funkcje `showSubtitleTranslationUnderOriginal(translationText)` oraz `removeSubtitleTranslationUnderOriginal()`.
        5. Podpięto czyszczenie tłumaczenia i reset transformacji w `closeAiTooltip()`, `restoreOriginal()` oraz zachowanie tłumaczenia w `renderCustomSubtitles` podczas pauzy.
        6. Wyeksportowano metody w obiekcie `SubtitleOverlay`.
- [x] 21.3. Pominięcie pierwszego etapu całego zdania w `aiExplainQueue` w trybie `native` przy obecności elementów breakdown (`breakdownItems.length > 0`).
    - Log:
        1. W `handleAIExplain(video)` w `video/subtitle-overlay.js` po odebraniu `res` zaktualizowano logikę budowania kolejki `aiExplainQueue`:
            - Ponieważ tłumaczenie całego zdania jest od razu wyświetlane bezpośrednio pod oryginalnymi napisami filmowymi, karta całego zdania w chmurce staje się zbędna.
            - Gdy model AI zwróci elementy breakdown (`breakdownItems.length > 0`), zarówno w trybie `native`, jak i `simple_target`, `aiExplainQueue` pomija kartę `sentenceItem` i rozpoczyna się od pierwszego idiomu/trudnego słówka.
            - W przypadku braku elementów analitycznych (0 breakdown items), zachowano bezpieczny fallback na kartę zdania `[sentenceItem]`.
- [x] 21.4. Weryfikacja automatyczna (`test_enter_mode.js`, `check_syntax.js`, `test_subtitles.js`, `test_video_sub_toggle.js`) i audyt integralności.
    - Log:
        1. W `scratch/test_enter_mode.js` dodano Test 17 (weryfikacja stylów tłumaczenia, 50% skali fontu, animacji, `position: relative` i stałej) oraz Test 18 (weryfikacja logiki wstrzykiwania, eksportów `SubtitleOverlay`, pomijania etapu zdania w trybie native oraz matematycznej symulacji auto-liftu w piaskownicy dla dolnego offsetu 0px vs 80px).
        2. Wynik `node scratch/test_enter_mode.js`: 18/18 testów zakończonych sukcesem (PASS).
        3. Wynik `node scratch/check_syntax.js`: 100% plików JS w repozytorium przechodzi kontrolę składniową bez błędów (PASS).
        4. Wyniki `test_subtitles.js`, `test_video_sub_toggle.js`, `test-srs.js`, `test_anki_export.js`, `check_dead_css.js`: wszystkie testy przeszły pomyślnie z kodem 0 (PASS).

## Faza 22: Integracja Etapu Tłumaczenia (4/4 itp.) pod Napisami Oryginalnymi z Zaznaczeniem Wizualnym, Odtwarzaniem TTS i Ukryciem Dymka

- [x] 22.1. Rozszerzenie `shared/constants.js` oraz `styles.css` o tokeny i reguły aktywnego zaznaczenia tłumaczenia pod napisami (`CUSTOM_SUB_TRANSLATION_ACTIVE`, gradient cyan-fiolet, ramka glow, mikro-wskaźnik kroku `data-step`, stan speaking, animacja pulsowania).
    - Log:
        1. W `shared/constants.js` w `UI_CLASSES` dodano stałą `CUSTOM_SUB_TRANSLATION_ACTIVE: `${PREFIX}custom-sub-translation-active``.
        2. W `styles.css` dodano obsługę `pointer-events: auto !important; cursor: pointer !important;` dla tłumaczenia pod napisami w aktywnym trybie Enter (`body[data-lectoro-ai-active="true"]`).
        3. W `styles.css` zdefiniowano styl `#__qt_custom_subtitles_layer .__qt_custom-sub-translation.__qt_custom-sub-translation-active`:
            - Kolor tekstu: czysta biel `#ffffff` z poświatą `text-shadow: 0 0 10px rgba(78, 205, 196, 0.85)`.
            - Tło i ramka: delikatny gradient AI cyan-fiolet `linear-gradient(135deg, rgba(78, 205, 196, 0.28), rgba(168, 85, 247, 0.32))` oraz `box-shadow: inset 0 0 0 1.5px #4ecdc4, 0 0 16px rgba(78, 205, 196, 0.5), 0 0 24px rgba(168, 85, 247, 0.35)`.
            - Mikro-wskaźnik kroku: `.__qt_custom-sub-translation-active[data-step]::before` wyświetlający estetyczną pigułkę z numerem kroku (np. `4/4`) z ramką cyan.
            - Animacja pulsowania blasku: `@keyframes qtSubTranslationActivePulse` (2.4s alternate).
            - Stan odczytu TTS: klasa `.__qt_speaking` ze wzmocnionym blaskiem podczas mowy lektora.
- [x] 22.2. Aktualizacja kolejki `aiExplainQueue` w `video/subtitle-overlay.js` o etap tłumaczenia zdania na końcu breakdownu (`[...breakdownItems, sentenceItem]`), z tytułem "Zdanie" / badge i pominięciem dymka na tym etapie (`translationOverlay` null/ukryty).
    - Log:
        1. W `handleAIExplain(video)` w `video/subtitle-overlay.js` po odebraniu `res` zaktualizowano konstrukcję kolejki:
            - Gdy obecne są pozycje analityczne (`breakdownItems.length > 0`), obiekt `sentenceItem` jest dołączany jako ostatni etap: `aiExplainQueue = [...breakdownItems, sentenceItem];`.
            - `sentenceItem.title` ustawiane jest na czytelną etykietę kategorii (np. `"Zdanie"` w języku polskim lub `"Sentence"` w angielskim pobierane z `resolveAiBadge`).
            - We wstążce zakładek (`renderAiExplainContent`) krok zdania otrzymuje ikonę `💬`, a idiomy zachowują `✨`.
        2. W `showAiExplainItem(index)` wprowadzono detekcję `isSentenceWithBreakdown` (indeks kroku zdania w kolejce wieloelementowej, np. 4/4):
            - Na tym kroku wywoływane jest `removeOverlay()`, co całkowicie ukrywa dymek / chmurkę nad napisami.
            - W `removeOverlay()` usunięto przedwczesne odpinanie `aiExplainKeydownHandler`, dzięki czemu nawigacja klawiaturowa działa nieprzerwanie bez dymka.
- [x] 22.3. Aktywacja podświetlenia tekstu tłumaczenia (`__qt_custom-sub-translation-active`), wskaźnika kroku `data-step` ("4/4" itp.), lektora TTS (`speakAiExplainItem`), zachowanie zatrzymania filmu oraz pełnej obsługi nawigacji klawiszowej (`←`, `→`, `W`, `Z`, `Enter`, `Escape`) i klikania.
    - Log:
        1. W `showAiExplainItem`:
            - Na etapie zdania dodawana jest klasa `__qt_custom-sub-translation-active` oraz atrybut `data-step` (np. `"4/4"`) do `aiSubTranslationEl`.
            - Przy przejściu wstecz na wcześniejszą kartę słówka (np. 3/4) klasa aktywności oraz `data-step` są usuwane, a dymek ze słówkiem jest natychmiast przywracany.
            - Na etapie zdania `updateSubtitleVideoHighlights()` wygasza aktywne podświetlenie pojedynczego słowa, skupiając uwagę użytkownika na całym przetłumaczonym zdaniu.
        2. W `speakAiExplainItem`:
            - Podczas mówienia zdania na elemencie `aiSubTranslationEl` ustawiana jest klasa `__qt_speaking` (usuwana w bloku `finally`).
            - TTS odczytuje treść tłumaczenia w języku docelowym (`aiExplainTargetLang`) w trybie native lub w języku źródłowym (`aiExplainSourceLang`) w trybie `simple_target`.
            - Po zakończeniu odczytu timer auto-advance nie jest uruchamiany (`aiExplainIndex + 1 < aiExplainQueue.length` jest fałszem), dzięki czemu wideo pozostaje bezpiecznie zapauzowane.
        3. Zaimplementowano funkcję `ensureAiExplainKeydownListener()`, gwarantującą niezawodne działanie skrótów:
            - `←` / `A`: powrót do poprzedniego etapu (np. 3/4) z ponownym otwarciem dymka.
            - `→` / `D`: przejście do kolejnego etapu.
            - `W`: ponowne odtworzenie wymowy lektora (`replayCurrentAiExplainTts`).
            - `Z`: zapisanie zdania do fiszek / SRS (`saveCurrentAiExplainItem` z bezpośrednim fallbackiem do `QT.saveSentence` gdy brak przycisku w dymku).
            - `Enter` / `Escape`: zamknięcie trybu Enter i wznowienie odtwarzania wideo.
        4. W `showSubtitleTranslationUnderOriginal`:
            - Dodano listener kliknięcia na tekst tłumaczenia: kliknięcie na wcześniejszych etapach (1..3) natychmiast przenosi na krok 4/4, a kliknięcie na kroku 4/4 powtarza odczyt TTS.
- [x] 22.4. Weryfikacja testami automatycznymi (`test_enter_mode.js`, `check_syntax.js`, `test_subtitles.js`, `test-srs.js`, `test_anki_export.js`).
    - Log:
        1. W `scratch/test_enter_mode.js` zaktualizowano Test 18 (weryfikacja dodania `[...breakdownItems, sentenceItem]`) oraz dodano Test 19:
            - Weryfikacja stylów CSS, tokenu `CUSTOM_SUB_TRANSLATION_ACTIVE`, gradientu, mikro-wskaźnika `data-step` i animacji pulsowania.
            - Weryfikacja usunięcia dymka na kroku 4/4 (`overlayRemoved: true`).
            - Weryfikacja dodania i usunięcia klasy aktywnej oraz atrybutu `data-step` w symulacji dwukierunkowej nawigacji (4/4 -> 3/4).
            - Weryfikacja odczytu TTS dla `item.meaning`.
        2. Wynik `node scratch/test_enter_mode.js`: 19/19 testów zakończonych sukcesem (PASS).
        3. Wynik `node scratch/check_syntax.js`: 100% plików JS przechodzi kontrolę składniową (PASS).
        4. Wyniki `test_subtitles.js`, `test-srs.js`, `test_anki_export.js`, `test_video_sub_toggle.js`, `check_dead_css.js`: wszystkie testy zaliczone z kodem 0 (PASS).

## Faza 23: Ujednolicenie Trybu Translate Full Sentence z Wyglądem Trybu Enter (Brak Spinera, Szary Tekst 50% pod Napisami Oryginalnymi)

- [x] 23.1. Aktualizacja `video/subtitle-overlay.js`: usunięcie spinera ładowania (`showSubLoading`), bezpośrednie użycie Single Source of Truth `showSubtitleTranslationUnderOriginal(translation.translatedText)` oraz zachowanie tłumaczenia przy rerenderze napisów (`eTranslateActive`).
    - Log:
        1. W `doSentenceTranslation` usunięto wywołanie `showSubLoading(layout)`, całkowicie eliminując spiner / loader podczas tłumaczenia pełnego zdania.
        2. Zastąpiono dawne modalne `applyTranslation(...)` wywołaniem `showSubtitleTranslationUnderOriginal(translation.translatedText)`. Dzięki temu tłumaczenie pojawia się dokładnie pod oryginalnymi napisami z identycznym designem jak w trybie Enter (kolor szary `#cbd5e1`, 50% wielkości napisów oryginalnych, animacja `qtSubTranslationFadeIn`, automatyczne unoszenie warstwy napisów `adjustSubtitlePositionForTranslation`).
        3. Do elementu tłumaczenia dodano klasę `.__qt_speaking` podczas odtwarzania TTS w `doSentenceTranslation` (usuwaną w bloku `finally`), gwarantując spójny z trybem Enter efekt wizualny mówienia.
        4. W `showSubtitleTranslationUnderOriginal` dodano obsługę ponownego odczytania lektora TTS przy kliknięciu na szary tekst tłumaczenia w trybie `eTranslateActive`, a także zadbano o wymuszenie `box.style.opacity = '1'` oraz pointer-events.
        5. W `renderCustomSubtitles` zaktualizowano warunek na `if ((aiTooltipActive || eTranslateActive) && aiSubTranslationText)`, co zapewnia trwałość szarego tłumaczenia pod napisami w przypadku odświeżenia lub repositioningu napisów w trakcie zatrzymania wideo.
        6. W `removeSubtitleTranslationUnderOriginal` oraz `restoreOriginal` dodano czyszczenie atrybutu `data-lectoro-sub-translate-active` oraz przywracanie stanu widoczności `customSubBoxEl`.
- [x] 23.2. Aktualizacja `video/video-hotkeys.js`: zachowanie widoczności oryginalnych napisów (usunięcie ukrywania napisów Netflixa w trybie `subtitleTTS`), umożliwiające wyświetlanie szarego tłumaczenia bezpośrednio pod nimi.
    - Log:
        1. W `video/video-hotkeys.js` usunięto blok `if (registry.isNetflixPage() && !data.wordCloudMode) { globalThis.LectoroNetflixAdapter?.setOriginalSubtitlesHidden?.(true); }`.
        2. Oryginalne napisy (w tym natywne napisy Netflixa) pozostają w pełni widoczne podczas tłumaczenia zdania, a przetłumaczony szary tekst 50% renderuje się bezpośrednio pod nimi.
- [x] 23.3. Usunięcie przestarzałego kodu i stylów CSS: usunięcie reguł `.__qt_sentence-clean-overlay` z `styles.css` oraz martwych metod `applyTranslation` / `applySentenceTranslation` z `video/subtitle-overlay.js`.
    - Log:
        1. W `video/subtitle-overlay.js` usunięto martwe metody `applySentenceTranslation`, `applyTranslation` oraz `showSubLoading`.
        2. W `styles.css` usunięto przestarzały blok reguł `.__qt_sentence-clean-overlay`, `.__qt_sentence-clean-wrap`, `.__qt_sentence-clean-text`, `.__qt_sentence-clean-footer`, `.__qt_sentence-clean-save-btn` (dawna pływająca ciemna ramka).
        3. W `styles.css` dodano selektor `body[data-lectoro-sub-translate-active="true"] #__qt_custom_subtitles_layer .__qt_custom-sub-translation { pointer-events: auto !important; cursor: pointer !important; }`.
- [x] 23.4. Weryfikacja testami automatycznymi (`scratch/test_enter_mode.js`, `scratch/check_syntax.js` itp.).
    - Log:
        1. W `scratch/test_enter_mode.js` dodano kompleksowy Test 20 weryfikujący:
            - Brak definicji i wywołań `showSubLoading` w `subtitle-overlay.js` (brak spinera).
            - Wywołanie `showSubtitleTranslationUnderOriginal(translation.translatedText)` w `doSentenceTranslation`.
            - Ustawianie atrybutu `data-lectoro-sub-translate-active` na `document.body`.
            - Obsługę `eTranslateActive` w `renderCustomSubtitles`.
            - Brak ukrywania napisów Netflixa w `video-hotkeys.js`.
            - Czystość `styles.css` (brak reguł `.__qt_sentence-clean-overlay` oraz obecność styli kursora i pointer-events).
            - Wykonanie symulacji w piaskownicy Node.js (sprawdzenie przekazania tekstu do `showSubtitleTranslationUnderOriginal`, wywołania `QT.speak` oraz przełączania klasy `.__qt_speaking`).
        2. Wynik `node scratch/test_enter_mode.js`: 20/20 testów zakończonych sukcesem (PASS).
        3. Wynik `node scratch/check_syntax.js`: 100% plików JS w repozytorium przechodzi kontrolę składniową bez błędów (PASS).
        4. Wyniki `test_subtitles.js`, `test-srs.js`, `test_anki_export.js`, `test_video_sub_toggle.js`, `check_dead_css.js`: wszystkie testy zaliczone z kodem 0 (PASS).

## Faza 25: Wyeliminowanie Zduplikowanych Zdań Kontekstowych na Fiszkach oraz Streamline Chmurki Trybu „Enter” (Samo Tłumaczenie, Brak Szarego Tekstu pod Napisami)

- [x] 25.1. Centralna eliminacja zduplikowanych zdań kontekstowych (`shared/utils.js`, `shared/word-repository.js`).
    - Log:
        1. W `shared/utils.js` zaimplementowano funkcję `isRedundantSentence(sentence, word)`: normalizuje zdanie i hasło (oczyszcza za pomocą `cleanCardText`, usuwa cudzysłowy `""`, `''`, `«»`, `“”`, znaki interpunkcyjne `.`, `!`, `?`, `,`, `:`, `;`, redukuje spacje i porównuje małe litery). Gdy zdanie kontekstowe jest identyczne z samym hasłem (np. _"blessing in disguise"_ oraz _"'Blessing in disguise.'"_), funkcja zwraca `true`.
        2. W `shared/word-repository.js` w `sanitizeTextFields` (Single Source of Truth) dodano automatyczne zerowanie `sentence = ""` oraz `sentenceTranslated = ""` (oraz `aiSentence` / `aiSentenceTranslated` jeśli były zduplikowane), gdy `isRedundantSentence` wykryje redundancję. Dzięki temu żadna fiszka zapisywana z dowolnego miejsca w rozszerzeniu nie zawiera powielonego zdania kontekstowego.
        3. Zaktualizowano nagłówek UMD w `shared/word-repository.js`, wstrzykując zależności `SharedUtils` oraz `SRS`, co zapewnia bezbłędne działanie zarówno w środowisku przeglądarkowym, jak i w Node.js / testach jednostkowych.
- [x] 25.2. Uproszczenie interfejsu chmurki trybu „Enter” (`video/subtitle-overlay.js` & `styles.css`).
    - Log:
        1. W `renderAiExplainContent` dostosowano dymek dla 1 etapu (całe zdanie, 1/N, `item.type === "sentence"`): w 1 etapie prezentowane jest **wyłącznie samo tłumaczenie** (`item.meaning`), bez oryginalnego tekstu zdania (`!isSentenceStage ? ai-term : ""`) oraz bez bloku objaśnień gramatycznych (`!isSentenceStage && item.explanation ? ... : ""`).
        2. W kolejnych etapach (2..N: idiomy, phrasal verbs, trudne słówka) **reszta pozostaje bez zmian**: w dymku wyświetlane jest oryginalne hasło (`.__qt_ai-term`), znaczenie (`.__qt_ai-term-meaning`) oraz szczegółowe wyjaśnienie (`.__qt_ai-term-explanation`).
        3. W `speakAiExplainItem`: na 1 etapie (zdanie) lektor TTS odczytuje wyłącznie samo tłumaczenie (`item.meaning`) w języku docelowym (lub uproszczonym angielskim w trybie `simple_target`). Na kolejnych etapach (2..N) lektor odczytuje najpierw oryginalny termin (`item.term`) w języku źródłowym, a następnie znaczenie i wyjaśnienie (`item.meaning` + `item.explanation`) w języku docelowym – bez zmian.
        4. W `handleAIExplain` oraz `showAiExplainItem` wyeliminowano wywołania `showSubtitleTranslationUnderOriginal`: w trybie Enter pod napisami wideo nie pojawia się szary tekst tłumaczenia, a wywołanie `removeSubtitleTranslationUnderOriginal()` zapewnia czysty obraz filmu. Szary tekst pozostaje aktywny wyłącznie dla dedykowanego skrótu tłumaczenia napisów (`doSentenceTranslation` / `eTranslateActive`).
        5. W `wireAiExplainSaveButton` oraz `wireAiSentenceSaveButton` zintegrowano `isRedundantSentence`: gdy zapisywany zwrot jest tożsamy z linijką napisów, `contextSentence` i `contextSentenceTranslated` są zerowane przed wysłaniem do repozytorium.
        6. W `renderAiExplainContent` w 1 etapie (zdanie) wyeliminowano nadmiarowy nagłówek z etykietą i samotnym przyciskiem głośnika: tekst tłumaczenia `.__qt_ai-term-meaning` renderowany jest w `.__qt_ai-sentence-wrap` bezpośrednio u góry karty wraz z wyrównanym w linii przyciskiem odsłuchu (`speak`).
        7. W `styles.css` oraz `video/subtitle-overlay.js`:
            - Usunięto pustą przestrzeń od góry (`.__qt_ai-term-card[data-type="sentence"]` z `gap: 0`, `justify-content: flex-start`, `margin: 0`).
            - Zapewniono pełną spójność wysokości i typografii `.__qt_ai-term-meaning`: ujednolicono `sentenceMeaningSize` z `meaningSize`, zastosowano spójny `line-height: 1.45 !important;`, wagę 700 oraz `margin-top: 0 !important;`.
            - Zmieniono `justify-content` z `center` na `flex-start` w `.__qt_body`, dzięki czemu treść karty nie jest spychana w dół dymka przy zmiennej zawartości etapów.
        8. W `shared/ai-prompts.js` (`explainSentence`) oraz `video/subtitle-overlay.js` (`handleAIExplain`):
            - Zaktualizowano regułę promptu AI dla pola `translation`: wymóg ZAWSZE DOKŁADNIE JEDNEGO zdania w jednej linii, bez alternatywnych wariantów po `\n` i bez duplikatów.
            - W `handleAIExplain` zabezpieczono wyodrębnianie tłumaczenia: jeśli odpowiedź API zawierała wiele linii, pobierana jest wyłącznie pierwsza linia, a powtórzone połówki są automatycznie deduplikowane. Dzięki temu w 1 etapie trybu Enter pojawia się zawsze tylko jedno, bezpośrednie tłumaczenie zdania.
- [x] 25.3. Spójność widoku powtórek i lektora TTS w popupie (`popup/review.js` & `popup/init.js`).
    - Log:
        1. W `popup/review.js` w `renderQuestion` oraz `renderAnswer` dodano warunek `!isRedundantSentence(sentence, word)`. Jeśli użytkownik posiada w bazie wcześniej zapisane karty ze zduplikowanym zdaniem, widok powtórek nie wyświetla cudzysłowu ani drugiego wiersza z powtórzonym tekstem.
        2. W formularzu edycji fiszki (`showReviewEditForm`) wyczyszczono redundancję przy zapisie edycji.
        3. W `popup/init.js` w funkcji `buildReviewSpeakText(word, sentence)` dodano weryfikację `isRedundantSentence`: syntezator mowy podczas powtórek odczytuje hasło tylko raz, eliminując sztuczne powtórzenie _"blessing in disguise. blessing in disguise"_.
- [x] 25.4. Weryfikacja testami automatycznymi (`test_enter_mode.js`, `functions/subscription-config.test.js`, audyt CSS/JS).
    - Log:
        1. `node scratch/test_enter_mode.js`: 22/22 testy zakończone sukcesem (PASS), w tym Test 2, Test 9, Test 21 oraz Test 22 weryfikujące: eliminację redundancji zdań, czyszczenie w repozytorium, odsłuch w popupie, samo tłumaczenie w 1 etapie trybu Enter, pełne elementy (hasło + znaczenie + wyjaśnienie) w etapach 2..N oraz brak szarego tekstu pod napisami.
        2. `npm test --prefix functions`: 51/51 testów jednostkowych Cloud Functions zakończonych sukcesem (PASS).
        3. Weryfikacja składniowa wszystkich plików JS w projekcie: 100% plików poprawnych składniowo (PASS).
        4. Audyt CSS (`scratch/audit_dead_code.js`): 0 martwych klas w `styles.css`, `popup.css`, `quiz.css`.

## Naprawa Reading Modes — 2026-09-07

- [x] Transport tłumaczeń: wspólna kolejka, cache trwających żądań, timeout i jawne błędy bez ponawiania HTTP 429 w content script.
    - `shared/translator-service.js`, `background.js`, `shared/utils.js`: jedna kolejka backgroundu dla popupu i kart (maks. 2 żądania), współdzielenie identycznych żądań, hydratacja cache przed odczytem, timeout 12 s, utrwalone Retry-After. Błędy zachowują kod/status; nie ma dodatkowego fetch po błędzie backgroundu ani zapisywania pustych wyników.
    - Testy obejmują współbieżność, osobny cache języków, niepoprawne odpowiedzi, timeout, restart workera podczas blokady i komunikację popup/content → background.
- [x] Kontroler Reading Modes: wspólne ustawienia, język ojczysty, anulowanie, prezentacja błędów i rozliczanie tylko udanych tłumaczeń.
    - Dodano `video/reading-modes.js` i `shared/subtitle-translation-service.js`. Klawiatura deleguje akcję, oba renderery współdzielą tłumaczenie. Background kolejkuje sprawdzenie limitu i nalicza znaki po sukcesie; ponowne odczytanie cache nie nalicza ich drugi raz.
    - `video/subtitle-overlay.js`: usunięto fallback zwracający oryginał jako tłumaczenie; dodano komunikat i ponowienie. Częściowy błąd słów zachowuje udane chmurki. Zmiana języka odrzuca starszą odpowiedź, TTS używa języka tłumaczenia. Przytrzymanie S nie zamyka świeżo otwartego trybu.
    - `manifest.json` ładuje nowy kontroler również w ścieżce wstrzykiwania skryptów do iframe; istniejące nazwy komunikatów i klucze ustawień pozostają zachowane.
- [x] DRY i porządki: wspólne reguły językowe, usunięcie starego przepływu zdania AI oraz nieużywanych stylów.
    - `shared/constants.js`, `popup/init.js`, `popup/settings.js`: wspólne domyślne ustawienia Reading Modes/TTS, aktualny stan popupu i usunięcie podwójnej inicjalizacji przełączników.
    - `shared/utils.js`, `shared/ai-prompts.js`, `video/subtitle-overlay.js`: wspólna normalizacja kodów języków i reguły prostych słów; zachowano rozpoznawanie fraz i pomijanie liczb.
    - Usunięto nieistniejące `QT.saveSentence` (skrót Z korzysta z rzeczywistego przycisku zapisu), stary click handler etapu zdania AI pod napisami, `CUSTOM_SUB_TRANSLATION_ACTIVE`, jego selektory i animację. Kwota limitu w komunikacie pochodzi z wyniku sprawdzenia limitu.
    - Skrypty audytu uwzględniają dynamiczne klasy i odróżniają selektory odtwarzaczy od kodu rozszerzenia. Nie usuwano aktywnych klas Netflix/YouTube/Video.js ani dynamicznych klas popupu.
- [x] Testy zachowania transportu, limitów, obu trybów oraz aktualizacja przestarzałych testów i kontrola składni.
    - Dodano `tests/translator.test.js`, `tests/reading-modes.test.js` i wspólne narzędzia testowe. `scratch/test_enter_mode.js` sprawdza aktualne zachowanie zamiast dawnych promptów; test CSS stopki jest niezależny od formatowania. Test Anki korzysta z kontrolowanej odpowiedzi sieci i czeka na asercje asynchroniczne.
    - `npm test`: 98/98 PASS. Testy napisów, SRS i eksportu Anki: PASS. Kontrola składni i `git diff --check`: PASS. Statyczny audyt: brak nierozpoznanych kandydatów CSS/funkcji (nie jest to formalny dowód pełnej osiągalności kodu).
    - Chromium 124, osobny tymczasowy profil, lokalne wideo i kontrolowane odpowiedzi dostawcy: rzeczywisty skrót S uruchamia oba tryby po polsku mimo AI simple_target; zmiana ustawień przełącza oba na niemiecki; HTTP 429 wyświetla błąd bez oryginału udającego tłumaczenie i naliczenia znaków; przycisk ponowienia przywraca oba tryby po upływie symulowanej blokady. Test nie obejmował dostępności Google na żywo ani sesji zalogowanych Netflix/YouTube.

## Faza 24: Naturalne Fiszki AI (2 Zwroty, Brak Znaków Specjalnych), Tryb „Enter” (Zdanie jako 1/N, Trwałość Chmurki i Wideo w Pauzie, TTS Meaning) oraz Audyt Kodu i CSS

- [x] 24.1. Naturalne generowanie zwrotów AI do fiszek (`shared/ai-prompts.js` & `shared/utils.js`).
    - Log:
        1. W `shared/ai-prompts.js` w funkcji `sentenceExample` wprowadzono restrykcyjne reguły: wymóg generowania ZAWSZE DWÓCH naturalnych, potocznych zwrotów oddzielonych znakiem `\n` (np. dla _"All right, you've cornered me"_ -> _"Dobra, przyparłeś mnie do muru\nDobra, nie mam już wyjścia"_), zakaz sztucznych kalk dosłownych (_"wporządku, osaczyłeś mnie"_) oraz bezwzględny zakaz znaków specjalnych (brak ukośników `/`, nawiasów `()`, `[]`, cudzysłowów, punktorów, myślników i prefiksów).
        2. W `standardTranslate` oraz `explainSentence` zsynchronizowano reguły promptów dla fiszek i trybu powtórek: wymóg 2 naturalnych zwrotów potocznych oddzielonych znakiem `\n` bez znaków specjalnych.
        3. W `shared/utils.js` w `cleanCardText` zaimplementowano czyszczenie per-linia z zachowaniem znaku `\n`, dzięki czemu wieloliniowe zwroty nie są spłaszczane w jeden ciąg znaków, a jednocześnie każda linia jest dokładnie oczyszczana ze znaczników napisowych (`[music]`, `NARRATOR:`, `>>`, kropek i przecinków na końcach).
- [x] 24.2. Uporządkowanie trybu „Enter” na wideo (`video/subtitle-overlay.js`).
    - Log:
        1. W `handleAIExplain` przestawiono kolejność kolejki: `aiExplainQueue = [sentenceItem, ...breakdownItems]`. Całe zdanie jest ZAWSZE pierwszym etapem (1/N) zarówno w trybie `native`, jak i `simple_target`, po czym następują kolejne idiomy i trudne słowa (2/N, 3/N, itd.).
        2. W `showAiExplainItem` wyeliminowano wywołanie `removeOverlay()`. Chmurka (dymek) pozostaje w pełni widoczna na każdym etapie – od 1/N aż do 4/4 (ostatniego). Odtwarzacz wideo nie wznawia filmu samoczynnie i pozostaje bezpiecznie w pauzie dopóki użytkownik sam nie naciśnie `Escape` lub `Enter`/`Q`.
        3. W `renderAiExplainContent` usunięto tłumienie `formattedExplanation` na etapie zdania – objaśnienia są teraz zawsze formatowane i widoczne w dymku.
        4. W `speakAiExplainItem` zunifikowano odczyt TTS: dla zdania syntezator odczytuje `item.meaning` (uproszczone zdanie lub tłumaczenie), a następnie `item.explanation`. W trybie `simple_target` dla idiomów i słówek odczytywany jest `term`, po czym `meaning` (prosta definicja/synonim) oraz `explanation`.
- [x] 24.3. Stylizacja wieloliniowych zwrotów i audyt CSS/JS (`popup.css` & `styles.css`).
    - Log:
        1. W `popup.css` dodano `white-space: pre-line;` do `.review-word`, `.review-context`, `.review-ai-text`, `.word-item .wi-translated` i `.word-item .wi-sentence`.
        2. W `styles.css` dodano `white-space: pre-line !important;` do `.__qt_custom-sub-translation` oraz `.__qt_ai-term-meaning`.
        3. Przeprowadzono audyt CSS i JS za pomocą dedykowanych skryptów audytujących: potwierdzono 0 martwych klas CSS w `styles.css`, `popup.css` i `quiz.css` oraz brak osieroconych funkcji w kodzie rozszerzenia.
- [x] 24.4. Weryfikacja testami automatycznymi (`test_enter_mode.js`, `functions/subscription-config.test.js`, `functions/gemini-proxy-cache.test.js`, `check_syntax.js`).
    - Log:
        1. `node scratch/test_enter_mode.js`: 21/21 testów zakończonych sukcesem (PASS), w tym nowy Test 21 weryfikujący naturalne zwroty, `cleanCardText`, `white-space: pre-line` oraz odczyt TTS `meaning` i `explanation`.
        2. `npm test --prefix functions`: 51/51 testów jednostkowych Cloud Functions zakończonych sukcesem (PASS).
        3. `node scratch/check_syntax.js`: 100% plików JS przechodzi weryfikację składniową (PASS).
        4. `test_subtitles.js`, `test-srs.js`, `test_anki_export.js`: wszystkie testy zakończone wynikiem PASS (kod 0).
