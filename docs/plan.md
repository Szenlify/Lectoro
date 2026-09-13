<!-- # Plan udoskonalenia Lectoro

Plan przygotowany 13.09.2026 na podstawie `GUIDE.md`, całego `todo.md`, analizy kodu rozszerzenia i backendu oraz istniejących testów. Wszystkie zadania pozostają nieodhaczone. Checkbox oznacza wykonanie zadania wraz ze sprawdzeniem jego efektu; samo dopisanie propozycji nie oznacza naprawy.

**Priorytety:** P0 — błędne tłumaczenia, interakcje z niewłaściwym językiem i utrata danych; P1 — codzienna nauka, napisy, skróty, quizy i prostota; P2 — porządki, koszty i przygotowanie publikacji. Zależności i kolejność wdrażania są na końcu.

**Zakres sprawdzenia:** obecny zestaw `npm test` przechodzi: 223/223 testy; `npm run check:syntax` przechodzi: 85 plików JS. Dodatkowe lokalne próby potwierdziły błędy walidacji języków, ponownej tokenizacji dolnego napisu Netflix i równoczesnych zapisów fiszek. Nie wykonywano ręcznego testu zalogowanego Netflixa/YouTube, wdrożenia ani przeglądu rachunków i działającej infrastruktury. Wskazane niżej hipotezy wymagają odtworzenia; lista obejmuje problemy znalezione w tym audycie, a nie gwarancję wykrycia każdego możliwego błędu.

## 1. Docelowe zachowanie i punkt wyjścia

- [ ] Utrzymać jedną zasadę językową: **Learning language** to język nauki i źródło słowa; **Native language** to język tłumaczenia. Przykład PL → JA oznacza polskie słowo i japońskie tłumaczenie, niezależnie od języka interfejsu.
- [ ] Pozwolić na klikanie, hover, odczyt i wybór do powtórek wyłącznie w źródłowym rzędzie napisów zgodnym z językiem nauki. Rząd tłumaczenia ma służyć do czytania.
- [ ] Przyjąć układ: jedna linia języka nauki; po włączeniu podwójnych napisów jedna dodatkowa linia tłumaczenia pod spodem. „W jednym rzędzie” oznacza jedną linię na język, bez zawijania jednego języka na kilka rzędów.
- [ ] Zachować dotychczasowy tryb `S`, dopóki użytkownik nie naciśnie `←` lub `→`. Hover ma działać również bez uruchamiania wyboru klawiaturą.
- [ ] Przygotować krótkie nagrania stanu przed zmianą: Netflix z klikalnym Native language, PL → JA, komunikat walidacji, `S`, `Enter`, przejście YouTube → Shorts i generowanie quizu.
- [ ] Przy odtwarzaniu błędów zapisać wersję rozszerzenia, wersję Chrome, platformę, języki ustawień, rzeczywisty język ścieżki napisów, przykładowe słowo oraz informację, czy wynik pochodził z cache.
- [ ] Rozdzielić w zgłoszeniach trzy różne sytuacje: nieprawidłowa para języków, poprawny tekst bez hasła słownikowego oraz awaria usługi. Każda ma otrzymać własny sposób naprawy i komunikat.
- [ ] Dodać testy regresji dla potwierdzonych błędów przed zmianą ich implementacji; nie traktować obecnych zielonych testów jako dowodu poprawnego UX w odtwarzaczu.

## 2. P0 — właściwy język źródła i tłumaczenia

**Ustalenie z kodu:** hover w `video/subtitle-overlay.js` pobiera źródło z `learningLang`, podczas gdy adapter może wyświetlać inną aktywną ścieżkę. `selectBestCaptionTrack()` w `adapters/youtube-adapter.js` ma również preferencje angielskich ścieżek. Obsługa zmiany ustawień w adapterach obejmuje `targetLang` i `doubleSubtitles`, ale wymaga rozszerzenia o `learningLang`. To może kierować prawidłowe słowo do słownika niewłaściwego języka.

- [ ] Ustalić wspólny kontrakt kontekstu napisów: identyfikator filmu i ścieżki, rzeczywisty `sourceLang`, `targetLang`, rola rzędu, identyfikator kwestii oraz wersja ustawień/sesji.
- [ ] Rozbudować istniejący `SharedTranslatorService`, aby hover, `S`, `Enter`, zaznaczenie tekstu, zapis fiszki i TTS dostawały ten sam kontekst językowy; nie tworzyć kolejnej niezależnej konfiguracji.
- [ ] W YouTube i Netflix wybierać ścieżkę zgodną z `learningLang`, uwzględniając warianty regionalne i metadane platformy; nie przełączać domyślnie na English.
- [ ] Jeżeli ścieżki języka nauki brakuje, pokazać krótką informację „Brak napisów w języku nauki” oraz dostępną akcję zmiany ścieżki/ustawień. Nie wysyłać widocznego tekstu z fałszywym oznaczeniem źródła.
- [ ] Jeśli aktywna ścieżka jest w Native language, zachować jej rolę pomocniczą i zablokować narzędzia nauki, zamiast uznawać ją za język źródłowy tylko dlatego, że jest ścieżką główną.
- [ ] Ujednolicić normalizację kodów językowych, np. `en-US` → obsługiwany wariant słownika `en`, zachowując pełny kod tam, gdzie potrzebuje go dobór głosu lub ścieżki.
- [ ] Obsłużyć zmianę `learningLang` w obu adapterach tak samo starannie jak zmianę `targetLang`: wybrać ścieżki ponownie, usunąć stare dane i odrzucić spóźnione odpowiedzi.
- [ ] Pobierać parę języków jako jeden spójny snapshot na początku operacji. Zmiana ustawień w trakcie żądania nie może połączyć starego źródła z nowym celem.
- [ ] Przy zmianie języków zamknąć nieaktualne tooltipy, zatrzymać ich TTS, wyzerować wybór `S` i `Enter` oraz unieważnić trwające tłumaczenia.
- [ ] Zdefiniować zachowanie dla `learningLang === targetLang`: czytelny komunikat w ustawieniach, brak bezcelowego żądania tłumaczenia i brak podwójnego identycznego rzędu.
- [ ] Zabezpieczyć zapis fiszki: zapisać rzeczywistą parę języków, tekst źródłowy i jego kontekst z chwili wyboru, a nie ustawienia odczytane dopiero po zakończeniu żądania.
- [ ] Sprawdzić `shared/ai-prompts.js`, `shared/translator-service.js`, `shared/gemini-proxy.js` i backend pod kątem sprzecznych fallbacków; pozostawić wartości domyślne w centralnej konfiguracji.
- [ ] Kryterium odbioru: PL → JA pokazuje japońskie znaczenie polskiego słowa; zamiana na JA → PL od razu zmienia kierunek bez odświeżania strony i bez starych wyników.

## 3. P0 — słownik i „Could not verify this dictionary entry”

**Potwierdzone:** `validateEntry()` w `functions/live-translation.js` usuwa znaki spoza `a-z0-9` przy sprawdzaniu części dłuższych słów i stosuje granice wyrazów nieodpowiednie dla japońskiego. Lokalne próby odrzuciły poprawne przykłady dla `książka`, `Hütte`, `garçon`, `猫`. Ta sama walidacja zaakceptowała PL → JA: `pies` → `kundel`, ponieważ kontrola celu JA/KO sprawdza głównie, czy wynik nie jest identyczny ze źródłem. Specjalny prompt dla angielskiego `like` nakazuje polskie odpowiedniki również przy innym języku docelowym.

