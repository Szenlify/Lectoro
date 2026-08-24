# Audyt Lectoro — Etap 1

Jesteś ekspertem od Chrome Extensions, Manifest V3 oraz zasad Chrome Web Store.

Przeanalizuj całe repozytorium tej wtyczki Chrome:

https://github.com/Szenlify/Lectoro

Celem jest przygotowanie projektu do publikacji w Chrome Web Store.

## WAŻNE

Nie przepisuj całego projektu i nie wykonuj zmian w ciemno.

Najpierw dokładnie przeanalizuj kod i wskaż konkretne problemy.

Dla każdego problemu podaj:

1. nazwę pliku,
2. numer linii, jeśli jest dostępny,
3. obecny kod,
4. dlaczego jest problemem,
5. jakie wymaganie Chrome Web Store może naruszać,
6. dokładną rekomendowaną zmianę,
7. gotowy fragment kodu po zmianie.

Podziel wszystkie problemy na:

* 🔴 MUSISZ ZMIENIĆ — duże ryzyko odrzucenia,
* 🟠 POWINIENEŚ ZMIENIĆ — zalecane przed publikacją,
* 🟢 MOŻE ZOSTAĆ — nie wymaga zmian.

---

# ETAP 1 — AUDYT TECHNICZNY

## 1. manifest.json

Dokładnie przeanalizuj:

* `manifest_version`,
* `permissions`,
* `host_permissions`,
* `content_scripts`,
* `matches`,
* `exclude_matches`,
* `web_accessible_resources`,
* `background.service_worker`,
* `externally_connectable`,
* `content_security_policy`,
* `commands`,
* `oauth2`,
* wszystkie inne pola Manifest V3.

Szczególnie sprawdź:

### `*://*/*`

Sprawdź, czy Lectoro rzeczywiście potrzebuje dostępu do wszystkich stron.

Jeżeli można ograniczyć zakres dostępu, zaproponuj konkretną zmianę.

Jeżeli szeroki dostęp jest konieczny ze względu na funkcję zaznaczania tekstu na dowolnej stronie, wyjaśnij:

* dlaczego jest potrzebny,
* jakie ryzyko powoduje,
* jak najlepiej uzasadnić go w Chrome Web Store.

---

# 2. Permissions

Przeanalizuj każde permission osobno:

* `storage`
* `alarms`
* `identity`
* `scripting`
* `activeTab`
* oraz każde inne znalezione w projekcie.

Dla każdego odpowiedz:

* gdzie jest używane,
* czy rzeczywiście jest potrzebne,
* czy można zastąpić je mniej uprzywilejowanym mechanizmem,
* czy można użyć `optional_permissions`,
* czy Chrome Web Store może wymagać dodatkowego uzasadnienia.

Nie zakładaj, że permission jest potrzebne tylko dlatego, że znajduje się w `manifest.json`.

Przeszukaj cały kod i znajdź rzeczywiste użycie każdego permission.

---

# 3. `chrome.scripting`

Znajdź wszystkie użycia:

```js
chrome.scripting
```

oraz:

```js
chrome.scripting.executeScript
```

Sprawdź:

* gdzie są używane,
* dlaczego,
* czy można użyć `activeTab`,
* czy można zastosować content script,
* czy nie jest to niepotrzebnie szeroki dostęp.

Zaproponuj konkretną zmianę, jeśli jest możliwa.

---

# 4. `activeTab`

Znajdź wszystkie miejsca korzystające z `activeTab`.

Sprawdź, czy rzeczywiście jest potrzebne.

Jeśli można osiągnąć tę samą funkcjonalność bez tego permission, pokaż jak.

---

# 5. Content Scripts

Przeanalizuj wszystkie content scripts.

Sprawdź:

* na jakich stronach są uruchamiane,
* czy uruchamiają się automatycznie,
* czy analizują zawartość stron,
* czy pobierają tekst strony,
* czy wysyłają dane poza przeglądarkę,
* czy działają na stronach, na których nie są potrzebne.

Szczególnie przeanalizuj:

```text
content.js
```

oraz wszystkie inne pliki ładowane jako content scripts.

---

# 6. Dane wysyłane poza przeglądarkę

Znajdź absolutnie wszystkie:

```js
fetch(...)
```

```js
XMLHttpRequest
```

```js
WebSocket
```

oraz inne mechanizmy komunikacji sieciowej.

Utwórz tabelę:

| Plik | Endpoint | Jakie dane wysyłamy | Kiedy | Czy dane zawierają tekst użytkownika? | Czy jest to konieczne? |
| ---- | -------- | ------------------- | ----- | ------------------------------------- | ---------------------- |

Nie pomijaj żadnego endpointu.

---

# 7. Google Translate

Znajdź wszystkie miejsca korzystające z:

```text
translate.googleapis.com
```

Sprawdź:

* jaki tekst jest wysyłany,
* kiedy jest wysyłany,
* czy użytkownik wykonuje świadomą akcję,
* czy dane mogą zawierać dane osobowe,
* czy można ograniczyć wysyłane dane.

Oceń ryzyko Chrome Web Store.

---

# 8. Gemini / AI

Przeanalizuj:

```text
gemini-proxy.js
```

oraz cały kod związany z Gemini.

Sprawdź:

* gdzie znajduje się API key,
* czy jakikolwiek sekret znajduje się w rozszerzeniu,
* czy request przechodzi przez backend,
* jakie dane są wysyłane,
* czy użytkownik inicjuje request,
* czy backend może być nadużywany.

Jeżeli znajdziesz API key lub sekret w kodzie klienta, oznacz to jako 🔴.

---

# 9. Screenshoty i Cloudflare R2

Znajdź cały kod związany ze screenshotami oraz:

```text
Cloudflare R2
```

Sprawdź:

* kiedy wykonywany jest screenshot,
* czy wykonuje go użytkownik,
* czy wykonywany jest automatycznie,
* gdzie jest wysyłany,
* jakie dane może zawierać,
* czy URL do R2 jest publiczny,
* czy użytkownik może usunąć screenshot.

Jeżeli screenshot jest wysyłany automatycznie bez wyraźnej akcji użytkownika, oznacz to jako 🔴 lub 🟠 i zaproponuj zmianę.

---

# 10. Firebase

Przeanalizuj cały katalog:

```text
firebase/
```

oraz wszystkie użycia:

```text
Firebase Authentication
Firestore
Firebase Storage
```

Sprawdź:

* jakie dane są zapisywane,
* jakie dane są odczytywane,
* czy użytkownik może dostać dostęp do danych innego użytkownika,
* czy Firebase Security Rules są bezpieczne,
* czy dane są odpowiednio ograniczone do `userId`.

Jeżeli znajdziesz:

```text
allow read, write: if true
```

lub podobnie niebezpieczne reguły, oznacz to jako 🔴.

---

# 11. Netflix

To bardzo ważna część audytu.

Przeanalizuj dokładnie:

```text
netflix-player-bridge.js
```

oraz wszystkie pliki związane z Netflix.

Sprawdź:

* `world: "MAIN"`,
* dostęp do playera,
* dostęp do manifestów,
* dostęp do timed text,
* pobieranie URL-i napisów,
* komunikację między MAIN world i extension world,
* czy kod może wyglądać jak obchodzenie zabezpieczeń,
* czy pobierane są jakiekolwiek dane poza tymi potrzebnymi do obsługi napisów.

Nie zakładaj, że integracja z Netflixem jest zakazana.

Oceń ją na podstawie aktualnych zasad Chrome Web Store.

Powiedz dokładnie:

* co jest bezpieczne,
* co jest ryzykowne,
* co należy zmienić,
* czego absolutnie nie robić.

