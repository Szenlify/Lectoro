# Plan napisów Lectoro do nauki języków

Data audytu: 13.09.2026. Dokument opisuje plan wdrożenia. Zaznaczone pola dotyczą wyłącznie wykonanej analizy i istniejących mechanizmów potwierdzonych w kodzie; nie oznaczają, że docelowe napisy są już gotowe.

Legenda: `[ ]` — do wykonania, `[x]` — wykonane i sprawdzone. Etap można zaznaczyć jako zakończony dopiero po wykonaniu jego zadań i spełnieniu warunku odbioru. Testy powstają razem z odpowiednimi zmianami; etap testów na końcu zbiera weryfikację całego przepływu.

## Postęp etapów

- [x] 00. Audyt punktu wyjścia.
- [ ] 01. Kontrakt jakości i materiał odbiorowy.
- [ ] 02. Prototyp darmowego tłumaczenia lokalnego.
- [ ] 03. Wspólny model danych.
- [ ] 04. Dobór napisów źródłowych i ścieżek.
- [ ] 05. Normalizacja tekstu i czasu.
- [ ] 06. Podział na naturalne frazy.
- [ ] 07. Zgodność tłumaczenia z każdą frazą.
- [ ] 08. Wspólny zegar filmu i obu wierszy.
- [ ] 09. Jeden wiersz na język i pionowy suwak.
- [ ] 10. Przygotowanie i stany gotowości.
- [ ] 11. Darmowe narzędzia nauki z napisów.
- [ ] 12. Wydajność, modele i dystrybucja na dużą skalę.
- [ ] 13. Testy automatyczne całego kontraktu.
- [ ] 14. Ręczny odbiór języka, czasu i wydajności.
- [ ] 15. Stopniowe wdrożenie i utrzymanie.

## Efekt dla użytkownika

W trybie pojedynczym jest **jeden fizyczny wiersz w języku nauki**. W trybie podwójnym są **dokładnie dwa fizyczne wiersze: jeden w języku nauki i jeden z jego tłumaczeniem pod spodem**. Oba należą do tej samej wypowiedzi, pojawiają się i znikają razem. Dotychczasowy pionowy suwak położenia zostaje i przesuwa cały blok.

Napisy mają zachowywać treść wypowiedzi, naturalne granice fraz, czytelność i zgodność z filmem. Nie wystarczy umieścić dwóch niezależnych ścieżek jedna pod drugą. Dolny wiersz musi tłumaczyć dokładnie zakres znaczeniowy widoczny u góry — bez dopowiadania kolejnego fragmentu ani pomijania obecnego.

**Docelowa architektura:** napisy źródłowe dostępne w odtwarzaczu → oczyszczenie z zachowaniem czasów → naturalne jednostki wypowiedzi → odpowiadające im tłumaczenia → wspólne dopasowanie do szerokości → jeden harmonogram obu wierszy sterowany czasem filmu. Źródłem tłumaczenia może być sprawdzona para napisów wydawcy albo darmowy model działający lokalnie na urządzeniu użytkownika.

**Granice obietnicy:** nie można uczciwie zagwarantować bezbłędnego tłumaczenia każdego filmu, każdego języka i każdego błędnego ASR. Nie zawsze da się też zmieścić nierozdzielną frazę w jednym wierszu przy dowolnie małym oknie i dużej czcionce. Gwarantujemy kontrolowane zachowanie programu; jakość językową i zgodność z nagraniem potwierdzamy na materiale testowym. Niepewny lub niedostępny drugi język ma otrzymać jawny stan, a nie przypadkowe tłumaczenie. Taki przypadek nie spełnia warunku pełnych napisów podwójnych.

**Zasada kosztów:** bez płatnych API, Gemini, Google Translate, automatycznego tłumaczenia YouTube przez `tlang`, obejść limitów ani darmowych publicznych serwerów tłumaczeń jako podstawy działania. Lokalny model otwarty nie wymaga opłat za znaki lub minuty, ale wykorzystuje komputer użytkownika. Dystrybucja modeli, utrzymanie i testowanie mogą mieć koszty; „bez opłat za tłumaczenie” nie oznacza zerowego kosztu całego projektu. Funkcja napisów ma być bezpłatna także przy codziennym oglądaniu przez tysiące osób.

## Etap 00 — audyt punktu wyjścia

- [x] Przeczytano kod napisów, odpowiednie testy oraz [GUIDE.md](../GUIDE.md).
- [x] Potwierdzono parsowanie JSON3, WebVTT, TTML i SRT w [subtitle-service.js](../shared/subtitle-service.js).
- [x] Potwierdzono przypisywanie dolnego tekstu do aktualnego obiektu kwestii i usuwanie nieaktualnego tłumaczenia w [subtitle-overlay.js](../video/subtitle-overlay.js).
- [x] Potwierdzono pionowe przeciąganie i zapis `subtitlePosition`; istniejący test obejmuje ruch tylko po osi Y.
- [x] Uruchomiono sześć plików testów napisów: **49/49 PASS**, bez pominiętych testów. Polecenie znajduje się w etapie 13. To testy Node/VM, nie pomiar synchronizacji prawdziwego filmu ani fizycznego układu tekstu.
- [x] Zidentyfikowano rozbieżności między obecnym kodem a oczekiwanym efektem:

| Obszar | Stan faktyczny | Co trzeba zmienić |
| --- | --- | --- |
| Dopasowanie języków | `alignSlaveTrackToMaster()` przypisuje cały dolny fragment do górnego o największym dodatnim nakładaniu czasów. | Sprawdzać zakres wypowiedzi; sam czas nie potwierdza znaczenia. |
| Dowód błędnego kontraktu | Test dla `He walked into` / `the room quietly.` oczekuje pustego tłumaczenia przy pierwszym fragmencie i `Wszedł cicho do pokoju.` przy drugim. | Oba fragmenty przygotować jako poprawne jednostki dwujęzyczne; dotychczasowy wynik ma stać się przypadkiem odrzucanym. |
| YouTube | Drugi język powstaje przez `tlang`; górne kwestie zachowują podział wejściowy. | Usunąć automatyczne tłumaczenie platformy z tego przepływu; wybierać istniejącą ścieżkę autora albo tłumaczyć lokalnie. |
| Netflix | Rekonstrukcja górnych zdań jest włączana tylko przy `doubleSubtitles`. | Ujednolicić reguły segmentacji; przełączenie trybu nie może przestawiać aktualnej wypowiedzi. |
| Rekonstrukcja | Są progi słów/znaków, zaokrąglenie czasu oraz minimum 0,8 s; komentarz o pauzie 1,4 s nie odpowiada progowi 0,65 s w kodzie. | Zachować rzeczywiste czasy i wprowadzić jawne, testowane reguły granic. |
| Gotowość | W adapterach wystarczy co najmniej jedno niepuste tłumaczenie, aby ogłosić `ready`. | Gotowość i pokrycie sprawdzać dla każdej jednostki oraz przygotowanego zakresu filmu. |
| Jeden wiersz | W dual tekst trafia do jednego elementu, ale CSS pozwala zawijać; single może zachować kilka elementów. | Mierzyć rzeczywistą szerokość i liczbę linii w przeglądarce. |
| Zegar | YouTube używa pętli RAF; Netflix opiera aktualizacje m.in. na zdarzeniach odtwarzacza. | Wspólny kontrakt zegara klatki i obsługi przewijania. |
| Dawna usługa | Worker nadal ładuje `SharedSubtitleTranslationService` z limitami i delegowaniem do wspólnego translatora. | Uniemożliwić wykorzystanie tej ścieżki przez darmowe napisy; zależności innych funkcji sprawdzić przed usuwaniem. |
| Interakcje edukacyjne | Hover i Enter mają połączenia ze słownikiem/backendem i Gemini. | Darmowa ścieżka nauki z napisów nie może uruchamiać płatnego generowania w tle. |