- [ ] Zastąpić usuwanie znaków Unicode normalizacją zachowującą litery, znaki diakrytyczne i pismo języka źródłowego.
- [ ] Sprawdzać obecność hasła w przykładach przy użyciu tokenizacji właściwej dla języka; dopuścić poprawne formy fleksyjne bez arbitralnego obcinania końcówki każdego słowa.
- [ ] Dla japońskiego nie wymagać spacji ani łacińskich granic wyrazu; przetestować słowo osadzone w naturalnym zdaniu.
- [ ] Rozszerzyć istniejący `shared/dictionary-tokenizer.js` o język wejściowy. Obecny stały segmenter `ja` nie powinien być domyślną regułą dla wszystkich obsługiwanych języków.
- [ ] Użyć `Intl.Segmenter` tam, gdzie pomaga w podziale słów i zdań, z kontrolowanym zachowaniem przy braku obsługi. Samo dzielenie po spacji nie obsługuje poprawnie m.in. japońskiego. [Dokumentacja MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter).
- [ ] Usunąć z ogólnych promptów wymuszanie polskich wyników dla `like`, `I`, rodzajników i przykładów wieloznaczności; reguły zależne od języka stosować tylko dla właściwej pary.
- [ ] Walidować osobno język krótkiego znaczenia, definicji, synonimów i przykładów: pola źródłowe w języku nauki, pola tłumaczenia w `targetLang`.
- [ ] Dla JA/KO sprawdzać zgodność pisma i treści, lecz dopuścić uzasadnione nazwy własne, liczby i zapożyczenia. Sam zapis alfabetem łacińskim ani identyczność wyrazów nie dowodzą błędu.
- [ ] Dla języków o tym samym alfabecie nie udawać pewnego rozpoznawania języka krótkiego słowa; oprzeć ocenę na całym wpisie, kontekście i kontrakcie odpowiedzi.
- [ ] Rozdzielić odpowiedzi backendu na poprawny wpis, nazwę własną, brak potwierdzonego znaczenia, niezgodność języka, limit, błąd sieci i błąd serwera.
- [ ] Zastąpić techniczne ostrzeżenie z symbolem ⚠ krótkim komunikatem odpowiednim do przyczyny. Szczegóły walidacji pozostawić w diagnostyce, bez pokazywania użytkownikowi surowej odpowiedzi modelu.
- [ ] Pozwolić na najwyżej jedną automatyczną próbę korekty odpowiedzi o złym języku/formacie; potem zakończyć czytelnym stanem i umożliwić świadome ponowienie. Nie tworzyć pętli płatnych żądań.
- [ ] Nie przepuszczać błędnego wpisu tylko po to, aby zniknął komunikat walidacji; pokazać brak wyniku, gdy znaczenie nie zostało wiarygodnie ustalone.
- [ ] Podnieść wersję walidacji danych słownika i unieważnić stare, niepoprawne wpisy w lokalnym cache oraz R2 w kontrolowany sposób. Nie usuwać zapisanych fiszek użytkownika.
- [ ] Przy odczycie wpisu z R2 sprawdzić aktualny kontrakt i języki; historyczna flaga `languageValidation: 1` nie może bezterminowo gwarantować poprawności.
- [ ] Rozdzielić ogólne hasło słownikowe od znaczenia wybranego w konkretnym zdaniu: obecny klucz R2 zależy od pary i słowa, podczas gdy prompt uwzględnia kontekst. Wspólny wpis nie może utrwalać znaczenia z pierwszej przypadkowej sceny.
- [ ] W cache odpowiedzi zależnych od kontekstu uwzględnić kontekst/sens oraz wersję kontraktu; nie dodawać prywatnego zdania użytkownika do publicznego wpisu słownika.
- [ ] Dodać regresje dla `książka`, `łóżko`, `zrobiłem`, `Hütte`, `garçon`, `猫`, koreańskiego słowa, apostrofu, łącznika, nazwy własnej i tego samego słowa w dwóch znaczeniach.
- [ ] Kryterium odbioru: poprawny wpis PL → JA jest przyjmowany, `pies` → `kundel` jest odrzucany jako japońskie tłumaczenie, a brak hasła nie zamienia całego trybu nauki w ekran błędu.

## 4. P0 — nieklikalne napisy Native language

**Potwierdzone w lokalnej próbie:** renderer dolnego rzędu w `video/subtitle-overlay.js` tworzy zwykły tekst, ale `core.js → findWordAtPoint()` potrafi ponownie podzielić dowolny `DIV`/`SPAN` wewnątrz netflixowego `[data-uia='video-canvas']` na interaktywne słowa. `shared/constants.js → isOwnUI()` nie obejmuje całej nakładki napisów. Zmiana samego wyglądu dolnego rzędu nie rozwiązuje tej przyczyny.

- [ ] Oznaczyć oba rzędy jawną rolą `learning` / `native` oraz rzeczywistym językiem w danych renderera i DOM.
- [ ] Dodać centralną regułę dopuszczającą interakcję wyłącznie dla źródłowego rzędu; używać jej w hover, kliknięciu, wykrywaniu słowa, zapisie, TTS i nawigacji klawiaturą.
- [ ] Ograniczyć awaryjną tokenizację `findWordAtPoint()` do rozpoznanych źródłowych napisów. Nie tokenizować dowolnego tekstu w całym kontenerze wideo.
- [ ] Uzupełnić rozpoznawanie własnego UI, zachowując możliwość świadomej interakcji z prawidłowo oznaczonymi słowami źródłowymi.
- [ ] Usunąć z dolnego rzędu klasy słów, `tabindex`, handlery zapisu, podświetlenie hover i kursor sugerujący kliknięcie; pozostawić tekst dostępny dla czytnika ekranu.
- [ ] Sprawdzić propagację zdarzeń: zabezpieczenie dolnego rzędu nie może uruchamiać tłumaczenia ani przypadkowo klikać ukrytego elementu przez `pointer-events: none`.
- [ ] Zablokować również ogólny pasek tłumaczenia zaznaczenia na własnym rzędzie Native language, jeśli omijałby powyższą regułę.
- [ ] Zachować blokadę po przewinięciu, zmianie odcinka, zmianie języka, przełączeniu pełnego ekranu, odświeżeniu DOM oraz otwarciu i zamknięciu `S`/`Enter`.
- [ ] Dodać regresję dla plain-text dolnego rzędu wewnątrz netflixowego `video-canvas`, a nie tylko test sprawdzający HTML bez handlerów.
- [ ] Kryterium odbioru: hover, klik i klawiatura na Native language nie tworzą tooltipu, fiszki, zapytania tłumaczenia ani nowego zużycia AI na Netflixie i YouTube.

## 5. P1 — hover w `S` i spokojny UX brakujących znaczeń

**Potwierdzone:** `handleSubMouseMove()` w `video/subtitle-overlay.js` kończy obsługę przy `wordCloudActive`, przez co hover w `S` jest wyłączony. W `showWordClouds()` pojedynczy błąd generowania ustawia wspólny `generationError`, zatrzymuje dalszą pracę i może trafić do `showReadingError()`, zasłaniającego cały tryb.

- [ ] Usunąć ogólną blokadę hover podczas `wordCloudActive` i zastąpić ją sprawdzeniem roli słowa, aktualnej sesji oraz widoczności właściwego elementu.
- [ ] Po `S` pokazywać tooltip po najechaniu na źródłowe słowo/frazę, także zanim użytkownik użyje strzałek.
- [ ] Korzystać ze wspólnego komponentu szczegółów słowa: krótki odpowiednik jako najważniejsza treść, odczyt i zapis, a definicja oraz przykłady dostępne po rozwinięciu.
- [ ] Zachować tę samą parę języków i kontekst w chmurce oraz tooltipie; nie odwracać tłumaczenia po najechaniu na już przetłumaczony element.
- [ ] Wprowadzić krótki próg hover, np. 180–250 ms, anulowanie przy szybkim przejściu oraz usuwanie spóźnionych odpowiedzi poprzedniego słowa.
- [ ] Utrzymywać tooltip podczas przejścia kursorem ze słowa do jego treści; nie dopuścić do migania na granicy elementów.
- [ ] Zamknięcie tooltipu w `S` ma pozostawić tryb i jego pauzę. Sam hover nie uruchamia filmu, TTS ani zapisu słowa.
- [ ] Modelować wynik każdego tokenu oddzielnie: oczekiwanie, tłumaczenie, nazwa własna, brak znaczenia, chwilowy błąd lub limit. Jeden nieudany token nie usuwa poprawnych wyników pozostałych.
- [ ] Dla potwierdzonej nazwy własnej pozostawić oryginalny zapis i dyskretną informację „Nazwa własna”; nie wymyślać tłumaczenia tylko po to, aby zapełnić chmurkę.
- [ ] Dla nierozpoznanego słowa pozostawić normalny wyraz w zdaniu. W jego szczegółach pokazać „Brak pewnego tłumaczenia” i ewentualnie akcję „Sprawdź w kontekście”.
- [ ] Dla chwilowej awarii pokazywać ponowienie przy konkretnym słowie. Nie umieszczać technicznego ostrzeżenia pod każdym wyrazem.
- [ ] Przy wyczerpaniu limitu zatrzymać kolejne generacje i pokazać jedną zbiorczą informację, zachowując tekst i już otrzymane wyniki.
- [ ] Nie dodawać automatycznie fiszki z pustym znaczeniem, komunikatem błędu ani skopiowanym źródłem. Dla braku znaczenia umożliwić jawne uzupełnienie przed zapisem; nazwę własną oznaczyć świadomie.
- [ ] Ograniczyć liczbę równoległych żądań i współdzielić jedno trwające żądanie tego samego słowa/kontekstu między chmurką a tooltipem.
- [ ] Zachować wysokość i pozycję rzędu podczas ładowania; brak znaczenia nie może przesuwać pozostałych słów.
- [ ] Kryterium odbioru: zdanie z kilkoma zwykłymi wyrazami i jedną nazwą/nieznanym słowem pozostaje czytelne, poprawne znaczenia działają, a hover nie zmienia pauzy ani trybu.