---

# 12. YouTube

Przeanalizuj:

```text
youtube-player-bridge.js
```

oraz wszystkie pliki związane z YouTube.

Sprawdź:

* player,
* subtitles,
* timed text,
* manifest,
* `baseUrl`,
* pobieranie napisów,
* komunikację MAIN world ↔ extension.

Oceń, czy implementacja może zostać uznana za:

* normalną funkcję edukacyjną,
* pobieranie treści,
* obchodzenie ograniczeń,
* nieautoryzowany dostęp.

Zaproponuj bezpieczniejszą implementację, jeśli jest potrzebna.

---

# 13. Remote code

Przeszukaj całe repozytorium pod kątem:

```js
eval(
```

```js
new Function(
```

```js
import(
```

oraz:

```text
<script
```

```text
innerHTML
```

```text
outerHTML
```

i wszystkich mechanizmów pobierania oraz wykonywania kodu z zewnętrznego serwera.

Sprawdź, czy projekt nie wykonuje remote code.

Każde znalezione użycie dokładnie wyjaśnij.

---

# 14. Sekrety

Przeszukaj całe repozytorium pod kątem:

```text
API_KEY
APIKEY
SECRET
TOKEN
PASSWORD
PRIVATE_KEY
CLIENT_SECRET
ACCESS_TOKEN
```

oraz typowych kluczy:

```text
AIza
sk-
ghp_
github_pat_
```

Sprawdź również:

```text
.env
.env.local
.env.production
```

Jeżeli znajdziesz prawdziwy sekret:

🔴 oznacz go jako krytyczny.

Powiedz:

* gdzie jest,
* do czego służy,
* czy należy go unieważnić,
* jak prawidłowo przenieść go na backend.

---

# 15. HTTP / HTTPS

Znajdź wszystkie:

```text
http://
```

i sprawdź, czy można zastąpić je:

```text
https://
```

Każdy przypadek przeanalizuj osobno.

---

# 16. Obfuskacja

Sprawdź, czy jakikolwiek JavaScript jest:

* obfuscated,
* minified w sposób utrudniający review,
* dynamicznie generowany,
* pobierany z serwera.

Chrome Web Store musi być w stanie zrozumieć funkcjonalność rozszerzenia.

---

# 17. Niepotrzebny kod

Znajdź:

* development code,
* test endpoints,
* debug code,
* `console.log`,
* nieużywane permissions,
* nieużywane API,
* stare integracje,
* nieużywane pliki.

Nie usuwaj ich automatycznie.

Najpierw pokaż listę.

---

# 18. Przygotuj końcowy raport

Na końcu przedstaw:

## 🔴 MUSISZ ZMIENIĆ

Tabela:

| Priorytet | Plik | Problem | Ryzyko | Konkretna zmiana |
| --------- | ---- | ------- | ------ | ---------------- |

## 🟠 POWINIENEŚ ZMIENIĆ

Tabela:

| Priorytet | Plik | Problem | Zalecana zmiana |
| --------- | ---- | ------- | --------------- |

## 🟢 MOŻE ZOSTAĆ

Lista elementów, które są prawidłowe.

---

# 19. Najważniejsza część — plan zmian

Na końcu przygotuj dokładny plan:

```text
KROK 1
Plik:
Zmiana:

KROK 2
Plik:
Zmiana:

KROK 3
Plik:
Zmiana:
```

Uszereguj go od najważniejszych zmian do najmniej ważnych.

---

# 20. Nie wykonuj zmian bez mojej zgody

Na tym etapie NIE zmieniaj kodu automatycznie.

Najpierw przedstaw mi raport.

Chcę najpierw zobaczyć:

1. wszystkie problemy,
2. dokładne pliki,
3. dokładne linie,
4. ryzyko,
5. proponowane rozwiązanie,
6. gotowy kod po zmianie.

Dopiero po mojej akceptacji będziemy wprowadzać zmiany.

## Kryterium końcowe

Celem jest przygotowanie Lectoro tak, aby:

* spełniało Manifest V3,
* używało minimalnych permissions,
* miało uzasadniony dostęp do stron,
* bezpiecznie przetwarzało dane użytkownika,
* nie wykonywało remote code,
* nie przechowywało sekretów po stronie klienta,
* bezpiecznie korzystało z Firebase,
* bezpiecznie korzystało z Gemini,
* poprawnie obsługiwało YouTube,
* poprawnie i możliwie bezpiecznie obsługiwało Netflix,
* było zgodne z aktualnymi zasadami Chrome Web Store,
* miało możliwie wysoką szansę przejścia review.

Nie zgaduj.

Jeżeli czegoś nie możesz potwierdzić na podstawie kodu, napisz wyraźnie:

**„Nie mogę tego potwierdzić na podstawie repozytorium.”**

Jeżeli jakaś kwestia zależy od aktualnych zasad Chrome Web Store, sprawdź aktualną oficjalną dokumentację Google zamiast opierać się na starej wiedzy.

























ETAP 2 

# Lectoro — ETAP 2

## Privacy, dane użytkownika i przygotowanie do Chrome Web Store

Pracujesz nad rozszerzeniem Chrome **Lectoro**:

https://github.com/Szenlify/Lectoro

W ETAPIE 1 wykonano audyt techniczny projektu pod kątem Chrome Web Store.

Teraz przeprowadź ETAP 2.

### Cel

Przygotuj Lectoro od strony:

* Privacy Policy,
* przetwarzania danych użytkownika,
* ujawnień wymaganych przez Chrome Web Store,
* usuwania danych,
* Terms of Service,
* stron Support,
* informacji wymaganych w Chrome Web Store.

Nie zmieniaj jeszcze kodu.

Najpierw wykonaj analizę i przygotuj gotowe dokumenty oraz konkretne zalecenia.

---

# 1. Zidentyfikuj wszystkie dane użytkownika

Przeanalizuj cały kod Lectoro i utwórz kompletną listę danych, które:

1. są zbierane,
2. są generowane,
3. są przechowywane lokalnie,
4. są przechowywane na serwerze,
5. są wysyłane do zewnętrznych usług,
6. są synchronizowane między urządzeniami,
7. są usuwane.

Nie zgaduj.

Jeżeli dane nie są faktycznie zbierane, nie wpisuj ich do dokumentacji.

Przygotuj tabelę:

| Dane | Źródło | Gdzie trafiają | Cel | Czy użytkownik inicjuje akcję? | Czy są przechowywane? | Jak długo? |
| ---- | ------ | -------------- | --- | ------------------------------ | --------------------- | ---------- |

Uwzględnij między innymi:

* email,
* Google account ID,
* informacje z Firebase Authentication,
* zapisane słowa,
* zdania,
* historię nauki,
* ustawienia,
* zaznaczony tekst,
* tekst wysyłany do tłumaczenia,
* tekst wysyłany do Gemini,
* screenshoty,
* dane YouTube,
* dane Netflix,
* dane związane z napisami,
* informacje przechowywane w `chrome.storage`,
* IndexedDB,
* cookies, jeśli są używane,
* dane telemetryczne, jeśli są używane,
* logi backendu.

---

# 2. Zidentyfikuj wszystkie zewnętrzne usługi

Przeszukaj cały projekt.

Utwórz tabelę:

| Usługa | Do czego służy | Jakie dane otrzymuje | Czy dane są przechowywane? | Czy dane opuszczają UE? |
| ------ | -------------- | -------------------- | -------------------------- | ----------------------- |

Uwzględnij wszystkie rzeczywiste usługi znalezione w kodzie, np.:

