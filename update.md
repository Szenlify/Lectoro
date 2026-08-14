# Audyt ujednolicenia, wydajności i kosztów Lectoro

Data analizy: 14 sierpnia 2026 r.

## 1. Wniosek w skrócie

Projekt jest funkcjonalnie sensownie podzielony na rozszerzenie Chrome, wspólne moduły, synchronizację Firebase i backend Cloud Functions. Na plus wyróżniają się: centralna konfiguracja planów, serwerowa kontrola limitów AI/TTS, atomowe rezerwowanie limitów, cache audio oraz działające testy backendu.

Przed udostępnieniem wtyczki tysiącom użytkowników zalecam jednak refaktoryzację. Najważniejsze problemy to:

1. `content.js` uruchamia `MutationObserver` na całym `document.body` oraz skan napisów co 500 ms na **każdej stronie**, nawet bez filmu. To największe ryzyko zużycia CPU po stronie użytkowników.
2. Wszystkie fiszki są trzymane w jednej tablicy `savedWords`. Zmiana jednej fiszki przepisuje całą tablicę, a background porównuje wiele obiektów przez `JSON.stringify`. Przy 2 000–8 000 kartach, szczególnie ze screenshotami base64, będzie to coraz wolniejsze i bardziej awaryjne.
3. Popup zawsze ładuje 18 skryptów i ok. 368 KB surowych zasobów, również ciężki generator quizu, niezależnie od otwartej zakładki.
4. Kod profilu, planów i limitów jest częściowo zdublowany w `shared/gemini-proxy.js` oraz `shared/subscription-service.js`.
5. `popup.css` ma 4 011 linii i 524 reguły, a `styles.css` używa 75 deklaracji `!important`. To wskazuje na narastającą specyficzność, nadpisywanie stylów i wysoki koszt dalszych zmian UI.
6. Limit SRS jest egzekwowany wyłącznie w kliencie. Użytkownik może ominąć rozszerzenie i zapisać dowolną liczbę dokumentów w `users/{uid}/...`, generując koszt Firestore.
7. Jedno „użycie AI” może oznaczać krótkie tłumaczenie albo quiz z limitem 8 000 tokenów wyjścia. Model kredytów nie odzwierciedla więc rzeczywistego kosztu.

Najlepszy cel refaktoryzacji bez zmiany funkcjonalności to:

- zmniejszenie kodu źródłowego frontendu o około 20–30%;
- zmniejszenie zasobów parsowanych na każdej stronie o około 55–75%;
- usunięcie stałego skanu co 500 ms na stronach bez wideo;
- przejście z jednej dużej tablicy fiszek na rekordy aktualizowane pojedynczo;
- zachowanie obecnego interfejsu, skrótów, planów, limitów i formatu danych użytkownika poprzez migrację wstecznie zgodną.

Finansowo projekt może być rentowny przy aktualnych cenach. W scenariuszu bazowym 90% FREE / 8% BASIC / 2% PRO szacowana miesięczna marża operacyjna przed VAT, podatkiem dochodowym, zwrotami i kosztem pracy wynosi około:

- **1 000 użytkowników:** 878–883 USD, czyli około 3.336 – 3.355 PLN;
- **10 000 użytkowników:** 8 798–8 823 USD, czyli około 33.433 – 33.528 PLN.

Przy wykorzystaniu 100% limitów przez wszystkich użytkowników tego samego miksu marża spada odpowiednio do około 690–695 USD oraz 6 902–6 942 USD. Największym kosztem zmiennym jest ElevenLabs, nie Gemini ani Firebase.

## 2. Zakres i metoda analizy

Analiza objęła:

- kod rozszerzenia Manifest V3;
- popup, content script i service worker;
- Firebase Auth i Firestore REST;
- Cloud Functions 2nd gen;
- Gemini 2.5 Flash-Lite;
- ElevenLabs Flash v2.5;
- Stripe Checkout, Portal i webhooki;
- limity planów FREE, BASIC i PRO;
- testy jednostkowe backendu;
- bieżące oficjalne cenniki usług.

Nie zmieniałem kodu aplikacji ani jej funkcjonalności. Jedynym utworzonym dokumentem jest niniejszy raport.

## 3. Inwentaryzacja projektu

### 3.1. Rozmiar

| Obszar | Wynik |
| --- | ---: |
| Wszystkie analizowane linie JS/TS/CSS/HTML/JSON, bez `node_modules` i lockfile | 17 423 |
| Kod produkcyjny, bez testów | 16 985 linii |
| JavaScript/TypeScript produkcyjny | 10 933 linie |
| CSS | 5 279 linii |
| HTML | 481 linii |
| Testy | 438 linii |
| Surowy zestaw ładowany jako content script | ok. 242,7 KB, 10 plików |
| Surowy popup wraz z HTML/CSS/skryptami | ok. 367,9 KB, 20 plików |

Największe pliki:

| Plik | Linie | Rozmiar |
| --- | ---: | ---: |
| `popup.css` | 4 011 | 89,6 KB |
| `content.js` | 2 292 | 85,9 KB |
| `shared/quiz-export.js` | 1 332 | 70,0 KB |
| `styles.css` | 1 268 | 35,2 KB |
| `core.js` | 1 146 | 50,6 KB |
| `popup/review.js` | 909 | 37,2 KB |
| `functions/index.js` | 471 | 19,9 KB |
| `background.js` | 465 | 16,0 KB |

`icon48.png` ma 500×500 px i 105,2 KB, mimo że manifest wykorzystuje go jako ikonę 48×48. To prosty kandydat do redukcji rozmiaru paczki. `functions/node_modules` zajmuje lokalnie ok. 71 MB; jest ignorowany przez Git i Firebase, ale brak dedykowanego procesu budowania paczki rozszerzenia zwiększa ryzyko przypadkowego dodania go do ZIP-a publikacyjnego.

### 3.2. Obecna architektura

Przepływ jest następujący:

1. Content script działa na `<all_urls>` i ładuje konfigurację subskrypcji, narzędzia, prompty, Firebase, dwa klienty subskrypcji/AI, `core.js` i `content.js`.
2. Dane nauki są zapisywane lokalnie w `chrome.storage.local.savedWords` jako jedna tablica.
3. Service worker obserwuje zmianę tablicy, wylicza różnice i po minucie wysyła batch do Firestore.
4. Pełna synchronizacja pobiera wszystkie dokumenty słów użytkownika i scala je metodą last-write-wins.
5. Żądania AI i ElevenLabs przechodzą przez `geminiProxy`, który weryfikuje Firebase ID token, plan z Custom Claims i limit w transakcji Firestore.
6. Stripe webhook synchronizuje plan do Custom Claims oraz dokumentu użytkownika.

Architektura jest wystarczająca dla pierwszej wersji, ale ma dwa wąskie gardła przy skali: monolityczny lokalny zapis fiszek i ciągła praca content scriptu na wszystkich stronach.

## 4. Co jest zrobione dobrze i powinno zostać zachowane

- Jedno źródło prawdy dla planów w `functions/subscription-config.js`.
- Plan autoryzacyjny pochodzi z podpisanego Firebase Custom Claim, a nie z edytowalnego cache klienta.
- Firestore rules blokują klientowi modyfikację pól planu, Stripe i liczników AI/TTS.
- AI i ElevenLabs rezerwują limit w transakcji przed wywołaniem płatnego dostawcy.
- Nieudane wywołanie dostawcy powoduje próbę cofnięcia rezerwacji.
- Żądania równoległe klienta mają lokalną rezerwację optymistyczną, a serwer nadal pozostaje źródłem prawdy.
- Zmiany lokalne są kolejkowane i batchowane zamiast wysyłania pełnego zbioru przy każdej zmianie.
- Audio ElevenLabs jest cache’owane w IndexedDB, więc ponowne odtworzenie tego samego tekstu i głosu nie kosztuje kolejnego wywołania.
- Webhook Stripe odczytuje aktualny stan subskrypcji zamiast bezwarunkowo ufać pojedynczemu zdarzeniu.
- Sekrety Gemini, ElevenLabs i Stripe są przechowywane w Firebase Secrets, nie w rozszerzeniu.
- Istnieje 17 testów backendowych i wszystkie przeszły: 17/17.

Te elementy trzeba objąć testami regresji przed refaktoryzacją, a nie usuwać.

## 5. Problemy i rekomendacje techniczne

### P0 — przed skalowaniem

#### 5.1. Stałe skanowanie DOM-u na każdej stronie

`content.js:1001–1007` obserwuje całe `document.body` z `subtree: true` i `characterData: true`, a dodatkowo co 500 ms uruchamia `makeSubtitlesInteractive()`. Ponieważ manifest ma `matches: ["<all_urls>"]`, mechanizm działa także w poczcie, dokumentach, panelach administracyjnych i zwykłych stronach bez wideo.

Skutek:

- niepotrzebne wybudzanie CPU dwa razy na sekundę na każdej otwartej karcie;
- ponowne przeszukiwanie DOM-u na dynamicznych stronach;
- gorsza bateria laptopa i większa szansa, że użytkownicy uznają rozszerzenie za ciężkie;
- rosnący koszt debugowania konfliktów ze stronami.

Rekomendacja zachowująca funkcjonalność:

1. Zostawić mały bootstrap do zaznaczania tekstu na wszystkich stronach.
2. Moduł wideo/napisów ładować dopiero po wykryciu `<video>`, aktywnej ścieżki napisów lub znanego hosta.
3. Usunąć `setInterval(..., 500)` i zastosować jeden debounced `MutationObserver`, obserwujący możliwie mały kontener napisów.
4. Odłączać observer po usunięciu playera i ponownie podpinać tylko po zmianie SPA/navigation.
5. Mierzyć liczbę wywołań observera i czas `makeSubtitlesInteractive()` w testach wydajnościowych.

To będzie miało znacznie większy efekt niż samo minifikowanie kodu.

#### 5.2. Jedna wielka tablica `savedWords`

