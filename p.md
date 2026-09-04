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