* Google Firebase,
* Google Authentication,
* Google Translate,
* Gemini,
* Cloudflare R2,
* ElevenLabs,
* Vercel,
* inne API,
* inne usługi znalezione w projekcie.

Nie dodawaj usług, których Lectoro faktycznie nie używa.

---

# 3. Google Translate

Dokładnie przeanalizuj sposób korzystania z Google Translate.

Odpowiedz:

* jaki tekst jest wysyłany,
* kiedy jest wysyłany,
* czy użytkownik wykonuje akcję,
* czy tekst może zawierać dane osobowe,
* czy tekst jest przechowywany,
* czy Lectoro może działać bez wysyłania tekstu.

Na podstawie kodu przygotuj dokładny opis, który powinien znaleźć się w Privacy Policy.

---

# 4. Gemini

Przeanalizuj cały przepływ:

```text
Lectoro
↓
backend/proxy
↓
Gemini
```

Ustal:

* jakie dane trafiają do Gemini,
* dlaczego,
* czy są przechowywane,
* czy są logowane,
* jak długo,
* czy użytkownik inicjuje request.

Jeżeli backend ma możliwość logowania promptów lub odpowiedzi, wskaż to.

---

# 5. Firebase

Przeanalizuj:

* Firebase Authentication,
* Firestore,
* wszystkie kolekcje,
* dokumenty,
* pola,
* synchronizację.

Utwórz dokładną mapę:

```text
User
 ├── email
 ├── userId
 ├── settings
 ├── vocabulary
 ├── sentences
 └── learning data
```

Jeżeli struktura jest inna, pokaż rzeczywistą strukturę.

Sprawdź również Firebase Security Rules.

---

# 6. Cloudflare R2

Sprawdź dokładnie:

* jakie pliki są wysyłane,
* kto może je odczytać,
* czy URL jest publiczny,
* czy bucket jest publiczny,
* czy istnieje możliwość usunięcia pliku,
* czy użytkownik może usunąć swoje screenshoty.

Jeżeli screenshoty mogą zawierać treść strony internetowej, zaznacz to w Privacy Policy.

---

# 7. YouTube i Netflix

Dokładnie rozdziel:

### YouTube

Jakie informacje Lectoro pobiera i dlaczego.

### Netflix

Jakie informacje Lectoro pobiera i dlaczego.

Nie używaj ogólnego:

> "We collect data from YouTube and Netflix."

Opisz konkretnie, jakie dane są faktycznie przetwarzane.

Jeżeli Lectoro nie zapisuje tych danych, zaznacz:

> processed temporarily and not stored

ale tylko jeśli jest to prawdą na podstawie kodu.

---

# 8. Privacy Policy

Na podstawie rzeczywistego kodu przygotuj kompletną Privacy Policy dla Lectoro.

Dokument powinien zawierać:

## 1. Introduction

Czym jest Lectoro.

## 2. Information We Collect

Dokładna lista danych.

## 3. How We Use Information

Cel każdego rodzaju danych.

## 4. Third-Party Services

Lista wszystkich usług zewnętrznych.

## 5. Authentication

Opis Google/Firebase Authentication.

## 6. AI Processing

Opis Gemini.

## 7. Translation

Opis Google Translate.

## 8. Screenshots and Cloud Storage

Opis Cloudflare R2.

## 9. Local Storage

Opis `chrome.storage` i IndexedDB.

## 10. YouTube and Netflix

Dokładny opis przetwarzania danych.

## 11. Data Retention

Jak długo przechowywane są dane.

Jeżeli okres nie jest obecnie określony w kodzie, NIE wymyślaj go.

Oznacz:

**REQUIRES DECISION**

i zaproponuj rozsądne rozwiązanie.

## 12. Data Deletion

Jak użytkownik może usunąć dane.

## 13. Account Deletion

Jak użytkownik może usunąć konto.

## 14. Security

Opis zabezpieczeń.

## 15. Children's Privacy

Sprawdź, czy Lectoro jest skierowane do dzieci.

Nie deklaruj wieku użytkownika bez potwierdzenia.

## 16. International Data Transfers

Sprawdź, czy dane mogą być przetwarzane poza UE.

Nie zgaduj.

## 17. Changes to Privacy Policy

Standardowa procedura aktualizacji.

## 18. Contact

Miejsce na adres kontaktowy.

Jeżeli nie znasz prawdziwego adresu, użyj:

`[CONTACT EMAIL — TO BE PROVIDED]`

Nie wymyślaj adresu.

---

# 9. Chrome Web Store — Privacy

Przygotuj dokładnie informacje, które trzeba podać w Chrome Web Store.

W szczególności ustal:

### Single purpose

Jaki jest jeden główny cel Lectoro?

Zaproponuj jedno krótkie zdanie.

### Data usage

Określ, które kategorie danych dotyczą Lectoro.

Nie zaznaczaj kategorii, których projekt faktycznie nie wykorzystuje.

### User data

Przygotuj rekomendowane odpowiedzi do formularza Chrome Web Store.

### Privacy Policy URL

Powiedz, jaką stronę należy udostępnić.

---

# 10. Limited Use

Przeanalizuj, czy Lectoro podlega wymaganiom dotyczącym Limited Use.

Wyjaśnij:

* które dane są objęte wymaganiami,
* jak są wykorzystywane,
* czy są przekazywane osobom trzecim,
* czy wykorzystanie jest związane z główną funkcją rozszerzenia.

Przygotuj tekst, który można wykorzystać w deklaracji dotyczącej wykorzystania danych.

---

# 11. Account deletion

Sprawdź, czy Lectoro posiada funkcję:

```text
Delete account
```

Jeżeli nie:

1. oznacz to jako 🟠 lub 🔴,
2. wyjaśnij dlaczego,
3. zaproponuj implementację.

Przygotuj dokładny flow:

```text
User
↓
Settings
↓
Delete account
↓
Confirmation
↓
Firebase Auth deletion
↓
Firestore deletion
↓
R2 deletion
↓
Local storage cleanup
↓
Logout
```

Dostosuj flow do rzeczywistej architektury Lectoro.

---

# 12. Support Page

Przygotuj strukturę strony:

```text
/support
```

Powinna zawierać:

* czym jest Lectoro,
* instalację,
* logowanie,
* tłumaczenie,
* AI,
* YouTube,
* Netflix,
* synchronizację,
* problemy,
* usuwanie konta,
* kontakt.

Przygotuj gotową treść FAQ.

---

# 13. Terms of Service

Przygotuj draft Terms of Service dla Lectoro.

Uwzględnij:

* korzystanie z rozszerzenia,
* konto użytkownika,
* usługi zewnętrzne,
* AI,
* ograniczenie odpowiedzialności,
* dostępność usługi,
* prawa własności intelektualnej,
* możliwość zakończenia konta,
* zmiany regulaminu,
* kontakt.

Nie twórz fałszywych danych firmy.

Użyj placeholderów:

```text
[COMPANY NAME]
[COMPANY ADDRESS]
[CONTACT EMAIL]
```

---

# 14. Chrome Web Store Listing

Przygotuj draft:

### Extension name

Maksymalnie zgodny z zasadami Chrome Web Store.

### Short description

Krótki opis funkcji.

### Detailed description

Pełny opis funkcji.

### Permissions justification

Przygotuj osobne uzasadnienie dla każdego permission.

Format:

```text
Permission:
Reason:
Where used:
Why necessary:
```

---

# 15. Opis Netflix / YouTube

Przygotuj bezpieczne sformułowanie dotyczące integracji.

Nie sugeruj, że Lectoro jest oficjalnie powiązane z:

* Netflix,
* YouTube,
* Google.

Nie używaj sformułowań typu:

> Official Netflix extension

> Netflix approved

> Google official

chyba że istnieje rzeczywiste potwierdzenie.

---

# 16. Zgodność dokumentacji z kodem

To jest bardzo ważne.

Porównaj:

```text
CODE
vs.
PRIVACY POLICY
vs.
CHROME WEB STORE DISCLOSURES
```

Znajdź każdą sytuację, w której:

* kod robi coś, czego Privacy Policy nie opisuje,
* Privacy Policy opisuje coś, czego kod nie robi,
* Chrome Web Store disclosure nie odpowiada rzeczywistemu działaniu.

Utwórz tabelę:

| Problem | Kod | Dokument | Co poprawić |
| ------- | --- | -------- | ----------- |

---

# 17. GDPR — Polska / UE

Ponieważ Lectoro może być używane przez użytkowników w UE, przeanalizuj kwestie GDPR.

Nie udzielaj ogólnej porady prawnej.

Wskaż techniczne i dokumentacyjne wymagania, które powinienem sprawdzić, np.:

* prawo do usunięcia danych,
* dostęp do danych,
* minimalizacja danych,
* retencja,
* podstawy przetwarzania,
* dostawcy zewnętrzni,
* transfer danych poza EOG,
* kontakt w sprawach prywatności.

Jeżeli jakaś kwestia wymaga prawnika, wyraźnie to zaznacz.

---

# 18. Raport końcowy

Na końcu przygotuj cztery sekcje.

## 🔴 MUSISZ ZROBIĆ PRZED PUBLIKACJĄ

| Problem | Dlaczego | Co zrobić |
| ------- | -------- | --------- |

## 🟠 POWINIENEŚ ZROBIĆ

| Problem | Ryzyko | Zalecenie |
| ------- | ------ | --------- |

## 🟢 JEST OK

Lista rzeczy zgodnych z wymaganiami.

## ❓ WYMAGA DECYZJI

Lista rzeczy, których nie można ustalić z kodu.

---

# 19. Gotowe dokumenty

Na końcu wygeneruj:

1. kompletną Privacy Policy,
2. Terms of Service,
3. Support FAQ,
4. Chrome Web Store Privacy disclosure,
5. Permission justifications,
6. Single Purpose description,
7. Data usage description,
8. Account deletion flow.

Dokumenty mają być napisane po angielsku, ponieważ będą używane na stronie i w Chrome Web Store.

Nie wymyślaj:

* danych firmy,
* adresów,
* emaili,
* okresów retencji,
* dostawców,
* sposobów przetwarzania.

Jeżeli czegoś brakuje, użyj `[TO BE PROVIDED]`.

---

# ZASADA

Nie zmieniaj kodu w tym etapie.

Najpierw przygotuj kompletny raport i dokumenty.

Każde stwierdzenie dotyczące wymagań Chrome Web Store, które zależy od aktualnych zasad Google, zweryfikuj w aktualnej oficjalnej dokumentacji Google.

Nie opieraj się na nieaktualnych poradnikach, blogach ani starych wersjach polityki.

Celem jest przygotowanie Lectoro do rzeczywistego submission review w Chrome Web Store w 2026 roku.








ETAP 3
# Lectoro — ETAP 3

## Implementacja poprawek technicznych przed Chrome Web Store

Pracujesz nad rozszerzeniem Chrome **Lectoro**:

https://github.com/Szenlify/Lectoro

Wykonałeś wcześniej:

* ETAP 1 — audyt techniczny Chrome Web Store,
* ETAP 2 — audyt Privacy, danych użytkownika i dokumentacji.

Teraz przejdź do **ETAPU 3 — IMPLEMENTACJI ZMIAN W KODZIE**.

## WAŻNE

Nie przebudowuj projektu od zera.

Nie zmieniaj architektury, jeżeli nie jest to konieczne.

Nie usuwaj istniejących funkcji tylko dlatego, że można napisać je inaczej.

Twoim celem jest:

> **minimalna liczba zmian potrzebna do zwiększenia bezpieczeństwa, zgodności z Chrome Web Store i gotowości produkcyjnej Lectoro.**

---

# 1. Najpierw przeczytaj raporty z Etapu 1 i 2

Przed rozpoczęciem zmian:

1. przeczytaj wyniki Etapu 1,
2. przeczytaj wyniki Etapu 2,
3. zidentyfikuj wszystkie problemy oznaczone jako 🔴,
4. następnie problemy 🟠,
5. pomiń problemy 🟢.

Nie wprowadzaj zmian, które nie wynikają z audytu.

---

# 2. Zrób plan zmian

Przed edycją kodu przygotuj krótką listę:

```text
KROK 1
Plik:
Problem:
Zmiana:

KROK 2
Plik:
Problem:
Zmiana:
```

Posortuj według:

1. bezpieczeństwo,
2. Chrome Web Store,
3. prywatność,
4. permissions,
5. stabilność,
6. cleanup.

Jeżeli zmiana może wpłynąć na istniejącą funkcjonalność, zaznacz:

⚠️ POTENCJALNY BREAKING CHANGE

---

# 3. Manifest V3

Doprowadź `manifest.json` do możliwie najmniejszego i poprawnego zestawu uprawnień.

Sprawdź:

* `manifest_version`,
* `permissions`,
* `host_permissions`,
* `content_scripts`,
* `matches`,
* `web_accessible_resources`,
* `background`,
* `content_security_policy`.

Usuń tylko rzeczywiście niepotrzebne permissions.

Nie usuwaj permission tylko dlatego, że wygląda szeroko.

Najpierw sprawdź wszystkie miejsca jego użycia.

---

# 4. Ogranicz dostęp do stron

Obecnie projekt korzysta z szerokiego zakresu:

```json
"matches": ["*://*/*"]
```

Sprawdź, czy można go ograniczyć.

Jeżeli Lectoro musi działać na większości stron, zachowaj szeroki zakres, ale:

* nie wykonuj ciężkiego kodu bez potrzeby,
* nie pobieraj całej zawartości strony automatycznie,
* nie wysyłaj tekstu strony automatycznie,
* reaguj na rzeczywistą akcję użytkownika.

Jeżeli można zastosować `activeTab`, `optional_host_permissions` lub inne ograniczenie bez utraty funkcjonalności, zastosuj je.

---

# 5. Minimalizuj przetwarzanie danych

To jest jedna z najważniejszych zmian.

Lectoro nie powinno:

```text
strona
↓
automatyczne pobranie całego tekstu
↓
serwer
```

jeżeli funkcja wymaga tylko:

```text
użytkownik zaznacza tekst
↓
Lectoro pobiera zaznaczenie
↓
Lectoro wysyła zaznaczony tekst
```

Przeanalizuj wszystkie miejsca, w których dane strony są pobierane.

Ogranicz je do minimum.

---

# 6. Google Translate

Zachowaj funkcję tłumaczenia, ale upewnij się, że:

* wysyłany jest tylko potrzebny tekst,
* request jest inicjowany przez użytkownika,
* nie wysyłasz całej strony,
* nie wysyłasz danych w tle bez potrzeby.

Nie zmieniaj dostawcy tłumaczeń, chyba że jest to konieczne.

---

# 7. Gemini

Upewnij się, że:

```text
API KEY
```

nie znajduje się w kodzie rozszerzenia.

Poprawna architektura:

```text
Chrome Extension
       ↓
Twój backend
       ↓
Gemini API
```

Klucze i sekrety muszą znajdować się po stronie backendu.

Sprawdź również, czy frontend może manipulować parametrami backendu w sposób umożliwiający:

* używanie API bez autoryzacji,
* nadużywanie endpointu,
* wysyłanie dowolnych requestów,
* generowanie niekontrolowanych kosztów.

Jeżeli znajdziesz taki problem, popraw backend.

---

# 8. Backend security

Dla każdego endpointu backendowego sprawdź:

* authentication,
* authorization,
* rate limiting,
* input validation,
* request size limits,
* CORS,
* logging,
* error handling.

Szczególnie sprawdź endpointy AI.

Nie ufaj danym wysyłanym z rozszerzenia.

Każdy input z klienta traktuj jako niezaufany.

---

# 9. Firebase

Popraw Firebase Security Rules.

Cel:

```text
User A
↓
tylko dane User A

User B
↓
tylko dane User B
```

Użytkownik nie może:

* odczytać danych innego użytkownika,
* zmodyfikować danych innego użytkownika,
* usunąć danych innego użytkownika.

Sprawdź wszystkie kolekcje i subkolekcje.

Nie zakładaj, że samo ukrycie `userId` po stronie klienta zapewnia bezpieczeństwo.

---

# 10. Account deletion

Jeżeli projekt nie ma pełnego usuwania konta, dodaj:

```text
Settings
↓
Delete account
↓
Confirmation
↓
Delete Firebase Auth user
↓
Delete Firestore user data
↓
Delete R2 user files
↓
Clear chrome.storage
↓
Clear IndexedDB
↓
Logout
```

Dostosuj ten flow do rzeczywistej architektury.

Jeżeli usunięcie wymaga backendu, wykonaj je po stronie serwera.

Nie pozwól użytkownikowi usuwać danych innych użytkowników.

---

# 11. Local data cleanup

Znajdź wszystkie:

```js
chrome.storage
```

oraz:

```text
IndexedDB
localStorage
sessionStorage
cookies
```

Ustal:

* jakie dane są zapisywane,
* kiedy,
* jak długo,
* jak są usuwane.

Dodaj funkcję:

```text
clearAllLocalUserData()
```

jeżeli obecna architektura tego wymaga.

Funkcja powinna usuwać tylko dane należące do aktualnego użytkownika.

---

# 12. Screenshoty

Przeanalizuj cały flow screenshotów.

Jeżeli screenshot jest wykonywany automatycznie bez wyraźnej akcji użytkownika, zmień implementację tak, aby użytkownik świadomie inicjował zapis.

Preferowany flow:

```text
User clicks Save
       ↓
Create screenshot
       ↓
Upload
       ↓
Save reference
```

Nie:

```text
User visits page
       ↓
Automatic screenshot
       ↓
Upload
```

Jeżeli screenshot nie jest potrzebny do aktualnej funkcji, nie wykonuj go.

---

# 13. Cloudflare R2

Zabezpiecz R2.

Sprawdź:

* bucket,
* upload,
* download,
* delete,
* URL,
* authorization.

Nie pozwalaj klientowi na dowolny upload do bucketu.

Jeżeli używasz signed URLs, upewnij się, że są generowane po stronie backendu.

Użytkownik A nie może uzyskać dostępu do pliku użytkownika B.

---

# 14. YouTube

Nie usuwaj integracji YouTube.

Zachowaj funkcjonalność edukacyjną.

Jednocześnie upewnij się, że Lectoro:

* nie pobiera filmu,
* nie pobiera audio,
* nie omija DRM,
* nie obchodzi zabezpieczeń,
* nie wykonuje niepotrzebnego scrapingu,
* pobiera tylko informacje potrzebne do funkcji napisów.

Jeżeli bridge pobiera więcej danych niż potrzeba, ogranicz go.

---

# 15. Netflix

To jest krytyczna część.

Nie usuwaj integracji automatycznie.

Najpierw ogranicz ją do:

```text
Netflix
↓
wykrycie aktualnego materiału
↓
wykrycie dostępnych napisów
↓
obsługa napisów
↓
funkcje nauki języka
```

Nie implementuj:

* pobierania filmu,
* pobierania audio,
* obchodzenia DRM,
* obchodzenia zabezpieczeń,
* pobierania chronionych materiałów,
* funkcji niezwiązanych z nauką języka.

Jeżeli istnieją mechanizmy, które mogą zostać uznane za obchodzenie zabezpieczeń, usuń je lub zastąp bezpieczniejszym mechanizmem.

Jeżeli nie da się zachować funkcji Netflix bez takiego mechanizmu, zatrzymaj zmianę i oznacz:

🔴 REQUIRES MANUAL REVIEW

Nie wymyślaj alternatywnej implementacji bez potwierdzenia, że jest zgodna z zasadami.

---

# 16. MAIN world

Przeanalizuj wszystkie:

```json
"world": "MAIN"
```

i sprawdź, czy rzeczywiście są konieczne.

Jeżeli można użyć izolowanego world, preferuj go.

Jeżeli MAIN world jest konieczny:

* ogranicz komunikację,
* waliduj wszystkie dane,
* nie ufaj obiektom pochodzącym ze strony,
* nie wykonuj arbitralnego kodu,
* nie przekazuj danych użytkownika bez potrzeby.

---

# 17. Remote code

Usuń lub zastąp mechanizmy, które mogą powodować wykonywanie zewnętrznego kodu.

Szczególnie przeanalizuj:

```js
eval()
new Function()
```

oraz dynamiczne ładowanie kodu.

Jeżeli dynamiczny `import()` jest używany wyłącznie do lokalnych modułów rozszerzenia, nie traktuj go automatycznie jako problemu.

Sprawdź źródło modułu.

---

# 18. Sekrety

Usuń z rozszerzenia:

* API keys, które powinny być prywatne,
* private keys,
* service account credentials,
* client secrets,
* access tokens.

Wszystkie sekrety przenieś na backend.

Jeżeli prawdziwy sekret został wcześniej opublikowany w GitHubie:

1. usuń go z kodu,
2. unieważnij,
3. wygeneruj nowy,
4. sprawdź historię Git.

---

# 19. Walidacja danych

Dodaj walidację danych pochodzących z:

* content scripts,
* webpage,
* `postMessage`,
* `chrome.runtime.sendMessage`,
* backendu,
* Firebase,
* URL,
* query parameters.

Nie ufaj danym tylko dlatego, że pochodzą z własnego rozszerzenia.

---

# 20. CSP

Sprawdź Content Security Policy Manifest V3.

Usuń niepotrzebne wyjątki.

Nie dodawaj:

```text
unsafe-eval
```

ani innych niebezpiecznych wyjątków tylko po to, żeby naprawić błąd.

Jeżeli biblioteka wymaga takiego wyjątku, znajdź bezpieczniejszą alternatywę.

---

# 21. CORS

Sprawdź wszystkie backendy.

Nie ustawiaj bez potrzeby:

```text
Access-Control-Allow-Origin: *
```

Jeżeli endpoint jest przeznaczony tylko dla Lectoro, ogranicz dostęp.

Pamiętaj jednak, że samo CORS nie jest mechanizmem autoryzacji.

---

# 22. Logging

Usuń lub ogranicz produkcyjne:

```js
console.log()
```

szczególnie jeśli logują:

* email,
* token,
* tekst użytkownika,
* prompt,
* odpowiedź AI,
* URL,
* dane konta.

Nigdy nie loguj:

* API keys,
* access tokens,
* passwords,
* refresh tokens.

---

# 23. Error handling

Sprawdź błędy backendu i extension.

Nie zwracaj użytkownikowi:

* stack trace,
* sekretów,
* kluczy API,
* wewnętrznych ścieżek,
* danych innych użytkowników.

Błędy powinny być czytelne dla użytkownika, ale szczegóły techniczne powinny pozostać w bezpiecznych logach developerskich.

