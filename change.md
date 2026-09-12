# Dziennik audytu i postępu prac refaktoringu LectoroAI

Nadrzędny dziennik postępu prac i audytu kodu rozszerzenia Chrome LectoroAI.

---

## Faza 1: Oczyszczenie UI Popup (`popup.html` & `popup/settings.js`)

- [x] 1.1. Usunięcie opisu sekcji *Subtitles*: `Interactive reading modes & visual appearance on video.` z `popup.html`.
    - Log: Usunięto paragraf `<p class="section-subtitle-desc">` z nagłówka sekcji *Subtitles* w `popup.html`.
- [x] 1.2. Usunięcie trybu `AI Translate full sentence` (przełącznik `#subtitleTTS` oraz opis `Pressing S / E / Enter displays the full translated sentence and reads it aloud.`) z `popup.html`.
    - Log: Usunięto cały wiersz przełącznika oraz opis z sekcji *Reading Modes* w `popup.html`.
- [x] 1.3. Oczyszczenie `popup/settings.js` z obsługi i listenerów `#subtitleTTS`.
    - Log: Usunięto deklarację `subtitleTTSToggle`, inicjalizację z `data.subtitleTTS` oraz listener zdarzenia `change`.
- [x] 1.4. Zabezpieczenie wartości domyślnych w `shared/constants.js` oraz uproszczenie logiki w `video/reading-modes.js` (skrót S / ↓ uruchamia wyłącznie `wordCloudMode`).
    - Log: W `video/reading-modes.js` funkcja `start(video)` została uproszczona do uruchamiania wyłącznie `ui.showWordClouds` w trybie `wordCloudMode`. Brak wywołań zbędnego tłumaczenia całego zdania pod skrótem `S`. Składnia zweryfikowana (`node --check`).

## Faza 2: Oczyszczenie R2 i Cloud Functions (`functions/`)

- [x] 2.1. Usunięcie tworzenia i zapisu do `dictionaries/translations` w `functions/live-translation.js`.
    - Log: Usunięto generowanie kluczy `dictionaries/translations/` oraz zapis do R2 dla tłumaczonych zdań. Pełne zdania są tłumaczone przez AI w pamięci bez zaśmiecania R2.
- [x] 2.2. Usunięcie tworzenia, zapisu i odczytu `dictionaries/phrase` z R2 w `functions/live-translation.js`. Pozostawienie wyłącznie `dictionaries/live` dla słówek.
    - Log: Usunięto funkcje `savePhraseEntries`, `lookupStoredPhrases`, `buildPhraseCandidates`, `phraseTranslationFromObject`, `validateGeneratedSentence`. W Cloudflare R2 pozostaje wyłącznie folder `dictionaries/live/<source>-<target>/<sha256>.json` dla `kind: "word"`.
- [x] 2.3. Aktualizacja testów `functions/live-translation.test.js` oraz dokumentacji `functions/LIVE_TRANSLATIONS.md`.
    - Log: Usunięto przestarzałe testy zapisu do R2 dla fraz i zdań; zaktualizowano `functions/LIVE_TRANSLATIONS.md`. 79/79 testów w `functions/` przechodzi pomyślnie.

## Faza 3: Statyczne pliki fraz JSON dla trybu Word-by-Word (`dictionaries/phrase/*.json`)

- [x] 3.1. Utworzenie struktury katalogów `dictionaries/phrase/` i dodanie pliku `dictionaries/phrase/en-pl.json` ze wskazanymi frazami:
    - `"play with fire": "igrać z ogniem"`
    - `"on thin ice": "na cienkim lodzie"`
    - `"take off": "startować"`
    - `"take out": "wyjmować"`
    - `"take over": "przejmować"`
    - Log: Utworzono plik `dictionaries/phrase/en-pl.json` ze wskazanymi powszechnymi frazami angielsko-polskimi.
- [x] 3.2. Dodanie startowego pliku `dictionaries/phrase/de-en.json`.
    - Log: Utworzono plik `dictionaries/phrase/de-en.json` z podstawowym zestawem fraz niemiecko-angielskich.
- [x] 3.3. Aktualizacja `manifest.json` (`web_accessible_resources`) o zasoby `"dictionaries/phrase/*.json"`.
    - Log: Dodano `"dictionaries/phrase/*.json"` do listy `web_accessible_resources` w `manifest.json`.
- [x] 3.4. Implementacja natychmiastowego ładowania i wyszukiwania $O(1)$ fraz w `shared/dictionary-store.js` oraz `shared/local-dictionary.js` z obsługą środowiska przeglądarki i Node.js/testów.
    - Log: Zastąpiono pobieranie hashowanych plików SHA-256 z R2 w `getPhrase` ładowaniem słownika `${source}-${target}.json` do pamięci podręcznej i natychmiastowym wyszukiwaniem $O(1)$ znormalizowanych kluczy fraz. Udostępniono metodę `setPhraseDictionary` dla testów.

## Faza 4: Weryfikacja, Testy Jednostkowe & Regresje

- [x] 4.1. Aktualizacja i naprawa testów jednostkowych (`tests/live-dictionary-store.test.js`, `tests/phrase-r2-lookup.test.js`, `tests/reading-modes.test.js`).
    - Log: Zaktualizowano testy `tests/phrase-r2-lookup.test.js` do testowania nowego formatu statycznych słowników fraz; poprawiono `tests/live-dictionary-store.test.js` oraz `tests/reading-modes.test.js` pod kątem usunięcia trybu `subtitleTTS`.
- [x] 4.2. Weryfikacja 100% testów jednostkowych (`npm test`: `node --test tests/*.test.js functions/*.test.js`).
    - Log: Pełny zestaw testów przeszedł: 212/212 testów rozszerzenia i 79/79 testów funkcji serwerowych (łącznie 291/291 PASS).
- [x] 4.3. Weryfikacja składniowa wszystkich plików JS (`node --check`).
    - Log: Zweryfikowano wszystkie pliki JavaScript w repozytorium poleceniem `node --check`. Brak jakichkolwiek błędów składniowych.
- [x] 4.4. Aktualizacja wpisów w `GUIDE.md`.
    - Log: Zaktualizowano tabelę modułów w `GUIDE.md` (usunięcie odniesienia do `subtitleTTS`, udokumentowanie `dictionaries/phrase/*.json`).
