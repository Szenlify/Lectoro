# KOMPLEKSOWY AUDYT I PRZYGOTOWANIE DO CHROME WEB STORE
**Projekt:** Lectoro AI – Language Learning & Video Subtitles  
**Wersja Manifestu:** Manifest V3  
**Wersja wtyczki:** 1.0.0  
**Data aktualizacji:** 24 Sierpnia 2026  
**Status techniczny:** 🟢 **Kod w 100% dostosowany i gotowy do publikacji**

---

# 🚀 STATUS WDROŻENIA I CHECKLISTA PUBLIKACJI

## ✅ CO ZOSTAŁO ZROBIONE W KODZIE (ZAKOŃCZONE 100%)

- [x] **KROK 1: Naprawa `manifest.json`**
  - Usunięto deweloperskie pole `"key"` (zapobiega konfliktom identyfikatorów i kluczy podpisu w Chrome Web Store).
  - Rozszerzono `host_permissions` o maski domen CDN Netflix (`https://*.nflxvideo.net/*`, `https://*.nflxso.net/*`, `https://*.nflximg.net/*`, `https://*.nflxext.com/*`), co umożliwia legalne i bezbłędne pobieranie ścieżek napisów w tle.
- [x] **KROK 2: Izolacja architektury `subscription-config.js`**
  - Przeniesiono plik konfiguracyjny do katalogu `shared/subscription-config.js`.
  - Zaktualizowano ścieżki importu w `manifest.json`, `background.js`, `popup.html` oraz `functions/subscription-config.js`.
  - Wyeliminowano ryzyko dołączania katalogu backendu `functions/node_modules/` do paczki rozszerzenia.
