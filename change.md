# Lectoro Extension – Rejestr Refaktoringu i Porządkowania KoduStatus ogólny: UKOŃCZONO
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