`core.js`, `popup/review.js`, `popup/words.js`, `popup/export.js` i `background.js` wielokrotnie odczytują oraz zapisują całe `savedWords`. Service worker buduje mapy całych tablic i używa `JSON.stringify` do porównań. Screenshot w formie base64 również znajduje się w obiekcie fiszki.

Przy limicie PRO równym 8 000 kart zmiana oceny jednej fiszki może oznaczać:

- odczyt tysięcy rekordów;
- utworzenie nowej dużej tablicy;
- serializację obiektów do JSON;
- przepisanie wszystkich screenshotów;
- ponowne wyliczenie różnic w service workerze.

Rekomendacja:

- wprowadzić `WordRepository` jako jedyny interfejs zapisu/odczytu;
- trzymać fiszki jako osobne rekordy w IndexedDB albo pod osobnymi kluczami, a w `chrome.storage.local` pozostawić ustawienia i mały indeks;
- screenshoty przenieść do osobnego blob store i przechowywać w fiszce tylko klucz;
- aktualizować pojedynczy rekord przy ocenie SRS;
- dodać indeks `nextReview`, aby kolejka powtórek nie filtrowała zawsze całego zbioru;
- zapewnić jednorazową, idempotentną migrację starego `savedWords` oraz możliwość rollbacku w jednej wersji przejściowej.

To zmniejszy złożoność typowej aktualizacji z O(n) względem liczby kart do operacji bliskiej O(1).

#### 5.3. Limit SRS można ominąć

`SubscriptionService.checkSrsSave()` działa w kliencie. Reguły Firestore pozwalają zalogowanemu użytkownikowi tworzyć dowolne dokumenty we własnej podkolekcji. Reguły nie egzekwują 100/2 000/8 000 kart.

Uczciwy użytkownik zobaczy limit, ale zmodyfikowany klient może zapisywać bez ograniczeń i generować koszty dokumentów, indeksów oraz transferu.

Rekomendacja:

- zapisy synchronizacji kierować przez funkcję serwerową;
- utrzymywać serwerowy licznik kart w transakcji;
- batch odrzucać, jeżeli wynik przekroczy limit planu;
- ograniczyć rozmiar pojedynczego pola tekstowego i całego requestu;
- rozważyć App Check/custom attestation oraz limit żądań na UID/IP;
- po migracji zablokować bezpośredni zapis klienta do `users/{uid}/words`.

#### 5.4. Brak kontroli ekonomicznej rodzaju żądania AI

Backend przyjmuje dowolny `prompt` do 50 000 znaków i `maxOutputTokens` do 8 192. Każde wywołanie odejmuje dokładnie jeden kredyt, mimo że krótki przykład zdania i pełny quiz mają bardzo różny koszt.

Rekomendacja:

- klient powinien wysyłać `action` i dane wejściowe, a prompt budować na serwerze;
- dla każdej akcji ustalić osobny limit wejścia/wyjścia;
- quiz może kosztować np. 5–10 kredytów albo mieć osobny limit miesięczny;
- logować faktyczne `usageMetadata` Gemini i wyliczać koszt per akcja;
- dodać limit chwilowy, np. na minutę i godzinę, oprócz limitu miesięcznego;
- odrzucać nieznane akcje i nadmierną równoległość.

Nie chodzi tylko o koszt Gemini. Serwerowy katalog akcji uprości prompty, walidację JSON, monitoring jakości i późniejszą zmianę modelu.

### P1 — wysoki zwrot z refaktoryzacji

#### 5.5. Dwa częściowo pokrywające się klienty: Gemini i subskrypcje

`shared/gemini-proxy.js` i `shared/subscription-service.js` duplikują m.in.:

- `currentMonth`;
- pobieranie tokenu;
- otwieranie planów;
- rozpoznawanie błędu limitu;
- renderowanie komunikatu upgrade;
- cache profilu i cache użycia AI, które muszą być ręcznie uzgadniane.

Rekomendacja:

- jeden `ApiClient` do tokenu, fetch, błędów, retry i timeoutów;
- jeden `SubscriptionStore` z pojedynczym obiektem profilu i użycia;
- `AiService` oraz `TtsService` jako cienkie moduły domenowe;
- jeden komponent `UpgradePrompt`;
- jeden URL backendu w konfiguracji środowiska.

Realny zysk: około 120–220 linii mniej oraz mniej błędów wynikających z rozjechania dwóch cache’y.

#### 5.6. Monolityczne moduły UI i globalny zakres

`content.js`, `core.js`, `popup/review.js` i `shared/quiz-export.js` łączą stan, DOM, sieć, storage oraz logikę domenową. Popup polega na kolejności 18 znaczników `<script>` i globalnych nazwach funkcji.

Rekomendowany podział:

- `features/selection-translate`;
- `features/video-subtitles`;
- `features/review`;
- `features/quiz`;
- `services/api`, `services/storage`, `services/sync`;
- `ui/components`;
- `domain/word`, `domain/srs`, `domain/subscription`.

Wprowadzić ES modules i prosty build, np. esbuild lub Vite library mode. Nie trzeba przechodzić na framework UI; niewielki bundler wystarczy do tree-shakingu, minifikacji, importów i sourcemap.