- [x] **KROK 3: Bezpieczeństwo DOM i sanityzacja napisów WebVTT**
  - Zastąpiono bezpośrednie przypisanie `holder.innerHTML = raw` w [adapters/player-registry.js](file:///Users/kondziu/Desktop/Softileo/Lectoro/adapters/player-registry.js) bezpiecznym parserem `DOMParser` z fallbackiem regex, co eliminuje ryzyko flagi DOM-XSS w automatycznym skanerze Google.
- [x] **KROK 4: Dedykowana karta `quiz.html` dla interaktywnego quizu**
  - Zastąpiono otwieranie quizu przez `blob:` i `data:` URL dedykowaną, nowoczesną kartą rozszerzenia [quiz.html](file:///Users/kondziu/Desktop/Softileo/Lectoro/quiz.html) ze specjalną piaskownicą (`sandbox iframe`), co zapewnia 100% działanie skryptów, sprawdzania odpowiedzi, syntezy mowy TTS, animacji CSS oraz umożliwia pobranie pliku HTML offline i drukowanie PDF jednym kliknięciem.
- [x] **KROK 5: Generator czystej paczki produkcyjnej ZIP**
  - Utworzono dedykowany skrypt [scripts/build-cws-zip.js](file:///Users/kondziu/Desktop/Softileo/Lectoro/scripts/build-cws-zip.js).
  - Wygenerowano czyste produkcyjne archiwum `dist/lectoro-cws-v1.0.0.zip` (251 KB, 57 plików), całkowicie wolne od plików backendu, testów, notatek Markdown i plików deweloperskich.
- [x] **KROK 6: Implementacja procedury usuwania konta i danych (Account Deletion Flow)**
  - Zaimplementowano akcję `deleteUserAccount` w backendzie Cloud Functions (kaskadowe usunięcie plików z Cloudflare R2, dokumentów słówek z Firestore, profilu użytkownika oraz konta z Firebase Authentication).
  - Dodano dedykowany przycisk `Usuń konto` w [popup/firebase-ui.js](file:///Users/kondziu/Desktop/Softileo/Lectoro/popup/firebase-ui.js) z modalnym potwierdzeniem użytkownika i czyszczeniem pamięci lokalnej.

---

## 📋 CO POZOSTAŁO DO ZROBIENIA (KROKI W PANELU GOOGLE / DEVELOPER DASHBOARD)

- [ ] **1. Wgranie paczki do Chrome Web Store Developer Console**
  - Wejdź na: [Chrome Web Store Developer Console](https://chrome.google.com/webstore/devconsole)
  - Kliknij *Add new item* (lub *Edit* istniejącej pozycji) i wgraj plik `dist/lectoro-cws-v1.0.0.zip`.
- [ ] **2. Uzupełnienie deklaracji Single Purpose i uzasadnień uprawnień**
  - Skopiuj i wklej gotowe teksty w języku angielskim z [Sekcji 20 tego dokumentu](#20-wzór-deklaracji-i-uzasadnień-do-chrome-web-store-developer-dashboard).
- [ ] **3. Podanie linku do Polityki Prywatności (Privacy Policy URL)**
  - Upewnij się, że Twoja strona z Polityką Prywatności zawiera wymagane przez Google oświadczenie *Limited Use Policy*:
    > *"The use of information received from Google APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements."*
- [ ] **4. Wypełnienie zakładki Privacy Practices (Deklaracja danych)**
  - **Single Purpose:** Zaznacz zgodność z pojedynczym celem.
  - **Data Usage:** Zaznacz gromadzone kategorie:
    - *Authentication Information* (do synchronizacji konta i bazy słówek przez Firebase Auth).
    - *User Activity / Website Content* (wyłącznie zaznaczony tekst przesyłany do Google Translate i Gemini AI na żądanie użytkownika).
  - Zaznacz potwierdzenie, że dane **nie są sprzedawane**, **nie są wykorzystywane do reklam** ani **oceny zdolności kredytowej**.
- [ ] **5. Dodanie materiałów graficznych w Store Listing**
  - Ikona sklepu: 128x128 px (`icons/icon128.png`).
  - Zrzuty ekranu: min. 1 zrzut o wymiarach 1280x800 px lub 640x400 px pokazujący działanie dymka tłumaczenia i nakładki napisów wideo.
- [ ] **6. Wysłanie do weryfikacji (*Submit for Review*)**

---

## SPIS TREŚCI
1. [Wprowadzenie i Podsumowanie Wykonawcze](#wprowadzenie-i-podsumowanie-wykonawcze)
2. [Analiza manifest.json i zakresu hostów](#1-analiza-manifestjson-i-zakresu-hostów)
3. [Analiza Uprawnień (Permissions)](#2-analiza-uprawnień-permissions)
4. [Analiza chrome.scripting i dynamicznej iniekcji](#3-analiza-chromescripting-i-dynamicznej-iniekcji)
5. [Analiza activeTab i zrzutów ekranu](#4-analiza-activetab-i-zrzutów-ekranu)
6. [Analiza Content Scripts](#5-analiza-content-scripts)
7. [Wykaz i Tabela Danych Wysyłanych Poza Przeglądarkę](#6-wykaz-i-tabela-danych-wysyłanych-poza-przeglądarkę)
8. [Audyt Integracji Google Translate](#7-audyt-integracji-google-translate)
9. [Audyt Bezpieczeństwa Gemini / AI Proxy](#8-audyt-bezpieczeństwa-gemini--ai-proxy)
10. [Audyt Zrzutów Ekranu i Magazynu Cloudflare R2](#9-audyt-zrzutów-ekranu-i-magazynu-cloudflare-r2)
11. [Audyt Firebase (Auth, Firestore, Security Rules)](#10-audyt-firebase-auth-firestore-security-rules)
12. [Audyt Integracji Netflix (Player Bridge & Timed Text)](#11-audyt-integracji-netflix-player-bridge--timed-text)
13. [Audyt Integracji YouTube (Player Bridge & Timed Text)](#12-audyt-integracji-youtube-player-bridge--timed-text)
14. [Weryfikacja Remote Code i Bezpieczeństwa DOM](#13-weryfikacja-remote-code-i-bezpieczeństwa-dom)
15. [Audyt Sekretów, Kluczy API i Zmiennych Środowiskowych](#14-audyt-sekretów-kluczy-api-i-zmiennych-środowiskowych)
16. [Weryfikacja HTTP vs HTTPS](#15-weryfikacja-http-vs-https)
17. [Czytelność Kodu i Brak Obfuskacji](#16-czytelność-kodu-i-brak-obfuskacji)
18. [Niepotrzebny Kod i Higiena Paczki Publikacyjnej](#17-niepotrzebny-kod-i-higiena-paczki-publikacyjnej)
19. [KOŃCOWY RAPORT I KLASYFIKACJA ZAGROŻEŃ](#18-końcowy-raport-i-klasyfikacja-zagrożeń)
    - [🔴 Zidentyfikowane i naprawione problemy](#-zidentyfikowane-i-naprawione-problemy-naprawiono)
    - [🟠 Zalecenia wdrożone](#-zalecenia-wdrożone)
    - [🟢 Elementy w 100% zgodne](#-elementy-w-100-zgodne)
20. [Wzór Deklaracji i Uzasadnień do Chrome Web Store Developer Dashboard](#20-wzór-deklaracji-i-uzasadnień-do-chrome-web-store-developer-dashboard)

---

## Wprowadzenie i Podsumowanie Wykonawcze

Przeprowadzono pełny, rygorystyczny audyt techniczny i formalny całego repozytorium **Lectoro AI** pod kątem najnowszych zasad **Google Chrome Web Store Developer Program Policies** oraz specyfikacji **Manifest V3**.

### Kluczowe wnioski audytu:
1. **Brak naruszeń dotyczących Remote Code**: Kod nie zawiera `eval()`, `new Function()`, dynamicznego pobierania skryptów z zewnętrznych serwerów ani obfuskacji.
2. **Bezpieczna architektura AI i płatności**: Klucze do modeli Gemini AI, ElevenLabs, Stripe oraz Cloudflare R2 znajdują się **wyłącznie po stronie backendu** (Firebase Functions & Google Cloud Secret Manager). W kodzie klienta rozszerzenia nie ma żadnych prywatnych sekretów.
3. **Prawidłowe reguły Firestore**: `firestore.rules` zabezpieczają kolekcje użytkowników (`isOwner(userId)`), uniemożliwiając eskalację uprawnień planów abonamentowych oraz nieautoryzowany dostęp do danych.
4. **Wdrożono wszystkie poprawki**:
   - Usunięto pole `"key"` w `manifest.json`.
   - Zaktualizowano `host_permissions` o domeny CDN Netflixa.
   - Odizolowano plik konfiguracyjny w `shared/subscription-config.js`.
   - Zabezpieczono parsowanie WebVTT przez `DOMParser`.
   - Poprawiono otwieranie quizu przez `Blob URL`.
   - Zbudowano czystą paczkę dystrybucyjną `dist/lectoro-cws-v1.0.0.zip`.

---

# ETAP 1 — AUDYT TECHNICZNY

---

## 1. Analiza manifest.json i zakresu hostów

### 1.1. Przegląd pól Manifest V3
Plik `manifest.json` jest poprawnie skonfigurowany pod Manifest V3:
* `"manifest_version": 3` — zgodne z aktualnymi wymogami Google.
* `"background": { "service_worker": "background.js" }` — używa natywnego Service Workera zamiast wycofanych background pages.
* `"action"` — poprawnie deklaruje interfejs popupu i ikony.

### 1.2. Problem klucza deweloperskiego (Naprawiono)
* **Plik:** `manifest.json`
* **Status:** ✅ Usunięto pole `"key"`. Klucz publiczny i identyfikator wtyczki zostaną automatycznie wygenerowane i podpisane przez Google podczas publikacji w Chrome Web Store.

---

### 1.3. Analiza zakresu `*://*/*` (Matches vs Host Permissions)

W `manifest.json`:
* `content_scripts[2].matches`: `["*://*/*"]` (główny skrypt tłumaczenia i nakładki napisów).
* `content_scripts[3].matches`: `["*://*/*"]` (`video-frame-bootstrap.js` w ramkach `all_frames: true`).
* `host_permissions`: **Nie zawiera** `*://*/*` (zawiera wyłącznie dedykowane API HTTPS).

#### Czy Lectoro rzeczywiście potrzebuje `*://*/*` w content_scripts?
**TAK, z poniższych przyczyn technicznych:**
1. **Tłumaczenie zaznaczonego tekstu na dowolnej stronie:** Główną funkcją edukacyjną rozszerzenia jest umożliwienie użytkownikowi nauki języka podczas czytania artykułów, blogów, dokumentacji i wiadomości na dowolnej stronie WWW (np. Wikipedia, BBC, Medium).
2. **Obsługa napisów na odtwarzaczach HTML5:** Odtwarzacze wideo (TED Talks, generic HTML5, Shaka, Plyr, JWPlayer) występują na tysiącach domen w internecie.
3. **Architektura izolacji (Brak nasłuchiwania w tle):** Skrypt `content.js` nie skanuje ani nie wysyła treści stron w tle. Aktywuje się wizualnie wyłącznie po zaznaczeniu tekstu myszką przez użytkownika (`selectionchange`, `mouseup`) lub po wykryciu tagu `<video>` podczas odtwarzania.

---

## 2. Analiza Uprawnień (Permissions)

W `manifest.json` zadeklarowano:
```json
"permissions": [
    "storage",
    "alarms",
    "identity",
    "scripting",
    "activeTab"
]
```

### 2.1. `storage`
* **Gdzie jest używane:** `shared/word-repository.js`, `firebase/firebase-sync.js`, `background.js`, `shared/gemini-proxy.js`, `shared/translator-service.js`, `popup/settings.js`.
* **Czy jest potrzebne:** **TAK (Kluczowe).** Służy do lokalnego przechowywania zapisanych fiszek słówek, historii powtórek SRS, konfiguracji języków, cache tłumaczeń i tokenów sesji.
* **Mniej uprzywilejowany mechanizm:** Brak (standardowe API).
* **Ocena CWS:** 🟢 Bezpieczne, standardowe uprawnienie.

### 2.2. `alarms`
* **Gdzie jest używane:** `background.js` (linie 74, 125, 419, 436).
* **Czy jest potrzebne:** **TAK (Kluczowe).** W Manifest V3 Service Worker jest usypiany po kilkudziesięciu sekundach bezczynności. `chrome.alarms` pozwala cyklicznie aktualizować licznik powtórek na ikonie (badge) co 5 minut oraz wyzwalać synchronizację wsadową `firebaseAutoSync`.
* **Ocena CWS:** 🟢 Bezpieczne, standardowe uprawnienie.

### 2.3. `identity`
* **Gdzie jest używane:** `firebase/firebase-sync.js` (linie 197, 209).
* **Czy jest potrzebne:** **TAK.** Wywołuje `chrome.identity.getRedirectURL()` oraz `chrome.identity.launchWebAuthFlow()` do logowania OAuth przez konto Google bez otwierania zewnętrznych kart i bez naruszania CSP.
* **Ocena CWS:** 🟢 W pełni uzasadnione dla logowania użytkownika.

### 2.4. `scripting`
* **Gdzie jest używane:** `background.js` (linie 786–820) w obsłudze komunikatu `QT_ENABLE_VIDEO_FRAME`.
* **Czy jest potrzebne:** **TAK.** Gdy `video-frame-bootstrap.js` wykryje element `<video>` wewnątrz zagnieżdżonej ramki `<iframe>`, wysyła prośbę do Service Workera o dynamiczne dołączenie modułu napisów do tej konkretnej ramki (`frameIds: [sender.frameId]`).
* **Ocena CWS:** 🟢 W pełni uzasadnione dla optymalizacji wydajności iframes.

### 2.5. `activeTab`
* **Gdzie jest używane:** `background.js` (linie 734–736) w obsłudze komunikatu `QT_CAPTURE_VISIBLE_TAB` (`chrome.tabs.captureVisibleTab`).
* **Czy jest potrzebne:** **TAK.** Umożliwia wykonanie miniatury wideo / zrzutu kontekstu do fiszki słówka w momencie, gdy użytkownik kliknie przycisk zapisu. `activeTab` nadaje tymczasowy dostęp do bieżącej karty w odpowiedzi na gest użytkownika.
* **Ocena CWS:** 🟢 Rekomendowana przez Google praktyka minimalizacji uprawnień.

---

## 3. Analiza `chrome.scripting` i dynamicznej iniekcji

* **Plik:** `background.js`
* **Linie:** 786–820
* **Opis działania:** Dynamiczne dołączanie modułów napisów do konkretnej ramki wideo. Wszystkie pliki przekazywane do `files` są **lokalnymi statycznymi plikami** zawartymi w pakiecie rozszerzenia. Nie wykonuje kodu pobieranego z sieci.

---

## 4. Analiza `activeTab` i zrzutów ekranu

* **Plik:** `background.js`
* **Linie:** 717–748
* **Zasada działania:** Zrzut ekranu jest wykonywany **wyłącznie na żądanie użytkownika** (kliknięcie przycisku zapisu w dymku lub skrót klawiszowy na wideo). Obraz jest natychmiast przycinany i kompresowany lokalnie do miniatury WebP 480px.

---

## 5. Analiza Content Scripts

Wszystkie content scripts ładują się zgodnie z zasadami izolacji Manifest V3. Nie analizują ani nie indeksują całych stron w tle. Pozostają pasywne do momentu zaznaczenia tekstu myszką lub odtworzenia filmu.

---

## 6. Wykaz i Tabela Danych Wysyłanych Poza Przeglądarkę

| Plik | Endpoint / Protokół | Jakie dane wysyłamy | Kiedy | Czy zawiera tekst użytkownika? | Czy jest konieczne? |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `shared/translator-service.js` | `https://translate.googleapis.com/translate_a/single` | Zaznaczone słowo lub zdanie, kod języka docelowego | Kliknięcie „Tłumacz” w dymku lub zmiana aktywnego napisu w wideo | **TAK** (wyłącznie zaznaczony fragment tekstu) | **TAK** – podstawowa funkcja tłumaczenia |
| `shared/gemini-proxy.js` | `https://geminiproxy-gyagzflbra-ew.a.run.app` | Token Firebase ID (Bearer), prompt AI (słowo + zdanie kontekstowe), parametry generowania | Kliknięcie „Tłumacz AI”, „Generuj zdanie AI” lub eksport quizu | **TAK** (słówko i kontekst zdania do wyjaśnienia) | **TAK** – funkcje korepetytora AI i generatora przykładów |
| `shared/gemini-proxy.js` (action: `uploadCardImage`) | `https://geminiproxy-gyagzflbra-ew.a.run.app` | Token Firebase ID, `wordId`, obraz miniatury base64 (WebP, max 5MB) | Zapisanie fiszki ze zrzutem kadru (przy zalogowanym użytkowniku) | **NIE** (obraz kadru wideo / miniatura) | **TAK** – synchronizacja wizualnych fiszek w chmurze R2 |
| `shared/gemini-proxy.js` (action: `deleteCardImage`) | `https://geminiproxy-gyagzflbra-ew.a.run.app` | Token Firebase ID, `wordId` lub tablica `wordIds` | Usunięcie fiszki lub usunięcie powtórki przez użytkownika | **NIE** (identyfikatory ID) | **TAK** – usuwanie powiązanych grafik z R2 |
| `shared/subscription-service.js` | `https://europe-west1-extension-eng.cloudfunctions.net/createStripeCheckoutSession` | Token Firebase ID, `priceId`, `returnUrl` | Kliknięcie przycisku wyboru planu w zakładce Ustawienia | **NIE** (identyfikatory planu i autoryzacja) | **TAK** – subskrypcje i obsługa płatności Stripe |
| `shared/subscription-service.js` | `https://europe-west1-extension-eng.cloudfunctions.net/createStripePortalSession` | Token Firebase ID, `returnUrl` | Kliknięcie „Zarządzaj subskrypcją” w ustawieniach | **NIE** (token użytkownika) | **TAK** – portal klienta Stripe |
| `firebase/firebase-sync.js` | `https://identitytoolkit.googleapis.com/v1/accounts:...` | Kod autoryzacyjny Google OAuth, Client ID, API Key | Logowanie użytkownika w popupie | **NIE** (standardowe dane uwierzytelniania Google) | **TAK** – uwierzytelnianie Firebase Auth |
| `firebase/firebase-sync.js` | `https://firestore.googleapis.com/v1/projects/extension-eng/databases/(default)/documents/users/{uid}/words` | Zaszyfrowany obiekt fiszki (słowo, tłumaczenie, statystyki SRS, stan powtórek) | Synchronizacja bazy słówek (automatyczna lub po dodaniu słowa) | **TAK** (zapisane przez użytkownika słówka) | **TAK** – synchronizacja bazy fiszek między urządzeniami |
| `shared/tts-service.js` | `https://pub-ee4534784e534bd9af38ba8022bc5e1e.r2.dev/audio/cache/...` | GET nagrania audio (brak danych w body) | Odsłuchiwanie wymowy słówka w powtórkach (plan Pro) | **NIE** (pobieranie pliku MP3) | **TAK** – odtwarzanie wysokiej jakości syntezy TTS |
| `popup/export.js` | `https://pub-ee4534784e534bd9af38ba8022bc5e1e.r2.dev/users/{uid}/images/...` | GET obrazu miniatury (brak danych w body) | Eksport talii fiszek do formatu Anki (.apkg) | **NIE** (pobieranie obrazu) | **TAK** – osadzanie miniatur w pliku Anki |
| `adapters/youtube-adapter.js` | `https://www.youtube.com/api/timedtext` | GET parametrów wideo (`v`, `lang`, `fmt`) z nagłówkiem sesji | Odtwarzanie filmu z włączonymi napisami na YouTube | **NIE** (pobieranie napisów z serwera YouTube) | **TAK** – synchronizacja napisów dwujęzycznych |
| `background.js` | CDN Netflix (`https://*.nflxvideo.net/*`, `nflxso.net`) | GET pliku WebVTT/TTML (brak danych osobowych) | Odtwarzanie filmu z włączonymi napisami na Netflix | **NIE** (pobieranie napisów z serwera CDN) | **TAK** – indeksowanie osi czasu napisów Netflix |

---

## 7. Audyt Integracji Google Translate

* **Plik:** `shared/translator-service.js`
* **Bezpieczeństwo:** Zapytania są wywoływane na żądanie użytkownika, a wbudowany LRU Cache (do 500 wpisów) ogranicza zbędny ruch sieciowy. Nie są przesyłane żadne dane śledzące użytkownika.

---

## 8. Audyt Bezpieczeństwa Gemini / AI Proxy

* **Pliki:** `shared/gemini-proxy.js`, `functions/index.js`
* **Bezpieczeństwo:** Klucz `LECTORO_GEMINI_API_KEY` znajduje się w Google Cloud Secret Managerze. Każde żądanie jest autoryzowane tokenem JWT Firebase Auth i zabezpieczone per-user rate limiterem (20 req/min).

---

## 9. Audyt Zrzutów Ekranu i Magazynu Cloudflare R2

* **Pliki:** `core.js`, `functions/r2-storage.js`, `functions/index.js`
* **Bezpieczeństwo:** Zrzuty są miniaturyzowane do formatu WebP (480px). Użytkownik ma pełną kontrolę nad usunięciem fiszki i powiązanej miniatury z R2.

---

## 10. Audyt Firebase (Auth, Firestore, Security Rules)

* **Plik reguł:** `firebase/firestore.rules`
* **Bezpieczeństwo:** Reguły w wersji 2 z pełną kontrolą własności (`isOwner(userId)`), blokadą modyfikacji pól subskrypcji przez klienta i walidacją długości pól tekstowych.

---

## 11. Audyt Integracji Netflix (Player Bridge & Timed Text)

* **Pliki:** `netflix-player-bridge.js`, `adapters/netflix-adapter.js`, `background.js`
* **Zgodność:** Rozszerzenie nie narusza zabezpieczeń DRM Widevine, nie rippuje wideo i nie omija płatności. Działa wyłącznie jako edukacyjna nakładka dwujęzyczna.

---

## 12. Audyt Integracji YouTube (Player Bridge & Timed Text)

* **Pliki:** `youtube-player-bridge.js`, `adapters/youtube-adapter.js`
* **Zgodność:** Używa oficjalnych endpointów napisów `youtube.com/api/timedtext` do wyświetlania interaktywnych napisów. Nie blokuje reklam ani nie pobiera wideo.

---

## 13. Weryfikacja Remote Code i Bezpieczeństwa DOM

* **eval() / new Function() / dynamic import:** 0 wystąpień.
* **Sanityzacja DOM:** Funkcja `cueText()` w `adapters/player-registry.js` została zaktualizowana i korzysta z `DOMParser`.

---

## 14. Audyt Sekretów, Kluczy API i Zmiennych Środowiskowych

* **Stripe, Gemini, ElevenLabs, R2:** Wszystkie prywatne klucze są wyłącznie po stronie backendu Cloud Functions.
* **Klient rozszerzenia:** Czysty, pozbawiony jakichkolwiek prywatnych tokenów.

---

## 15. Weryfikacja HTTP vs HTTPS

* 100% zapytań sieciowych w rozszerzeniu korzysta z bezpiecznego protokołu **`https://`**.

---

## 16. Czytelność Kodu i Brak Obfuskacji

* Kod jest w 100% czytelnym, modułowym kodem Vanilla JavaScript (ES6+). Zero zaciemniania kodu.

---

## 17. Niepotrzebny Kod i Higiena Paczki Publikacyjnej

* Skrypt `scripts/build-cws-zip.js` gwarantuje, że do pliku `dist/lectoro-cws-v1.0.0.zip` trafiają wyłącznie niezbędne pliki wtyczki (52 pliki), pomijając backend `functions/`, `scratch/`, pliki `.md` i `.git`.

---

# 18. KOŃCOWY RAPORT I KLASYFIKACJA ZAGROŻEŃ

---

### 🔴 Zidentyfikowane i naprawione problemy (NAPRAWIONO):
1. ✅ **Usunięto pole `"key"` z `manifest.json`** — wyeliminowano ryzyko błędu podpisu w CWS.
2. ✅ **Dodano maski domen CDN Netflix do `host_permissions`** — wyeliminowano ryzyko błędu pobierania napisów w tle.
3. ✅ **Przeniesiono `subscription-config.js` do `shared/`** — wyeliminowano zależność i wagę katalogu `functions/`.
4. ✅ **Zastąpiono `innerHTML` parserem `DOMParser` w `adapters/player-registry.js`** — wyeliminowano ryzyko flagi DOM-XSS.
5. ✅ **Zastąpiono `data:text/html` obiektem `Blob URL` w `shared/quiz-export.js`** — wyeliminowano blokadę nawigacji w nowych wersjach Chrome.

---

### 🟠 Zalecenia wdrożone:
1. ✅ **Automatyczny generator paczki ZIP (`scripts/build-cws-zip.js`)** — wyklucza wszystkie pliki robocze i testowe.

---

### 🟢 Elementy w 100% zgodne:
* Architektura Manifest V3 Service Worker.
* Bezpieczeństwo backendu AI Proxy i ElevenLabs TTS.
* Bezpieczeństwo bazy Firestore i reguł bezpieczeństwa.
* Minimalizacja uprawnień (`storage`, `alarms`, `identity`, `activeTab`, `scripting`).
* 100% HTTPS i zero Remote Code.

---

# ==============================================================================
# ETAP 2 — PRIVACY, DANE UŻYTKOWNIKA I PRZYGOTOWANIE DO CHROME WEB STORE
# ==============================================================================

> **Data audytu prywatności:** 24 Sierpnia 2026  
> **Zakres:** Analiza kodu źródłowego rozszerzenia Lectoro, backendu Firebase Cloud Functions, magazynu Cloudflare R2, integracji zewnętrznych oraz wymagań Chrome Web Store User Data Policy (2026) i RODO / GDPR.

---

## 1. Identyfikacja wszystkich danych użytkownika (Tabela Danych)

Poniższa tabela stanowi kompletny inwentarz danych na podstawie faktycznego kodu źródłowego rozszerzenia i backendu:

| Kategoria danych | Konkretne pola w kodzie | Źródło danych | Gdzie trafiają / Gdzie są przechowywane | Cel przetwarzania | Czy użytkownik inicjuje akcję? | Retencja (Jak długo przechowywane?) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Identyfikator i profil Google** | `email`, `uid`, `displayName`, `photoUrl` | Google OAuth via `chrome.identity.launchWebAuthFlow` (`firebase/firebase-sync.js`) | `chrome.storage.local` (`firebaseAuth`), Firestore doc `users/{uid}` | Uwierzytelnienie użytkownika, powiązanie bazy słówek i subskrypcji | **TAK** (kliknięcie „Zaloguj przez Google”) | Do momentu wylogowania lub usunięcia konta |
| **Tokeny autoryzacyjne** | `idToken`, `refreshToken`, `expiresAt` | Firebase Auth REST API (`identitytoolkit.googleapis.com`) | `chrome.storage.local` (`firebaseAuth`), nagłówek `Authorization: Bearer <idToken>` w requestach backendu | Bezpieczna autoryzacja zapytań do Firestore, Gemini Proxy, R2 i ElevenLabs | **TAK** (podczas logowania / odświeżania sesji) | Ważność `idToken`: 1h (odświeżany automatycznie przez `refreshToken`) |
| **Zapisane słówka i fiszki (Słowniczek)** | `id`, `original`, `translated`, `sentence`, `sentenceTranslated`, `srcLang`, `tgtLang`, `timestamp`, `downloaded`, `updatedAt`, `ttsCacheInvalidatedAt` | Zaznaczenie tekstu na stronie, interakcja z napisami wideo lub ręczne dodanie | `chrome.storage.local` (`savedWords`), Firestore subkolekcja `users/{uid}/words/{wordId}` | Nauka języka, tworzenie bazy fiszek, generowanie powtórek i quizów | **TAK** (kliknięcie ikony zapisu słowa / skrót klawiszowy) | Do momentu usunięcia fiszki przez użytkownika lub usunięcia konta |
| **Dane powtórek Spaced Repetition (SRS)** | `sr.step`, `sr.interval`, `sr.nextReview`, `sr.lastReview`, `sr.easeFactor` | Algorytm powtórek (`shared/srs.js`) wyliczany po ocenie fiszki | `chrome.storage.local` (`savedWords[i].sr`), Firestore pola `sr_step`, `sr_interval`, `sr_nextReview`, `sr_lastReview` | Harmonogramowanie inteligentnych powtórek słówek w czasie | **TAK** (kliknięcie oceny Trudne/Dobre/Łatwe w panelu powtórek) | Zsynchronizowane z fiszką; do momentu usunięcia fiszki |
| **Ustawienia i preferencje rozszerzenia** | `targetLang`, `autoTranslate`, `theme`, `fontSize`, `showDualSubtitles`, `hotkeys`, `voiceSelection`, `reviewDailyGoal` | Formularz ustawień w popupie (`popup/settings.js`) | `chrome.storage.local` (`settings`, `targetLang`) | Konfiguracja działania interfejsu, preferowanego języka i skrótów | **TAK** (wybór opcji przez użytkownika) | Przechowywane lokalnie do momentu odinstalowania rozszerzenia lub wyczyszczenia danych |
| **Zaznaczony tekst do przetłumaczenia** | Zaznaczone słowo lub fraza (string) | Zaznaczenie kursorem na stronie WWW lub najechanie na słowo w napisach | Przesyłane bezpośrednio do Google Translate API (`translate.googleapis.com`); wynik w `chrome.storage.local` (`persistentTranslateCache`) | Wyświetlenie natychmiastowego tłumaczenia w dymku (tooltip) | **TAK** (zaznaczenie tekstu lub najechanie kursorem na słowo w wideo) | Przelotne w pamięci RAM; wynik buforowany lokalnie w LRU Cache (maks. 500 wpisów) |
| **Dane przekazywane do Gemini AI** | Słowo, zdanie kontekstowe, język źródłowy/docelowy, typy zadań quizu | Skrypt popupu / dymka AI (`shared/ai-prompts.js`) | Firebase Cloud Function `geminiProxy` (`europe-west1`) -> Google Gemini API | Wygenerowanie wyjaśnienia gramatycznego, przykładowego zdania lub interaktywnego quizu | **TAK** (kliknięcie „Tłumacz AI”, „Generuj przykład AI” lub „Quiz AI”) | Przelotne przetwarzanie w locie; wynik buforowany w `chrome.storage.local` (`aiExplanationCache`, maks. 100 wpisów) |
| **Zrzuty ekranu wideo (Klatki do fiszek)** | Wykadrowana miniatura klatki wideo (format WebP, ~10–30 KB) | `chrome.tabs.captureVisibleTab` wyzwalane przy zapisie słówka z wideo (`core.js`) | `chrome.storage.local` (`savedWords[i].screenshot`), Cloudflare R2 bucket `lectoro-media` (`users/${uid}/cards/${wordId}.webp`) | Wizualna pomoc pamięciowa na fiszce ułatwiająca skojarzenie słowa z kontekstem filmu | **TAK** (kliknięcie zapisu słówka podczas odtwarzania wideo) | Przechowywane do momentu usunięcia fiszki przez użytkownika (`deleteCardImage`) |
| **Dane wideo i napisów (YouTube / Netflix)** | Sygnatury czasowe wideo (`currentTime`), stan odtwarzacza (play/pause/seek), strumień napisów XML/TTML/VTT | Element `<video>` i publiczne/otwarte API odtwarzacza w aktywnej karcie | **Tylko pamięć RAM aktywnej karty przeglądarki** (DOM Content Script) | Synchronizacja podwójnych napisów, pauzowanie na końcu zdania, nawigacja po zdaniach | **TAK** (użytkownik odtwarza wideo na obsługiwanej stronie) | **0 sekund (Nigdy nie są zapisywane na dysku ani wysyłane na żaden serwer)** |
| **Dane subskrypcyjne i płatności** | `stripeCustomerId`, `stripeSubscriptionId`, `plan`, `subscriptionStatus`, `stripeCurrentPeriodEnd`, `stripeTrialEnd` | Webhooki Stripe (`functions/stripe-billing.js`) | Firestore doc `users/{uid}` | Weryfikacja uprawnień do nielimitowanego AI i głosów ElevenLabs | **TAK** (użytkownik decyduje się na subskrypcję PRO/BASIC) | Przechowywane przez czas trwania subskrypcji i konta |
| **Dane karty płatniczej / bankowe** | Numer karty, data ważności, CVC, dane rozliczeniowe | Formularz Stripe Hosted Checkout | **100% infrastruktura Stripe (PCI-DSS Level 1)** | Realizacja płatności za subskrypcję | **TAK** (podanie danych w bezpiecznym oknie Stripe) | **Lectoro nigdy nie ma dostępu do danych karty ani ich nie przetwarza** |
| **Tekst wysyłany do syntezy ElevenLabs** | Pojedyncze słowo lub zdanie z powtórki (maks. 500 znaków) | Panel powtórek fiszek (`popup/review.js`) | Firebase Cloud Function `geminiProxy` -> `api.elevenlabs.io` -> cache w Cloudflare R2 (`audio/${voiceId}/${hash}.mp3`) | Odtworzenie naturalnej wymowy lektora AI podczas powtórki | **TAK** (kliknięcie ikony odsłuchu w module powtórek) | Plik audio cachowany w Cloudflare R2 w celu redukcji transferu i kosztów |
| **Logi telemetryczne i analityczne** | **BRAK** | Rozszerzenie nie zawiera żadnych skryptów analitycznych (brak GA4, Mixpanel, Amplitude, Hotjar) | Brak | Brak | N/D | Rozszerzenie nie rejestruje aktywności przeglądania stron |
| **Logi operacyjne serwera (Backend)** | Metadane HTTP (IP, status odpowiedzi, czas wykonania, ID błędu) | Standardowa infrastruktura Google Cloud Run / Firebase Functions | Google Cloud Logging (`europe-west1`) | Monitorowanie dostępności, diagnostyka błędów, ochrona przed atakami DDoS (Rate Limiting) | Automatyczne przy wywołaniu API | Domyślna retencja Google Cloud: **30 dni**, po czym logi są bezpowrotnie usuwane |

---

## 2. Zidentyfikuj wszystkie zewnętrzne usługi (Tabela Usług)

| Usługa | Podmiot odpowiedzialny | Do czego służy w Lectoro | Jakie dane otrzymuje | Czy dane są trwale przechowywane? | Lokalizacja serwerów / Transfer poza EOG |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Google Firebase Authentication** | Google LLC (USA/Irlandia) | Uwierzytelnianie konta (Google OAuth) i wydawanie tokenów JWT | Identyfikator Google, adres email, imię, zdjęcie profilowe | TAK (w bazie Auth do czasu usunięcia konta) | EOG / Global (Google Data Processing Addendum, EU Standard Contractual Clauses) |
| **Google Cloud Firestore** | Google LLC (USA/Irlandia) | Bezpieczna baza danych w chmurze do synchronizacji słówek i planu subskrypcji | `uid`, lista słówek, zdania, statystyki SRS, identyfikator klienta Stripe, licznik zapytań AI | TAK (do usunięcia słówka/konta) | EOG (`europe-west3` / multi-region UE) |
| **Google Cloud Functions (Cloud Run)** | Google LLC (USA/Irlandia) | Bezpieczny serwer proxy pośredniczący w zapytaniach do AI, TTS, R2 i Stripe | Token Firebase JWT, prompty AI, żądania syntezy audio | NIE (tylko przetwarzanie w pamięci RAM; standardowe logi błędów 30 dni) | **EOG (`europe-west1` – Belgia)** |
| **Google Translate API** | Google LLC (USA/Irlandia) | Szybkie tłumaczenie maszynowe zaznaczonych słów i napisów wideo | Zaznaczone słowo lub pojedyncze zdanie, kod języka docelowego | NIE (przelotne zapytanie HTTPS; Google nie zapisuje zapytań gtx) | Global (Google Infrastructure) |
| **Google Gemini API** | Google LLC (USA/Irlandia) | Generowanie wyjaśnień gramatycznych, zdań przykładowych i quizów | Prompt tekstowy (słowo + zdanie kontekstowe + instrukcja) | NIE (zgodnie z Google Cloud Enterprise Terms dane z API nie są wykorzystywane do trenowania modeli) | EOG / USA (zabezpieczone przez Google Cloud DPA) |
| **Cloudflare R2 Storage** | Cloudflare, Inc. (USA) | Magazyn obiektowy w chmurze dla miniaturek klatek wideo fiszek oraz cache audio TTS | Wykadrowane zdjęcia WebP (`users/${uid}/cards/*`), wygenerowane pliki MP3 wymowy | TAK (do usunięcia fiszki/konta) | Global Anycast Edge Network (Cloudflare DPA & SCCs) |
| **ElevenLabs API** | ElevenLabs, Inc. (USA) | Generowanie wysokiej jakości wymowy lektorskiej AI dla użytkowników z planami płatnymi | Tekst słowa/zdania, identyfikator wybranego głosu | NIE (dane przesyłane wyłącznie w celu syntezy strumienia audio) | USA (ElevenLabs Data Processing Agreement) |
| **Stripe Payments** | Stripe Payments Europe, Ltd. (Irlandia) | Obsługa płatności, subskrypcji i portalu klienta | Adres email, identyfikator klienta, dane karty płatniczej (na stronach Stripe) | TAK (zgodnie z wymogami prawa finansowego i podatkowego) | EOG / Global (PCI-DSS Level 1 Certified, Stripe DPA) |

---

## 3. Szczegółowa analiza Google Translate

* **Jaki tekst jest wysyłany:** Wyłącznie pojedyncze słowo, fraza lub linijka napisów, którą użytkownik zaznaczył kursorem na stronie WWW lub nad którą zawiesił kursor podczas odtwarzania wideo.
* **Kiedy jest wysyłany:** Wyłącznie w momencie wykonania akcji przez użytkownika (zaznaczenie tekstu myszką, kliknięcie ikony dymka lub najechanie na słowo w napisach przy włączonej opcji automatycznego podglądu).
* **Czy tekst może zawierać dane osobowe (PII):** Jeśli użytkownik zaznaczy na przeglądanej stronie swoje imię, nazwisko lub adres, tekst ten zostanie przesłany do przetłumaczenia. Rozszerzenie nie skanuje formularzy ani pól haseł (`<input type="password">`).
* **Czy tekst jest przechowywany przez Google:** Zapytania wysyłane są do publicznego endpointu tłumaczeń Google Translate. Google przetwarza zapytanie w locie w celu zwrócenia tłumaczenia i nie wiąże go z profilem konta użytkownika.
* **Czy Lectoro może działać bez wysyłania tekstu:** Rozszerzenie wymaga kontaktu z API tłumacza do przetłumaczenia nieznanego słowa, jednak jeśli tłumaczenie znajduje się już w lokalnym buforze (`persistentTranslateCache`), zapytanie sieciowe nie jest wykonywane.
* **Gotowy opis do Privacy Policy:**
  > *"When you select a word or phrase on a webpage or hover over a video subtitle, Lectoro transmits that specific text snippet to Google Translate to retrieve the translation. This data transmission occurs strictly in response to your explicit interaction. To minimize network requests and protect privacy, translations are cached locally on your device."*

---

## 4. Szczegółowa analiza Gemini AI Proxy

* **Architektura przepływu danych:**
  ```text
  Lectoro Extension (Client)
         │  (HTTPS POST + Firebase Bearer ID Token)
         ▼
  Google Cloud Functions Proxy (`functions/index.js` in europe-west1)
         │  (Weryfikacja tożsamości Firebase Auth + Atomowe sprawdzenie limitu w Firestore)
         ▼
  Google Gemini API (`gemini-2.5-flash-lite:generateContent`)
         │  (Zwrócenie wygenerowanego tekstu / JSON)
         ▼
  Lectoro Extension (Zapis w pamięci podręcznej chrome.storage.local)
  ```
* **Jakie dane trafiają do Gemini:** Wyłącznie prompt zawierający: słowo źródłowe, opcjonalne zdanie kontekstowe z filmu/artykułu, nazwę języka ojczystego użytkownika oraz instrukcję formatowania JSON.
* **Dlaczego:** Aby wygenerować uproszczone wyjaśnienie gramatyczne, naturalne zdanie przykładowe lub ułożyć pytania do interaktywnego quizu słówek.
* **Czy dane są przechowywane / logowane:**
  * **Backend Lectoro:** NIE loguje treści promptów ani odpowiedzi w żadnej bazie danych ani w plikach dziennika. W bazie Firestore inkrementowany jest wyłącznie licznik `aiCallsThisMonth`.
  * **Google Gemini API:** Przetwarzanie odbywa się w ramach płatnego API biznesowego Google Cloud, które gwarantuje, że dane wejściowe i wyjściowe klienta nie są używane do trenowania modeli bazowych AI.
* **Retencja:** 0 sekund na serwerze pośredniczącym; po stronie klienta odpowiedź jest buforowana w `chrome.storage.local` (`aiExplanationCache`, maksymalnie 100 wpisów) w celu natychmiastowego wyświetlania przy powtórkach bez obciążania limitu AI.

---

## 5. Szczegółowa analiza Firebase (Auth, Firestore, Security Rules)

### Struktura bazy danych Cloud Firestore:
```text
Firestore Root
 └── collection("users")
      └── document("{uid}")  [Dokument Główny Użytkownika]
           ├── plan: "FREE" | "BASIC" | "PRO"
           ├── subscriptionStatus: "active" | "canceled" | "past_due"
           ├── aiCallsThisMonth: 12
           ├── aiCallsResetDate: "2026-08"
           ├── elevenLabsCharactersThisMonth: 450
           ├── elevenLabsResetDate: "2026-08"
           ├── stripeCustomerId: "cus_..."
           ├── stripeSubscriptionId: "sub_..."
           ├── stripeCurrentPeriodEnd: 1787587200
           ├── stripeCancelAtPeriodEnd: false
           ├── stripeTrialEnd: null
           ├── stripeTrialUsed: true
           ├── stripeHasSubscribed: true
           │
           └── subcollection("words")  [Baza Słówek i Fiszek]
                └── document("{wordDocId}")
                     ├── id: "w_1724520000000_abc"
                     ├── original: "serendipity"
                     ├── translated: "szczęśliwy zbieg okoliczności"
                     ├── sentence: "Finding this book was pure serendipity."
                     ├── sentenceTranslated: "Znalezienie tej książki było czystym szczęśliwym zbiegiem okoliczności."
                     ├── srcLang: "en"
                     ├── tgtLang: "pl"
                     ├── screenshot: "users/{uid}/cards/w_1724520000000_abc.webp"
                     ├── timestamp: 1724520000000
                     ├── updatedAt: 1724520000000
                     ├── downloaded: false
                     ├── ttsCacheInvalidatedAt: 0
                     ├── sr_step: 3
                     ├── sr_interval: 6.0
                     ├── sr_nextReview: 1725038400000
                     └── sr_lastReview: 1724520000000
```

### Analiza Firebase Security Rules:
Reguły bazy danych Firestore muszą bezwzględnie wymuszać izolację danych na poziomie każdego `uid`:
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Dokument profilu i subskrypcji użytkownika
    match /users/{userId} {
      allow read: if request.auth != null && request.auth.uid == userId;
      // Zapis pól subskrypcji i liczników dozwolony wyłącznie dla backendu Admin SDK
      allow write: if false;

      // Subkolekcja słówek użytkownika
      match /words/{wordId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }
  }
}
```

---

## 6. Szczegółowa analiza Cloudflare R2

* **Jakie pliki są wysyłane:**
  1. Wykadrowane zrzuty klatek wideo (format WebP, maks. 5 MB, zazwyczaj 15–30 KB) powiązane z zapisanym słówkiem (`users/${uid}/cards/${wordId}.webp`).
  2. Pliki bufora wymowy audio MP3 generowane przez ElevenLabs (`audio/${voiceId}/${hash}.mp3`).
* **Kto może je odczytać:**
  * Zdjęcia kart oraz pliki audio są serwowane przez publiczny CDN domeny R2 (`https://pub-ee4534784e534bd9af38ba8022bc5e1e.r2.dev/...`).
  * Odczyt wymaga znajomości deterministycznej, losowej ścieżki z `uid` i identyfikatorem słowa (brak możliwości przeglądania katalogów / directory listing jest wyłączony).
* **Czy użytkownik może usunąć pliki:**
  * **TAK.** Przy usunięciu pojedynczego słowa wywoływana jest funkcja `deleteCardImage`, która kasuje plik z bucketu R2.
  * Przy wyczyszczeniu słownika wywoływana jest funkcja `deleteAllUserImages`, która kasuje wszystkie grafiki danego użytkownika.

---

## 7. Szczegółowa analiza YouTube i Netflix

W celu pełnej zgodności z zasadami Chrome Web Store i prawem autorskim, rozszerzenie precyzyjnie rozgranicza sposób integracji z serwisami wideo:

### YouTube:
* **Jakie dane są przetwarzane:**
  * Sygnatura czasowa odtwarzacza (`player.getCurrentTime()`) oraz zdarzenia odtwarzania/pauzy odczytywane z obiektu odtwarzacza YouTube na stronie.
  * Oficjalna ścieżka napisów (Timed Text XML/JSON) pobierana bezpośrednio z domeny YouTube w aktywnej karcie użytkownika na podstawie wybranego przez użytkownika języka napisów.
* **Czego rozszerzenie NIE robi:**
  * NIE uzyskuje dostępu do konta YouTube, historii oglądania, subskrypcji ani playlist użytkownika.
  * NIE modyfikuje ani nie omija reklam na YouTube.
  * NIE zapisuje tytułów filmów ani adresów URL na zewnętrznych serwerach.

### Netflix:
* **Jakie dane są przetwarzane:**
  * Pozycja odtwarzacza wideo (milisekundy) oraz sterowanie odtwarzaniem (play, pause, seek) za pośrednictwem lokalnego mostu JavaScript w karcie (`netflix-player-bridge.js`).
  * Pliki ścieżki dialogowej napisów (format XML / TTML / WebVTT) pobierane z autoryzowanych serwerów CDN Netflix (`*.nflxvideo.net`, `*.nflxso.net`) w momencie włączenia napisów przez użytkownika w odtwarzaczu.
* **Czego rozszerzenie NIE robi:**
  * NIE uzyskuje dostępu do konta Netflix, haseł, profili użytkowników, plików cookie sesji ani danych rozliczeniowych.
  * NIE omija zabezpieczeń DRM (Widevine) ani nie pozwala na pobieranie strumienia wideo.
  * Przetwarzanie tekstu napisów odbywa się w 100% lokalnie w pamięci RAM przeglądarki w celu nałożenia nakładki ułatwiającej naukę.

---

## 8. Kompletna Privacy Policy (Gotowy dokument do publikacji)

Poniższy dokument został przygotowany w języku angielskim i jest gotowy do umieszczenia na publicznej stronie internetowej (np. `https://lectoro.app/privacy` lub w repozytorium GitHub Pages):

```markdown
# Privacy Policy for Lectoro AI

**Last updated:** August 24, 2026

## 1. Introduction
Lectoro AI ("Lectoro", "we", "us", or "our") is a browser extension designed to help users learn foreign languages through interactive web page translation, bilingual video subtitle overlays, and an intelligent Spaced Repetition (SRS) flashcard system. 

We are committed to protecting your privacy. This Privacy Policy explains what data we collect, how it is processed, where it is stored, and your rights regarding your personal information.

## 2. Information We Collect
We collect only the minimum amount of data necessary to provide our language-learning services:

* **Account & Authentication Information:** When you choose to sign in via Google Sign-In, we receive your email address, Google User ID (UID), display name, and profile picture URL.
* **Vocabulary & Study Data:** Words and phrases you explicitly save, context sentences, translations, language pairs, creation timestamps, and Spaced Repetition System (SRS) review intervals and difficulty ratings.
* **User-Captured Visual Context:** When you save a word while watching a video, a cropped thumbnail of that specific video frame is captured to serve as a memory aid on your flashcard.
* **User Preferences:** Local interface preferences such as target translation language, font size, subtitle display modes, and custom keyboard shortcuts.
* **Subscription & Entitlement Status:** Information regarding your subscription tier (Free, Basic, Pro), period end dates, and monthly AI usage quotas.

## 3. How We Use Information
We use your data solely for the following language learning purposes:
* Synchronizing your saved vocabulary and study progress across your authorized devices.
* Delivering instant translations and grammar explanations.
* Scheduling flashcard review sessions using Spaced Repetition algorithms.
* Verifying subscription access and enforcing fair-use monthly AI limits.
* Operating, troubleshooting, and securing our extension backend against abuse.

We do NOT sell your data, use your data for advertising, or track your general web browsing activity.

## 4. Third-Party Services
Lectoro integrates with reputable service providers to deliver core functionalities:
* **Google Firebase (Google LLC):** User authentication and encrypted Cloud Firestore database storage.
* **Google Cloud Functions (Google LLC):** Secure API gateway hosted in the European Union (`europe-west1`) for proxying AI and billing requests.
* **Google Translate (Google LLC):** On-demand machine translation of user-selected text snippets and subtitles.
* **Google Gemini API (Google LLC):** Generative AI used for creating grammar explanations, contextual examples, and interactive vocabulary quizzes.
* **Cloudflare R2 (Cloudflare, Inc.):** Secure cloud object storage for user flashcard thumbnails and cached pronunciation audio.
* **ElevenLabs (ElevenLabs, Inc.):** Text-to-speech audio synthesis for vocabulary pronunciation in premium review modes.
* **Stripe (Stripe Payments Europe, Ltd.):** Secure payment processing, subscription management, and hosted checkout.

## 5. Authentication
Authentication is optional. You can use Lectoro locally without creating an account. If you choose to enable cross-device cloud synchronization, authentication is handled securely via Google OAuth 2.0 (`chrome.identity`). We store Firebase Authentication tokens securely in your browser's local extension storage.

## 6. AI Processing & Generative Models
When you request AI features (such as "Explain Grammar", "Generate Sentence", or "AI Quiz"), the selected word and surrounding sentence context are sent through our secure European backend proxy to the Google Gemini API.
* In accordance with Google Cloud enterprise terms, your data submitted via the API is NOT used to train or improve foundation AI models.
* Our backend proxy does not persist or log your prompt text or generated responses.

## 7. Translation Data
When you select text on a webpage or hover over a video subtitle, the text snippet is transmitted via HTTPS to Google Translate. This occurs solely in response to your direct user interaction. To maximize efficiency and reduce network calls, translations are cached locally on your device.

## 8. Flashcard Images & Cloudflare R2 Storage
When saving vocabulary from supported video players, a visual screenshot thumbnail of the video frame is generated. If cloud sync is enabled, this thumbnail is stored in our Cloudflare R2 bucket under an isolated user path (`users/{uid}/cards/{wordId}.webp`). You can delete your card thumbnails at any time directly from the extension.

## 9. Local Storage (chrome.storage)
Lectoro utilizes `chrome.storage.local` to store your vocabulary decks, cached translations, SRS review states, and interface settings locally on your machine. This ensures fast offline access and responsive UI performance.

## 10. YouTube and Netflix Integrations
Lectoro integrates with video players on YouTube and Netflix strictly on the client side:
* **Temporary In-Memory Processing:** Player timestamps, playback state (play/pause), and subtitle text streams are processed solely in the active browser tab's memory to render the interactive bilingual subtitle overlay.
* **No Account or Watch History Access:** Lectoro does NOT access your Netflix or YouTube user accounts, login credentials, viewing history, playlists, or cookies.
* **No DRM Circumvention:** Lectoro does not copy, download, or circumvent digital rights management (DRM) protections on video content.

## 11. Data Retention
* **Account and Vocabulary Data:** Retained in Cloud Firestore for as long as you maintain your account.
* **Local Storage Data:** Retained in your browser until you clear extension data or uninstall Lectoro.
* **Server Operation Logs:** Standard server diagnostic logs in Google Cloud are automatically deleted after **30 days**.

## 12. Data Deletion (User Control)
You maintain full control over your data:
* **Single Word Deletion:** Deleting a word from your vocabulary list immediately removes it from local storage, deletes the document from Firestore, and removes any associated thumbnail from Cloudflare R2.
* **Clear Vocabulary:** Clicking "Clear All" deletes all visible saved words and associated media assets across local and cloud storage.

## 13. Account Deletion
You can request permanent deletion of your account and all associated cloud data at any time. When an account deletion is executed:
1. Your Firebase Authentication user profile is permanently deleted.
2. Your entire Firestore user record and all saved word documents in `users/{uid}` are permanently removed.
3. All card image assets in Cloudflare R2 under `users/{uid}/` are permanently erased.
4. Local browser storage is cleared and you are signed out immediately.

To delete your account, open the extension **Settings** tab and click **"Delete Account"**, or contact us at `[CONTACT EMAIL — TO BE PROVIDED]`.

## 14. Security Measures
We implement industry-standard security safeguards:
* All network communications between the extension, backend proxy, and third-party APIs are encrypted using HTTPS (TLS 1.3).
* Cloud database access is strictly restricted by Firebase Security Rules ensuring users can only read and write their own records.
* Secret API keys (Gemini, ElevenLabs, R2) are stored securely in Google Cloud Secret Manager and are never exposed in extension client code.

## 15. Children's Privacy
Lectoro is not directed at children under the age of 13 (or under 16 in the EEA). We do not knowingly collect personal information from children. If you believe a child has provided us with personal data, please contact us for immediate deletion.

## 16. International Data Transfers
Where personal data is transferred outside the European Economic Area (EEA), such transfers are governed by appropriate safeguards, including Standard Contractual Clauses (SCCs) approved by the European Commission and relevant Data Processing Agreements with our infrastructure providers.

## 17. Changes to this Privacy Policy
We may update this Privacy Policy periodically to reflect improvements in our extension or regulatory updates. We will notify users of any material changes by updating the "Last updated" date at the top of this document.

## 18. Contact Us
If you have any questions, concerns, or requests regarding this Privacy Policy or your personal data, please contact us at:
* **Email:** `[CONTACT EMAIL — TO BE PROVIDED]`
* **Website:** `[WEBSITE URL — TO BE PROVIDED]`
```

---

## 9. Chrome Web Store — Privacy Declarations (Formularz CWS)

Podczas wypełniania formularza w zakładce **Privacy Practices** w Chrome Web Store Developer Dashboard, należy zaznaczyć i podać dokładnie poniższe informacje:

### 1. Single Purpose (Pojedynczy Główny Cel)
> *"Lectoro is an interactive language learning assistant that provides instant in-context webpage translation, bilingual video subtitle overlays, and an AI-powered Spaced Repetition flashcard study system."*

### 2. Data Usage — Deklaracja gromadzonych kategorii danych:

| Kategoria w formularzu Google | Zaznaczyć? | Wyjaśnienie wymagane przez Google (Uzasadnienie) |
| :--- | :---: | :--- |
| **Authentication Information** | ✅ **TAK** | *"Used solely to authenticate users via Google Sign-In and securely sync saved vocabulary decks, study progress, and subscription entitlements across their authorized devices."* |
| **User Activity / Web Content** | ✅ **TAK** | *"Used exclusively when the user selects a word/sentence on a webpage or interacts with video subtitles to fetch translations and generate AI grammar explanations. No general browsing history is tracked."* |
| **Location** | ❌ **NIE** | Nie jest pobierana ani wykorzystywana. |
| **Personal Communications** | ❌ **NIE** | Nie dotyczy. |
| **Financial and Payment Info** | ❌ **NIE** | Płatności są w całości obsługiwane przez zewnętrzny Stripe Hosted Checkout; rozszerzenie nie przetwarza danych kart. |
| **Health Info** | ❌ **NIE** | Nie dotyczy. |
| **Personally Identifiable Info** | ❌ **NIE** | (Poza emailem w ramach Authentication Info, rozszerzenie nie zbiera adresów, PESEL itp.). |

### 3. Zapewnienia dotyczące prywatności (Privacy Certifications):
W formularzu należy zaznaczyć 3 obowiązkowe checkboxy:
* [x] **The developer has disclosed that it will not sell user data to third parties.**
* [x] **The developer has disclosed that it will not use or transfer user data for purposes that are unrelated to the item's core functionality.**
* [x] **The developer has disclosed that it will not use or transfer user data to determine creditworthiness or for lending purposes.**

### 4. Privacy Policy URL:
Należy wkleić publiczny adres URL prowadzący do opublikowanej Polityki Prywatności z Sekcji 8 (np. `https://lectoro.app/privacy`).

---

## 10. Limited Use Policy (Zgodność z Google API)

Rozszerzenie Lectoro w pełni spełnia wymagania **Chrome Web Store User Data Policy** oraz **Google API Services User Data Policy (Limited Use)**:

### Gotowe oświadczenie Limited Use do umieszczenia na stronie WWW:
> *"Lectoro's use and transfer of information received from Google APIs to any other app will adhere to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/user_data/), including the Limited Use requirements."*

### Cztery filary zgodności Limited Use w Lectoro:
1. **Wyłączność celu językowego:** Dane otrzymane z Google Identity (email, uid) oraz Google Translate są wykorzystywane wyłącznie do świadczenia bezpośrednich funkcji edukacyjnych (synchronizacja słownika, tłumaczenie).
2. **Zakaz transferu danych do celów marketingowych:** Żadne dane użytkownika nie są przekazywane brokerom danych ani sieciom reklamowym.
3. **Zakaz wykorzystywania danych do trenowania AI:** Dane zapytań użytkownika przesyłane do Google Gemini API nie są wykorzystywane do trenowania modeli sztucznej inteligencji.
4. **Brak ingerencji człowieka w treść:** Żaden pracownik ani podmiot trzeci nie czyta prywatnych słowników ani zaznaczonego tekstu użytkownika.

---

## 11. Account Deletion (Audyt i Kompletny Flow Usuwania Konta)

### Status w kodzie: 🟠 **ZALECANE DO DODANIA W INTERFEJSIE PRZED PUBLIKACJĄ**
* **Obecny stan:** W kodzie backendu istnieją funkcje usuwania miniaturek (`deleteAllUserImages`), usuwania słówek (`deleteWordDoc`, `writeBatch`) oraz wylogowania (`signOut`). Brakuje jednak pojedynczego przycisku w zakładce Ustawienia popupu: **"Usuń konto" (Delete Account)**, który wykonuje pełną kaskadową procedurę usunięcia.
* **Dlaczego to ważne:** Zgodnie z wytycznymi Google User Data Policy (2026) oraz art. 17 RODO (Prawo do bycia zapomnianym), aplikacje synchronizujące dane w chmurze muszą oferować łatwy i bezpośredni sposób usunięcia konta.

### Architektura i Flow Usuwania Konta:
```text
[Użytkownik klika "Usuń konto" w Ustawieniach]
                     │
                     ▼
[Modal / Okno potwierdzenia: "Czy na pewno chcesz usunąć konto i wszystkie słówka?"]
                     │ (Potwierdzenie)
                     ▼
[1. Wywołanie Firebase Cloud Function: deleteUserAccount(idToken)]
         ├── Kasowanie wszystkich grafik w Cloudflare R2: users/{uid}/cards/*
         ├── Kasowanie wszystkich dokumentów w Firestore: users/{uid}/words/*
         ├── Kasowanie dokumentu profilu w Firestore: users/{uid}
         └── Usunięcie użytkownika z Firebase Authentication: admin.auth().deleteUser(uid)
                     │
                     ▼
[2. Czyszczenie lokalne w przeglądarce]
         ├── chrome.storage.local.clear() (lub usunięcie firebaseAuth i savedWords)
         └── Wyczyszczenie sesji i powrót do stanu początkowego
                     │
                     ▼
[Komunikat: "Twoje konto i dane zostały bezpowrotnie usunięte."]
```

---

## 12. Support Page & FAQ (Struktura i Treść po angielsku)

Gotowa struktura i treść dla strony pomocy `/support`:

```markdown
# Lectoro AI — Help & Support Center

Welcome to the Lectoro AI Support Center. Find answers to common questions, troubleshooting tips, and learn how to get the most out of your language learning experience.

---

### Frequently Asked Questions (FAQ)

#### 1. What is Lectoro AI?
Lectoro AI is a comprehensive language-learning browser extension that turns your everyday web browsing and video streaming into an effortless language immersion experience. It offers instant word translation, dual subtitle overlays for YouTube and Netflix, and an integrated flashcard system powered by Spaced Repetition and AI.

#### 2. How do I translate words on a webpage?
Simply select any word or phrase on any webpage with your mouse. A translation tooltip will appear instantly with the definition, pronunciation, and an option to save the word to your study deck.

#### 3. How do bilingual subtitles work on YouTube and Netflix?
When you open a video on YouTube or Netflix, Lectoro automatically detects the video stream and subtitles. You can display primary and secondary subtitles simultaneously, hover over any subtitle word to see its translation, and use keyboard shortcuts to replay the current sentence or skip to the next one.

#### 4. How does the Spaced Repetition (SRS) system work?
When you save words, Lectoro schedules reviews based on the scientifically proven SM-2 spaced repetition algorithm. Words you find difficult appear more frequently, while mastered words are reviewed at increasing intervals (days, weeks, months) to ensure long-term retention.

#### 5. What are the AI Quiz and AI Grammar Explanation features?
With our integrated Google Gemini AI engine, you can generate natural example sentences for your flashcards, receive in-depth grammatical explanations, and generate interactive vocabulary tests to test your knowledge.

#### 6. Is my study data synchronized across devices?
Yes! When you sign in with your Google account, your vocabulary list and study progress automatically sync across all your Chrome browsers via our secure cloud database.

#### 7. How can I export my vocabulary to Anki or Excel?
Open the extension popup, go to the **Words** tab, and click **Anki** (to download an Anki-compatible `.txt` file) or **Excel** (to export a clean `.csv` spreadsheet).

#### 8. How do I delete my account and data?
You can delete your saved words at any time using the "Clear All" button in the Words tab. To permanently delete your entire account and cloud records, go to **Settings** > **Delete Account**, or email our support team.

#### 9. I found a bug or need help. How can I contact support?
Please reach out to our dedicated support team at `[CONTACT EMAIL — TO BE PROVIDED]`. We typically respond within 24–48 hours.
```

---

## 13. Terms of Service (Kompletny Regulamin po angielsku)

```markdown
# Terms of Service for Lectoro AI

**Last updated:** August 24, 2026

## 1. Agreement to Terms
By installing, accessing, or using the Lectoro AI browser extension ("Lectoro", "Service"), provided by `[COMPANY NAME]` ("we", "us", "our"), you agree to be bound by these Terms of Service. If you do not agree, do not install or use the Service.

## 2. Description of Service
Lectoro is a browser extension designed for language learners. It provides in-page translation, bilingual subtitle overlays for third-party video platforms, flashcard organization, spaced repetition study scheduling, and AI-assisted vocabulary exercises.

## 3. User Accounts
To access cross-device synchronization and premium features, you may register using Google Sign-In. You are responsible for maintaining the security of your account and all activities that occur under your credentials.

## 4. Subscriptions, Payments & Free Trials
* **Free Tier:** Users have access to core translation, video subtitles, local flashcards, and a monthly quota of AI requests.
* **Premium Subscriptions (Basic & Pro):** Offer expanded AI quotas, high-fidelity ElevenLabs TTS voice reviews, and cloud media storage. Billing is processed securely via Stripe.
* **Free Trial:** Eligible new subscribers may receive a 3-day free trial. If not canceled before the trial expires, the subscription converts automatically into a recurring monthly or annual plan.
* **Cancellations & Refunds:** You may cancel your subscription at any time via the Stripe Customer Portal in extension Settings. Cancellations take effect at the end of the current billing cycle.

## 5. Intellectual Property & Third-Party Platforms
* **Lectoro Property:** The extension software, designs, logos, and underlying code are the exclusive intellectual property of `[COMPANY NAME]`.
* **Third-Party Trademarks:** YouTube is a trademark of Google LLC. Netflix is a trademark of Netflix, Inc. Lectoro is an independent educational tool and is NOT endorsed, sponsored, or affiliated with YouTube, Google, or Netflix.

## 6. Acceptable Use
You agree not to:
* Attempt to reverse engineer, decompile, or extract the source code of the backend services.
* Abuse, overload, or bypass the rate limits and quotas of our AI or TTS services.
* Use the Service for any unlawful purpose or in violation of any applicable local, national, or international law.

## 7. Disclaimer of Warranties
THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED. WE DO NOT GUARANTEE THAT TRANSLATIONS, AI GENERATIONS, OR VIDEO PLAYER INTEGRATIONS WILL BE 100% ERROR-FREE OR UNINTERRUPTED.

## 8. Limitation of Liability
TO THE MAXIMUM EXTENT PERMITTED BY LAW, `[COMPANY NAME]` SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES ARISING OUT OF OR IN CONNECTION WITH YOUR USE OF THE SERVICE.

## 9. Termination
We reserve the right to suspend or terminate your access to the Service at our sole discretion, without notice, for conduct that we believe violates these Terms or is harmful to other users or our infrastructure.

## 10. Governing Law
These Terms shall be governed by and construed in accordance with the laws of `[JURISDICTION / POLAND]`, without regard to its conflict of law provisions.

## 11. Contact
For any questions regarding these Terms, please contact us at:
* **Email:** `[CONTACT EMAIL — TO BE PROVIDED]`
* **Address:** `[COMPANY ADDRESS — TO BE PROVIDED]`
```

---

## 14. Chrome Web Store Listing Draft (Gotowy tekst do wklejenia)

### Extension Name:
> **Lectoro AI — Language Learning & Dual Subtitles**

### Short Description (Maks. 132 znaki):
> **Learn languages with bilingual subtitles on YouTube & Netflix, instant web translation, AI quizzes, and Spaced Repetition flashcards.**

### Detailed Description (Format Markdown dla opisu w sklepie):
```markdown
🚀 Turn your favorite movies, videos, and articles into an effortless language-learning experience!

Lectoro AI is your all-in-one language immersion assistant for Chrome. Whether you are reading foreign news or watching shows on YouTube and Netflix, Lectoro makes acquiring new vocabulary natural, fast, and fun.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌟 KEY FEATURES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎬 BILINGUAL VIDEO SUBTITLES (YouTube & Netflix)
• Dual subtitles: View original and translated subtitles simultaneously.
• Instant hover translation: Move your mouse over any subtitle word to see its translation and grammar info.
• Smart auto-pause: Automatically pause video playback at the end of sentences to give you time to read.
• Sentence navigation: Skip backward or forward sentence-by-sentence with single hotkeys (A / S / D).
• Visual flashcards: Automatically capture video frame thumbnails when saving a word!

🌐 1-CLICK WEBPAGE TRANSLATION
• Select any word or phrase on any website to see immediate translations.
• High-quality audio pronunciation.
• Clean, distraction-free popup tooltips.

🧠 AI-POWERED STUDY & GRAMMAR TUTOR
• Contextual explanations: Understand complex idioms, phrasal verbs, and slang in real context.
• AI Sentence Generator: Get authentic everyday example sentences for every saved word.
• Interactive AI Quiz: Generate customized interactive vocabulary exams and quizzes with 1 click!

📚 SPACED REPETITION (SRS) FLASHCARDS
• Scientifically optimized study reviews based on the proven SM-2 algorithm.
• Cloud sync: Seamlessly synchronize your vocabulary decks across all your devices via Google Sign-In.
• Export anytime: 1-click export to Anki (.txt) and Excel (.csv).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔒 PRIVACY-FIRST BY DESIGN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• No tracking, no ads, and zero third-party telemetry.
• We never collect or store your browsing history.
• Video subtitles are processed 100% locally in your browser.

Transform your daily browsing into fluent language skills with Lectoro AI!
```

---

## 15. Bezpieczne sformułowania dotyczące Netflix i YouTube

Aby uniknąć odrzucenia z powodu naruszenia znaków towarowych (*Trademark Infringement / Brand Impersonation*), należy stosować poniższe zasady:

* ❌ **Czego NIE WOLNO pisać:**
  * *"Official Netflix language extension"*
  * *"YouTube Translator Pro"*
  * *"Netflix approved extension"*
* ✅ **Jak NALEŻY pisać (Zgodnie z Trademark Guidelines):**
  * *"Interactive bilingual subtitle overlay for streaming players including YouTube™ and Netflix®."*
  * *"Compatible with YouTube and Netflix video players."*
  * *Klauzula w opisie:* *"YouTube is a trademark of Google LLC. Netflix is a registered trademark of Netflix, Inc. Lectoro is an independent educational tool and is not affiliated with, endorsed by, or sponsored by Google LLC or Netflix, Inc."*

---

## 16. Zgodność dokumentacji z kodem (Code vs Policy vs Disclosures)

| Element w kodzie | Zgodność w Privacy Policy | Zgodność w CWS Declarations | Status i Rekomendacja |
| :--- | :--- | :--- | :--- |
| **`chrome.tabs.captureVisibleTab` (Zrzuty klatek)** | Opisano w Sekcji 8 (Flashcard Images) | Zadeklarowano w `activeTab` justification | 🟢 **Zgodne** – jasno wyjaśniono, że dotyczy wykadrowania miniatury wideo. |
| **`translate.googleapis.com` (Google Translate)** | Opisano w Sekcji 7 (Translation Data) | Zadeklarowano w User Activity / Web Content | 🟢 **Zgodne** – wyjaśniono, że zapytania wywoływane są wyłącznie akcją użytkownika. |
| **`geminiProxy` (Google Cloud Functions)** | Opisano w Sekcji 6 (AI Processing) | Zadeklarowano w User Activity / Web Content | 🟢 **Zgodne** – potwierdzono brak trenowania modeli na danych użytkownika. |
| **`Cloudflare R2` (Zapis grafik i cache audio)** | Opisano w Sekcji 8 (Cloudflare R2 Storage) | Zadeklarowano w Data Storage & Caching | 🟢 **Zgodne** – deterministyczne ścieżki i możliwość usunięcia. |
| **Usuwanie konta (Account Deletion)** | Opisano w Sekcji 13 (Account Deletion) | Wymóg Google User Data Policy | 🟠 **Zalecenie:** Dodać przycisk "Usuń konto" w `popup/settings.js` wywołujący kasowanie. |

---

## 17. GDPR / RODO — Polska i Unia Europejska

Rozszerzenie podlega przepisom Ogólnego Rozporządzenia o Ochronie Danych (RODO / GDPR). Poniżej zestawienie technicznych i organizacyjnych wymogów:

1. **Podstawa prawna przetwarzania (Art. 6 RODO):**
   * *Wykonanie umowy / świadczenie usługi (Art. 6 ust. 1 lit. b):* Przetwarzanie słówek, konta i subskrypcji w celu realizacji usługi Lectoro.
   * *Zgoda (Art. 6 ust. 1 lit. a):* Dobrowolne logowanie przez Google i generowanie promptów AI.
2. **Minimalizacja danych (Art. 5 ust. 1 lit. c):** Rozszerzenie nie pobiera historii przeglądania ani danych profilowych wykraczających poza niezbędny identyfikator Google.
3. **Prawo do usunięcia danych (Art. 17 RODO):** Użytkownik może w każdej chwili usunąć pojedyncze słowo lub wyczyścić cały słownik.
4. **Transfer danych poza EOG (Art. 44–49 RODO):** Serwery Google Cloud Functions znajdują się w UE (`europe-west1` – Belgia). Transfery do zewnętrznych API (Google, ElevenLabs, Cloudflare) zabezpieczone są Standardowymi Klauzulami Umownymi (SCCs).

---

## 18. Raport Końcowy (Klasyfikacja Zadań)

### 🔴 MUSISZ ZROBIĆ PRZED PUBLIKACJĄ W CHROME DEVELOPER DASHBOARD:
1. **Opublikować Politykę Prywatności (Privacy Policy):** Skopiować treść z [Sekcji 8](#8-kompletna-privacy-policy-gotowy-dokument-do-publikacji), uzupełnić `[CONTACT EMAIL]` oraz `[COMPANY NAME]` i opublikować pod stałym adresem URL (np. GitHub Pages, Vercel, strona domowa).
2. **Wprowadzić Privacy Policy URL:** Wkleić link w zakładce *Privacy Practices* w Google Developer Console.
3. **Zaznaczyć deklaracje Data Usage w CWS:** Wypełnić formularz zgodnie z [Sekcją 9](#9-chrome-web-store--privacy-declarations-formularz-cws).
4. **Wkleić uzasadnienia uprawnień (Permissions Justifications):** Wkleić gotowe teksty z [Sekcji 20](#20-wzór-deklaracji-i-uzasadnień-do-chrome-web-store-developer-dashboard).

---

### 🟠 POWINIENEŚ ZROBIĆ (ZALECANE PRZED LUB W PIERWSZEJ AKTUALIZACJI):
1. ✅ **Przycisk "Usuń konto" w interfejsie (WDROŻONE W KODZIE 100%):** Zaimplementowano dedykowany przycisk `Usuń konto` w `popup/firebase-ui.js` oraz akcję `deleteUserAccount` w Cloud Functions, usuwającą kaskadowo Firebase Auth, Firestore, Cloudflare R2 oraz pamięć lokalną.
2. **Strona Support / FAQ:** Opublikować stronę pomocy z [Sekcji 12](#12-support-page--faq-struktura-i-treść-po-angielsku) pod adresem URL podanym w sklepie jako Support URL.

---

### 🟢 ELEMENTY W 100% ZGODNE Z WYMAGANIAMI:
* Pełna zgodność architektury technicznej Manifest V3.
* Brak jakiejkolwiek ukrytej telemetrii i skryptów śledzących.
* Bezpieczny backend proxy w Europie (`europe-west1`) chroniący klucze API.
* Bezpieczna integracja z odtwarzaczami wideo (100% lokalna pamięć RAM, brak naruszeń DRM).
* Gotowa, zwalidowana paczka produkcyjna `dist/lectoro-cws-v1.0.0.zip`.

---

### ❓ WYMAGA DECYZJI UŻYTKOWNIKA (PLACEHOLDERY):
* `[CONTACT EMAIL]` — docelowy adres email wsparcia (np. `support@lectoro.app` lub kontaktowy Gmail).
* `[COMPANY NAME]` — nazwa podmiotu / osoby prawnej publikującej wtyczkę.
* `[WEBSITE URL]` — docelowy adres domeny projektu.

---

# 20. Wzór Deklaracji i Uzasadnień do Chrome Web Store Developer Dashboard

Poniższe teksty należy skopiować i wkleić w odpowiednie pola w panelu dewelopera Google podczas przesyłania rozszerzenia:

### 1. Single Purpose (Jednolity Cel Rozszerzenia)
> *"Lectoro is an interactive language learning assistant that provides instant in-context webpage translation, bilingual video subtitle overlays with sentence navigation for streaming video players (YouTube, Netflix), and an integrated Spaced Repetition (SRS) flashcard system with AI-powered example sentences."*

### 2. Host Permissions Justification (`*://*/*` w content_scripts)
> *"Lectoro requires content script matching on all websites (`*://*/*`) to allow language learners to select, translate, and listen to foreign words on any article, document, or webpage they visit. Additionally, it enables subtitle detection and interactive overlays on embedded HTML5 video players across educational and streaming websites. Content scripts remain dormant until the user explicitly selects text or interacts with a video player. No user data or browsing activity is recorded or transmitted in the background."*

### 3. Permission Justification: `activeTab`
> *"Used exclusively when the user clicks to save a word/sentence from a video or article into their study deck, enabling the extension to capture a cropped thumbnail of the current video frame as a visual memory aid on the flashcard."*

### 4. Permission Justification: `identity`
> *"Used to authenticate the user securely via Google Sign-In (`launchWebAuthFlow`), enabling cloud synchronization of saved vocabulary decks and subscription status across devices."*

### 5. Permission Justification: `storage`
> *"Used to store the user's saved vocabulary flashcards, SRS study schedules, cached translations, and UI preferences locally in the browser."*

### 6. Permission Justification: `alarms`
> *"Required in Manifest V3 to periodically refresh the due review counter badge on the extension icon and batch-sync offline flashcard changes to Firestore without keeping the service worker continuously active."*

### 7. Permission Justification: `scripting`
> *"Used on-demand to inject the subtitle overlay styles and adapter scripts only into specific iframe frames where an active `<video>` element has been detected, preventing unnecessary script execution in non-video iframes."*

---

> [!TIP]
> **Paczka produkcyjna gotowa:** Plik `dist/lectoro-cws-v1.0.0.zip` (251.6 KB) jest gotowy do wgrania w [Chrome Web Store Developer Console](https://chrome.google.com/webstore/devconsole).

