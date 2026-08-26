================================================================================
PHASE 1 — BEZPIECZNE POPRAWKI BŁĘDÓW I MARTWEGO KODU (LOW RISK)
================================================================================

[ ] 1.1 Naprawa brakującej destrukturyzacji csvCell w popup/export.js
        - Plik: popup/export.js (linia 309)
        - Cel: Zapobieżenie ReferenceError przy eksporcie do Excela (.csv).
        - Ryzyko: LOW

[ ] 1.2 Usunięcie nieużywanego importu pickBestVoice w popup/tts.js
        - Plik: popup/tts.js (linia 8)
        - Cel: Czystość kodu i brak fałszywych zależności.
        - Ryzyko: LOW

[ ] 1.3 Aktualizacja asercji w teście functions/gemini-proxy-cache.test.js
        - Plik: functions/gemini-proxy-cache.test.js (linia 457)
        - Cel: Przywrócenie 100% zdawalności testów jednostkowych (45/45 pass).
        - Ryzyko: LOW

================================================================================
PHASE 2 — CENTRALIZACJA STAŁYCH I DEDUPLIKACJA (DRY & SSOT)
================================================================================

[ ] 2.1 Rozszerzenie shared/constants.js o kompletne MESSAGE_TYPES i EVENT_NAMES
        - Pliki: shared/constants.js, background.js, adapters/youtube-adapter.js, adapters/netflix-adapter.js
        - Cel: Single Source of Truth dla nazw komunikatów runtime i zdarzeń bridge'a.
        - Ryzyko: LOW

[ ] 2.2 Ujednolicenie escapeHtml i cleanCardText z wykorzystaniem SharedUtils
        - Pliki: popup/firebase-ui.js, popup/words.js, shared/tts-service.js, shared/word-repository.js
        - Cel: Usunięcie powielonych wyrażeń regularnych i reguł sanityzacji tekstu.
        - Ryzyko: LOW

[ ] 2.3 Ujednolicenie pobierania klucza miesiąca (SharedUtils.currentMonth)
        - Pliki: shared/gemini-proxy.js, shared/subscription-service.js
        - Cel: DRY dla logiki wyliczania limitów miesięcznych.
        - Ryzyko: LOW

[ ] 2.4 Przeniesienie deleteReviewWord i deleteAllReviews z popup/init.js do popup/review.js
        - Pliki: popup/init.js, popup/review.js
        - Cel: Poprawna enkapsulacja stanu powtórek (reviewQueue, reviewIndex) w module review.
        - Ryzyko: LOW

================================================================================
PHASE 3 — REORGANIZACJA STRUKTURY DANYCH I ZAPISU (ŚREDNIE RYZYKO)
================================================================================

[ ] 3.1 Przekierowanie operacji czyszczenia i pobierania słów przez SharedWordRepository
        - Pliki: popup/export.js (markAsDownloaded, clearAll), popup/init.js
        - Cel: Spójność synchronizacji z bazą danych i zwalnianie obrazów w R2 przez jeden serwis.
        - Ryzyko: MEDIUM (Wymaga weryfikacji operacji masowych w pamięci lokalnej).

[ ] 3.2 Zdefiniowanie centralnego STORAGE_KEYS w shared/constants.js
        - Pliki: shared/constants.js, popup/init.js, background.js
        - Cel: Wyeliminowanie literówek w kluczach storage.local w całym projekcie.
        - Ryzyko: LOW

================================================================================
PHASE 4 — WERYFIKACJA KOŃCOWA I PRZYGOTOWANIE PACZKI CWS
================================================================================

[ ] 4.1 Uruchomienie pełnego pakietu testów backendu (npm test w functions/)
        - Weryfikacja: 45/45 testów zakończonych sukcesem.

[ ] 4.2 Test składni JS we wszystkich plikach rozszerzenia (node scratch/check_syntax.js)
        - Weryfikacja: 0 błędów składniowych w kodzie wtyczki.

[ ] 4.3 Zbudowanie paczki produkcyjnej (node scripts/build-cws-zip.js)
        - Weryfikacja: Powstanie pliku dist/lectoro-cws-v1.0.0.zip bez pola "key" w manifest.json.

[ ] 4.4 Test funkcjonalny w przeglądarce Chrome
        - Weryfikacja: Tłumaczenie tekstu na stronie, napisy na YouTube i Netflix, powtórki SRS, generowanie Quizu, synchronizacja Firebase.