## 6. P1 — opcjonalny wybór słów strzałkami w `S`

**Obecny kontrakt:** w `Enter` strzałki zmieniają element, ręczna nawigacja zatrzymuje automatyczne przechodzenie, `Z` zapisuje wybrany element, a `W` ponawia odczyt. W `S` nie ma osobnej gałęzi wyboru tokenu; część klawiszy zamyka UI lub przechodzi do przewijania napisów. Obsługa skrótów jest dodatkowo rozdzielona między `video/video-hotkeys.js` i listener w `video/subtitle-overlay.js`.

- [ ] Wprowadzić wewnętrzny stan wyboru `S`: brak wyboru / wybór klawiaturą. Nie dodawać nowego przełącznika do Settings.
- [ ] Po uruchomieniu `S` ustawić brak wyboru: bez automatycznego zaznaczenia pierwszego słowa, bez dodatkowego TTS i bez nowego sposobu zapisu.
- [ ] Pierwsze `→` ma wybrać pierwsze źródłowe słowo/frazę, a pierwsze `←` ostatnie. Kolejne strzałki przechodzą do sąsiada.
- [ ] Traktować rozpoznaną frazę jako jeden element nauki; pomijać spacje, interpunkcję i rząd Native language.
- [ ] Po wyborze wyświetlić subtelne podświetlenie i odpowiednie szczegóły słowa, wykorzystując te same dane co hover.
- [ ] Włączyć przechwytywanie `←`/`→` przez wybór tylko podczas aktywnego `S`; na granicach listy pozostać na skrajnym słowie i nie przewijać filmu.
- [ ] Utrzymać istniejący zapis całego zdania pod `Z`, dopóki nie użyto strzałek. Po uruchomieniu wyboru `Z` zapisuje wybrane słowo/frazę z kontekstem.
- [ ] Podłączyć istniejące aliasy skrótów do tego samego routera; nie pozostawiać sytuacji, w której `Z` i jego dotychczasowy alias zapisują różne rzeczy.
- [ ] Po ręcznym wyborze dopasować `W` do odczytu wybranego źródłowego słowa, zgodnie z logiką `Enter`; nie uruchamiać mowy samym przejściem strzałką, jeśli ustawienia jej nie wymagają.
- [ ] Zachować `Enter` jako wejście w wyjaśnienie; zapis słowa pozostawić pod dotychczasowym `Z` i przyciskiem zapisu.
- [ ] Hover myszą ma dawać podgląd, ale nie przestawiać ukradkiem wyboru klawiatury. Przycisk zapisu w otwartym podglądzie zapisuje jego słowo; `Z` w trybie wyboru zapisuje zaznaczony token.
- [ ] Ustalić kolejność `Escape`: zamknięcie szczegółów, wyjście z wyboru, potem istniejące wyjście z `S`. Wznowić odtwarzanie dopiero zgodnie ze stanem sprzed wejścia w tryb.
- [ ] Wyzerować wybór po zmianie kwestii, filmu, języka lub ponownym uruchomieniu `S`; nie przenosić indeksu słowa między zdaniami.
- [ ] Scalić obsługę klawiszy w jednym routerze z priorytetami stanów; uniknąć podwójnego działania tego samego zdarzenia w listenerach capture.
- [ ] Nie przechwytywać skrótów podczas pisania w `input`, `textarea`, `select`, `contenteditable`, wyszukiwarce platformy ani podczas kompozycji IME; uwzględnić modyfikatory i `event.repeat`.
- [ ] Przy zapisie przechwycić stabilny identyfikator słowa i sesji przed `await`. Oznaczenie „Zapisano” musi dotyczyć zapisanej pozycji, nawet gdy użytkownik w tym czasie nacisnął strzałkę. Naprawić analogiczne użycie zmiennego `aiExplainIndex` w `Enter`.
- [ ] Kryterium odbioru: `S` bez strzałek zachowuje dotychczasowy przebieg; `S → → Z` zapisuje drugą pozycję, nie całe zdanie; nie następuje przypadkowy seek ani uruchomienie filmu.

## 7. P1 — wspólne napisy YouTube/Netflix, jedna linia i interpunkcja

**Ustalenie z kodu:** obie platformy już korzystają ze wspólnych styli w `styles.css`; trzeba dopracować istniejący renderer. Reguły `white-space: normal` i `text-wrap: balance` dopuszczają wiele linii. `cleanCardText()` nie jest odpowiednim miejscem na globalne usuwanie interpunkcji z napisów, ponieważ obsługuje także inne treści. Pozycjonowanie chmurek wymaga wizualnego sprawdzenia kolizji długich tłumaczeń.

- [ ] Przygotować jeden wzorzec napisów dla obu platform: wspólna typografia, odstępy, promień tła, przezroczystość, akcent zaznaczenia i pozycja względem odtwarzacza.
- [ ] Utrzymać źródło jako główny element: większy/czytelniejszy tekst; Native language jako spokojny, nieinteraktywny rząd pomocniczy.
- [ ] Wprowadzić osobne `rawText` i `displayText` oraz mapę tokenów/zakresów. Renderer pokazuje tekst oczyszczony; tłumaczenie, kontekst, tokenizacja i TTS mają dostęp do prawidłowego oryginału.
- [ ] Usuwać z warstwy prezentacji obu rzędów przecinki, kropki, średniki, dwukropki, wielokropki, cudzysłowy, znaki pytania/wykrzyknienia i odpowiadające im znaki japońskie, o ile są interpunkcją zdaniową.
- [ ] Zachować znaki należące do wyrazu lub wartości, np. apostrof w `don't`, łącznik w słowie złożonym i separator w `3.14` / `3,14`; nie uczyć uszkodzonej pisowni ani innej liczby.
- [ ] Po usunięciu separatora między wyrazami wstawić właściwy odstęp zamiast sklejać słowa. Nie dodawać sztucznych spacji w japońskim tekście ciągłym.
- [ ] Wspólnie normalizować końce linii, podwójne spacje i znaczniki formatowania. Zachować informację o zmianie mówcy w danych, nawet gdy wizualne myślniki są ukryte.
- [ ] Oddzielnie obsłużyć napisy opisujące dźwięki, muzykę i mówców; nie usuwać bezwarunkowo każdego fragmentu w nawiasach, jeżeli niesie treść potrzebną do zrozumienia sceny.
- [ ] Wymusić jedną fizyczną linię na język w normalnym odtwarzaniu i w `S`, z szerokością ograniczoną do widocznego obszaru filmu, nie całej strony.
- [ ] Dla zbyt długiej kwestii użyć krótszych fragmentów prezentacji opartych na istniejących segmentach i czasie kwestii. Nie rozwiązywać problemu samym ucięciem końca ani zmniejszaniem tekstu do nieczytelnego rozmiaru.
- [ ] Jeśli brak czasów poszczególnych słów, traktować rozkład fragmentów w czasie jako przybliżenie; zachować oryginalne granice kwestii i zapewnić pełny tekst po pauzie. Sprawdzić, że żadne słowo nie ginie.
- [ ] Dopasowywać fragmenty obu języków do wspólnego przedziału sceny, bez zakładania identycznej liczby wyrazów i dosłownej zgodności słowo w słowo.
- [ ] Nie stosować ciągłego przesuwania tekstu typu marquee; podczas pauzy umożliwić spokojny dostęp do całej długiej kwestii, a podczas wyboru odsłaniać aktualne słowo.
- [ ] Dla `S` ułożyć źródłowe tokeny w jednym rzędzie i krótkie znaczenia względem nich; długie definicje przenieść do szczegółów. Rozwiązać kolizje sąsiednich chmurek zamiast nakładać je na siebie.
- [ ] Zachować wielkość tekstu wybraną przez użytkownika i stabilną pozycję napisów przy pojawieniu się tłumaczenia, paska sterowania, tooltipu i zmianie rozmiaru okna.
- [ ] Dopasować `lang`, `dir` oraz logiczne właściwości CSS do treści; nie uzależniać czytelności od angielskiej długości słów.
- [ ] Sprawdzić krótką i bardzo długą kwestię, wiele zdań, dialog, CJK, tryb kinowy, fullscreen, pionowy Shorts oraz powiększenie 200% na jasnym i ciemnym kadrze.
- [ ] Kryterium odbioru: ten sam materiał testowy wygląda spójnie na YouTube i Netflixie, każdy język zajmuje jeden rząd, interpunkcja zdaniowa znika z obu, a źródłowe dane i znaczenia pozostają poprawne.