#### 5.7. Popup ładuje wszystko od razu

Popup ma ok. 368 KB surowych zasobów i zawsze ładuje generator quizu (70 KB), kod powtórek, bibliotekę, eksport i ustawienia. Większość sesji wykorzysta tylko jedną zakładkę.

Rekomendacja:

- entrypoint zawierający przełączanie zakładek i minimalne ustawienia;
- dynamiczny import modułu po pierwszym wejściu w „Quiz”, „Powtórki” lub „Bibliotekę”;
- osobne CSS per funkcja albo build wycinający nieużywane reguły;
- ciężki runtime interaktywnego quizu przechowywać jako szablon/asset, a nie jako bardzo długi template string wymieszany z logiką popupu.

#### 5.8. CSS wymaga systemu komponentów i tokenów

Metryki:

- `popup.css`: 4 011 linii, 524 reguły, 16 animacji, 91 wystąpień kolorów hex;
- `styles.css`: 1 268 linii, 130 reguł, 75 `!important`, brak użycia CSS variables;
- w `popup.css` występują powtarzane selektory planów, kart, statusów i kontrolek.

Rekomendacja:

- wspólne tokeny koloru, odstępów, promieni, cieni, warstw `z-index` i animacji;
- komponenty `.button`, `.card`, `.badge`, `.meter`, `.menu`, `.toast` z wariantami;
- warstwy CSS (`@layer reset, tokens, components, features, overrides`);
- ograniczenie `!important` do wyjątków integracyjnych z cudzą stroną;
- wspólne animacje shimmer/spinner/fade;
- style inline z JS przenieść do klas.

Ostrożny cel: skrócenie CSS o 20–35%, czyli około 1 050–1 850 linii, bez zmiany wyglądu.

#### 5.9. Brak kontrolowanego procesu pakowania rozszerzenia

Nie ma głównego `package.json`, skryptu `build`, manifestu generowanego per środowisko ani listy plików publikacyjnych. Backend i rozszerzenie współdzielą katalog `functions`, a lokalne `node_modules` ma ok. 71 MB.

Rekomendacja:

- `npm run build:extension` tworzący czysty `dist/extension`;
- kopiowanie wyłącznie zasobów osiągalnych z manifestu;
- osobny bundle backendu;
- walidacja manifestu i budżet rozmiaru w CI;
- ZIP tworzony wyłącznie z `dist/extension`;
- sourcemapy prywatne, poza paczką produkcyjną;
- zoptymalizowana ikona 48×48 oraz osobne rozmiary 16/32/48/128.

### P2 — jakość, niezawodność i dalsze obniżenie utrzymania

#### 5.10. Synchronizacja pełna skaluje się liniowo

`pullWords()` pobiera wszystkie fiszki stronami po 500. Ręczny pełny sync użytkownika PRO z 8 000 kart oznacza co najmniej 8 000 odczytów Firestore, nawet gdy zmieniła się jedna karta.

Rekomendacja:

- przechowywać `updatedAt` jako prawdziwy Firestore Timestamp;
- delta sync `where updatedAt > lastSync` z paginacją;
- tombstones lub dziennik usunięć z TTL;
- pełny sync pozostawić wyłącznie jako mechanizm naprawczy;
- nie wykonywać pełnego pull przy każdym logowaniu, jeśli urządzenie ma checkpoint.

#### 5.11. Niepełny round-trip danych fiszki

`toFirestoreFields()` nie zapisuje m.in. `sr_easeFactor`, mimo że `fromFirestoreFields()` próbuje go odczytać. Do chmury nie trafiają też część pól lokalnych, np. screenshot, URL i pola AI. Może to być celowe dla oszczędności, ale po reinstalacji lub zmianie urządzenia użytkownik nie odzyska identycznej fiszki.

Rekomendacja:

- jawny, wersjonowany schemat `WordV1/WordV2`;
- test round-trip: local → Firestore → local;
- udokumentowanie pól „local only”;
- dla screenshotów osobny, opcjonalny magazyn blobów zamiast dokumentu Firestore;
- migracje schematu wykonywane przez repository.

#### 5.12. Cache audio nie ma limitu

IndexedDB `AudioCache` nie ma TTL, LRU, limitu rozmiaru ani wersji klucza. Nie wpływa to bezpośrednio na rachunek serwera, lecz może stale zajmować przestrzeń urządzenia i zachowywać stare audio po zmianie modelu/ustawień.

Rekomendacja:

- metadane `createdAt`, `lastAccessedAt`, `size`, `model`, `voiceId`;
- limit np. 100–250 MB konfigurowalny;
- usuwanie najstarszych rekordów;
- przycisk czyszczenia cache;
- klucz będący hashem tekstu + głosu + modelu + ustawień głosu.

#### 5.13. Lista głosów i mnożniki ElevenLabs

Backend zwraca całą listę dostępnych głosów i przyjmuje poprawnie wyglądający `voiceId`. ElevenLabs informuje, że niektóre głosy współdzielone mogą mieć własny mnożnik kredytów. To może podnieść koszt ponad bazowe 0,05 USD/1 000 znaków.