**Odbiór:** audyt zapisany; dalsze etapy pozostają do realizacji. Zielone dotychczasowe testy nie potwierdzają docelowej jakości.

## Etap 01 — ustalenie kontraktu jakości i materiału odbiorowego

- [ ] Zdefiniować `cue` jako fragment ścieżki wejściowej, `utterance` jako wypowiedź, a `displayUnit` jako jedną parę tekstów wyświetlaną wspólnie. Pełne zdanie nie musi mieścić się w jednej jednostce.
- [ ] Ustalić zasadę nadrzędną: żadnego dodawania, gubienia ani przestawiania wypowiedzianej treści w celu uzyskania krótszego wiersza.
- [ ] Rozdzielić trzy niezależne oceny: poprawność tekstu względem nagrania, poprawność tłumaczenia względem górnego tekstu oraz poprawność wyświetlania względem czasu filmu.
- [ ] Zdefiniować macierz pierwszego wydania: YouTube VOD i Netflix VOD na komputerowym Chrome; TED i odtwarzacze ogólne dopiero po przejściu tych samych kryteriów. Live, brak napisów i natywny Picture-in-Picture nie otrzymują automatycznie obietnic wersji VOD.
- [ ] Zdefiniować sprawdzane pary językowe i oba kierunki osobno; EN→PL jako pierwszy przekrój testowy, bez zaszywania go jako domyślnego języka w kodzie.
- [ ] Przygotować minimum 500 ręcznie ocenionych jednostek z co najmniej 20 zróżnicowanych fragmentów filmów dla pierwszej pary językowej. Dalsze pary przechodzą własną ocenę.
- [ ] Uwzględnić dialog, wykład, slang, negację, idiomy, liczby, nazwy, szybką mowę, pauzy, dwie osoby, muzykę, napisy autora i ASR.
- [ ] Zapisać oczekiwane teksty, granice wypowiedzi, czasy i dopuszczalne warianty tłumaczeń; oddzielić zbiór używany przy poprawkach od zbioru końcowego odbioru.
- [ ] Przygotować przykłady autorskie lub materiał z odpowiednim prawem do wykorzystania w repozytorium; do ręcznej oceny materiałów platformowych wystarczą identyfikatory i znaczniki czasu.

**Odbiór:** wymagania są mierzalne; wiadomo, dla jakich platform, języków i urządzeń można deklarować ukończenie.

## Etap 02 — sprawdzenie darmowego tłumaczenia lokalnego przed dużą przebudową

- [ ] Zbudować mały prototyp silnika **Bergamot/Marian w WebAssembly** w rzeczywistym rozszerzeniu MV3. To kandydat do sprawdzenia, nie zatwierdzona zależność ani już działająca funkcja.
- [ ] Dobrać konkretny model do pierwszej pary językowej; sprawdzić kierunek, wersję, licencję wag, słownika/tokenizera, kompatybilność z silnikiem oraz możliwość dystrybucji. Nie zakładać, że dowolny model Marian lub ONNX można wczytać do Bergamota.
- [ ] Zapisać wyniki w tabeli: para → model i hash → licencje → rozmiar pobrania → RAM → czas pierwszego uruchomienia → szybkość tłumaczenia → wynik oceny językowej.
- [ ] Preferować model bezpośredni. Tłumaczenie przez język pośredni dopuścić dopiero po osobnych testach jakości, opóźnienia i pamięci; nie traktować go jako gwarancji obsługi wszystkich par.
- [ ] Zmierzyć działanie na słabszym laptopie i typowym komputerze, przy równoczesnym odtwarzaniu filmu oraz kilku otwartych kartach.
- [ ] Sprawdzić idiomy, krótkie odpowiedzi i negację; poprawna identyfikacja jednostki nie oznacza poprawnego wyniku modelu.
- [ ] Ustalić listę obsługiwanych par dopiero na podstawie prototypu. Brak modelu lub zbyt słaba jakość oznacza niedostępność lokalnego tłumaczenia tej pary.
- [ ] Zaplanować darmowy import gotowych SRT/VTT oraz lokalnego pakietu modelu jako opcje dla braku ścieżki lub niedostępnego pobierania.
- [ ] Nie dodawać zastępstwa przez Google Translate, Chrome Translator API, Gemini, `tlang`, bezpłatny limit płatnej usługi ani publiczną instancję LibreTranslate. Własny serwer tłumaczeń także nie spełnia założenia braku kosztu obliczeń rosnącego z oglądaniem.
- [ ] Jeśli prototyp nie spełni kryteriów, oprzeć pierwsze wydanie na dostępnych, zweryfikowanych parach napisów i imporcie; pozostawić pełne pokrycie pozostałych materiałów jako niespełniony warunek. Nie maskować tego obietnicą „idealne napisy wszędzie”.