## 8. P1 — aktywny film, Shorts i synchronizacja napisów

**Potwierdzone w kodzie, objaw do odtworzenia w przeglądarce:** `youtube-player-bridge.js → getYouTubePlayer()` preferuje globalny `#movie_player`, a `getCurrentVideoId()` jego ID przed adresem Shortsa. Adapter wysyła polecenie mostem bez ID filmu i dodatkowo steruje przekazanym elementem `video`. Może więc sterować dwoma różnymi odtwarzaczami. Registry na adresie `/shorts/` zbyt szeroko dopuszcza podłączone filmy. Istniejące zabezpieczenia spóźnionych odpowiedzi napisów trzeba zachować i rozszerzyć na komendy odtwarzania.

- [ ] W `adapters/player-registry.js` wybierać faktycznie widoczny, aktywny odtwarzacz; na Shorts uwzględniać aktywny element listy, nie pierwszy znaleziony `video` ani poprzedni `#movie_player`.
- [ ] Powiązać każdą operację pauzy, wznowienia, seek, screenshotu i TTS z identyfikatorem sesji oraz konkretnym filmem.
- [ ] Po przejściu `/watch` → `/shorts`, zmianie Shortsa lub odcinka Netflix odpiąć stare obserwatory/listenery, anulować żądania, zamknąć UI i wyczyścić stare napisy.
- [ ] W mostach YouTube/Netflix sprawdzać zgodność identyfikatora filmu i żądania przy odbiorze danych; wyniki poprzedniej sesji nie mogą trafić do nowego filmu.
- [ ] Przekazywać tożsamość sesji/filmu także w komendach mostu; wybrać jeden skuteczny sposób sterowania aktywnym filmem, bez równoczesnej komendy do starego globalnego playera.
- [ ] Wznowić film po zamknięciu UI tylko wtedy, gdy ta sama sesja była wcześniej odtwarzana i to rozszerzenie ją zatrzymało. Nie uruchamiać odtwarzacza ręcznie zatrzymanego przez użytkownika.
- [ ] Sprawdzić zmianę CC on/off, brak ścieżki, zmianę ścieżki w menu platformy, reklamy, buffering, automatyczne przejście do kolejnego odcinka i powrót przyciskiem Wstecz.
- [ ] Zachować ścieżkę źródłową po błędzie pobrania tłumaczenia; nie chować całych napisów ani nie powtarzać bez końca pobierania przy HTTP 429.
- [ ] Sprawdzić `reconstructFullSentenceCues()` i `alignSlaveTrackToMaster()` dla luk, nakładających się kwestii, opóźnionego Native language i bardzo długich połączonych zdań.
- [ ] Nie tworzyć wyświetlanych pełnych zdań przekraczających sensowne granice sceny tylko po to, aby osiągnąć jeden rząd; rozdzielić rekonstrukcję kontekstu od prezentacji.
- [ ] Przy prędkościach 0.75×, 1×, 1.5× i 2× sprawdzić, że oba rzędy przechodzą do właściwej kwestii, a zamknięcie tooltipu nie cofa czasu.
- [ ] Kryterium odbioru: obejrzeć film YouTube, przejść przez kilka Shortsów, użyć `S`, hover i `Escape`, wrócić do filmu — żaden skrót nie uruchamia poprzedniego materiału.

## 9. P1 — minimalistyczny interfejs i pierwsze uruchomienie

- [ ] Uporządkować istniejące widoki wokół nauki, zapisanych słów/powtórek i ustawień; zmniejszyć liczbę konkurujących przycisków i powtórzonych opisów.
- [ ] Na początku ustawień umieścić dwa jednoznaczne pola: „Uczę się” i „Tłumacz na”, z widoczną parą języków i jedną akcją zamiany.
- [ ] Zachować tylko ustawienia wpływające na codzienną naukę w podstawowym widoku; rzadkie opcje rozwinąć w istniejącej sekcji zaawansowanej zamiast tworzyć nowe obowiązkowe kroki.
- [ ] Zastosować wspólne rozmiary przycisków, ikon, odstępów, pól i stanów: gotowe, ładowanie, zapisano, niedostępne, błąd.
- [ ] Ograniczyć dekoracje, gradienty, emotikony i duże banery w codziennym przepływie; jeden akcent dla aktywnej akcji, odpowiedni kontrast i widoczny fokus.
- [ ] Dodać krótkie opisy działania przycisków na hover i fokus, w tym odczytu, zapisu, synchronizacji, eksportu i przełączania trybu; ikony muszą mieć dostępne nazwy.
- [ ] Dla samego opisu stosować tooltip, który zamyka `Escape` i nie zabiera fokusu. Szczegóły słowa z przyciskami odczytu/zapisu traktować jako interaktywny panel, nie `role="tooltip"` z ukrytymi kontrolkami. [Wzorzec WAI-ARIA](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/).
- [ ] Utrzymywać podpowiedzi w granicach odtwarzacza i pełnego ekranu. Przy użyciu Popover/Anchor Positioning ustalić minimalną wersję Chrome i lokalny fallback; nie pobierać kodu interfejsu z CDN.
- [ ] Zastąpić blokujące `alert()` komunikatami przy właściwej akcji, z opisem problemu i jednym sensownym następnym krokiem.
- [ ] Pokazywać potwierdzenie zapisu krótko i lokalnie; stan nie może znikać przed końcem zapisu ani odnosić się do innego słowa.
- [ ] Uprościć ekran pustych słów/powtórek: jedno zdanie wyjaśnienia i akcja rozpoczęcia nauki; bez pustych tabel, technicznych liczników i nieaktywnych ozdobników.
- [ ] Dodać jednorazowe wprowadzenie po pierwszej instalacji: wybór dwóch języków, przykład kliknięcia/hover, `S`, `Enter` oraz zapis do powtórek. Umożliwić pominięcie i ponowne otwarcie z pomocy.
- [ ] Interpretować „trial co i jak robić” z `todo.md` jako przewodnik pierwszego uruchomienia. Jeśli ekran przedstawia również próbę płatnego planu, pokazać jej warunki i pozostawić osobną świadomą akcję rozpoczęcia subskrypcji.
- [ ] Wprowadzenia nie otwierać po każdym update, restarcie workera ani logowaniu; zapisać wersję i ukończenie przewodnika.
- [ ] Przygotować jedną krótką ściągę skrótów odpowiadającą faktycznie wdrożonym stanom, w tym opcjonalnym strzałkom w `S`.
- [ ] Sprawdzić całą ścieżkę bez myszy i z powiększeniem 200%; nie gubić fokusu przy przełączeniu zakładek i zamykaniu paneli.
- [ ] Kryterium odbioru: nowy użytkownik potrafi wybrać języki, zrozumieć słowo w filmie i dodać je do powtórek bez czytania dokumentacji projektu.

## 10. P0/P1 — fiszki, SRS i konkretny eksport Anki

**Potwierdzone:** `SharedWordRepository` kolejkuje `saveWord()` tylko w jednej instancji modułu, a inne mutacje wykonują odczyt i nadpisanie całej tablicy. Lokalna próba równoległego `updateWord()` i `saveWord()` zgubiła aktualizację istniejącej fiszki. Eksport Anki w `popup/export.js` preferuje `aiSentence` przed oryginalnym kontekstem i dołącza rozbudowane treści AI.

