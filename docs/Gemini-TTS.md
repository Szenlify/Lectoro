# Gemini TTS — zastąpienie ElevenLabs

Stan: 20 września 2026. Zmiana dotyczy kodu rozszerzenia i backendu; wdrożenie Firebase wykonuje się osobno.

## Model i głosy

- Model: `gemini-2.5-flash-preview-tts` — najtańsza stawka standardowego Gemini TTS do syntezy na żądanie: $0,50 / milion tokenów tekstowych i $10 / milion tokenów audio. Batch kosztuje mniej, ale nie służy do bieżącego odsłuchu po kliknięciu.
- **Sulafat** — domyślny głos, opisany przez Google jako ciepły (`Warm`).
- **Algieba** — drugi głos, opisany jako gładki (`Smooth`).

Lista w Review pochodzi z katalogu gotowych głosów Gemini w `shared/constants.js`; jej wyświetlenie nie wymaga zapytania o głosy do backendu ani klucza API. Backend jest wymagany do generowania nagrań.

Oba głosy można stosować do języków obsługiwanych przez Gemini TTS, w tym polskiego i angielskiego. Dobór wynika z charakterystyki głosów i zastosowania do spokojnego czytania; nie jest wynikiem własnego odsłuchu ani dowodem, że są najlepsze w każdym języku. Lista języków pozostaje ograniczona wsparciem modelu. Model ma status Preview.

