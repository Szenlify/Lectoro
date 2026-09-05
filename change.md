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
    - Log (skrypt: ekstrakcja selektorów → grep w *.js/*.html z uwzględnieniem dynamicznych `${PREFIX}x`, `lvl-${}`, `sync-status-${}`, `__qt_${state}`):
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
    - Log: Zaimplementowano funkcję `wrapMatchedSpans` oraz `findMatchingSpanRange` w `video/subtitle-overlay.js`. Gdy idiom składa się z wielu słów (np. *"step by step"*, *"take care of"*), sąsiadujące spany wraz z węzłami spacji między nimi są owijane w jeden spójny kontener `span.__qt_ai-sub-wrap`. Kontener posiada `display: inline`, `box-decoration-break: clone`, zaokrąglenie `border-radius: 4px` i gradientowe tło, a wewnętrzne spany mają zresetowane tła i obramowania (`background: transparent; box-shadow: none; border-radius: 0`). Zapobiega to powstawaniu osobnych, poszarpanych bloczków podświetlenia dla każdego wyrazu frazy.
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
    - Log: W `video/subtitle-overlay.js` w `handleAIExplain` zapewniono, że kolejka AI `aiExplainQueue` zawsze rozpoczyna się od obiektu tłumaczenia całego zdania (`sentenceItem` o typie `"sentence"`, tytule *"Całe zdanie"* i etykiecie *"Całe zdanie"*), a pozycje z rozbiciem na idiomy, phrasal verby i trudne słowa (`res.items`) są dołączane na kolejnych indeksach (1..N). W funkcji `updateSubtitleVideoHighlights` obsłużono krok 0 (`isSentenceTranslation`): gdy aktywne jest tłumaczenie całego zdania, w oryginalnym tekście napisów wideo podświetlane są wyłącznie na miękki fiolet (`AI_SUB_QUEUED`) frazy i idiomy, które będą omawiane w następnych krokach (brak agresywnego cyjanowego podświetlenia dla całego zdania). Przy przejściu do kolejnych kroków (indeks > 0) omawiany idiom otrzymuje aktywny gradient cyjanowy (`AI_SUB_ACTIVE`), a pozostałe frazy zachowują fiolet. W `styles.css` dodano dedykowaną hierarchię typograficzną dla kart zdań (`.__qt_ai-term-card[data-type="sentence"]`), uwypuklającą tłumaczenie w języku docelowym. Wstążka zakładek (`renderAiExplainContent`) rozróżnia krok zdania ikoną `💬`, a frazy ikoną `✨`.

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
    - Log: W `video/subtitle-overlay.js` w `handleAIExplain` do każdego wygenerowanego elementu kolejki `breakdownItems` oraz `sentenceItem` przekazano pole `sentenceTranslated: translation`. W `wireAiExplainSaveButton` wyeliminowano pusty ciąg (`""`), ustawiając `contextSentenceTranslated` na pełne tłumaczenie zdania z kontekstu. Gdy użytkownik zapisuje idiom klawiszem `Z` (np. *"will you?"*), pierwsza strona fiszki zawiera termin i całe zdanie źródłowe, a druga strona zawiera tłumaczenie terminu (*"możesz?"*) oraz kompletne przetłumaczone zdanie (*"sentenceTranslated"*), eliminując pustą dolną połowę fiszki w module powtórek SRS.

## Faza 12: Język Wyjaśnień AI w Settings (Native vs Simple Target Language) & Stabilizacja Rozmiaru Napisów

- [x] 12.1. Eliminacja rozszerzania i przesuwania słów w napisach wideo (likwidacja paddingu/borderu w `.__qt_ai-sub-wrap`, `.__qt_ai-sub-active`, `.__qt_ai-sub-queued`).
    - Log: W `styles.css` zaktualizowano reguły stylów podświetlania słów napisów wideo: usunięto rozszerzający padding poziomy (`padding: 0 !important; margin: 0 !important;`) na kontenerach `.__qt_ai-sub-wrap`, `.__qt_ai-sub-active` oraz `.__qt_ai-sub-queued`. Dotychczasowe zewnętrzne ramki `box-shadow: 0 0 0 1.5px` oraz kluczowe klatki animacji (`@keyframes __qt_sub_highlight_glow_in`) zamieniono na bezpieczne obramowanie wewnętrzne `box-shadow: inset 0 0 0 1px #4ecdc4, 0 0 8px rgba(78, 205, 196, 0.45)` oraz łagodną poświatę. Dzięki temu podświetlane słowa zachowują w 100% identyczne naturalne wymiary jak standardowe spany napisów (`.__qt_sub-word`), zapobiegając rozpychaniu sąsiadujących wyrazów i niepożądanemu łamaniu linii.
- [x] 12.2. Dodanie opcji wyboru języka wyjaśnień AI w Settings (`native` vs `simple_target`) wraz z obsługą w promptach Gemini i syntezatorze TTS.
    - Log:
      1. W `popup.html` dodano nową grupę ustawień z selektorem `<select id="aiExplanationLanguage">` oferującą wybór pomiędzy językiem ojczystym uczącego się (*Native language*) a prostym językiem docelowym (*Simple target language: A2-B1*).
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