- [ ] Ustalić jeden właściciel zapisu fiszek w workerze oraz wspólną kolejkę wszystkich mutacji: zapis, edycja, usunięcie, ocena SRS, oznaczenie eksportu i aktualizacja obrazka.
- [ ] Zapewnić trwałość operacji wymagających dokończenia po restarcie workera; sama kolejka Promise w pamięci nie wystarcza dla operacji już potwierdzonych użytkownikowi.
- [ ] Testować równoczesny zapis z dwóch kart oraz zapis równoległy do powtórki, synchronizacji i wysłania screenshota. Żadna istniejąca zmiana nie może znikać.
- [ ] Uwzględniać parę języków i właściwe znaczenie/kontekst w deduplikacji; takie samo słowo w innym języku nie jest automatycznie duplikatem.
- [ ] W powtórkach i eksporcie używać języków zapisanej fiszki, a nie wyłącznie bieżących ustawień. Zmiana nauki z EN na JA nie zmienia języka starych kart.
- [ ] Uprościć domyślną kartę Anki: przód — słowo/fraza; tył — krótki odpowiednik; ewentualnie jedno autentyczne zdanie z materiału i jego tłumaczenie.
- [ ] Usunąć z domyślnego eksportu komentarze AI, wykłady gramatyczne, powtórzone nagłówki, instrukcje i dekoracyjne bloki. Nie wybierać automatycznie przykładu AI zamiast oryginalnego zdania.
- [ ] Zachować wartościowe dane w repozytorium fiszek; uproszczenie szablonu eksportu nie powinno kasować kontekstu ani notatek użytkownika.
- [ ] Poprawić eksport mediów: rzeczywiste nazwy plików audio/obrazów i poprawne odwołania Anki, bez polegania na niesprawdzonych data URI. Format pliku musi odpowiadać rozszerzeniu.
- [ ] Po usunięciu Google Translate nie obiecywać pliku MP3 z samego `speechSynthesis`. Jeśli nie ma dostępnego nagrania z obsługiwanej usługi, wyeksportować poprawną kartę bez audio.
- [ ] Rozdzielić odczyt przodu i tyłu karty według ich języków, a screenshot traktować jako opcjonalny dodatek bez blokowania zapisu słowa.
- [ ] Oprzeć Cloze na wspólnej tokenizacji Unicode; obecna ścieżka oparta na alfabecie łacińskim wymaga poprawy dla JA/KO i znaków diakrytycznych.
- [ ] Sprawdzić, czy centralne stop words są rzeczywiście odpowiednie dla języka źródła; jedna lista angielska nie jest regułą dla wszystkich języków.
- [ ] Nie oznaczać kart jako wyeksportowane, jeśli zapis/pobranie artefaktu się nie udało; ponowienie ma zachować wybór i nie tworzyć niechcianych duplikatów.
- [ ] Ręcznie zaimportować wynik do Anki: zwykłe słowo, fraza, PL → JA, JA → PL, karta ze screenshotem/audio i karta bez mediów.
- [ ] Kryterium odbioru: karta zawiera konkretny materiał do nauki bez wyjaśnienia AI, media działają, a równoległy zapis i ocena powtórki nie gubią danych.

## 11. P1 — quiz działa za pierwszym razem i czyta właściwym głosem

**Potwierdzone:** przycisk quizu w `popup/export.js` blokowany jest dopiero po kilku `await`, co dopuszcza wyścig kliknięć. Błąd zapisu licznika po wygenerowaniu wyniku może zostać pokazany jako błąd generowania. `shared/quiz-export.js` zapisuje wynik pod wspólnym `latestQuizHtml`, a odczyt pytań/opcji często dostaje jeden `srcLang`, mimo mieszanej treści.

- [ ] Ustawić blokadę operacji natychmiast po kliknięciu, przed pierwszym `await`; zwalniać ją w jednym `finally`, także przy błędzie sprawdzania limitu i ładowania modułu.
- [ ] Nadać generowaniu identyfikator zadania i oddzielić etapy: sprawdzenie danych, generacja, walidacja, zapis, otwarcie/pobranie i aktualizacja użycia.
- [ ] Przy błędzie pokazywać konkretny etap i możliwość ponowienia od niego. Poprawnie utworzony quiz nie powinien znikać z powodu późniejszego błędu licznika.
- [ ] Walidować kompletność pytań, liczbę odpowiedzi, poprawny indeks rozwiązania, języki, duplikaty i puste pola przed otwarciem quizu.
- [ ] Zapisywać quiz pod identyfikatorem zadania zamiast jednego globalnego klucza; dwa okna lub dwie operacje nie mogą nadpisać sobie treści.
- [ ] Oczekiwać na rzeczywiste zakończenie zapisu i otwarcia karty; obsłużyć `chrome.runtime.lastError`, brak miejsca i zamknięcie popupu.
- [ ] Zachować gotowy wynik przy nieudanym otwarciu, aby „Otwórz ponownie” nie generowało i nie naliczało tego samego quizu ponownie.
- [ ] Rozdzielić język instrukcji, pytania, przykładu i odpowiedzi w danych quizu. Każdy fragment TTS ma dostać własny jawny kod języka.
- [ ] Nie czytać jedną wypowiedzią mieszanki polskiej instrukcji i japońskiej odpowiedzi; zbudować kolejkę fragmentów z właściwymi głosami i krótkimi przerwami.
- [ ] Ujednolicić dobór głosu z `SharedTtsService`; dla eksportowanego samodzielnego quizu dołączyć potrzebny kod lokalnie w artefakcie, bez założenia istnienia globalnych modułów rozszerzenia.
- [ ] Usunąć stały angielski fallback oraz dublujące się fallbacki mowy z obsługi `error` i odrzuconego `play()`. Jedna próba nie może uruchomić dwóch głosów.
- [ ] Anulować poprzednią wypowiedź po zmianie pytania, ponownym kliknięciu odczytu lub zamknięciu quizu; poczekać na dostępne głosy po `voiceschanged`, gdy są ładowane później.
- [ ] Obsłużyć brak głosu języka docelowego czytelną informacją, zamiast po cichu wybierać głos niewłaściwego języka.
- [ ] Sprawdzić oba warianty quizu: uruchamiany w rozszerzeniu i wyeksportowany, także offline w zakresie funkcji niewymagających sieci.
- [ ] Dodać regresje dla podwójnego kliknięcia, powolnej odpowiedzi, timeoutu, błędnego JSON, końca limitu, awarii zapisu oraz zmiany języka podczas generowania.
- [ ] Kryterium odbioru: pojedyncze kliknięcie prowadzi do gotowego quizu lub jednoznacznego błędu z ponowieniem; mieszane pytanie jest czytane we właściwych językach i tylko raz.

## 12. P0/P1 — synchronizacja, wylogowanie i usuwanie konta

**Potwierdzone:** `background.js` planuje wysłanie zmian około 60 sekund od ostatniej lokalnej zmiany, resetując ten termin przy kolejnych zmianach. To nie jest pełna synchronizacja co minutę: pobranie danych z serwera jest osobną ścieżką. `fullSync()` może ponownie wysłać lokalną fiszkę nieobecną na serwerze, przez co drugie urządzenie może odtworzyć wcześniej usunięty wpis. Wylogowanie używa `chrome.storage.local.clear()`. Backend usuwania konta potrafi zwrócić sukces po przechwyceniu błędów usunięcia części zasobów.