Źródła: [cennik Gemini API](https://ai.google.dev/gemini-api/docs/pricing#gemini-2.5-flash-preview-tts), [głosy i języki](https://ai.google.dev/gemini-api/docs/speech-generation), [protokół generateContent](https://ai.google.dev/gemini-api/docs/generate-content/speech-generation).

## Klucze i wdrożenie

Backend używa **istniejącego** sekretu `LECTORO_GEMINI_API_KEY`. Nie dodano nowego sekretu TTS. Sekret `ELEVENLABS_API_KEY` nie jest już wymagany przez nową wersję funkcji. Nie jest automatycznie usuwany z Secret Managera.

1. Sprawdź, czy projekt istniejącego klucza ma dostęp do wskazanego modelu Gemini TTS oraz odpowiedni billing i limit żądań.
2. Wdróż funkcję z katalogu głównego repozytorium:

   ```sh
   firebase deploy --only functions:geminiProxy
   ```

3. Przeładuj rozszerzenie lub udostępnij nową paczkę. Nowe komunikaty TTS wymagają nowej wersji backendu i rozszerzenia; stare wersje rozszerzenia nie korzystają z nowych endpointów.
4. Na koncie BASIC/PRO wybierz Sulafat albo Algieba w powtórkach. Sprawdź krótkie nagrania w używanych językach, zatrzymanie odczytu, ponowny odsłuch z cache i eksport Anki.

Klucz nie jest wysyłany do rozszerzenia. Żądania syntezy są uwierzytelniane istniejącym tokenem Firebase. Nie wykonano produkcyjnego wdrożenia ani odsłuchu prawdziwej odpowiedzi Google w ramach testów lokalnych.

## Architektura

`SharedTtsService` → `SubscriptionService.synthesizeGeminiTts()` → service worker dla content scriptów → `geminiProxy` → Gemini `generateContent`.

Backend ma stały model i listę dwóch dozwolonych głosów. Odbiera język od klienta i przekazuje go w instrukcji czytania. Nie tłumaczy tekstu. Odpowiedź PCM 24 kHz, mono, 16 bit jest opakowana w WAV. Niekompletne odpowiedzi i nieobsługiwane formaty są odrzucane. Błąd syntezy cofa rezerwację znaków użytkownika. Brak automatycznych ponowień płatnego żądania ogranicza ryzyko powtórnej opłaty.

W ustawieniach tryb `elevenlabs` przechodzi automatycznie na `gemini`. Liam jest mapowany na Algieba, Matilda i nierozpoznane stare głosy na Sulafat. Ustawienie głosu przeglądarki pozostaje w trybie `browser`.

Dla kompatybilności zachowano fizyczny klucz `elVoiceId`, pola Firestore `elevenLabsCharactersThisMonth` / `elevenLabsResetDate` oraz pole profilu `usage.elevenLabsCharacters`. Oznaczają teraz wykorzystanie syntezy premium, bez resetowania limitów. Publiczne nazwy funkcji, komunikaty, konfiguracja planów i interfejs używają Gemini TTS.

Limity produktu nie zostały zwiększone: BASIC 15 000 znaków/miesiąc, do 500 na żądanie; PRO 100 000 znaków/miesiąc, do 1000 na żądanie. Synteza nie zużywa limitu analizy zdań AI. Zachowano dotychczasową politykę kontekstu `review`.

## Cache, odsłuch i eksport

Klucz w IndexedDB oraz ścieżka w R2 zawierają dostawcę, model, wersję promptu, głos, język i SHA-256 tekstu z zachowaniem wielkości liter:

```text
audio/gemini/gemini-2.5-flash-preview-tts/v1/Sulafat/pl/{sha256}.wav
```

Zmiana modelu lub promptu wymaga aktualizacji modelu / wersji cache jednocześnie w `shared/constants.js` oraz `functions/gemini-tts.js`; zgodność jest testowana. Nie ma wyszukiwania nagrań innego głosu ani podpinania starych plików ElevenLabs jako Gemini. Stary cache nie jest kasowany.

Odczyt istniejącego nagrania nie generuje ponownie audio. Anki otrzymuje rozszerzenie `.wav` dla nowego formatu oraz `.mp3` dla awaryjnego audio Google TTS. Sam eksport nie uruchamia płatnej syntezy. Po błędzie syntezy odsłuch może użyć głosu przeglądarki. Fragmenty rozpoznane przez istniejący parser jako wielojęzyczne nadal korzystają z segmentowanego głosu przeglądarki.

## Szacunkowa oszczędność

Porównanie z używanym wcześniej modelem `eleven_flash_v2_5`, przy publicznej stawce ElevenLabs Flash/Turbo **$0,05 / 1000 znaków**. Źródło: [ElevenAPI](https://elevenlabs.io/pricing/api).

Założenia: 1000 znaków ze spacjami daje 60–90 s audio; 250–400 tokenów wejściowych plus krótka instrukcja. Google rozlicza 25 tokenów audio na sekundę ([cennik i przelicznik](https://cloud.google.com/text-to-speech/pricing)).

| Nowo wygenerowany tekst | ElevenLabs Flash | Gemini 2.5 Flash TTS | Oszczędność |
| --- | ---: | ---: | ---: |
| 1000 znaków | $0,05 | około $0,015–0,023 | około $0,027–0,035 |
| 100 000 znaków | $5 | około $1,50–2,30 | około $2,70–3,50 |
| 1 000 000 znaków | $50 | około $15–23 | około $27–35 |

Około **55–70% mniej za generowanie**. Wolniejsze czytanie, pauzy i wiele krótkich żądań zmieniają wynik. To nie jest wyliczenie z faktur użytkownika: abonament, rabaty, darmowe pule, podatki, Firebase oraz transfer i przechowywanie WAV nie są uwzględnione. WAV jest większy od MP3. Wykorzystanie cache zmniejsza liczbę nowych generacji u obu dostawców i nie jest dodatkowo doliczane do procentu oszczędności.

## Weryfikacja

- Testy modelu, dwóch głosów, migracji ustawień i zgodności kluczy cache klient/backend.
- Testy formatu WAV, żądań Gemini, błędów dostępu/limitu oraz brakujących i niekompletnych odpowiedzi.
- Testy endpointu z atrapami Firebase: naliczanie znaków, rollback, miesiąc rozliczeniowy, cache, walidacja i uprawnienia.
- Testy klienta: cache, rozdzielenie języków/głosów, fallback, eksport bez syntezy i anulowanie przed nadejściem odpowiedzi.

Testy używają atrap dostawcy i nie potwierdzają dostępności modelu dla produkcyjnego klucza ani subiektywnej jakości głosów.