---

# 24. Nie zmieniaj funkcjonalności bez potrzeby

Po każdej zmianie sprawdź:

* popup,
* content script,
* selection,
* translation,
* AI,
* vocabulary,
* authentication,
* synchronization,
* YouTube,
* Netflix,
* TTS,
* screenshots.

Nie wolno "naprawić" Chrome Web Store kosztem podstawowej funkcji Lectoro.

---

# 25. Testy

Po wykonaniu zmian uruchom:

```text
npm install
npm run lint
npm run build
```

Jeżeli projekt nie posiada któregoś z tych skryptów, nie dodawaj go automatycznie.

Sprawdź również:

```text
manifest validation
extension loading
service worker
content scripts
permissions
```

---

# 26. Test ręczny

Przetestuj:

## Authentication

* login,
* logout,
* refresh,
* expired session.

## Translation

* zaznaczenie tekstu,
* tłumaczenie,
* długi tekst,
* pusty tekst,
* specjalne znaki.

## AI

* normalny request,
* błąd API,
* timeout,
* brak autoryzacji,
* bardzo długi input.

## Vocabulary

* save,
* delete,
* sync,
* logout/login.

## YouTube

* video,
* subtitles,
* brak subtitles,
* zmiana filmu.

## Netflix

* video,
* subtitles,
* brak subtitles,
* zmiana filmu.

## Account deletion

* usunięcie konta,
* usunięcie danych,
* wylogowanie,
* ponowny login.

## Permissions

Sprawdź, czy rozszerzenie nie żąda dodatkowych uprawnień podczas normalnego działania.

---

# 27. Security review

Po wykonaniu zmian ponownie przeszukaj repozytorium:

```text
API_KEY
SECRET
TOKEN
PASSWORD
PRIVATE_KEY
AIza
sk-
eval(
new Function(
unsafe-eval
http://
```

oraz:

```text
fetch(
XMLHttpRequest
WebSocket
chrome.scripting
chrome.tabs
chrome.cookies
chrome.history
```

Każdy wynik przeanalizuj.

---

# 28. Nie zmieniaj dokumentacji w tym etapie

Privacy Policy i Terms of Service zostały przygotowane w ETAPIE 2.

Nie zmieniaj ich automatycznie.

Jeżeli zmiana kodu powoduje, że dokumentacja jest nieaktualna, dodaj:

```text
⚠️ PRIVACY POLICY UPDATE REQUIRED
```

i wskaż dokładnie, co trzeba zmienić.

---

# 29. Finalny raport

Po wykonaniu zmian przygotuj:

## ZMIENIONE

| Plik | Zmiana | Powód |
| ---- | ------ | ----- |

## NIE ZMIENIONE

| Problem | Dlaczego pozostawiono |
| ------- | --------------------- |

## REQUIRES MANUAL REVIEW

Lista rzeczy, których nie można bezpiecznie zmienić automatycznie.

## POTENCJALNE BREAKING CHANGES

Lista zmian mogących wpłynąć na funkcjonalność.

## TESTY

| Test             | Wynik     |
| ---------------- | --------- |
| Build            | PASS/FAIL |
| Lint             | PASS/FAIL |
| Manifest         | PASS/FAIL |
| Authentication   | PASS/FAIL |
| Translation      | PASS/FAIL |
| AI               | PASS/FAIL |
| Firebase         | PASS/FAIL |
| YouTube          | PASS/FAIL |
| Netflix          | PASS/FAIL |
| Account deletion | PASS/FAIL |

---

# 30. Najważniejsza zasada

Nie twierdź:

> "Chrome Web Store zaakceptuje rozszerzenie."

Tego nie można zagwarantować.

Możesz jedynie powiedzieć:

> "Projekt został przygotowany zgodnie z aktualnie znanymi wymaganiami."

Jeżeli jakaś funkcja Lectoro nadal stanowi ryzyko podczas review, oznacz ją wyraźnie.

---

# 31. Zasada bezpieczeństwa

Jeżeli podczas implementacji znajdziesz:

* możliwość dostępu do danych innego użytkownika,
* wyciek sekretu,
* możliwość wykorzystania backendu bez autoryzacji,
* możliwość wykonywania arbitralnego kodu,
* możliwość nieautoryzowanego dostępu do treści,

zatrzymaj dalszą implementację tej części i oznacz problem jako:

🔴 CRITICAL SECURITY ISSUE

Nie maskuj problemu i nie omijaj go.

---

# CEL ETAPU 3

Po zakończeniu tego etapu Lectoro powinno mieć:

* poprawny Manifest V3,
* minimalne możliwe permissions,
* ograniczony dostęp do stron,
* bezpieczne przetwarzanie danych,
* bezpieczny backend,
* zabezpieczony Firebase,
* zabezpieczony R2,
* brak sekretów w rozszerzeniu,
* brak remote code,
* bezpieczne requesty AI,
* bezpieczne tłumaczenia,
* bezpieczniejsze integracje YouTube/Netflix,
* możliwość usunięcia danych użytkownika,
* brak oczywistych problemów bezpieczeństwa.

**Najpierw wykonaj analizę i plan. Następnie wprowadź zmiany w kodzie. Nie przebudowuj projektu bez potrzeby.**










# Lectoro — ETAP 4

## Finalny audyt przed publikacją w Chrome Web Store

Pracujesz nad rozszerzeniem Chrome **Lectoro**:

https://github.com/Szenlify/Lectoro

Wcześniej wykonano:

* ETAP 1 — audyt techniczny,
* ETAP 2 — Privacy, dane użytkownika i dokumentacja,
* ETAP 3 — implementacja wymaganych poprawek.

Teraz wykonaj **ETAP 4 — FINALNY AUDYT PRZED PUBLIKACJĄ**.

## CEL

Chcę otrzymać wersję Lectoro, którą mogę przygotować jako ZIP i przesłać do Chrome Web Store.

Nie wprowadzaj dużych zmian architektonicznych.

Na tym etapie najważniejsze są:

* poprawność,
* bezpieczeństwo,
* zgodność z Manifest V3,
* zgodność z aktualnymi zasadami Chrome Web Store,
* brak oczywistych błędów,
* poprawny build,
* kompletna dokumentacja,
* poprawne dane w Store Listing,
* gotowość do review.

---

# 1. Przeczytaj wyniki poprzednich etapów

Najpierw przeanalizuj:

* raport ETAPU 1,
* dokumentację ETAPU 2,
* zmiany wykonane w ETAPIE 3.

Sprawdź, czy wszystkie problemy oznaczone wcześniej jako:

🔴 MUSISZ ZMIENIĆ

zostały rzeczywiście rozwiązane.

Utwórz tabelę:

| Problem z poprzedniego etapu | Status      | Plik | Komentarz |
| ---------------------------- | ----------- | ---- | --------- |
| ...                          | ✅ FIXED     | ...  | ...       |
| ...                          | ❌ NOT FIXED | ...  | ...       |
| ...                          | ⚠️ PARTIAL  | ...  | ...       |

---

# 2. Sprawdź aktualne zasady Chrome Web Store

Przed finalnym audytem sprawdź aktualną oficjalną dokumentację Google Chrome Web Store.

Korzystaj przede wszystkim z:

* Chrome Web Store Program Policies,
* Manifest V3 documentation,
* Chrome Extensions documentation,
* User Data Policy,
* Privacy requirements,
* Publishing requirements.

Nie opieraj się na starych poradnikach.

Jeżeli jakaś zasada zmieniła się od poprzedniego audytu, zaznacz to.

---

# 3. Finalny manifest audit

