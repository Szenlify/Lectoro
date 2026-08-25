# Start

# Stripe live

# Klucze do zmiany przy produkcji
- LECTORO_GEMINI_API_KEY
- ELEVENLABS_API_KEY
- STRIPE_SECRET_KEY
- R2_SECRET_ACCESS_KEY

## .env w functions do zmiany

- STRIPE_BASIC_PRICE_ID=price_1U45bvPWye8UyAN8xKC8ista
- STRIPE_PRO_PRICE_ID=price_1U46tdPWye8UyAN8jN2EpPxa

## Cloudflare R2 - Konfiguracja Magazynu Mediów
- R2_ACCOUNT_ID=94b9a2de404c8e3f8efa532d0607b5f1
- R2_BUCKET_NAME=lectoro-media
- R2_PUBLIC_URL=https://pub-ee4534784e534bd9af38ba8022bc5e1e.r2.dev
- R2_ACCESS_KEY_ID=75713468bf056703eec66c5821e564f5


po zmianie - R2_PUBLIC_URL=https://pub-ee4534784e534bd9af38ba8022bc5e1e.r2.dev
musisz zmienic w calym projekcie bo sa dynamiczne URL audio i images


2. Gotowe Uzasadnienia Uprawnień do Wklejenia w Panelu Google
W sekcji Privacy practices Google zażąda wyjaśnienia każdego uprawnienia (w języku angielskim):

Single Purpose Description:

"Lectoro is a comprehensive language learning assistant that provides instant text translation on web pages, interactive bilingual subtitles for video platforms (YouTube & Netflix), spaced repetition (SRS) flashcards, and AI-powered grammar explanations."

Host Permissions (*://*/* & CDN masks):

"Needed to provide the floating translation tooltip when users select text on any website, render dual subtitle overlays on HTML5 video players, and communicate with our secure backend proxy for AI explanations and audio synthesis."

storage:

"Used to persist user preferences (target languages, voice speed), the offline-first vocabulary flashcards database, and spaced repetition review schedules locally."

identity:

"Used for one-click Google Sign-In authentication to securely synchronize the user's saved vocabulary and flashcards across devices via Firebase."

alarms:

"Used for periodic background synchronization of learning data, token refresh, and scheduling notifications for due spaced repetition reviews."

scripting:

"Used to dynamically inject the subtitle overlay components into embedded video iframes when the user interacts with video content."

activeTab:

"Used exclusively to capture a screenshot of the current video frame as a visual context memory aid when the user saves a new flashcard."

3. Wymogi Konta i Materiały Graficzne
2-Step Verification: Włączona weryfikacja dwuetapowa na koncie Google dewelopera.
Ikona: 128x128 px (jest w icons/icon128.png).
Zrzuty ekranu: Min. 1 (zalecane 4-5) o rozdzielczości 1280x800 px lub 640x400 px prezentujące dymek tłumaczenia, napisy na wideo i widok powtórek fiszek.
Kafelek promocyjny (Small Promo Tile): 440x280 px.



Oto jak dokładnie działa pole "key", skąd bierze się stały Extension ID i gdzie należy go skonfigurować w Firebase / Google Cloud Console:

1. Skąd wziąć "key" i czy Google go daje?
Krótka odpowiedź: Google wygeneruje go automatycznie w momencie pierwszego wgrania paczki do Chrome Web Store.

W pierwszej paczce ZIP nie musisz mieć pola "key".
Wchodzisz do Chrome Web Store Developer Console i klikasz Add new item (lub wgrywasz plik dist/lectoro-cws-v1.0.0.zip).
Google natychmiast utworzy nową pozycję (draft) i nada wtyczce unikalny, 32-literowy Extension ID (np. abcdefghijklmnopabcdefghijklmnop).
W zakładce Package w panelu dewelopera Google wyświetli Ci również wygenerowany publiczny Klucz (Public Key).
2. Gdzie i po co wkleja się ten klucz/ID?
Są dwa miejsca powiązania:

Krok A: W Google Cloud Console / Firebase (Żeby logowanie Google działało)
Logowanie kontem Google (chrome.identity / Firebase Auth) musi wiedzieć, że żądanie logowania pochodzi z Twojej oficjalnej wtyczki:

Wejdź do Google Cloud Console – Credentials dla projektu extension-eng.
W sekcji OAuth 2.0 Client IDs kliknij swój istniejący identyfikator klienta (lub utwórz nowy: Create Credentials -> OAuth client ID -> Typ aplikacji: Chrome extension).
W polu Item ID wpisz ten 32-literowy Extension ID, który Google nadał Twojej wtyczce w Developer Dashboard.
Zapisz zmiany.
(W Firebase Authentication logowanie Google korzysta dokładnie z tego projektu Google Cloud, więc po tej zmianie Firebase automatycznie zaakceptuje autoryzację z wtyczki).

Krok B: W lokalnym manifest.json (Do testowania lokalnego)
Gdy testujesz wtyczkę lokalnie w chrome://extensions (Załaduj rozpakowane), Chrome normalnie generuje losowy ID bazując na ścieżce do folderu.

Aby Twoja wtyczka uruchomiona lokalnie miała ten sam stały Extension ID co w sklepie, wklejasz wygenerowany z konsoli ciąg do pola "key" w lokalnym pliku manifest.json.
Nasz skrypt budujący paczkę (node scripts/build-cws-zip.js) automatycznie dba o to, by usunąć "key" z pliku ZIP, więc możesz mieć ten klucz w lokalnym manifest.json bez obawy o odrzucenie w sklepie.
📋 Podsumowanie – kolejność działania:
Wgraj plik dist/lectoro-cws-v1.0.0.zip do Chrome Web Store Developer Console.
Skopiuj przydzielony przez sklep Extension ID (32 litery).
Wejdź do Google Cloud Console -> Credentials -> Ustaw ten Extension ID w konfiguracji OAuth klienta.
(Opcjonalnie) Skopiuj klucz publiczny z konsoli CWS i wklej go do lokalnego manifest.json w repozytorium do dalszego lokalnego developmentu