- [ ] Opisać aktualną synchronizację zgodnie z kodem i pokazać w popupie ostatni sukces, oczekujące zmiany oraz stan offline; przycisk „Synchronizuj” ma mieć jednoznaczną funkcję.
- [ ] Zachować grupowanie zapisów, ale dodać maksymalny czas oczekiwania, aby ciągłe zmiany nie odkładały synchronizacji bez końca.
- [ ] Zdefiniować osobno wysyłanie zmian i pobieranie zmian z innych urządzeń; dobrać częstotliwość pobierania do aktywności użytkownika i kosztów, zamiast obiecywać synchronizację „na żywo”.
- [ ] Zapisywać trwałe znaczniki usunięcia fiszek po stronie serwera i klienta, aby drugie urządzenie rozpoznało usunięcie zamiast przywracać wpis.
- [ ] Ustalić konflikt edycja–edycja, edycja–usunięcie i ocena SRS–edycja. Zachować stabilne ID i wersje operacji; sam zegar urządzenia nie powinien być jedynym rozstrzygnięciem.
- [ ] Utrwalać kolejkę niewysłanych zmian, ponawiać ją z ograniczonym opóźnieniem i obsłużyć restart workera. Nie opierać wymaganej trwałości na zmiennych globalnych. [Cykl życia workera MV3](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).
- [ ] Rozdzielić preferencje urządzenia, dane konta i stan logowania. Wylogowanie ma zachować języki i ustawienia UI zamiast wywoływać globalne `storage.local.clear()`.
- [ ] Umożliwić kontrolowane wylogowanie offline: zapisać stan oczekujących zmian i jasno pokazać ich status; błąd `fullSync()` nie może bez wyjaśnienia blokować wylogowania.
- [ ] Oddzielić lokalne dane różnych kont; po zalogowaniu jako inny użytkownik nie synchronizować fiszek poprzedniego konta.
- [ ] W usuwaniu konta rozróżnić „rozpoczęto”, „częściowo wykonano”, „nie udało się” i „zakończono”. Nie pokazywać trwałego usunięcia, jeśli R2, Firestore lub Auth zgłosiło błąd.
- [ ] Zaplanować wznawialną operację usunięcia i sprawdzić powiązaną subskrypcję Stripe; komunikat w UI ma odpowiadać rzeczywistemu losowi rozliczeń i danych.
- [ ] Przetestować dwa urządzenia: zapis A → odczyt B, edycja w obu, usunięcie A → synchronizacja B, praca offline, restart Chrome oraz późniejsze zalogowanie.
- [ ] Kryterium odbioru: usunięte fiszki nie wracają, zmiany SRS nie znikają, ustawienia języków zostają po wylogowaniu, a sukces usunięcia konta jest prawdziwy.

## 13. P1/P2 — usunięcie Google Translate i jednolite naliczanie użyć

**Zakres z `todo.md`:** usunąć limit `15,000 chars/h translate` dla Free, wycofać oba endpointy Google Translate i liczyć użycia funkcji AI dla każdego planu również wtedy, gdy wynik jest już w R2. Obecny `handleLiveTranslation()` zwraca trafienie R2 przed `reserve()`, a klient może odczytać słownik bezpośrednio; samo przeniesienie jednej instrukcji na backendzie nie zamknie całego przepływu.

- [ ] Usunąć regułę 15 000 znaków/h ze wspólnej i backendowej konfiguracji, sprawdzania uprawnień, liczników, Settings, opisów planów i dokumentacji; nie zastępować jej ukrytym odpowiednikiem.
- [ ] Usuwać limit na podstawie jego klucza i funkcji, nie samej liczby `15000`; zachować niezależne limity znaków TTS, w tym ElevenLabs, dopóki osobne zadanie ich nie zmienia.
- [ ] Prześledzić wszystkie odwołania do `translate.googleapis.com` i `translate.google.com`, w tym fallback `QT.translate`, tłumaczenia stron, napisów i odczyt eksportowanych quizów.
- [ ] Zastąpić potrzebne tłumaczenia istniejącym backendem i wspólną usługą; dla mowy użyć zatwierdzonej ścieżki TTS. Dopiero po usunięciu zależności usunąć domeny z manifestu i innych konfiguracji.
- [ ] Zachować działanie logowania Google/Firebase — usunięcie domen Google Translate nie oznacza usunięcia niezależnych endpointów OAuth i uwierzytelniania.
- [ ] Ustalić jednoznaczną jednostkę naliczania: świadome użycie tłumaczenia/wyjaśnienia rozliczane według funkcji, niezależnie od nowej generacji, R2 i lokalnej kopii wyniku.
- [ ] Opisać koszt `S` z wieloma słowami: ile użyć zużywa zdanie i poszczególne brakujące znaczenia. Zastosować tę samą regułę dla Free, Basic i Pro, a przed masowym pobraniem pokazać ją zrozumiale.
- [ ] Rozróżnić ponowne użycie funkcji od odmalowania już otwartego UI. Render, zmiana fokusu między chmurką i jej tooltipem oraz retry tej samej operacji nie mogą przypadkowo naliczać wielokrotnie.
- [ ] Egzekwować naliczanie na backendzie także dla trafień R2 i lokalnych wyników używanych w nowej operacji; nie ufać licznikowi ani deklaracji `cached` przesłanej przez klienta.
- [ ] Dla rozliczanych odczytów usunąć z przepływu aplikacji możliwość obejścia backendu przez bezpośredni odczyt publicznego R2. Oddzielić cache transportowy od uprawnienia do wykonania funkcji.
- [ ] Nadać operacjom identyfikatory idempotencji i transakcyjny zapis użycia; równoległe karty, automatyczne ponowienie i timeout nie mogą pobierać dwóch użyć za tę samą operację.
- [ ] Utrzymać określoną politykę zwrotu użycia za niedostarczony wynik i błąd walidacji; naprawa techniczna odpowiedzi w tym samym zadaniu nie powinna naliczać się jako nowe kliknięcie użytkownika.
- [ ] Oddzielić zużycie produktu od kosztu dostawcy: wynik R2 może zużywać limit produktu bez nowej generacji Gemini. Wyjaśnić to w opisach planów bez sugerowania, że każde użycie oznacza nowe wywołanie modelu.
- [ ] Sprawdzić wszystkie ścieżki: hover, `S`, `Enter`, zaznaczenie na stronie, powtórki, quizy, cache pamięci, IndexedDB/R2, statyczne frazy i generację przy braku wpisu; jawnie przypisać każdą do reguły produktu.
- [ ] Zachować zwykły odczyt gotowych napisów platformy poza licznikiem funkcji AI; ujednolicenie limitów nie powinno przypadkowo naliczać samego oglądania.
- [ ] Zaktualizować zgodność `shared/subscription-config.js` z `functions/subscription-config.js` oraz testy parytetu; odświeżać UI użycia na podstawie wyniku serwera.
- [ ] Zaktualizować `functions/LIVE_TRANSLATIONS.md`, które obecnie opisuje cache jako darmowy, oraz opisy planów i prywatności po rzeczywistym wdrożeniu nowego przepływu.
- [ ] Kryterium odbioru: dla każdego planu nowe użycie funkcji jest liczone zgodnie z tą samą regułą również z R2; retry nie dubluje użycia; runtime i eksporty nie wywołują usuniętych domen Google Translate.

## 14. P2 — backend i przygotowanie Chrome Web Store

**Do sprawdzenia przed publikacją:** repozytorium nie dowodzi, jaka wersja funkcji i jakie ustawienia działają w chmurze. W lokalnym `functions/firebase.json` ścieżka reguł wskazuje `firestore.rules`, którego nie ma w tym katalogu; reguły znajdują się w `firebase/firestore.rules`. `functions/functions.yaml` i kod zawierają różne deklaracje instancji. Nie traktować tych rozbieżności jako potwierdzenia konkretnego stanu produkcji.