Bergamot udostępnia silnik i interfejs WASM do tłumaczenia w przeglądarce. Repozytorium Mozilla opisuje modele używane przez Firefox Translations oraz ich licencjonowanie; nie jest to dowód jakości konkretnej pary w Lectoro. Źródła: [Bergamot](https://github.com/browsermt/bergamot-translator), [Mozilla Translations](https://github.com/mozilla/translations).

W katalogu modeli sprawdzonym 13.09.2026 dostępne są oba kierunki EN→PL i PL→EN ze statusem `Release`. To konkretny punkt startowy prototypu, nie dowód jakości napisów ani obietnica kompatybilności dowolnego builda silnika. Źródło: [rejestr modeli Mozilla](https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/db/models.json). Hosting plików Mozilla nie jest usługą Google Translate; sposób dystrybucji Lectoro pozostaje do sprawdzenia w etapie 12.

**Odbiór:** działający prototyp, konkretne modele i pomiary albo jawna decyzja o ograniczeniu zakresu pierwszego wydania. Dopiero wtedy ustalamy budżet pamięci i dystrybucji.

## Etap 03 — jeden model danych i jedno miejsce odpowiedzialne za reguły

- [ ] Rozbudować współdzielony system napisów zamiast powielać segmentację, parowanie i zegar w każdym adapterze.
- [ ] Zachowywać niezmienione dane wejściowe: identyfikator filmu/odcinka, ścieżki audio i napisów, język BCP 47, rodzaj ścieżki, wersję, identyfikator kwestii, tekst, początek i koniec.
- [ ] Przechowywać dostępne znaczniki słów wraz z informacją o pochodzeniu i dokładności; brak znacznika ma pozostać brakiem.
- [ ] Zdefiniować `displayUnit`: stabilne `id`, `revision`, `sourceCueIds`, zakres źródłowych tokenów, `sourceText`, `targetText`, `start`, `end`, języki, pochodzenie tłumaczenia i stan przygotowania.
- [ ] Oddzielić identyfikator jednostki od tekstu. Dwa kolejne `Yes.` to dwie różne wypowiedzi, także gdy mają identyczne tłumaczenie.
- [ ] Zachować mapę jednostka → źródłowe kwestie i słowa. Każde połączenie lub podział musi być możliwy do prześledzenia w diagnostyce.
- [ ] Wprowadzić identyfikator sesji i rewizji przygotowania zależny od filmu, audio, języków, ścieżek oraz ustawień segmentacji. Odrzucać odpowiedzi ze starszej rewizji.
- [ ] Ustalić jeden kontrakt adaptera: lista ścieżek, surowe kwestie, aktywne audio, stan CC, dostęp do zegara, zmiana filmu i sprzątanie zasobów.
- [ ] Języki brać z istniejących ustawień i metadanych; rozbieżność języka audio, ścieżki i języka nauki pokazać użytkownikowi zamiast niejawnie zgadywać.
- [ ] Nowe moduły i połączenia dopisać do mapy w `GUIDE.md` dopiero po faktycznym wdrożeniu. Nazwy struktur w tym planie nie oznaczają istniejących już plików.

**Odbiór:** każdą wyświetloną parę można jednoznacznie powiązać z jej filmem, tekstem źródłowym i czasami; adapter nie tworzy własnych reguł tłumaczenia.

## Etap 04 — właściwe napisy źródłowe i ścieżki platformowe

- [ ] Preferować napisy zgodne z faktycznie odtwarzanym audio. Przy dubbingu sprawdzać, czy napisy odpowiadają dubbingowi; sama zgodność kodu języka tego nie gwarantuje.
- [ ] Rozróżniać pełne napisy, SDH/CC, ASR i forced narrative. Krótka ścieżka forced nie zastępuje pełnych napisów dialogowych.
- [ ] W YouTube wybierać górną i dostępną dolną ścieżkę z metadanych ścieżek autora; usunąć generowanie URL z `tlang` oraz akceptowanie takiej automatycznej ścieżki jako źródła docelowego.
- [ ] W Netflix zachować pobieranie tekstowych ścieżek z bieżącej sesji i poprawną identyfikację odcinka, języka, wariantu oraz audio; nie przełączać widocznej natywnej ścieżki w pętli w celu zbierania tłumaczeń.
- [ ] Przypisać każdemu źródłu jakość i pochodzenie. Napisy autora też mogą być skrótem dialogu, a ASR może rozpoznawać słowa błędnie.
- [ ] Po zmianie audio, napisów, języka docelowego lub odcinka anulować stare pobrania i przebudować właściwy zakres. Nie mieszać ścieżek z różnych wersji filmu.
- [ ] Zachować timeout, ograniczoną liczbę ponowień i obsługę 429; jedno logiczne pobranie współdzielić między odbiorcami w tej samej sesji.
- [ ] Nie opierać obsługi na scrapowaniu widocznego DOM, gdy dostępna jest pełna ścieżka. DOM pozostaje ograniczonym trybem awaryjnym, bez obietnicy przewidywania kolejnych wypowiedzi.
- [ ] Dla plików użytkownika obsłużyć wybór języka i mapowanie do filmu. Niepasująca wersja filmu nie staje się zgodna tylko przez podobną długość pliku.
- [ ] Przy braku napisów zaoferować import lub jasny komunikat. Transkrypcja audio, OCR napisów wtopionych i obchodzenie DRM nie są podstawą tego planu; osobny lokalny ASR wymagałby własnych badań jakości i wydajności.

**Odbiór:** odtwarzany materiał ma poprawnie zidentyfikowane źródło; brak lub zła ścieżka nie prowadzi do pozornego stanu gotowości.

## Etap 05 — normalizacja bez niszczenia tekstu i czasu

- [ ] Zachować oryginalne czasy; konwersje jednostek wykonywać w jednym miejscu. Nie zaokrąglać przedwcześnie granic ani domyślnie wydłużać krótkich kwestii.
- [ ] Poprawnie obsługiwać formaty platform: JSON3 i przesunięcia segmentów, WebVTT, TTML z jednostkami i parametrami zegara, SRT z przecinkiem dziesiętnym.
- [ ] Dla strumieni segmentowanych obsłużyć mapowanie czasu do osi filmu i nieciągłości. Reklama, przejście do nowego okresu albo restart live nie mogą odziedziczyć starego przesunięcia.
- [ ] Usuwać znaczniki formatowania bez utraty treści; zachować metadane mówcy, dźwięków i istotnych granic przed spłaszczeniem nowych linii.
- [ ] Rozpoznawać aktualizacje narastającego ASR na podstawie identyfikatorów, czasu i nakładania tokenów. Nie deduplikować zwykłego powtórzenia `No, no!` albo refrenu na podstawie samego tekstu.
- [ ] Zachować interpunkcję, apostrofy, diakrytykę, symbole i granice grafemów. Nie poprawiać twórczo błędnego ASR tak, jakby odczytano nagranie.
- [ ] Obsłużyć skróty, liczby dziesiętne i języki bez spacji. `Intl.Segmenter`, jeśli dostępny, może pomagać w tokenizacji; nie traktować go jako analizatora sensu zdania.
- [ ] Walidować niepoprawne lub brakujące czasy, zera, ujemne długości, kolejność i nakładające się kwestie. Błędy danych rejestrować lokalnie i nie naprawiać ich niewidocznym zgadywaniem.
- [ ] Zachować ciszę między wypowiedziami jako ciszę. Nie przedłużać zakończonej jednostki poprzednim napisem tylko po to, aby interfejs był stale zajęty; krótką pauzę wewnątrz świadomie scalonej frazy oceniać w regułach etapu 06.

WebVTT jest formatem tekstów związanych z czasem mediów; jego składnię i znaczniki należy obsłużyć jako dane, a nie HTML do wykonania. Źródło: [specyfikacja WebVTT](https://www.w3.org/TR/webvtt1/).

**Odbiór:** parser nie dodaje ani nie gubi słów; czasy i pochodzenie pozostają odtwarzalne po normalizacji.

## Etap 06 — naturalne frazy zamiast urywanych slajdów

- [ ] Grupować sąsiadujące kwestie w wypowiedzi z uwzględnieniem pauz, interpunkcji, mówcy i dostępnych czasów słów. Nie sklejać automatycznie wszystkiego aż do kropki.
- [ ] Rozdzielić pełną wypowiedź przechowywaną jako kontekst od krótszej jednostki widocznej na ekranie. Kontekst nie może pojawiać się w tłumaczeniu, jeśli odpowiada słowom niewidocznym u góry.
- [ ] Wyznaczać możliwe granice jednostek i oceniać je wspólnie: sens frazy, szerokość tekstu, czas czytania, pauza i zgodność obu języków. Same limity 11 słów lub 65 znaków nie wystarczą.
- [ ] Dodać reguły językowe chroniące m.in. negację z czasownikiem, czasowniki frazowe, przyimek z dopełnieniem, liczbę z jednostką, nazwy i typowe konstrukcje. Sprawdzać je na przykładach negatywnych, nie tylko słowniku wyjątków.
- [ ] Dla przykładu `bla bla I am` / `very busy bla bla` szukać granicy przed `I am very busy`, o ile pozwalają na to czasy i szerokość. Nie przepisywać początku frazy do wcześniejszego slajdu jedynie dla wyrównania długości.
- [ ] Ograniczyć łączenie przez długą pauzę, zmianę mówcy i dostępny sygnał zmiany sceny. Nie deklarować wykrywania scen, jeżeli adapter nie dostarcza takiej informacji.
- [ ] Krótką, naturalną frazę pokazywać jako całość przez jej udokumentowany czas; nie ujawniać na początku długiego zdania obejmującego kilkanaście sekund przyszłego dialogu.
- [ ] Nową granicę wewnątrz oryginalnej kwestii wyznaczać z wiarygodnych czasów słów. Gdy ich brak, użyć granicy istniejących kwestii albo zachować całość; nie dzielić czasu proporcjonalnie do liczby znaków i nie nazywać tego dokładną synchronizacją.
- [ ] Ustalić językowe profile tempa czytania i preferowanego czasu ekspozycji na podstawie testów. Przykładowy punkt startowy dla alfabetu łacińskiego: 12–17 znaków/s; to hipoteza UX, nie uniwersalna norma ani pretekst do zmiany czasu wypowiedzi.
- [ ] Gdy tekstu jest za dużo, umożliwić wolniejsze odtwarzanie lub pauzę nauki. Bez wyraźnie włączonego trybu nauki nie zatrzymywać samoczynnie filmu.
- [ ] Przy dwóch osobach mówiących jednocześnie zachować obie kwestie i oznaczenia mówców, jeśli mieszczą się w kontrakcie. Gdy się nie mieszczą i nie ma poprawnego podziału czasowego, uznać fragment za niespełniający profilu; nie usuwać jednej osoby ani sztucznie przesuwać dialogu.

**Odbiór:** brak sztucznego rozdzielenia chronionych fraz w zbiorze odbiorowym; każde wymuszone odstępstwo ma konkretną przyczynę i nie jest ukrywane.

## Etap 07 — tłumaczenie dokładnie tej treści, która jest u góry

- [ ] Zastąpić wybór „największe nakładanie czasów wygrywa” przepływem przygotowującym wspólne jednostki znaczeniowe. Dolna ścieżka nie ma własnego zegara renderowania.
- [ ] Dla gotowych ścieżek analizować kolejne grupy 1:1, 1:N i N:1; dopuszczać lukę. Kolejność, czas, mówca, liczby i nazwy pomagają znaleźć kandydatów, ale nie dowodzą zgodności znaczenia.
- [ ] Sprawdzać, czy oba teksty odnoszą się do tego samego zakresu wypowiedzi. Oficjalne tłumaczenie może skracać dialog lub inaczej grupować zdania; nie wolno przypisać całego zdania do jednej z jego części.
- [ ] Jeśli do oceny kandydatów używany jest lokalny model lub wynik wyrównania słów, skalibrować progi na ręcznie ocenionym zbiorze. Wysoki wynik podobieństwa nie może być przedstawiany jako gwarancja poprawności.
- [ ] Niepewne pary z niezależnej ścieżki zastępować lokalnym tłumaczeniem dokładnej jednostki źródłowej, jeśli model tej pary został dopuszczony; w przeciwnym razie oznaczać jako niedostępne.
- [ ] Do lokalnego tłumaczenia przekazywać pełną jednostkę znaczeniową wraz z identyfikatorem i rewizją. Wynik przypinać do tych danych, nigdy do aktualnie widocznego tekstu znalezionego po podobieństwie.
- [ ] Kontekst sąsiednich wypowiedzi wykorzystywać tylko przez sprawdzony mechanizm konkretnego modelu. Zwykły model zdaniowy nie potrafi automatycznie oddzielić „kontekstu” od tekstu do przetłumaczenia; nie sklejać kilku kwestii i nie ciąć wyniku według numeru zdania.
- [ ] Jeśli tłumaczenie całej wypowiedzi trzeba podzielić, dopuszczać tylko granice zachowujące znaczenie po obu stronach. Wyrównanie słów jest wskazówką; języki mogą mieć inną kolejność i różną liczbę słów.
- [ ] Osobno sprawdzić możliwość uzyskania mapowania tokenów z wybranego builda silnika. Obecne bindingi WASM Bergamota nie udostępniają bezpośrednio macierzy wyrównania; potrzebny byłby osobny prototyp lub własne bindingi. Podstawowy przepływ ma działać przez tłumaczenie dokładnej końcowej frazy, bez tej zależności. Źródło: [bindingi odpowiedzi WASM](https://github.com/browsermt/bergamot-translator/blob/main/wasm/bindings/response_bindings.cpp).
- [ ] Gdy bezpieczny podział przekładu nie istnieje, przegrupować źródłową frazę i przetłumaczyć ją ponownie albo pozostawić większą jednostkę. Nie dzielić dolnego tekstu proporcjonalnie do długości lub czasu górnego.
- [ ] Weryfikować obecność przekładu, język, liczby, negację, nazwy, pominięcia i dopiski. Reguły automatyczne wykrywają część błędów; ocenę znaczenia potwierdzać również ręcznie.
- [ ] Mierzyć szerokość obu tekstów, ewentualnie poprawić granice i ponowić tłumaczenie nowych jednostek. Ograniczyć liczbę prób, wykrywać cykle i kończyć jawnym stanem, gdy nie ma rozwiązania.
- [ ] Nie zamieniać poprawnego wyniku nowym w połowie wyświetlania. Gotową jednostkę zamrozić na czas jej prezentacji; opóźniony wynik zostawić do ponownego odtworzenia.
- [ ] Dla identycznego języka nauki i tłumaczenia pokazywać pojedynczy wiersz z czytelnym stanem ustawienia, zamiast kopiować tekst do dwóch wierszy.

Przykład docelowego powiązania:

| Czas, wyłącznie przykładowy | Górny wiersz | Dolny wiersz |
| --- | --- | --- |
| 10,20–11,70 | I am very busy. | Jestem bardzo zajęty. |
| 11,95–13,40 | Can we talk later? | Możemy porozmawiać później? |

W rzeczywistym nagraniu czasy i np. forma rodzaju muszą wynikać z materiału oraz kontekstu. Tabeli nie należy traktować jako uniwersalnego wzorca tłumaczenia.

**Odbiór:** każda gotowa para dotyczy tego samego fragmentu wypowiedzi; nie ma pustego pierwszego slajdu i tłumaczenia dwóch slajdów dopiero przy drugim. Poprawność wiązania danych jest warunkiem technicznym, a poprawność przekładu dodatkowym warunkiem językowym.

## Etap 08 — jeden zegar zgodny z filmem

- [ ] Użyć czasu mediów jako jedynego źródła aktywnej jednostki, z przedziałami `[start, end)`. Nie naliczać czasu napisów niezależnym licznikiem opartym na `Date.now()`.
- [ ] Wykorzystać `requestVideoFrameCallback()` i `metadata.mediaTime`, po sprawdzeniu dostępności oraz zgodności osi czasu adaptera z klatką. Dodać prosty wariant awaryjny RAF + `video.currentTime` i zdarzenia odtwarzacza.
- [ ] Oba wiersze zatwierdzać w jednej operacji renderowania z tego samego `displayUnit`. Nie utrzymywać osobnych opóźnień, timerów ani offsetów dla dołu.
- [ ] Obsłużyć pauzę, wznowienie, `seeking`, `seeked`, `ratechange`, `waiting`, `playing`, zmianę widoczności karty, `ended` i wymianę elementu wideo.
- [ ] Po przewinięciu wybierać jednostkę dla rzeczywiście osiągniętego czasu/klatki, a nie wyłącznie zadanej pozycji. Usunąć ryzyko pokazania kwestii z przyszłego miejsca podczas starej klatki.
- [ ] Na pauzie pozostawić parę właściwą dla zatrzymanej klatki; w ciszy, po końcu filmu, przy CC off i usunięciu odtwarzacza wyczyścić oba wiersze.
- [ ] Użyć indeksu uwzględniającego nakładające się przedziały. W Netflix naprawić przypadek, gdy po zakończeniu krótszego napisu nadal trwa wcześniejsza dłuższa kwestia.
- [ ] Nie zgadywać przesunięcia między niezależnymi ścieżkami na podstawie jednego dopasowania. Korektę ścieżki oprzeć na wielu potwierdzonych punktach; pojedynczy offset nie naprawia dryfu lub innego montażu filmu.
- [ ] Jeśli użytkownik koryguje czas, przesuwać całą gotową parę jednym offsetem. Ustawienie czasu ma być odrębne od zachowanego pionowego suwaka pozycji.
- [ ] Przy ukryciu karty ograniczyć pracę; po powrocie natychmiast odczytać aktualny czas i unieważnić przestarzały render. Nie obiecywać dokładności klatkowej w throttlowanej karcie tła.
- [ ] Oddzielnie mierzyć opóźnienie renderera względem znacznika oraz błąd znacznika względem mowy. Sprawny zegar nie naprawia źle przygotowanych napisów źródłowych.

`requestVideoFrameCallback()` daje czas klatki, ale może być spóźniony względem jej prezentacji; nie stanowi obietnicy idealnego sprzętowego zgrania. Źródła: [specyfikacja API](https://wicg.github.io/video-rvfc/), [opis zachowania i ograniczeń](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback).

**Odbiór:** obie linie zawsze mają wspólną aktywność; przewijanie, pauza i zmiana prędkości nie powodują starego tłumaczenia ani narastającego dryfu dodanego przez aplikację.

## Etap 09 — fizycznie jeden wiersz na język i zachowany suwak

- [ ] Ujednolicić single i dual: jedna linia źródłowa, opcjonalnie jedna linia docelowa. Dołączenie tłumaczenia nie zmienia aktualnego fragmentu źródłowego w trakcie prezentacji.
- [ ] Dla tej samej pary języków, geometrii i przygotowanej rewizji zachować jeden harmonogram źródła; single tylko ukrywa dół. Single może działać bez modelu i tłumaczeń. Jeśli dopiero włączenie dual wymaga nowego podziału, zatwierdzić go od przyszłej bezpiecznej granicy, z zachowaniem ciągłości wszystkich słów.
- [ ] Zastąpić obecne zawijanie obu linii kontrolowanym układem bez zawijania. Samo `white-space: nowrap` nie jest rozwiązaniem — musi poprzedzać je dobór mieszczącej się jednostki.
- [ ] Mierzyć oba teksty dla rzeczywistego fontu, rozmiaru, odstępów i szerokości obszaru wideo. Nie wyliczać dopasowania z samej liczby znaków ani szerokości okna strony.
- [ ] Reagować na zmianę wielkości playera, fullscreen, zoom, rozmiar czcionki i wczytanie fontu; ograniczyć liczbę przeliczeń i nie powodować pętli `ResizeObserver`.
- [ ] Przy przepełnieniu najpierw szukać poprawnego wspólnego podziału. Dopuszczalne zmniejszenie fontu ograniczyć ustalonym minimum czytelności; nie kompresować ani nie zmniejszać go bez końca.
- [ ] Jeśli resize nastąpi podczas zamrożonej jednostki, najpierw zastosować dopuszczalne zmniejszenie fontu. Gdy nadal nie pasuje, przejść do jawnego stanu ograniczenia i udostępnić pełny tekst poza nakładką; nie ciąć trwającej frazy. Nowy podział zatwierdzić od kolejnej bezpiecznej granicy. Taki fragment nie zalicza się do poprawnego układu dual.
- [ ] Nie ucinać treści, nie używać wielokropka i nie przewijać napisu poziomo w celu zaliczenia warunku jednego wiersza. Na niewspieranym rozmiarze podać stan poza napisami i umożliwić większy player lub pełny tekst w widoku nauki.
- [ ] Ustalić testowany minimalny rozmiar odtwarzacza i zakres fontów. Jeśli nie da się zachować pełnej frazy, czytelności i jednego wiersza, oznaczyć ograniczenie profilu zamiast uznawać fragment za poprawny.
- [ ] Zachować dotychczasowy pionowy suwak/uchwyt i klucz `subtitlePosition`, ruch tylko po Y oraz wspólne przesuwanie obu wierszy. Uwzględnić wysokość całego bloku i granice obrazu z pasami.
- [ ] Utrzymać bezpieczne położenie po zmianie single/dual, proporcji filmu, fullscreen i wielkości czcionki; zapisanej preferencji nie nadpisywać chwilową korektą układu.
- [ ] Zapewnić suwakowi obsługę klawiatury, fokus, etykietę i informację o wartości. Sprawdzić dostępność natywnego pionowego `input[type=range]` lub poprawnie zaimplementować semantykę istniejącego uchwytu.
- [ ] Ustawić kontrast i tło dla jasnych oraz ciemnych scen, czytelny odstęp między językami, poprawny `lang`, kierunek RTL i mieszane zapisy liczb/nazw.
- [ ] Nie nadawać napisom agresywnego `aria-live`, które odczytuje każdą zmianę podczas filmu; zapewnić dostępny widok tekstu i kontrolki nauki.
- [ ] Ukrywać natywne napisy dopiero po gotowości własnej nakładki; przy błędzie lub wyłączeniu przywrócić je. Zapobiec trzem/czterem wierszom wynikającym z nakładania interfejsów.

**Odbiór:** rzeczywisty pomiar w przeglądarce potwierdza jedną linię w single i dwie w dual, bez utraty znaków; suwak działa i zachowuje pozycję w całej macierzy wspieranych rozmiarów.

## Etap 10 — przygotowanie z wyprzedzeniem i uczciwe stany gotowości

- [ ] Przygotowywać najpierw aktualną okolicę filmu i kolejne jednostki; nie tłumaczyć podczas renderowania klatki. Początkowo sprawdzić bufor 30–60 s, później dostroić go pomiarami.
- [ ] Dla VOD umożliwić przygotowanie większego zakresu lub całego filmu przed nauką, gdy ścieżka jest dostępna i mieści się w budżecie urządzenia.
- [ ] Rozróżnić stany jednostki: przygotowywanie, gotowa para, niepewne dopasowanie, brak modelu/ścieżki, błąd i ograniczenie układu. `ready` nie może oznaczać jednego poprawnego przekładu w całym filmie.
- [ ] Pokazywać pokrycie gotowymi parami osobno od oceny jakości; 100% obecnych tłumaczeń nie dowodzi 100% poprawności.
- [ ] Rozpoczynać stabilne wyświetlanie dual dopiero na przygotowanej granicy jednostki. Nie doklejać opóźnionego dołu w połowie zdania.
- [ ] Włączyć opcjonalny tryb „przygotuj oba języki przed odtwarzaniem”. Przy aktywnym trybie i niedogotowanym następnym fragmencie zatrzymać film na granicy jednostki; nie nazywać oczekiwania błędem synchronizacji.
- [ ] Odróżnić chwilowe przygotowywanie od trwałego braku modelu, dopasowania lub miejsca na tekst. Ustalić limit oczekiwania i ponowień; po jego przekroczeniu pokazać wybór single, importu lub zmiany ustawień. Nie pozostawiać filmu w nieskończonym stanie ładowania.
- [ ] Podczas zwykłego oglądania brak gotowego dołu oznaczyć poza wierszem i zachować poprawne źródło. Ten fragment nie zalicza się do pełnego pokrycia dual; nie zastępować go starym tekstem.
- [ ] Po seek nadać priorytet nowemu miejscu, anulować lub zignorować nieaktualne obliczenia i nie publikować wyników dla poprzedniej rewizji.
- [ ] Po zmianie celu tłumaczenia natychmiast usunąć poprzedni język; nowy pokazać dopiero jako spójną gotową jednostkę.
- [ ] Obsłużyć brak miejsca, usunięty cache, przerwane pobieranie modelu, awarię workera i tryb offline. Ponowienie nie może tworzyć wielu identycznych zadań.
- [ ] Nie nazywać tłumaczenia live równoważnym VOD: przyszła wypowiedź nie jest jeszcze dostępna, a ASR może zmienić wcześniejszy tekst. Live pozostaje poza obietnicą pierwszego wydania.

**Odbiór:** użytkownik zawsze widzi, czy oba języki są przygotowane; brak danych nie powoduje fałszywego tłumaczenia ani migania drugiego wiersza.

## Etap 11 — wartość do nauki bez dodatkowych kosztów

- [ ] Zapewnić powtórzenie aktualnej frazy i przejście do poprzedniej/następnej według wspólnych jednostek, z krótkim kontekstem dźwięku i poprawną obsługą granic filmu.
- [ ] Udostępnić pętlę frazy, zmianę prędkości i opcjonalną pauzę na końcu jednostki; po pauzie zachować parę odpowiadającą zatrzymanemu materiałowi.
- [ ] Pauzę z widoczną kończącą się frazą realizować na ostatniej osiągalnej klatce wewnątrz `[start, end)` i sprawdzić faktyczny czas zatrzymania. Jeśli player zatrzymał się później, pełną frazę zachować w wyraźnym widoku powtórki; nie udawać, że jest aktywnym napisem nowej klatki.
- [ ] Dodać odsłanianie tłumaczenia na żądanie i tryb samodzielnego rozumienia, korzystające z tego samego przygotowanego tekstu. Nie generować nowego przekładu przy każdym odsłonięciu.
- [ ] Zapewnić kopiowanie/zapis pełnej frazy z tłumaczeniem, językami, identyfikatorem filmu i timestampem; wykorzystać istniejący moduł fiszek zamiast osobnego magazynu.
- [ ] Przy hover używać wyłącznie dostępnego lokalnego słownika lub wcześniej pobranego, dozwolonego pakietu. Brak hasła nie może automatycznie uruchamiać Gemini ani backendowego generowania.
- [ ] Zapewnić pełną wartość powyższych funkcji bez Enter uruchamiającego AI. W darmowej ścieżce napisów oddzielić lub zastąpić to działanie tak, aby obsługa napisów nie naliczała płatnych operacji.
- [ ] Podświetlać wypowiadane słowa tylko tam, gdzie istnieją wiarygodne znaczniki słów. W pozostałych materiałach podświetlenie dotyczy całej frazy, bez udawania synchronizacji słowo po słowie.
- [ ] Ujednolicić skróty z `video-hotkeys.js` i `reading-modes.js`; nie przechwytywać pisania w polach formularzy ani obsługi suwaka.
- [ ] Zachować niezmienność pary podczas hover, zapisu fiszki, pauzy i powrotu do filmu; panel pomocy nie może podmienić tłumaczenia aktywnej wypowiedzi.

**Odbiór:** można obejrzeć, zrozumieć, powtórzyć i zapisać frazę bez płatnej usługi, konta premium i ukrytego generowania.

## Etap 12 — tysiące użytkowników, lokalne obliczenia i dystrybucja

- [ ] Obliczenia tłumaczeń wykonywać poza głównym wątkiem w sprawdzonym kontekście rozszerzenia. Pętla napisów odpowiada tylko za wybór i renderowanie gotowej jednostki.
- [ ] Wybrać oraz przetestować właściciela silnika: np. dedykowany Worker uruchamiany przez dokument rozszerzenia. Nie utrzymywać ciężkiego modelu wyłącznie w nietrwałym service workerze MV3.
- [ ] Jeśli potrzebny jest dokument offscreen, zweryfikować odpowiedni powód użycia i cykl życia; komunikację z API rozszerzenia prowadzić przez `chrome.runtime`. Sprawdzić odtwarzanie, zamknięcie karty i restart workera.
- [ ] Zacząć od wariantu niewymagającego izolacji strony ani `SharedArrayBuffer`; SIMD, wątki lub GPU włączać dopiero po sprawdzeniu możliwości i istnienia działającego wariantu podstawowego.
- [ ] Kod JS i wykonywalny WASM dołączyć do paczki rozszerzenia. Modele pobierać jako dane z kontrolą wersji, rozmiaru i sumy kontrolnej; bez pobierania skryptów do wykonania.
- [ ] Dostosować CSP do lokalnego WASM, jeżeli wymaga tego wybrany kontekst; nie stosować ogólnego `unsafe-eval`. Sprawdzić końcową paczkę, nie tylko tryb developerski.
- [ ] Nie wysyłać treści napisów, audio ani historii oglądania do serwera w celu tłumaczenia. Diagnostykę trzymać lokalnie; ewentualne dobrowolne raporty nie mogą zawierać pełnych kwestii.
- [ ] Ograniczyć rozmiary wejścia i walidować wiadomości bridge'a, nadawcę, kontekst sesji i dozwolone adresy. Tekst renderować jako tekst; napisy nie mogą wstrzyknąć HTML ani kodu.
- [ ] Modele przechowywać w odpowiednim lokalnym magazynie dużych danych, a nie `chrome.storage.sync`. Sprawdzać quota, rozmiar instalacji, błędy zapisu i możliwość usunięcia pakietu przez użytkownika.
- [ ] Cache tłumaczeń kluczować wersją modelu, silnika, tokenizera i reguł przetwarzania, parą języków, dokładnym tekstem i faktycznie użytym kontekstem. Cache par platformowych dodatkowo wiązać z wersją filmu i obu ścieżek; sam tekst lub podpisany URL nie wystarcza.
- [ ] Rozdzielić cache przekładów od cache podziału na ekranie: zmiana szerokości, metryk fontu lub wersji segmentacji unieważnia układ, ale nie musi kasować poprawnego tłumaczenia całej frazy.
- [ ] Wprowadzić ograniczony cache LRU, limit liczby modeli w RAM i współdzielenie równoczesnych zadań. Po zamknięciu filmu zwolnić callbacki, obserwatory, kolejki i niepotrzebne modele.
- [ ] Nadać pierwszeństwo oglądanej karcie; wiele kart nie może uruchamiać bez limitu niezależnych silników zużywających całą pamięć.
- [ ] Obliczyć obciążenie dla 1 000, 10 000 i 50 000 użytkowników dziennie, oddzielnie dla oglądania, pierwszej instalacji modelu i aktualizacji modeli.
- [ ] Użyć jawnych założeń: np. 10 000 osób × 2 h × 900 znaków/min = 1,08 mld znaków/dzień przetwarzanych lokalnie; model 100 MB × 10 000 nowych pobrań = ok. 1 TB transferu. To przykład arytmetyczny, nie pomiar wielkości wybranego modelu ani prognoza ruchu.
- [ ] Policzyć koszt i limity dystrybucji konkretnych pakietów oraz aktualizacji. Nie zakładać bezterminowo darmowego CDN ani nieobciążonego publicznego hostingu autorów modeli. Zapewnić trwały cache i opcję importu lokalnego.
- [ ] Wykazać brak żądań tłumaczeniowych do backendu podczas oglądania i brak liczników znaków/godzin w darmowym przepływie. Pobrania napisów z platformy i modeli mierzyć oddzielnie.
- [ ] Usuwać dawne routingi/host permissions dopiero po sprawdzeniu wszystkich konsumentów. Darmowe napisy mają być od nich niezależne, bez przypadkowego zepsucia pozostałych funkcji produktu.

MV3 wymaga pakowania wykonywalnego kodu JS/WASM w rozszerzeniu; CSP określa warunki uruchamiania WASM. Service worker może zostać zakończony i nie jest trwałym magazynem sesji modelu. Źródła: [kod pobierany z sieci](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code), [CSP rozszerzenia](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy), [cykl życia service workera](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), [offscreen](https://developer.chrome.com/docs/extensions/reference/api/offscreen).

**Odbiór:** oglądanie nie generuje rachunku za znaki/minuty ani centralnej inferencji; zużycie zasobów urządzenia i koszt dystrybucji są policzone, ograniczone i sprawdzone.

## Etap 13 — testy automatyczne nowego kontraktu

- [ ] Zmienić testy utrwalające błędny overlap, akceptację 1 ms pokrycia oraz przypisanie tłumaczenia całego zdania do jego końcówki. Zachować testy prawdziwych przerw, identycznych kolejnych tekstów i odrzucania starych odpowiedzi.
- [ ] Dodać testy segmentacji: `I am very busy`, negacja, phrasal verbs, nazwy, liczby z jednostkami, skróty, zdania bez interpunkcji, języki bez spacji, długie słowo i zmiana mówcy.
- [ ] Testować parowanie 1:1, 1:N, N:1, luki, przesunięcie, inny montaż, częściowe tłumaczenie, niezgodny dubbing i zmianę kolejności słów. Nigdy nie wyciągać wniosku o semantyce wyłącznie z tych samych timestampów.
- [ ] Dodać testy własności: zachowanie kolejności i pełnej treści źródła, brak duplikacji, brak utraty rzeczywistych powtórzeń, wspólne granice obu wierszy, izolacja filmu/języka/rewizji i ograniczona liczba prób przygotowania.
- [ ] Sprawdzić parsery na danych uszkodzonych, pustych, wielkich, z HTML, nietypowym Unicode, brakującymi końcami i granicami czasu tuż obok siebie.
- [ ] Sprawdzić zegar z kontrolowanym wideo: 0,25×, 0,5×, 1×, 1,5× i 2×; pauzy na granicach, wielokrotne seek w obie strony, buforowanie, reklama, zmiana filmu, audio i ścieżek, nakładające się kwestie oraz powrót z tła.
- [ ] Dodać test integracyjny: opóźnione tłumaczenie starej jednostki nigdy nie pojawia się pod nową; spóźniony wynik nie zmienia pary w trakcie ekspozycji.
- [ ] W prawdziwej przeglądarce sprawdzać geometrię linii, pełną widoczność tekstu, liczbę linii i granice bloku. Test długości tablicy lub obecności jednego `div` nie dowodzi jednego wiersza.
- [ ] W przeglądarce sprawdzić suwak myszą, dotykiem i klawiaturą, zapis/odtworzenie pozycji, fullscreen, zoom, inne proporcje i przełączanie single/dual.
- [ ] Przetestować pobieranie/cache modelu, brak sieci, brak miejsca, usunięty model, restart kontekstu i równoległe karty; błędy nie mogą uruchamiać płatnego zastępstwa.
- [ ] Testem sieciowym potwierdzić zero wywołań Gemini, Google Translate, `tlang` i backendowego generowania podczas odtwarzania, hover, powtórki i zapisu frazy w darmowej ścieżce.
- [ ] Sprawdzić istniejące fiszki, chmurki słów, skróty i ustawienia językowe pod kątem regresji po zmianie modelu danych.
- [ ] Uruchomić pełne `npm test`, `npm run check:syntax` i `npm run build` po wdrożeniu kodu; wynik wraz z wersją zapisać przy odbiorze. Zmiana samego planu nie jest wdrożeniem tych funkcji.

Polecenie bazowego sprawdzenia wykonanego podczas audytu:

```sh
node --test tests/dual-subtitles.test.js tests/dual-subtitle-ui.test.js tests/netflix-dual-subtitles.test.js tests/youtube-dual-subtitles.test.js tests/youtube-captions-parse.test.js tests/subtitle-platform-timing.test.js
```

**Odbiór:** przechodzą testy nowego kontraktu, a nie tylko starej implementacji; pomiary układu i klatek pochodzą z przeglądarki.

## Etap 14 — ręczna ocena językowa, synchronizacja i wydajność

Poniższe progi są **proponowanymi warunkami odbioru**, a nie wynikami obecnego systemu ani gwarancją dla każdego urządzenia. Przed implementacją pomiarów należy utrwalić sprzęt, wersję przeglądarki, materiał i metodę.

| Właściwość | Warunek odbioru |
| --- | --- |
| Zgodność stanu obu języków | 100% gotowych par ma wspólne granice i pojawia się w jednym zatwierdzeniu renderera; zero starych tłumaczeń po zmianie jednostki. |
| Pełne pokrycie dual | 100% kwalifikujących się jednostek w zakresie oznaczonym jako gotowy ma kompletny przekład; fragmenty niedostępne i ukryte błędy nie mogą znikać z raportu pokrycia całego materiału. |
| Poprawność językowa | Zero wykrytych błędów krytycznych w końcowym zbiorze: odwrócenia negacji, błędnej liczby, innego podmiotu, dopisania faktu albo zgubienia treści. Minimum 98% jednostek bez korekty znaczenia w pierwszym przebiegu; pozostałe błędy sklasyfikowane. Wynik po ręcznej korekcie napisów raportowany oddzielnie, bez podnoszenia nim oceny modelu. |
| Naturalne granice | Zero sztucznych cięć wskazanych fraz w przypadkach, w których istnieje poprawny podział mieszczący się w obsługiwanym układzie. |
| Układ | 1 fizyczny wiersz single / 2 dual w całej wspieranej macierzy; zero niewidocznych znaków, poziomego przewijania i fontu poniżej ustalonego minimum. |
| Opóźnienie własnego renderera | Cel P95 ≤ 50 ms i P99 ≤ 100 ms względem zaplanowanej granicy na widocznej karcie i referencyjnym sprzęcie; osobno raportowane spóźnienia klatek. |
| Zgodność z mową | Cel P95 bezwzględnego błędu granic ≤ 150 ms na materiale z ręcznie oznaczonym odniesieniem; raport osobno dla startu i końca, z definicją dopuszczalnego czasu doczytania. |
| Przygotowanie lokalne | Przy wybranej prędkości odtwarzania bufor nie maleje długotrwale po rozgrzaniu modelu; cold start i pobranie modelu raportowane oddzielnie. |
| Płynność | Cel: brak własnych zadań blokujących główny wątek przez >50 ms podczas ustabilizowanego odtwarzania; P95 aktualizacji nakładki <4 ms na sprzęcie odniesienia. |
| Pamięć | Konkretny limit ustalony po prototypie dla wybranego modelu; brak narastania pamięci po 20 zmianach filmów i po zamknięciu kart, potwierdzony pomiarem po zwolnieniu zasobów. |
| Koszt tłumaczenia | 0 płatnych wywołań i 0 serwerowego generowania napisów w całym darmowym scenariuszu. |

- [ ] Ocenić finalny, niewykorzystany przy dostrajaniu zbiór przez dwie osoby znające oba języki; rozstrzygnąć rozbieżności z odsłuchem i kontekstem sceny.
- [ ] Zachować surowy wynik pierwszej oceny. Jeśli poprawiono system na podstawie wykrytych przykładów, przenieść je do regresji, a końcową ocenę wykonać na nowym zbiorze niewykorzystanym przy dostrajaniu; ręczna poprawka pojedynczego pliku nie dowodzi poprawy systemu.
- [ ] Oceniać górny tekst względem audio, dolny względem górnego i sens całej pary w scenie; naturalnie brzmiący przekład może nadal być błędny.
- [ ] Raportować licznik, mianownik, pominięte fragmenty i przyczyny odmowy osobno dla każdej platformy, pary językowej i rodzaju napisów.
- [ ] Przetestować sesje 30, 60 i 120 minut, szybkie serie seek, wiele kart, słabsze CPU, brak sieci po przygotowaniu i pobieranie na wolnym połączeniu.
- [ ] Sprawdzić gęsty dialog i mocno wydłużający się przekład; nie osiągać dobrych wyników przez odrzucenie wszystkich trudnych przykładów.
- [ ] Zebrać krótkie sesje nauki: zrozumienie sceny, wygoda porównania języków, liczba zbędnych pauz, odnajdywanie frazy i wygoda suwaka.
- [ ] Udokumentować błędy materiału źródłowego osobno od błędów aplikacji. Nie zaliczać kryterium zgodności z filmem tylko dlatego, że skopiowano błędny timestamp wydawcy.
- [ ] Zatwierdzać wsparcie nowej pary językowej dopiero po przejściu jej własnego odbioru; pojedynczy dobry wynik EN→PL nie przenosi się na inne języki.

**Odbiór:** zapisane wyniki, nagrania kontrolne lub pomiary, lista ograniczeń i zero otwartych błędów krytycznych. Brak błędu w próbie nie oznacza matematycznej gwarancji na wszystkich filmach.

## Etap 15 — wdrożenie etapami i utrzymanie jakości

- [ ] Wdrażać kolejno: wspólny model i źródła → normalizacja i granice → pary tłumaczeń → zegar → układ i suwak → przygotowanie/cache → narzędzia nauki. Prototyp lokalnego tłumacza z etapu 02 poprzedza uzależnienie reszty od modelu.
- [ ] Wprowadzić nowy przepływ za przełącznikiem technicznym i porównać wyniki na tych samych materiałach. Wycofanie zmiany ma przywracać stabilne napisy źródłowe, bez powrotu do zakazanego płatnego lub automatycznego tłumaczenia Google.
- [ ] Rozpocząć od niewielkiej grupy testerów, następnie poszerzać zakres dopiero po spełnieniu bramek czasu, znaczenia, pokrycia i wydajności.
- [ ] Zweryfikować migrację istniejących ustawień, zwłaszcza `subtitlePosition`, `doubleSubtitles`, języków i rozmiaru fontu; nie resetować preferencji przy aktualizacji.
- [ ] Zaktualizować `GUIDE.md`, [opis Chrome Web Store](CHROMEWEBSTORE.md), deklaracje prywatności i opis obsługiwanych języków zgodnie z rzeczywiście wdrożonym przepływem.
- [ ] Zbudować paczkę i sprawdzić instalację aktualizacji na istniejącym profilu: działanie WASM, zasobów, modeli, cache, uprawnień i połączeń między kontekstami.
- [ ] Przygotować lokalny raport diagnostyczny z wersją rozszerzenia/modelu, platformą, identyfikatorem jednostki, czasem i kodem błędu; udostępniany świadomie, bez pełnej historii oglądania.
- [ ] Utrzymywać zestaw regresji dla zmian YouTube/Netflix i nowych modeli. Każdy model może zmienić długość przekładów, więc jego aktualizacja wymaga także testów podziału i układu.
- [ ] Oznaczyć wdrożenie jako kompletne dopiero po przejściu wszystkich obowiązkowych bramek dla zadeklarowanego zakresu; niedostępne platformy, języki lub urządzenia pozostają jawnie poza nim.

**Końcowa definicja ukończenia:** użytkownik w obsługiwanym materiale otrzymuje czytelną frazę, jej odpowiadające tłumaczenie i wspólny czas zgodny z filmem; oba wiersze mieszczą się w jednym wierszu na język i przesuwają zachowanym pionowym suwakiem. Można z nich uczyć się codziennie bez opłat za tłumaczenie. Braki danych, ograniczenia urządzenia i niepotwierdzona jakość są widoczne, a nie ukryte pod deklaracją „idealne”.
