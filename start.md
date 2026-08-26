# Start

# Stripe live

# Klucze do zmiany przy produkcji
- LECTORO_GEMINI_API_KEY
- ELEVENLABS_API_KEY
- STRIPE_SECRET_KEY
- R2_SECRET_ACCESS_KEY

functions/.env - TEŻ TRZEBA ZMIENIĆ!

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


4. Gotowe uzasadnienia uprawnień do wklejenia w panelu Chrome Web Store (Privacy Practices)
W panelu dewelopera Google zażąda wyjaśnienia (Permission Justification) w języku angielskim dla każdego zadeklarowanego uprawnienia:

Single Purpose Description:

"Lectoro is a comprehensive language learning assistant that provides instant text translation on web pages, interactive bilingual subtitles for video platforms (YouTube & Netflix), spaced repetition (SRS) flashcards, and AI tutor explanations."

Host Permissions (*://*/* oraz maski CDN/Firebase/Cloud Run):

"Required to display the interactive translation and audio pronunciation tooltip when the user highlights foreign text on any web page, render dual subtitle overlays on HTML5 video players, and securely communicate with our backend proxy for AI explanations, cloud sync, and audio synthesis."

storage:

"Used to persist user settings (target language, speech rate), vocabulary flashcards, SRS review schedules, and offline sync queues locally on the user's device."

identity:

"Used for secure Google Sign-In authentication via Firebase to synchronize the user's saved vocabulary and flashcards across multiple devices."

alarms:

"Used for periodic background synchronization of learning data, token refresh, and scheduling notifications for due spaced repetition reviews."

scripting:

"Used to dynamically inject subtitle overlay components into embedded video frames (iframes) when the user interacts with video content."

activeTab:

"Used exclusively to capture a screenshot of the current video frame as a visual memory aid when the user saves a new flashcard."

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


Obowiązkowy fragment do umieszczenia na stronie https://lectoro.app/privacy:

"Lectoro's use and transfer of information received from Google APIs to any other app will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements."

Ponadto strona musi jasno wskazywać:

Jakie dane są zbierane (adres e-mail konta Google, zapisane słownictwo/fiszki, preferencje językowe).
Cel zbierania danych (synchronizacja postępów w nauce, personalizacja powtórek SRS, realizacja subskrypcji).
Że dane przeglądania nie są gromadzone ani sprzedawane podmiotom trzecim/brokerom danych.



5. Plan działania przed wysłaniem paczki
Wprowadzenie drobnych poprawek w kodzie:
Dopisanie "https://translate.google.com/*" do host_permissions w 

manifest.json
.
Usunięcie shared/srs.js z dynamicznego wstrzykiwania w 

background.js
.
Usunięcie zewnętrznych linków Google Fonts z 

quiz.html
.
Wykluczenie plików .ts w 

scripts/build-cws-zip.js
.
Przygotowanie strony WWW:
Upewnienie się, że pod adresem https://lectoro.app/privacy oraz https://lectoro.app/terms znajdują się aktywne strony z klauzulą Limited Use.
Generowanie paczki:
Uruchomienie node scripts/build-cws-zip.js, który utworzy czysty plik dist/lectoro-cws-v1.0.0.zip (bez zbędnych plików deweloperskich i z automatycznie usuniętym polem key).
Konfiguracja OAuth / Firebase:
Po pierwszym wgraniu paczki do CWS Dashboard, skopiowanie wygenerowanego 32-literowego Extension ID i wklejenie go w Google Cloud Console -> OAuth 2.0 Client IDs (Client Type: Chrome Extension).

📋 Ostateczna Checklista przed kliknięciem „Submit for Review”:
1. Działająca strona Polityki Prywatności (Kluczowe!)
Pod adresem https://lectoro.app/privacy musi działać strona zawierająca oświadczenie wymagane przez 

Google-Web-Store-Policies.md
:

"Lectoro's use and transfer of information received from Google APIs to any other app will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements."

(Warto też upewnić się, że strona wymienia cel zbierania danych: e-mail do konta i synchronizacja słówek).

2. Uzasadnienia uprawnień w formularzu Privacy Practices (w CWS Dashboard)
Wklej przygotowane uzasadnienia w języku angielskim w odpowiednie pola:

Single purpose:
Lectoro is a comprehensive language learning assistant that provides instant text translation on web pages, interactive bilingual subtitles for video platforms (YouTube & Netflix), spaced repetition (SRS) flashcards, and AI tutor explanations.

Permission Justification (*://*/* & host permissions):
Required to display the interactive translation and audio pronunciation tooltip when the user highlights foreign text on any web page, render dual subtitle overlays on HTML5 video players, and securely communicate with our backend proxy for AI explanations, cloud sync, and audio synthesis.

storage:
Used to persist user settings, vocabulary flashcards, SRS review schedules, and offline sync queues locally on the device.

identity:
Used for secure Google Sign-In authentication via Firebase to synchronize the user's saved vocabulary and flashcards across devices.

alarms:
Used for periodic background synchronization of learning data, token refresh, and scheduling notifications for due spaced repetition reviews.

scripting:
Used to dynamically inject subtitle overlay components into embedded video frames (iframes) when the user interacts with video content.

activeTab:
Used exclusively to capture a screenshot of the current video frame as a visual memory aid when the user saves a new flashcard.

3. Wymagane materiały graficzne w zakładce Store Listing
Ikona: Plik icons/icon128.png (128x128 px).
Zrzuty ekranu: Min. 1 zrzut (najlepiej 3-4) o wymiarach 1280x800 px lub 640x400 px (np. dymek tłumaczenia, napisy na YouTube/Netflix, widok powtórek fiszek).
Kafelek promocyjny (Small Promo Tile): 440x280 px (wymagany do publikacji).
4. Połączenie Extension ID z Google Cloud (żeby logowanie działało od razu)
Wgraj plik dist/lectoro-cws-v1.0.0.zip do CWS Dashboard jako wersję roboczą (Draft).
Skopiuj przydzielony przez sklep 32-literowy Extension ID.
Wejdź do Google Cloud Console – Credentials dla projektu extension-eng -> Wybierz identyfikator OAuth (lub stwórz typu Chrome Extension) i wklej ten Extension ID w polu Item ID.
Gdy powyższe 4 punkty są spełnione, wtyczka przechodzi proces review bez przeszkód. Paczka dist/lectoro-cws-v1.0.0.zip jest w 100% gotowa do wgrania.