- [ ] Zinwentaryzować wdrożone funkcje: projekt, region, runtime, datę wdrożenia, nazwę endpointu i odpowiadającą wersję kodu; porównać faktyczny ruch rozszerzenia z tym wykazem.
- [ ] Ujednolicić punkt wejścia konfiguracji Firebase i poprawić ścieżki reguł przed użyciem komendy wdrożenia; opisać dokładnie katalog i plik konfiguracyjny.
- [ ] Sprawdzić rzeczywiste limity instancji, pamięć, timeouty i concurrency funkcji generujących tłumaczenia i quizy; dopasować do ograniczeń klienta.
- [ ] Sprawdzić uwierzytelnienie, autoryzację użytkownika i planu, walidację rozmiaru/pól żądania oraz ograniczenie częstotliwości dla każdego endpointu używanego przez klienta.
- [ ] Zweryfikować reguły Firestore na przypadkach dostępu do cudzych fiszek, zmiany planu/limitu i danych usuniętego konta.
- [ ] Sprawdzić komunikację MAIN world ↔ content script: dozwolone typy wiadomości, nadawcę/źródło, identyfikator żądania i filmu, rozmiar danych. Dane strony nie mogą uruchamiać dowolnej uprzywilejowanej akcji.
- [ ] Sprawdzić renderowanie treści napisów, tłumaczeń i quizów jako danych: escapowanie HTML, dozwolone adresy mediów i brak wykonywania kodu zwróconego przez model.
- [ ] Sprawdzić logi: zachować identyfikator operacji, etap i kod błędu, ograniczyć wypisywanie pełnych zdań, odpowiedzi modelu i danych konta; nigdy nie logować tokenów/sekretów.
- [ ] Sprawdzić zachowanie gotowego tłumaczenia przy awarii zapisu R2: zwrócić użyteczny, zwalidowany wynik, jeśli kontrakt na to pozwala, a błąd cache obsłużyć oddzielnie; uzgodnić to z naliczaniem użycia.
- [ ] W manifest i `CHROMEWEBSTORE.md` dopasować uprawnienia oraz domeny do finalnej implementacji, w tym istniejącej funkcji tłumaczenia stron; nie dodawać uprawnień bez rzeczywistego zastosowania.
- [ ] Po zmianach danych i rozliczanych odczytów zaktualizować opis prywatności: co trafia do Gemini, Firebase i R2, co jest publiczne, jak długo jest przechowywane oraz jak użytkownik to usuwa.
- [ ] Zweryfikować dostęp do screenshotów: `functions/r2-storage.js` buduje publiczne URL i ustawia roczny publiczny cache z `immutable`. Oddzielić prywatne media fiszek od współdzielonego słownika, dopasować kontrolę dostępu i cache do usuwania danych oraz poprawić niespójny opis prywatności. Sprawdzić też faktyczną konfigurację bucketu.
- [ ] Zweryfikować logowanie dla ID rozszerzenia w wersji deweloperskiej i sklepowej; skrypt paczki usuwa lokalny `key`, więc trzeba sprawdzić rzeczywisty przepływ logowania po instalacji paczki.
- [ ] Uruchomić `npm run build`, obejrzeć zawartość ZIP i sprawdzić obecność zasobów z manifestu oraz brak sekretów, backendu, testów i notatek roboczych.
- [ ] Ręcznie wczytać gotowy artefakt do czystego profilu Chrome i wykonać instalację, konfigurację języków, logowanie, napisy, zapis słowa i powtórkę.
- [ ] Odświeżyć zrzuty, opis funkcji, wersję i uzasadnienia uprawnień w `CHROMEWEBSTORE.md` dopiero według działającej wersji; sprawdzić aktualne wymagania sklepu w momencie przygotowania publikacji.
- [ ] Kryterium odbioru: gotowa paczka odpowiada dokumentacji, korzysta z właściwego backendu i przechodzi ręczny scenariusz pierwszej instalacji.

## 15. P2 — wszystkie koszty i marża z `todo.md`

Ten etap ma zakończyć się policzonym modelem kosztów na podstawie rzeczywistych rachunków, metryk i aktualnych oficjalnych cenników. Nie wpisywać szacowanych stawek jako zweryfikowanych danych. Wyniki rozdzielić na pomiary, założenia i niewiadome.

- [ ] Przygotować zestawienie: usługa, operacja, jednostka naliczania, liczba operacji, koszt jednostkowy, koszt miesięczny, koszt na aktywnego użytkownika oraz źródło i data danych.
- [ ] Rozpisać Cloudflare R2: operacje odczytu/zapisu/listowania/usuwania, przechowywanie słownika, audio i zdjęć, dostęp przez publiczny adres oraz rzeczywisty sposób cache'owania.
- [ ] Zmierzyć, ile zapytań powstaje przy jednym hover, całym `S`, `Enter`, zapisie fiszki, powtórce, synchronizacji, eksporcie i quizie; uwzględnić powtórzenia po błędzie.
- [ ] Policzyć Firestore: odczyty i zapisy użytkownika, słów, limitów, blokad generacji, znaczników usunięcia, synchronizacji i danych Stripe.
- [ ] Osobno zweryfikować koszt i wykorzystanie Cloud Firestore API, Secret Manager API, Token Service API, Firebase Authentication/OAuth oraz pozostałych pozycji faktycznie widocznych w rachunkach; sprawdzić, które są tylko nazwami API tej samej usługi, aby nie liczyć podwójnie.
- [ ] Dla `geminiProxy` zebrać liczbę żądań, czas wykonania, instancje, rozmiary wejścia/wyjścia, retry, udział R2 oraz odrzucone/naprawiane wyniki.
- [ ] Zweryfikować dokładny identyfikator i aktualną dostępność używanego modelu Gemini — w notatce jest „gemini 2.5 lite” — oraz policzyć tokeny wejściowe/wyjściowe według aktualnego cennika właściwego modelu.
- [ ] Dla ElevenLabs policzyć znaki, liczbę generacji, ponowne odczyty z cache, plan dostawcy i koszt na plan Free/Basic/Pro.
- [ ] Osobno zmierzyć screenshoty fiszek: średni rozmiar, limit na użytkownika, czas przechowywania, przesyłanie, odczyty, usuwanie i osierocone pliki; sprawdzić prywatność publicznych linków.
- [ ] Zweryfikować użycie i koszt `createStripePortalSession`, `stripeWebhook`, `createStripeCheckoutSession` oraz `stripeCheckoutResult`.
- [ ] Zweryfikować, czy nadal działają `ext-firestore-stripe-payments-createCheckoutSession`, `ext-firestore-stripe-payments-createCustomer` i `ext-firestore-stripe-payments-handleWebhookEvents`, oraz czy nie dublują własnej integracji.
- [ ] Tak samo sprawdzić `ext-firestore-stripe-payments-onCustomerDataDeleted`, `ext-firestore-stripe-payments-createPortalLink` i `ext-firestore-stripe-payments-onUserDeleted`; odnotować brak wdrożenia zamiast zakładać, że każda nazwa z notatki generuje koszt.
- [ ] Policzyć prowizje płatności, przewalutowanie, zwroty, nieudane płatności i okres próbny oddzielnie od kosztu uruchamiania funkcji obsługujących Stripe.
- [ ] Zbudować scenariusze dla Free, Basic i Pro: mała aktywność, typowa aktywność i wykorzystanie całego limitu, przy niskim oraz wysokim trafieniu w cache.
- [ ] Obliczyć marżę jako przychód netto minus koszty dostawców i obsługi płatności; koszty stałe pokazać oddzielnie, a następnie policzyć próg rentowności całego projektu.
- [ ] Sprawdzić wpływ nowego naliczania cache na limit użytkownika i faktyczny koszt — to dwie różne wartości.
- [ ] Dobrać limity, rozmiary obrazów, cache i częstotliwość synchronizacji do wyników pomiaru; zaplanować alerty budżetowe i wykrywanie gwałtownego wzrostu żądań.
- [ ] Kryterium odbioru: wiadomo, ile kosztuje typowy i maksymalnie aktywny użytkownik każdego planu, jaka pozostaje marża oraz które dane nadal wymagają pomiaru.

## 16. P2 — czytelny kod i aktualna dokumentacja

**Potwierdzone:** `video/subtitle-overlay.js` ma ponad 4100 linii i łączy wiele odpowiedzialności. `package.json → npm run audit` wskazuje nieistniejący `scratch/scan_all_unused.js`. Dokumentacja zawiera rozbieżności, np. opis braku AI w Word-by-word przy istniejącej generacji brakujących słów oraz niezgodny z kodem opis obsługi awarii zapisu R2.