Rekomendacja:

- serwerowa allowlista zatwierdzonych głosów bez mnożników;
- cache listy głosów po stronie funkcji na kilka godzin;
- monitoring kosztu per voice/model;
- feature flag pozwalająca natychmiast wyłączyć kosztowny głos.

#### 5.14. Nieoficjalny endpoint Google Translate

`core.js` korzysta z `translate.googleapis.com/translate_a/single?client=gtx`. Nie ma w projekcie umowy, klucza, limitu ani SLA dla tego przepływu. Koszt dla właściciela może obecnie wynosić zero, ale przy tysiącach użytkowników istnieje ryzyko throttlingu lub zmiany zachowania endpointu.

Rekomendacja:

- zamknąć tłumaczenie za interfejsem `TranslationProvider`;
- mierzyć błędy i latency;
- mieć kontrolowany fallback;
- przed komercyjnym skalowaniem zweryfikować zgodność użycia z warunkami dostawcy;
- nie rozrzucać adresu endpointu i parsowania odpowiedzi po kodzie.

#### 5.15. Brak timeoutów i wspólnej polityki retry klienta

Wywołania `fetch` w rozszerzeniu nie mają wspólnego `AbortController`, timeoutu, klasyfikacji błędów ani backoffu. W części przypadków błąd jest ukrywany przez fallback.

Rekomendacja:

- jeden wrapper `fetchJson/fetchBlob`;
- timeouty zależne od akcji;
- retry wyłącznie dla błędów przejściowych i tylko dla operacji idempotentnych;
- jednolite kody błędów;
- brak retry dla naliczanych żądań bez idempotency key.

#### 5.16. Obserwowalność i ochrona budżetu

Brakuje widocznego mechanizmu:

- kosztu Gemini per akcja;
- znaków i kosztu ElevenLabs per plan/głos;
- liczby odczytów pełnego sync;
- odsetka błędów providerów;
- p95/p99 czasu funkcji;
- alertów budżetowych.

Przed skalowaniem należy dodać dashboard oraz alerty przy 50%, 80% i 100% budżetu, a także kill switch dla TTS i quizu. Logi nie powinny zawierać pełnego promptu, tekstu fiszki ani tokenów.

## 6. Proponowana docelowa struktura

```text
src/
  extension/
    content-bootstrap/
    features/
      selection-translate/
      video-subtitles/
      review/
      quiz/
    popup/
    background/
  domain/
    subscription/
    srs/
    word/
  services/
    api-client/
    auth/
    storage/
    sync/
    translation/
    tts/
  ui/
    components/
    tokens.css
functions/
  src/
    http/
    ai/
    tts/
    billing/
    subscription/
    shared/
tests/
  unit/
  integration/
  e2e/
dist/
  extension/
```

Nie jest wymagane przepisanie wszystkiego naraz. Najbezpieczniejszy jest wzorzec „strangler”: najpierw testy zachowania i interfejsy, potem przenoszenie funkcji moduł po module.

## 7. Plan refaktoryzacji bez zmiany funkcjonalności

### Etap 0 — pomiar i zabezpieczenie zachowania

1. Dodać ESLint/Prettier, test coverage i CI.
2. Dodać testy charakterystyki obecnego zachowania.
3. Zmierzyć czas startu popupu, parse/execute content scriptu, pracę observera, rozmiar `savedWords`, liczbę operacji Firestore i koszt providerów.
4. Ustalić budżety, np. content bootstrap < 80 KB raw, popup initial < 150 KB raw, brak timera 500 ms w idle.

### Etap 1 — największy efekt wydajnościowy

1. Wyłączyć stały polling napisów.
2. Leniwie ładować moduł wideo.
3. Zoptymalizować ikonę i dodać kontrolowany build ZIP.
4. Leniwie ładować quiz i zakładkę review.

### Etap 2 — dane i synchronizacja

1. Wprowadzić `WordRepository` nad obecnym `savedWords` bez zmiany UI.
2. Dodać migrację do rekordów IndexedDB.
3. Oddzielić screenshoty.
4. Wprowadzić delta sync i wersjonowany model danych.
5. Przenieść egzekwowanie limitu SRS na serwer.

### Etap 3 — ujednolicenie usług

1. Połączyć cache profilu i AI usage.
2. Wspólny `ApiClient`, błędy, timeouty i telemetria.
3. Akcje AI budowane na serwerze.
4. Allowlista głosów i rate limiting.
5. Rozdzielić `functions/index.js` na moduły domenowe, zachowując te same publiczne endpointy.

### Etap 4 — UI i CSS

1. Tokeny i komponenty CSS.
2. Konsolidacja toastów, przycisków, kart, statusów i shimmerów.
3. Usunięcie zbędnych `!important`.
4. Rozbicie dużych rendererów quizu i review na mniejsze czyste funkcje.
5. Snapshoty/wizualne testy regresji popupu i tooltipów.

### Etap 5 — optymalizacja kosztów na danych produkcyjnych

