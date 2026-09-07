Jesteś Principal Chrome Extension Architectem (Google CWS Compliance & Manifest V3 Specialist) oraz Lead Refactoring Engineerem. Twoim zadaniem jest gruntowny, bezstratny refaktoring i uporządkowanie całego repozytorium wtyczki Chrome „LectoroAI”.

CEL PROJEKTU:
Doprowadzenie kodu do stanu wzorcowej czytelności, modułowości, pełnej zgodności z zasadami DRY (Don't Repeat Yourself), SSOT (Single Source of Truth), bez martwego kodu i powtórzeń, przy ZACHOWANIU 100% DOTYCHCZASOWEJ FUNKCJONALNOŚCI dla użytkownika końcowego. Dopuszczalne są jedynie mikro-korekty UI/UX w celu unifikacji tokenów wizualnych i komponentyzacji.

ŻELAZNE ZASADY BEZPIECZEŃSTWA I INTEGRALNOŚCI (ZERO-REGRESSION GUARDRAILS)

1. ZERO TRUNCATION: Pod żadnym pozorem nie skracaj plików komentarzami w stylu "// ... rest of code remains unchanged ...". Każda edycja musi być kompletna, precyzyjna i działająca.
2. ZERO REGRESJI FUNKCJONALNEJ:
   - Nie zmieniaj nazw akcji wiadomości (`LectoroConstants.MESSAGE_TYPES` lub `action: "..."`).
   - Nie usuwaj ani nie zmieniaj kluczy w `chrome.storage.local` i `chrome.storage.sync` (zachowaj wsteczną kompatybilność bazy słówek, postępów SRS i ustawień).
   - Nie usuwaj atrybutów i ID wstrzykiwanych elementów DOM, na których polegają selektory JS (`#__qt_icon`, `#__qt_tooltip`, klasy overlay napisów itp.).
   - Nie zmieniaj kontraktów API publicznych obiektów (np. `window.QT`, metod adapterów wideo).
3. MANIFEST V3 & SERVICE WORKER SAFETY:
   - `background.js` to Service Worker – nie polegaj na ulotnym stanie w pamięci RAM; stan musi pochodzić z `chrome.storage` lub być synchronizowany transakcyjnie.
   - W listenerach `chrome.runtime.onMessage` upewnij się, że funkcje asynchroniczne zwracają `true`, zapobiegając błędowi "The message port closed before a response was received".
4. BEZPIECZEŃSTWO DOM & IZOLACJA CSS:
   - Skrypty `content.js` i `video/subtitle-overlay.js` działają na stronach obcych (YouTube, Netflix, dowolne www). Wszelkie wstrzykiwane style MUSZĄ być ściśle odizolowane (np. prefiks `__qt_` lub Shadow DOM), aby style hosta nie niszczyły UI wtyczki, a UI wtyczki nie psuło strony użytkownika.
   - Mosty MAIN-world (`netflix-player-bridge.js`, `youtube-player-bridge.js`) nie mają dostępu do API rozszerzenia – ich komunikacja z ISOLATED-world (`window.postMessage` / `CustomEvent`) musi pozostać nienaruszona.
5. CWS & CSP STRICT COMPLIANCE:
   - Żadnego `eval()`, żadnego `new Function()`, żadnego ładowania kodu z zewnętrznych serwerów CDN.
   - Wszelkie dynamiczne szablony HTML muszą być bezpiecznie escapowane (`SharedUtils.escapeHtml`).

PROTOKÓŁ ZARZĄDZANIA STANEM: PLIK `change.md`

Przed rozpoczęciem jakichkolwiek modyfikacji kodu w projekcie, Twoim PIERWSZYM KROKIEM jest utworzenie lub zaktualizowanie pliku `change.md` w głównym katalogu repozytorium.
Plik `change.md` ma pełnić rolę nadrzędnego dziennika audytu i postępu prac.

Wymogi dotyczące `change.md`:

- Każdy podetap musi mieć checkbox: `[ ]` (niezrobione) lub `[x]` (ukończone i przetestowane).
- Pod każdym ukończonym punktem należy dopisać zwięzły log: zmodyfikowane pliki, usunięty martwy kod, wyeliminowane duplikacje oraz wynik weryfikacji.
- Checkbox `[x]` może zostać zaznaczony DOPIERO PO faktycznym zrealizowaniu i sprawdzeniu danego fragmentu kodu. Nigdy nie zaznaczaj zadań "na zapas".

sprawdz i dokończ w wzorcowej czytelności [change.md](file;file:///c%3A/Users/FS/Documents/GitHub/Lectoro/change.md)

Jesteś ekspertem od Chrome Extensions, Manifest V3 oraz zasad Chrome Web Store.

Przeanalizuj całe repozytorium tej wtyczki Chrome:

## WAŻNE

unowoczesnijmy funkcje "Enter" na video
jak klikne Enter wszystko w animacji tak jak teraz jest powiekszajace sie dymki oraz qtAiShimmer. maja sie pokazywac osobno kazde idiomy trudne slowa do wyjasnienia po kolei nie na raz a nastepne slowa / idiomy w kolejce maja miec lekki bg fioletowego zeby bylo wiadomo co nastepne, które beda tlumaczone. wszystko ma miec Piekny UI/UX spojny z qtAiShimmer fajnie by bylo jakby raz po borderze kolory z przeszly jak teraz jest modne w AI oczywiscie wyjasnienia TTS ma czytac tak aby nauka jezyka obcego byla przyjemna i konkretna. strzalkami w bok przechodz do nastepnego slowa / idiumy/ frazy zeby nie czekac na to co chce uslyszec, sam dymek ma byc z tych CSS co juz mam

Nie przepisuj całego projektu i nie wykonuj zmian w ciemno.
pamietaj o zasadzie (Zasada DRY - Don't Repeat Yourself) oraz Centralizacja Logiki (Single Source of Truth)

Jesteś ekspertem Software Engineer

Jesteś ekspertem Full-Stack JavaScript Developer

Jesteś ekspertem od Chrome Extensions, Manifest V3 oraz UI/UX

## WAŻNE

w finkcji "Enter" niech jak bedzie 4/4 to zeby chmurka nei znikala i nie wznawiala filmu oraz w trybie simple language tlumaczenia AI to meaning tlumaczenie tez ma byc czytanie przez TTS

pamietaj o zasadzie (Zasada DRY - Don't Repeat Yourself) oraz Centralizacja Logiki (Single Source of Truth)
i wskarz co trzeba przepisac aby uczytelnic kod aby zeby funkcjonalnosci zostaly takie same sprawdz rowniez css czy nie ma martwych klass i w kodzie czy nie ma martwego kodu lub starych nie uzywanych funkcji







Jesteś ekspertem Full-Stack JavaScript Developer

zamiast uzywac niestabilnego nieoficialnego tlumaczenia
translate.googleapis.com/translate_a/single

chociaz zostaw go dla uzytkownikow niezalogowanych i dla tych co skoncza im sie tokeny AI

zrob lekkie zapytania do gemini 2.5 lite

design ma wygladac zamiast szarych napisow pod orginalnymi napisami ma sie pojawiac chmurka nad napisami jak
Translation unavailable
Translation service is busy. Please try again shortly.
Try again

a kiedy sie laduje to showAiShimmer ✨ Analyzing…

lekki prompt cos w stylu:

Przetłumacz poniższy tekst (native lang ustawiony w ustawieniach) Zwróć wyłącznie przetłumaczony tekst, bez żadnego wstępu, podsumowania ani komentarzy

temperature = 0

wymysl jeszcze jakis sposob zeby klucz api byl bezpieczny ale jak tysiace uzytkownikow bedzie korzystac z tej wtyczki do chrome zeby mnie nie bolalo finansowo oplacac kazde polaczenie do firebase cloud itp

i jesli ktos zaloguje sie wykorzysta tokeny AI to moze usunac konto i zalogowac sie ponownie i ma spowrotem 10 tokenow AI








Jesteś Principal Full-Stack JavaScript Developerem oraz architektem Google Chrome Extensions (Manifest V3). Twoim zadaniem jest zmodernizowanie modułu tłumaczenia napisów wideo oraz zintegrowanie lekkiego, bezpiecznego tłumaczenia AI za pomocą modelu Gemini 2.5 Flash Lite z automatycznym fallbackiem i nowym UI chmurki nad napisami.

mam zainstalowane globalnie:
npx modern-web-guidance@latest

Projekt: Rozszerzenie Chrome „Lectoro” (JavaScript ES6+, Manifest V3, Firebase Functions / Cloud Run).

### 1. CEL ZMIANY
1. Zastąpić dotychczasowe szare napisy pojawiające się pod oryginalnymi napisami (`showSubtitleTranslationUnderOriginal`) nowoczesną pływającą chmurką („tooltip/bubble”) wyświetlaną NAD napisami.
2. Wdrożyć hybrydowy mechanizm tłumaczenia (Smart Hybrid Translation):
   - **Użytkownicy zalogowani z dostępnymi tokenami AI**: szybkie tłumaczenie przez model `gemini-2.5-flash-lite` (temperature = 0).
   - **Użytkownicy niezalogowani LUB użytkownicy, którym skończył się limit AI (np. 10/10 w planie FREE)**: bezstratny, przezroczysty fallback do standardowego tłumacza Google Translate (`translate.googleapis.com/translate_a/single`).
   - W przypadku awarii sieci lub błędu AI: automatyczne przejście na Google Translate.
3. Wyeliminować regresje w istniejących trybach (skrót E, tryb Enter, Word Clouds) i zachować zgodność z `change.md` oraz regułami DRY/SSOT.

---

### 2. ARCHITEKTURA I KONTRAKT BACKENDU (`functions/index.js`)

1. **Zabezpieczenie klucza i optymalizacja kosztów**:
   - Klucz `LECTORO_GEMINI_API_KEY` pozostaje wyłącznie w Google Secret Manager / Cloud Functions.
   - Nowy lekki endpoint/akcja w `functions/index.js` (wewnątrz `geminiProxy`):
     - `action: "translateText"`
     - Wejście: `{ action: "translateText", text: string, targetLang: string }`
     - Nagłówek: `Authorization: Bearer <idToken>`
     - Weryfikacja limitu AI: atomowa transakcja Firestore (`checkAiLimit`) zużywająca 1 token AI z miesięcznej puli użytkownika.
   - Parametry wywołania Gemini 2.5 Flash Lite:
     - Model: `gemini-2.5-flash-lite:generateContent`
     - GenerationConfig:
       - `temperature: 0.0` (deterministyczne, najszybsze tłumaczenie)
       - `maxOutputTokens: 150` (ochrona przed przegadaniem i kosztami)
       - `responseMimeType: "text/plain"` (bez narzutu parsowania JSON)
     - Lekki Prompt systemowy/użytkownika:
       `"Translate the following subtitle text directly into target language [TARGET_LANG_NAME] ([TARGET_LANG_CODE]). Return ONLY the translated text, without any explanation, markdown, notes, or quotation marks.\n\nText:\n[TEXT]"`
   - Odpowiedź: `{ ok: true, text: string, usage: { plan, used, limit, remaining } }`.

2. **Polityka usuwania konta i resetowania tokenów**:
   - Zachowaj istniejącą implementację `action: "deleteUserAccount"`. Po usunięciu konta usuwany jest dokument profilu w Firestore oraz użytkownik z Firebase Auth.
   - Gdy użytkownik zarejestruje się ponownie, otrzymuje nowy dokument z pulą 10 darmowych tokenów AI. To zamierzone działanie (koszt 10 tokenów Gemini 2.5 Flash Lite to < 0,0001 $, a utrata fiszek SRS zniechęca do skrajnych nadużyć).

---

### 3. LOGIKA PO STRONIE KLIENTA (`shared/`)

1. **`shared/translator-service.js` & `shared/subtitle-translation-service.js`**:
   - Stwórz zunifikowaną metodę orkiestracji tłumaczenia (np. `translateSubtitleHybrid(text, targetLang)`):
     1. Sprawdź lokalny cache (`transportCache`). Jeśli tłumaczenie już istnieje – zwróć natychmiast z cache.
     2. Sprawdź stan autoryzacji (`FirebaseSync.getUser()`) oraz limit AI (`SubscriptionConfig.checkAiLimit` / `aiUsageCache`).
     3. Jeśli użytkownik jest zalogowany i ma `remaining > 0`:
        - Wyślij zapytanie do `GeminiProxy` (`action: "translateText"`).
        - Zaktualizuj stan zużycia tokenów w UI.
     4. Jeśli użytkownik jest niezalogowany, limit wynosi 0 lub zapytanie do Gemini zwróciło błąd limitu/sieci:
        - Wykonaj fallback do `googleTranslate(text, targetLang)` z `translate.googleapis.com`.
     5. Zapisz wynik w `transportCache` (`chrome.storage.local`).

---

### 4. UI/UX: NOWOCZESNA CHMURKA NAD NAPISAMI (`video/subtitle-overlay.js`)

1. **Usunięcie szarych napisów pod spodem**:
   - W trybie tłumaczenia napisów (skrót `E` / `doSentenceTranslation`) wyłącz wstawianie elementu pod oryginalne napisy (`showSubtitleTranslationUnderOriginal` / szary kolor `#cbd5e1`).
   - Całość tłumaczenia ma być renderowana w pływającej chmurce `applyAiExplanation` / `translationOverlay` pozycjonowanej **nad oryginalnymi napisami** za pomocą istniejącej funkcji `positionOverlay()`.

2. **Stan Ładowania (Shimmer)**:
   - Zanim nadejdzie odpowiedź z AI / Google Translate, natychmiast pokaż loader:
     `showAiShimmer(layout)` wyświetlający etykietę: `✨ Analyzing…` z płynną animacją shimmer.

3. **Stan Sukcesu**:
   - Po otrzymaniu tłumaczenia zamień zawartość chmurki na przetłumaczony tekst.
   - Wygląd spójny z motywem Lectoro: nowoczesny ciemny dymek ze szklanym efektem (glassmorphism/blur), zaokrąglone rogi, elegancka typografia.
   - Opcjonalny subtelny wskaźnik źródła (np. mikro-odznaka `✨ AI` przy tłumaczeniu z Gemini lub `🌐` przy darmowym fallbacku).
   - Kliknięcie w chmurkę lub przycisk odsłuchu uruchamia wymowę TTS (`SharedTtsService`).

4. **Stan Błędu (Zgodny z makietą)**:
   - W przypadku niepowodzenia (np. brak sieci, błąd obu serwisów) wyświetl w chmurce dokładnie taki układ:
     ```html
     <div class="__qt_header">Translation unavailable</div>
     <div class="__qt_body">
         <div class="__qt_ai-text">Translation service is busy. Please try again shortly.</div>
     </div>
     <div class="__qt_save-footer">
         <button type="button" class="__qt_save-word-btn">Try again</button>
     </div>
     ```
   - Przycisk `Try again` ma ponawiać tłumaczenie bieżącej kwestii.

---

### 5. ZASADY IMPLEMENTACJI I BEZPIECZEŃSTWA (ZERO REGRESSION)
1. **Brak regresji w skrótach wideo**: Klawisze `Enter`, `E`, pauza/wznowienie wideo oraz zamykanie dymków klawiszem `Escape` lub kliknięciem w tło muszą działać bez zakłóceń.
2. **Service Worker MV3**: Pamiętaj, aby listenery `chrome.runtime.onMessage` w `background.js` zwracały `true` dla operacji asynchronicznych.
3. **Logowanie zmian**: Przed przystąpieniem do edycji kodu zaktualizuj dziennik prac w `change.md`.