- [ ] Najpierw zabezpieczyć przepływy testami zachowania, a dopiero potem wydzielać komponenty; nie przepisywać całej wtyczki jednocześnie z naprawą kierunku języków.
- [ ] Wydzielić z istniejącej nakładki odpowiedzialności: sesja odtwarzacza, prezentacja napisów, szczegóły słowa, `S`, `Enter` i zapis. Zachować cienką warstwę koordynującą.
- [ ] Utrzymać jeden router skrótów i jeden kontroler pauzy/wznowienia dla UI wideo.
- [ ] Utrzymać jeden tokenizer i jedną regułę czyszczenia prezentacji napisów, oddzieloną od czyszczenia danych fiszki i tekstu TTS.
- [ ] Utrzymać wspólną usługę języków, klienta tłumaczeń, repozytorium fiszek, dobór głosu i definicję limitów; nie kopiować reguł do nowo wydzielanych modułów.
- [ ] Przy każdym nowym pliku aktualizować kolejność ładowania w manifest/popup/workerze oraz mapę zależności w `GUIDE.md`.
- [ ] Ograniczyć globalny stan; każda sesja ma mieć jawne rozpoczęcie, anulowanie i sprzątanie listenerów, observerów, timerów i elementów DOM.
- [ ] Dla kosztownych zmian DOM wykonywać pracę partiami i mierzyć opóźnienie interakcji; nie przebudowywać całych napisów przy każdym ruchu myszy.
- [ ] Naprawić `npm run audit`: wskazać utrzymywany skrypt albo usunąć nieaktualne polecenie i zastąpić je realną kontrolą. Nie traktować wyszukania nieużywanego selektora jako wystarczającej podstawy do usunięcia dynamicznego UI.
- [ ] Wyeliminować ręczne rozjeżdżanie konfiguracji planów klient/serwer przez jeden generowany kontrakt lub równoważne wspólne źródło oraz test parytetu.
- [ ] Poprawić `GUIDE.md` i `functions/LIVE_TRANSLATIONS.md` według rzeczywistej implementacji: kierunek języków, cache, generacja `S`, błędy zapisu R2, synchronizacja i naliczanie.
- [ ] Sprawdzić odwołania dokumentacji do brakujących plików, w tym `stripe.md`, oraz uporządkować instrukcję wdrożenia i konfiguracji Stripe.
- [ ] Utrzymać `plan.md` jako checklistę realizacji, a `GUIDE.md` jako opis działającej architektury; zakończone zadanie odhaczać dopiero po weryfikacji i aktualizacji dokumentacji.
- [ ] Kryterium odbioru: dodanie nowego źródła napisów lub zmiana sposobu renderowania nie wymaga kopiowania tłumaczeń, skrótów, zapisu i TTS między modułami.

## 17. Testy odbiorowe całego rozwiązania

Każdy scenariusz sprawdzić osobno na YouTube i Netflixie, jeśli dotyczy obu. Test automatyczny nie zastępuje ręcznego sprawdzenia stylu, głosu, fokusu i aktywnego odtwarzacza.

- [ ] EN → PL: zwykły wyraz, fraza, `I`, `like`, hover, `S`, `Enter`, zapis i odczyt działają w poprawnych językach.
- [ ] PL → JA: `pies`, `książka` i słowo odmienione mają japońskie znaczenie; polski synonim nie przechodzi jako poprawne tłumaczenie.
- [ ] JA → PL: słowa w zdaniu bez spacji można wybrać i przetłumaczyć; walidacja nie wymaga łacińskiej granicy wyrazu.
- [ ] DE → PL i FR → PL: znaki diakrytyczne oraz odmiana nie powodują fałszywego błędu słownika.
- [ ] EN → JA i PL → KO: prompty nie wstawiają polskich odpowiedników do innego języka docelowego.
- [ ] Wszystkie języki obsługiwane w Settings: test kontraktu i routingu w obu rolach; jawnie oznaczyć języki/pary wymagające jeszcze ręcznej oceny jakości tłumaczenia.
- [ ] Zmiana języka w trakcie wolnego żądania: stary wynik, tooltip i TTS nie pojawiają się po zmianie ustawień.
- [ ] Niepoprawny historyczny wpis w R2: zostaje pominięty/naprawiony zgodnie z wersją walidacji, bez utraty fiszek.
- [ ] Native language: hover, klik, zaznaczenie i klawiatura nie uruchamiają narzędzi nauki ani tokenizacji, także po zmianie fullscreen.
- [ ] `S` bez strzałek: zachowane dotychczasowe odtwarzanie, zapis zdania i zamknięcie; nowy hover działa bez zmiany tego kontraktu.
- [ ] `S` z `←`/`→`: właściwa pozycja, brak wyjścia poza listę, `Z` zapisuje wybraną pozycję, a film nie jest przewijany.
- [ ] `S` z nazwą własną, nieznanym słowem i awarią jednego żądania: cały napis pozostaje dostępny, a pozostałe tłumaczenia działają.
- [ ] `Enter`: strzałki, odczyt, zapis, zatrzymanie automatycznego przejścia i powrót do filmu działają po scaleniu skrótów.
- [ ] Szybki zapis → strzałka → zamknięcie UI: stan „Zapisano” dotyczy właściwej fiszki, a odpowiedź nie otwiera ponownie zamkniętego panelu.
- [ ] Długie napisy i interpunkcja: jedna linia na język, kompletna treść dostępna, brak kolizji chmurek, zachowane apostrofy/łączniki/liczby.
- [ ] YouTube → Shorts → kolejny Shorts → Wstecz oraz Netflix → kolejny odcinek: żaden stary film ani napis nie wraca.
- [ ] Brak sieci, HTTP 429, timeout, brak ścieżki, koniec limitu i wygaśnięte logowanie: zachowany tekst, spokojny komunikat i kontrolowane ponowienie.
- [ ] Anki: import, wygląd obu stron, Unicode, krótkie treści bez wyjaśnień AI i poprawne media.
- [ ] Quiz: pojedyncze/podwójne kliknięcie, ponowne otwarcie gotowego wyniku i mieszane języki TTS w wersji wtyczkowej oraz eksportowanej.
- [ ] Dane: równoległe mutacje fiszek, dwa urządzenia, usunięcia, restart workera, offline oraz wylogowanie bez utraty ustawień.
- [ ] Free/Basic/Pro: poprawne użycie z generacji, R2 i lokalnej kopii; idempotentne ponowienie, prawidłowy zwrot i spójny licznik w UI.
- [ ] Wykonać test klawiatury, fokusu, powiększenia 200%, kontrastu oraz podpowiedzi przy krawędziach i w pełnym ekranie.
- [ ] Uruchomić po implementacji `npm test` i `npm run check:syntax`; rozszerzyć istniejące zestawy testów zamiast tworzyć testy sprawdzające jedynie obecność tekstu w kodzie.
- [ ] Po przejściu testów zbudować i sprawdzić finalną paczkę; zapisać osobno wynik testów kodu, ręcznych prób Chrome i weryfikacji backendu.

## 18. Kolejność wdrożenia i warunek zakończenia

- [ ] **Partia 1 — poprawność języków:** sekcje 1–4, wersjonowanie wadliwych wpisów i testy par języków. Efekt: uczę się wybranego języka i otrzymuję właściwe tłumaczenie; Native language jest nieinteraktywne.
- [ ] **Partia 2 — dane:** krytyczne zapisy z sekcji 10 i 12 oraz stabilne ID zapisu z sekcji 6. Efekt: nowe interakcje nie gubią fiszek i nie oznaczają złej pozycji jako zapisanej.
- [ ] **Partia 3 — nauka na filmie:** sekcje 5–8, w kolejności wspólna sesja/skróty → hover i stany braków → strzałki → wygląd i długie kwestie → pełne sprawdzenie Shorts. Efekt: codzienny przepływ `S`/`Enter` jest przewidywalny.
- [ ] **Partia 4 — prostota i materiały:** sekcje 9–11 oraz pozostała synchronizacja. Efekt: prosty start, konkretne Anki, stabilny quiz i poprawny odczyt.
- [ ] **Partia 5 — limity i utrzymanie:** sekcje 13–16. Zmianę naliczania wdrażać jako zgodny kontrakt backendu i klienta; uwzględnić okres, w którym część użytkowników ma starszą wersję rozszerzenia.
- [ ] **Partia 6 — odbiór i publikacja:** cała sekcja 17, zgodna dokumentacja, policzone koszty i finalna paczka. Backend oraz interfejs muszą być sprawdzone w zgodnych wersjach.
- [ ] W każdej partii robić małe, niezależnie sprawdzalne zmiany; po wydzieleniu modułu najpierw potwierdzić dotychczasowe działanie, a potem zmieniać UX.
- [ ] Przed zmianami schematów/cache przygotować odwracalną migrację i sposób powrotu do poprzedniej wersji bez kasowania słów użytkownika.
- [ ] Przy każdym odhaczonym zadaniu dopisać krótki wynik weryfikacji lub odnośnik do testu/commita; problemy wymagające ręcznej próby pozostawić otwarte do czasu jej wykonania.
- [ ] Uznać plan za zrealizowany po zamknięciu wszystkich wymaganych zadań i scenariuszy odbioru; sama zmiana CSS, usunięcie ostrzeżenia lub zielony test jednostkowy nie kończą naprawy przepływu. -->