Przeanalizuj cały `manifest.json`.

Sprawdź:

```text
manifest_version
name
version
description
icons
action
background
permissions
host_permissions
optional_permissions
content_scripts
web_accessible_resources
content_security_policy
oauth2
externally_connectable
commands
```

Dla każdego pola odpowiedz:

```text
OK
```

lub:

```text
PROBLEM
```

Jeżeli jest problem, podaj dokładną poprawkę.

---

# 4. Permissions final review

Utwórz końcową tabelę:

| Permission | Czy używane? | Gdzie? | Czy konieczne? | Ryzyko |
| ---------- | ------------ | ------ | -------------- | ------ |

Sprawdź szczególnie:

```text
storage
alarms
identity
scripting
activeTab
```

oraz wszystkie host permissions.

Celem jest:

> najmniejszy możliwy zakres uprawnień potrzebny do działania Lectoro.

---

# 5. Host permissions

Sprawdź:

```text
*://*/*
```

Jeżeli nadal występuje, odpowiedz:

1. Czy jest absolutnie konieczne?
2. Które funkcje go wymagają?
3. Czy można użyć `activeTab`?
4. Czy można zastosować `optional_host_permissions`?
5. Czy można ograniczyć strony?
6. Jak należy uzasadnić ten dostęp w Chrome Web Store?

Jeżeli szeroki dostęp jest konieczny, nie usuwaj go tylko dla samego usunięcia.

---

# 6. Content Scripts

Sprawdź wszystkie content scripts.

Upewnij się, że:

* nie wykonują ciężkiej pracy bez potrzeby,
* nie pobierają całej strony automatycznie,
* nie wysyłają danych bez akcji użytkownika,
* nie wykonują zewnętrznego kodu,
* nie zbierają niepotrzebnych danych.

---

# 7. Background Service Worker

Przeanalizuj:

```text
background.js
```

Sprawdź:

* event listeners,
* message handlers,
* API calls,
* authentication,
* alarms,
* storage,
* tabs,
* scripting,
* error handling.

Upewnij się, że service worker nie wykonuje niepotrzebnych operacji w tle.

---

# 8. Message passing security

Przeanalizuj:

```text
chrome.runtime.sendMessage
chrome.runtime.onMessage
chrome.tabs.sendMessage
postMessage
window.postMessage
```

Sprawdź każdy przepływ:

```text
Content Script
↓
Background
↓
Backend
```

oraz:

```text
MAIN world
↓
Content Script
↓
Background
```

Sprawdź:

* czy dane są walidowane,
* czy wiadomości mają określony format,
* czy można wysłać złośliwą wiadomość,
* czy użytkownik może wywołać funkcję administracyjną,
* czy nie można zmienić `userId`,
* czy nie można uzyskać danych innego użytkownika.

---

# 9. MAIN world final audit

Znajdź wszystkie:

```text
"world": "MAIN"
```

Sprawdź każdy osobno.

Dla każdego odpowiedz:

```text
Dlaczego MAIN world?
Czy można użyć ISOLATED world?
Jakie dane przepływają?
Czy dane są walidowane?
Czy istnieje ryzyko manipulacji przez stronę?
```

---

# 10. YouTube final audit

Sprawdź pełną integrację YouTube.

Testuj:

### Film z napisami

```text
PASS / FAIL
```

### Film bez napisów

```text
PASS / FAIL
```

### Zmiana filmu

```text
PASS / FAIL
```

### Zmiana języka

```text
PASS / FAIL
```

### Brak dostępu do napisów

```text
PASS / FAIL
```

Upewnij się, że Lectoro:

* nie pobiera video,
* nie pobiera audio,
* nie obchodzi DRM,
* nie obchodzi zabezpieczeń,
* nie wykonuje niepotrzebnego scrapingu.

---

# 11. Netflix final audit

To jest jeden z najważniejszych testów.

Sprawdź:

### Netflix z napisami

```text
PASS / FAIL
```

### Netflix bez napisów

```text
PASS / FAIL
```

### Zmiana filmu

```text
PASS / FAIL
```

### Zmiana języka

```text
PASS / FAIL
```

### Odświeżenie strony

```text
PASS / FAIL
```

### Restart rozszerzenia

```text
PASS / FAIL
```

Upewnij się, że rozszerzenie nie:

* pobiera filmu,
* pobiera audio,
* obchodzi DRM,
* obchodzi zabezpieczeń,
* wykonuje nieautoryzowanego dostępu.

Jeżeli jakaś funkcja nadal jest ryzykowna, oznacz:

🔴 REVIEW RISK

Nie ukrywaj jej przed reviewerem.

---

# 12. Translation test

Przetestuj:

### Krótkie słowo

```text
hello
```

### Zdanie

```text
I went to work yesterday.
```

### Długi tekst

```text
minimum 1000 characters
```

### Znaki specjalne

```text
< > " ' & / \ €
```

### Tekst wielojęzyczny

```text
English
Polish
German
Spanish
French
```

### Pusty tekst

Sprawdź, czy request nie jest wykonywany.

---

# 13. AI test

Przetestuj:

* normalny request,
* pusty input,
* bardzo długi input,
* błędny input,
* timeout,
* brak internetu,
* 401,
* 403,
* 429,
* 500.

Sprawdź, czy użytkownik dostaje sensowny komunikat.

Nie pokazuj:

* API keys,
* stack trace,
* danych backendu,
* danych innych użytkowników.

---

# 14. Authentication test

Przetestuj:

```text
Install
↓
Login
↓
Refresh
↓
Close browser
↓
Open browser
↓
Logout
↓
Login again
```

Sprawdź:

* czy sesja działa,
* czy dane użytkownika są prawidłowo przypisane,
* czy logout czyści odpowiednie dane,
* czy użytkownik nie może dostać danych innego konta.

---

# 15. Account deletion test

Wykonaj rzeczywisty test:

```text
Create account
↓
Save vocabulary
↓
Create other user data
↓
Upload screenshot
↓
Delete account
```

Następnie sprawdź:

```text
Firebase Auth
Firestore
R2
chrome.storage
IndexedDB
localStorage
```

Wszystkie dane użytkownika powinny zostać usunięte zgodnie z polityką retencji.

Jeżeli jakiś rodzaj danych pozostaje, wskaż:

```text
DATA REMAINS:
WHY:
HOW TO FIX:
```

---

# 16. Firebase Security final test

Spróbuj logicznie zasymulować:

```text
User A
↓
request data from User B
```

oraz:

```text
User A
↓
modify User B data
```

oraz:

```text
User A
↓
delete User B data
```

Wszystkie powinny być:

```text
DENIED
```

---

# 17. Backend security

Przetestuj wszystkie endpointy.

Dla każdego sprawdź:

* authentication,
* authorization,
* validation,
* rate limit,
* CORS,
* request size,
* error handling.

Spróbuj wysłać:

```text
empty request
invalid JSON
huge request
invalid userId
another user's userId
missing authentication
expired authentication
```

Nie może to powodować wycieku danych.

---

# 18. Secrets scan

Przeszukaj cały projekt:

```text
API_KEY
SECRET
TOKEN
PASSWORD
PRIVATE_KEY
CLIENT_SECRET
ACCESS_TOKEN
REFRESH_TOKEN
AIza
sk-
ghp_
github_pat_
```

Sprawdź również:

```text
.env
.env.local
.env.production
```

Nie może być żadnego prawdziwego sekretu w paczce rozszerzenia.

---

# 19. Remote code final scan

Znajdź:

```text
eval(
new Function(
unsafe-eval
```

oraz wszystkie dynamiczne źródła JavaScript.

Sprawdź każdy wynik.