1. Koszt per akcja i plan.
2. Dostosowanie kredytów AI do ciężaru akcji.
3. Dostosowanie limitów ElevenLabs do realnej retencji i ARPU.
4. Negocjacja ceny ElevenLabs albo alternatywny provider po przekroczeniu ustalonego wolumenu.
5. Pełny sync tylko jako naprawa, normalnie delta sync.

## 8. Testy wymagane przed i po refaktoryzacji

Obecne testy: **17/17 przeszło**. Pokrywają głównie konfigurację planów, limit ElevenLabs, mapowanie Stripe, stronę wyniku Stripe i narzędzie usuwania planu.

Brakuje testów frontendu oraz pełnych przepływów. Minimalny zestaw przed dużą refaktoryzacją:

- zapis zwykłej fiszki, zdania, fiszki AI i screenshotu;
- duplikaty i limity SRS dla każdego planu;
- round-trip wszystkich pól przez Firestore;
- konflikt dwóch urządzeń i usunięcie offline;
- SRS po synchronizacji, w tym `easeFactor`;
- kolejka powtórek i wszystkie skróty klawiszowe;
- tryby napisów, word cloud, tooltip, AI explain i przywrócenie oryginału;
- cache oraz anulowanie TTS podczas zmiany karty;
- równoległe żądania AI/TTS i rollback limitu;
- webhooki Stripe w innej kolejności i wielokrotnie;
- timeouty i błędy 401/403/413/429/5xx;
- test wydajności dla 100, 2 000 i 8 000 kart;
- test, że strona bez wideo nie wykonuje cyklicznego skanu;
- test paczki produkcyjnej: brak sekretów, dokumentacji backendu i `node_modules`.

## 9. Model kosztów

### 9.1. Aktualne ceny użyte w obliczeniach

Stan na 14.08.2026, ceny netto dostawców:

| Usługa | Założenie cenowe |
| --- | --- |
| Gemini 2.5 Flash-Lite | 0,10 USD / 1 mln tokenów wejścia i 0,40 USD / 1 mln tokenów wyjścia |
| ElevenLabs Flash/Turbo | 0,05 USD / 1 000 znaków |
| Stripe Polska | 1,5% + 1,00 PLN dla standardowej karty EOG; przy wymaganym przewalutowaniu dodatkowo 2% |
| Firestore | 50 000 odczytów i 20 000 zapisów dziennie bez opłat, 1 GiB danych i 10 GiB transferu bez opłat; później pay-as-you-go |
| Cloud Run / Functions 2nd gen | bezpłatnie do 2 mln żądań, 180 tys. vCPU-s i 360 tys. GiB-s pamięci miesięcznie, później pay-as-you-go |
| Firebase Authentication | dla zwykłych metod logowania brak kosztu w analizowanej skali; Identity Platform ma 50 tys. MAU bez opłat na Blaze |

Źródła:

- [Gemini Developer API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [ElevenLabs API pricing](https://elevenlabs.io/pricing/api?price.platform=api)
- [ElevenLabs — sposób naliczania kredytów](https://help.elevenlabs.io/hc/en-us/articles/27562020846481-What-are-credits)
- [Stripe Polska — cennik](https://stripe.com/en-pl/pricing)
- [Firestore — pricing i free quota](https://firebase.google.com/docs/firestore/pricing)
- [Cloud Run pricing](https://cloud.google.com/run/pricing)
- [Firebase Authentication](https://firebase.google.com/docs/auth)

Do przeliczeń przyjmuję techniczny kurs **1 USD = 3,80 PLN**. Rzeczywisty wynik zmieni się wraz z kursem, sposobem rozliczenia Stripe i walutą kont dostawców.

### 9.2. Ważne zastrzeżenia

„1 000 użytkowników” nie oznacza „1 000 płacących”. Przychód zależy od konwersji na BASIC/PRO. Dlatego główny scenariusz przyjmuje jawny miks:

- 90% FREE;
- 8% BASIC;
- 2% PRO;
- wszyscy są aktywni w danym miesiącu.

Scenariusz średniego użycia:

| Plan | AI / miesiąc | ElevenLabs / miesiąc | Średnia liczba zapisanych kart | Zmiany kart / miesiąc |
| --- | ---: | ---: | ---: | ---: |
| FREE | 5 | 0 | 75 | 10 |
| BASIC | 40 | 10 000 znaków | 500 | 50 |
| PRO | 200 | 50 000 znaków | 1 500 | 100 |

Scenariusz maksymalny oznacza wykorzystanie 100% obecnych limitów: 10/100/1 000 AI oraz 0/30 000/150 000 znaków TTS.

Dla Gemini przyjmuję średnio 1 000 tokenów wejścia i 500 wyjścia na użycie, czyli około **0,00030 USD za użycie**. Quiz może być wielokrotnie droższy, dlatego jest to średnia, a nie gwarancja.

Dla Stripe używam konserwatywnie 3,5% + 1 PLN, ponieważ ceny w konfiguracji są w USD i może wystąpić 2% koszt przewalutowania. Jeśli płatność i settlement są w tej samej walucie, koszt będzie niższy o około 2% obrotu.

Koszt Firebase/Cloud Run podaję jako zakres. Bez produkcyjnych metryk czasu funkcji, liczby otwarć popupu, liczby pełnych synchronizacji i rozmiaru audio nie da się uczciwie podać jednej dokładnej wartości.

### 9.3. Koszt jednostkowy obecnych planów przy pełnym limicie

| Plan | Przychód | Stripe, konserwatywnie | ElevenLabs max | Gemini max | Backend/transfer, rezerwa | Marża operacyjna na konto |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| BASIC | 7,99 USD | 0,54 USD | 1,50 USD | 0,03 USD | 0,05–0,20 USD | **5,72–5,87 USD** |
| PRO | 19,99 USD | 0,96 USD | 7,50 USD | 0,30 USD | 0,15–0,60 USD | **10,63–11,08 USD** |

Wniosek: obecne limity są rentowne przy bazowej cenie ElevenLabs 0,05 USD/1 000 znaków. Plan PRO ma jednak dużo większą ekspozycję na wzrost ceny TTS, mnożniki głosów i nadużycia.

### 9.4. Scenariusz bazowy: 90% FREE / 8% BASIC / 2% PRO

#### Liczba kont

| Łącznie | FREE | BASIC | PRO | Płacący |
| ---: | ---: | ---: | ---: | ---: |
| 1 000 | 900 | 80 | 20 | 100 |
| 10 000 | 9 000 | 800 | 200 | 1 000 |

#### Średnie użycie

| Pozycja miesięczna | 1 000 użytkowników | 10 000 użytkowników |
| --- | ---: | ---: |
| Przychód brutto subskrypcyjny | 1 039 USD / 3 948 PLN | 10 390 USD / 39 482 PLN |
| Stripe, wariant konserwatywny | ok. 62,68 USD | ok. 626,81 USD |
| ElevenLabs | ok. 90 USD | ok. 900 USD |
| Gemini | ok. 3,51 USD | ok. 35,10 USD |
| Firebase/Cloud Run/transfer | ok. 0–5 USD | ok. 5–30 USD |
| **Marża operacyjna przed podatkami i pracą** | **878–883 USD** | **8 798–8 823 USD** |
| **To samo przy 3,80 PLN/USD** | **3 336–3 355 PLN** | **33 433–33 528 PLN** |
| Marża procentowa | ok. 84,5–85,0% | ok. 84,7–84,9% |

#### Wykorzystanie 100% limitów przez wszystkich

| Pozycja miesięczna | 1 000 użytkowników | 10 000 użytkowników |
| --- | ---: | ---: |
| Przychód brutto | 1 039 USD | 10 390 USD |
| Stripe | ok. 62,68 USD | ok. 626,81 USD |
| ElevenLabs | ok. 270 USD | ok. 2 700 USD |
| Gemini | ok. 11,10 USD | ok. 111 USD |
| Firebase/Cloud Run/transfer | ok. 0–5 USD | ok. 10–50 USD |
| **Marża operacyjna przed podatkami i pracą** | **690–695 USD** | **6 902–6 942 USD** |
| **To samo przy 3,80 PLN/USD** | **2 623–2 642 PLN** | **26 228–26 380 PLN** |
| Marża procentowa | ok. 66,4–66,9% | ok. 66,4–66,8% |

### 9.5. Wariant: wszyscy użytkownicy są na FREE

Jeśli „1 000/10 000 użytkowników” oznacza instalacje bez płatnej konwersji:

| Użytkownicy FREE | Przychód | Szacowany koszt przy typowym użyciu | Szacowany koszt przy pełnym limicie AI |
| ---: | ---: | ---: | ---: |
| 1 000 | 0 | ok. 2–5 USD/mies. | ok. 3–8 USD/mies. |
| 10 000 | 0 | ok. 20–50 USD/mies. | ok. 35–80 USD/mies. |

To nadal jest względnie tanie dzięki Gemini Flash-Lite oraz darmowym progom Firebase/Cloud Run. Koszt może być wyższy, jeśli użytkownicy często wykonują pełny sync tysięcy kart, funkcje długo czekają na providerów albo transfer audio przekroczy założenia. FREE nie ma ElevenLabs, więc najdroższy komponent jest wyłączony.

### 9.6. Prosty wzór do późniejszego przeliczania

Niech:

- `B` = liczba użytkowników BASIC;
- `P` = liczba użytkowników PRO;
- `Cb`, `Cp` = średnia liczba znaków ElevenLabs na konto;
- `Ab`, `Ap` = średnia liczba wywołań Gemini;
- `Fstripe(price)` = opłata Stripe dla danej ceny.

Wtedy w przybliżeniu:

```text
MRR = B × 7,99 + P × 19,99

ElevenLabs = (B × Cb + P × Cp) / 1000 × 0,05 USD

Gemini = (B × Ab + P × Ap + użycia FREE) × 0,00030 USD

Marża operacyjna = MRR - Stripe - ElevenLabs - Gemini - Firebase/Cloud Run - pozostałe koszty
```

Najważniejszą zmienną do monitorowania jest liczba znaków TTS na płacącego użytkownika.

## 10. Czego kalkulacja nie obejmuje

Podane „zarobki” są marżą operacyjną infrastrukturalną, a nie zyskiem księgowym. Nie uwzględniają:

- VAT i zasad OSS dla klientów z różnych państw;
- podatku dochodowego i składek;
- kosztu księgowości, regulaminu, polityki prywatności i obsługi prawnej;
- Stripe Tax lub innego systemu rozliczania podatku;
- refundów, chargebacków i fraudu;
- obsługi klienta i czasu programistycznego;
- monitoringu klasy Sentry/Log Explorer po przekroczeniu darmowych progów;
- marketingu, prowizji afiliacyjnych i pozyskania użytkownika;
- rabatów, kuponów i bezpłatnych okresów próbnych;
- zmiany kursów USD/PLN;
- ewentualnych mnożników kosztu głosów ElevenLabs;
- kosztu oficjalnego API tłumaczeń, jeżeli zastąpi obecny endpoint.

Kod Checkout nie włącza obecnie `automatic_tax`. Przed sprzedażą konsumencką należy ustalić z księgowością, czy ceny 7,99/19,99 USD zawierają VAT, oraz włączyć prawidłowe naliczanie i raportowanie podatku. Jeżeli ceny mają zawierać 23% VAT, kwota pozostająca firmie przed innymi kosztami będzie wyraźnie niższa niż w powyższych tabelach.

## 11. Rekomendacje biznesowo-kosztowe

1. **Rozliczaj w PLN dla polskich klientów.** Obecnie UI podaje USD. Cena PLN może ograniczyć przewalutowanie i zwiększyć przewidywalność przychodu.
2. **Włącz pomiar kosztu per akcja przed marketingiem.** Bez niego nie wiadomo, czy 5% użytkowników generuje 80% TTS.
3. **Ustal twardy wewnętrzny koszt TTS na konto.** Przykład: alert przy 1 USD BASIC i 5 USD PRO, zanim użytkownik dobije do limitu produktowego.
4. **Oddziel kredyty quizu od krótkich akcji AI.** Jedna jednostka nie powinna wyceniać 200 i 8 000 tokenów tak samo.
5. **Wprowadź roczne plany dopiero po danych o retencji.** Zniżka roczna poprawia cash flow, ale zwiększa ryzyko, jeśli TTS podrożeje.
6. **Przy większej skali negocjuj ElevenLabs.** To jedyny dostawca, który może pochłonąć znaczącą część MRR.
7. **Dodaj globalny miesięczny budżet i kill switch.** Po przekroczeniu budżetu TTS powinien bezpiecznie przejść na głos systemowy, co obecny UX już częściowo wspiera.
8. **Nie obniżaj cen przed poznaniem konwersji.** Marża na PRO przy maksymalnym TTS jest dobra, ale po VAT, wsparciu i marketingu będzie znacznie niższa.

## 12. Priorytety końcowe

| Priorytet | Zadanie | Główny efekt |
| --- | --- | --- |
| 1 | Usunąć globalny polling 500 ms i leniwie ładować wideo | CPU, bateria, reputacja rozszerzenia |
| 2 | `WordRepository`, rekordy zamiast jednej tablicy, osobne screenshoty | szybkość dla 2–8 tys. kart, mniej awarii |
| 3 | Serwerowy limit SRS i rate limiting | ochrona rachunku przed nadużyciem |
| 4 | Serwerowe akcje AI i limity per akcja | przewidywalny koszt Gemini |
| 5 | Jeden ApiClient/SubscriptionStore | mniej duplikacji i błędów cache |
| 6 | Build `dist/extension`, lazy loading i minifikacja | mniejsza paczka i szybszy popup |
| 7 | Tokeny/komponenty CSS | 20–35% mniej CSS, tańsze zmiany UI |
| 8 | Delta sync | mniej odczytów Firestore |
| 9 | Testy frontend/integration/performance | bezpieczna refaktoryzacja bez zmiany funkcji |
| 10 | Telemetria kosztów, alerty, kill switch | bezpieczne skalowanie do 10 tys.+ użytkowników |

## 13. Ostateczna ocena

Lectoro nie wymaga pełnego przepisania. Rdzeń biznesowy i zabezpieczenie płatnych endpointów są wystarczająco dobre, aby rozwijać je iteracyjnie. Największy zwrot da nie „skracanie dla samego skracania”, lecz:

- usunięcie pracy wykonywanej stale bez potrzeby;
- rozdzielenie dużych danych na pojedyncze rekordy;
- jeden wspólny klient API i profil subskrypcji;
- lazy loading funkcji;
- serwerowe limity chroniące rachunek;
- automatyczny build i testy regresji.

Po tych zmianach kod powinien być krótszy o około 20–30%, znacznie lżejszy w codziennym działaniu i bezpieczniejszy kosztowo. Przy miksie 10% płacących obecne ceny mają zdrową marżę infrastrukturalną zarówno przy 1 000, jak i 10 000 użytkowników, pod warunkiem kontroli ElevenLabs, podatków i nadużyć.