---

# 20. Network audit

Znajdź wszystkie:

```text
fetch(
XMLHttpRequest
WebSocket
http://
https://
```

Utwórz tabelę:

| Endpoint | Cel | Dane | Authentication | HTTPS | Konieczny |
| -------- | --- | ---- | -------------- | ----- | --------- |

Nie może być nieuzasadnionych endpointów.

---

# 21. Production build

Uruchom rzeczywiste komendy projektu.

Najpierw sprawdź `package.json`.

Następnie uruchom odpowiednie:

```text
npm install
npm run lint
npm run build
```

Jeżeli istnieją:

```text
npm test
npm run test
npm run typecheck
```

również je uruchom.

Nie wymyślaj komend, których projekt nie posiada.

---

# 22. Build output

Sprawdź końcowy katalog produkcyjny.

Nie powinno tam być:

```text
node_modules
.git
.env
.env.local
source maps z sekretami
test files
development files
```

Sprawdź, czy wszystkie wymagane:

```text
JS
HTML
CSS
icons
fonts
assets
manifest.json
```

są obecne.

---

# 23. Manifest validation

Załaduj produkcyjny build przez:

```text
chrome://extensions
```

włącz:

```text
Developer mode
```

następnie:

```text
Load unpacked
```

Sprawdź:

* błędy manifestu,
* błędy service workera,
* błędy content scriptów,
* błędy CSP,
* błędy permissions.

---

# 24. Clean installation

Przetestuj od zera:

```text
Chrome
↓
Install extension
↓
Login
↓
Use extension
↓
Logout
↓
Uninstall
↓
Reinstall
```

Sprawdź, czy po reinstall:

* stare dane nie powodują błędów,
* login działa,
* settings działają,
* extension działa normalnie.

---

# 25. Chrome Web Store Store Listing

Przygotuj finalne:

## Name

Nazwa rozszerzenia.

## Short description

Krótki opis.

## Detailed description

Pełny opis.

## Category

Najbardziej odpowiednia kategoria.

## Language

Język.

## Website

Strona produktu.

## Support URL

Strona support.

## Privacy Policy URL

Strona Privacy Policy.

---

# 26. Store description

Opis musi dokładnie odpowiadać rzeczywistej funkcjonalności.

Nie używaj:

```text
#1
Best
Official
Guaranteed
Perfect
```

jeżeli nie możesz tego udowodnić.

Nie sugeruj oficjalnego związku z:

* Google,
* Chrome,
* YouTube,
* Netflix,
* Gemini.

---

# 27. Permissions justification

Przygotuj finalne uzasadnienie każdego permission.

Format:

```text
Permission:
Why Lectoro needs it:
Where it is used:
Why a less powerful permission is not sufficient:
```

Każde uzasadnienie powinno być krótkie i konkretne.

---

# 28. Privacy disclosure

Przygotuj finalne odpowiedzi do sekcji Privacy w Chrome Web Store.

Dla każdej kategorii danych określ:

* czy jest zbierana,
* czy jest przechowywana,
* czy jest używana do funkcjonalności,
* czy jest przekazywana osobom trzecim.

Nie zaznaczaj niczego, czego nie potwierdza kod.

---

# 29. Single Purpose

Przygotuj jedno jasne zdanie:

> Lectoro helps users learn languages from web content by providing contextual translations, explanations, subtitles and vocabulary-learning features.

Jeżeli po audycie lepsze jest inne sformułowanie, zaproponuj je.

---

# 30. Screenshots

Przygotuj listę screenshotów potrzebnych do Chrome Web Store.

Powinny pokazywać rzeczywistą funkcjonalność:

1. główny interfejs,
2. tłumaczenie zaznaczonego tekstu,
3. naukę słówek,
4. funkcję napisów,
5. AI,
6. integrację z obsługiwanymi stronami.

Nie twórz fałszywych screenshotów.

---

# 31. Ikony

Sprawdź:

* 16×16,
* 32×32,
* 48×48,
* 128×128,

jeżeli są wymagane przez manifest.

Sprawdź również ikonę dla Chrome Web Store.

---

# 32. Versioning

Sprawdź:

```json
"version": "..."
```

Upewnij się, że:

* wersja jest poprawna,
* nie zawiera niedozwolonych znaków,
* odpowiada wersji produkcyjnej,
* nie została już opublikowana, jeżeli jest to nowy upload.

Nie zmieniaj numeru wersji bez powodu.

---

# 33. Final package

Przygotuj dokładnie, co powinno znaleźć się w ZIP:

```text
lectorо/
├── manifest.json
├── background.js
├── content scripts
├── popup
├── shared
├── icons
└── assets
```

Nie umieszczaj:

```text
.env
node_modules
.git
test credentials
development files
private keys
```

---

# 34. Final automated checklist

Przygotuj checklistę:

```text
[ ] Manifest V3
[ ] Minimal permissions
[ ] Host permissions reviewed
[ ] No remote code
[ ] No exposed secrets
[ ] HTTPS
[ ] Firebase rules secure
[ ] Backend authentication
[ ] Backend authorization
[ ] R2 secure
[ ] Account deletion
[ ] Local data deletion
[ ] Privacy Policy matches code
[ ] Terms match product
[ ] Store description matches product
[ ] YouTube reviewed
[ ] Netflix reviewed
[ ] AI reviewed
[ ] Translation reviewed
[ ] Authentication tested
[ ] Build successful
[ ] Lint successful
[ ] Extension loads
[ ] Service worker works
[ ] Clean installation works
[ ] ZIP contains only production files
```

---

# 35. Final risk assessment

Na końcu wystaw ocenę:

## 🟢 READY

Można przygotować submission.

## 🟠 READY WITH RISKS

Można wysłać, ale istnieją konkretne ryzyka.

## 🔴 NOT READY

Nie wysyłać jeszcze.

Jeżeli wynik jest 🟠 lub 🔴, podaj dokładnie:

```text
1. Problem
2. Ryzyko
3. Dlaczego
4. Co trzeba zrobić
5. Plik
6. Linia
```

---

# 36. Najważniejsze

Nie gwarantuj akceptacji przez Google.

Celem jest:

> maksymalnie dobrze przygotować Lectoro do rzeczywistego Chrome Web Store review.

Jeżeli jakaś funkcja jest potencjalnie problematyczna, szczególnie:

* Netflix,
* YouTube,
* szerokie host permissions,
* przetwarzanie treści stron,
* AI,
* screenshoty,

nie ukrywaj jej.

Oznacz ją jako:

🔴 REVIEW RISK

i wyjaśnij dokładnie dlaczego.

---

# 37. FINALNA ODPOWIEDŹ

Na samym końcu odpowiedzi przedstaw tylko:

## STATUS

🟢 READY / 🟠 READY WITH RISKS / 🔴 NOT READY

## 3 NAJWAŻNIEJSZE RZECZY

1.
2.
3.

## CZY MOŻNA WYSŁAĆ DO CHROME WEB STORE?

TAK / NIE

## CO ZROBIĆ PRZED SUBMISSION?

Krótka lista ostatnich kroków.

Jeżeli wszystko jest gotowe, podaj dokładną kolejność:

```text
1. npm run build
2. przygotować production ZIP
3. wejść do Chrome Web Store Developer Dashboard
4. utworzyć draft
5. upload ZIP
6. uzupełnić Store Listing
7. uzupełnić Privacy
8. sprawdzić Permissions
9. sprawdzić Preview
10. Submit for review
```

Nie twórz nowych funkcji na tym etapie. To jest **FINALNY AUDYT I PRZYGOTOWANIE DO PUBLIKACJI**.
