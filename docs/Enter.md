# Enter — analiza zdania AI w Lectoro

Stan analizy: 26 września 2026. Dokument opisuje aktualny kod repozytorium. Wygląd odtworzono z renderera DOM i CSS; nie jest to wynik wizualnego testu rozszerzenia w odtwarzaczu.

## 1. Przeznaczenie

**Enter / Q** otwiera analizę aktualnego napisu i zatrzymuje film. Pierwszy krok pokazuje tłumaczenie całego zdania na język ojczysty, a kolejne — wybrane przez AI słowa, idiomy i zwroty wraz ze znaczeniem oraz opcjonalnym wyjaśnieniem. Treść jest odczytywana przez lektora i można ją zapisać do powtórek.

Funkcja korzysta ze wspólnego kontrolera wideo oraz rejestru adapterów odtwarzaczy. Dostępność zależy od wykrycia wideo i tekstu napisów. Gdy nie ma bieżącego napisu, kod próbuje użyć ostatniego wpisu historii napisów. Bez żadnego tekstu kończy działanie.

### Dobór materiału do nauki

Instrukcja AI obejmuje całe zdanie: najpierw pełne phrasal verbs, idiomy, wyrażenia wielowyrazowe (MWE), kolokacje, utarte formuły i lexical chunks, a następnie przydatne słowa oraz konstrukcje gramatyczne A1–C2. Zasady dotyczą wszystkich 11 obsługiwanych języków i ich własnych konstrukcji.

Wykluczone są trywialne wtrącenia i zwroty konwersacyjne (np. `Oh, okay`, `Yeah`), a także podstawowe pojedyncze zaimki i proste formy czasowników (np. `My`, `I am`, `It is`), chyba że stanowią nierozerwalną część idiomu. Model i reguły serwisowe usuwają zbędne zagnieżdżone podfrazy (np. przy ekstrakcji `Let's keep it goin'` nie powiela się `keep it goin'`). Skróty i formy potoczne są zapisywane zwięźle jako skrót i forma bazowa (np. `goin' → going`, `wanna → want to`), bez zbędnych opisów w stylu `Nieformalne skrócenie od 'going'`.

Zwroty zachowują postać z napisu, łącznie z odmianą i wtrąconymi zaimkami: `scare him off`, `called me back`, `Ruf mich an`. Model ma dobierać znaczenie do sceny, rozróżniać `take care` i `take care of` oraz interpretować `call it` bez automatycznego uznawania go za phrasal verb. Nie wolno dopowiadać brakującej części zwrotu.

Znaczenie ma być jednym naturalnym odpowiednikiem w języku ojczystym, zwykle 1–6 słów. Instrukcja wyklucza kalki językowe, listy synonimów, komentarze i powtórzenia. Wyjaśnienie jest domyślnie puste. Jeśli tłumaczenie wystarcza, musi pozostać puste: np. `leave in the night` → `wyjechać w nocy` nie wymaga definicji wyjazdu nocą. Jedno proste zdanie do 12 słów jest uzasadnione tylko niezbędną nową informacją o nieoczywistym użyciu. Dla skrótów podawana jest wyłącznie zwięzła forma `skrót → forma`. Opis nie zawiera obcojęzycznych wtrąceń, cytowanych przykładów ani cudzysłowów jako formatowania. Oryginalny zwrot pozostaje w polu terminu.

Serwis przyjmuje typy `vocabulary`, `idiom`, `phrasal_verb`, `slang`, `contraction`, `reduced_form`, `collocation`, `fixed_phrase`, `lexical_chunk`, `mwe`, `expression`, `phrase` i `grammar`. Formy potoczne, np. `wanna`, `gonna`, `gotta`, `lemme` i `gimme`, mają być uwzględniane w oryginalnej pisowni, także obok dłuższego zwrotu. Nie obcina już wyników do 8 pozycji. Sprawdza obecność terminu w zdaniu z normalizacją Unicode, odstępów i apostrofów; odrzuca duplikaty, zagnieżdżone podfrazy oraz przypadkowe fragmenty innych słów. Obsługuje również tekst japoński bez spacji. Nadal odrzuca nazwy własne i elementy bez znaczenia.

## 2. Jak wygląda interfejs

Dymek jest ciemną, półprzezroczystą kartą nad napisami. W lewym górnym rogu frazy (idiomy, czasowniki złożone, wyrażenia wielowyrazowe) posiadają subtelne oznaczenie szarym tekstem bez tła (np. `FRAZA`, `CZASOWNIK ZŁOŻONY`, `IDIOM`, zlokalizowane we wszystkich językach). Pojedyncze słowa oraz karta zdania nie wyświetlają tego napisu. Po prawej stronie nagłówka znajdują się strzałki oraz licznik `1/N`. Pod nim znajduje się wyśrodkowana treść i przycisk głośnika. Na dole są dwie akcje: zwykły zapis (`Z`) i wygenerowanie zdania AI z zapisem (`X`). Etykiety są lokalizowane.

Schemat poglądowy, nie zrzut ekranu:

```text
Krok 1 — całe zdanie
╭──────────────────────────────────────────╮
│                                ◀ 1/3 ▶   │
│       Tłumaczenie całego zdania  🔊       │
│──────────────────────────────────────────│
│       Zapisz [Z]      Zdanie AI [X]       │
╰──────────────────────────────────────────╯
               Oryginalne napisy filmu

Kolejny krok — fraza / zwrot
╭──────────────────────────────────────────╮
│ FRAZA                          ◀ 2/3 ▶   │
│              analizowany zwrot 🔊        │
│                 tłumaczenie              │
│          opcjonalne wyjaśnienie użycia    │
│──────────────────────────────────────────│
│       Zapisz [Z]      Zdanie AI [X]       │
╰──────────────────────────────────────────╯
       Napisy z podświetlonym zwrotem
```

### Karta całego zdania

Wyświetla samo tłumaczenie i głośnik. Oryginalnego zdania nie powtarza w treści karty; pozostaje ono w napisach filmu. Choć obiekt kroku przechowuje `explanation`, renderer nie pokazuje wyjaśnienia na etapie `sentence`.

Pierwsza karta tłumaczy bieżący napis w kontekście około 30 sekund przed początkiem i 15 sekund po końcu bieżącego wpisu. Okno zawiera pełne wpisy przecinające jego granice, w kolejności chronologicznej. AI ma najpierw odczytać wypowiedź ponad podziałami napisów, a potem dobrać sens, ton, intencję i odniesienia. Otrzymuje również pełny bieżący wpis, jeśli tłumaczony fragment jest krótszy. Sąsiednie wpisy nie są dopisywane do tłumaczenia karty. Instrukcja zabrania zakładania narkotyków lub euforii wyłącznie na podstawie `high / come down`; przy braku dowodów zachowuje niejednoznaczność.

Prompt nie przycina już kontekstu do 2+2 wpisów ani każdego napisu do 300 znaków. Zachowuje najbliższe pełne wpisy, z limitem 4000 znaków JSON i 120 wpisów na każdą stronę; analogiczny limit dotyczy pełnego bieżącego napisu. Ogranicza to rozmiar żądania bez cięcia zdań w połowie. Wspólny mechanizm kontekstu jest używany także podczas zapisu przez Z. Przy braku ścieżki z czasami dostępne jest do 10 ostatnich zaobserwowanych napisów, bez wymyślania przyszłych wpisów czy ich czasów. Przy dostępnej ścieżce przerwy w dialogu nie są uzupełniane niepowiązaną historią odtwarzania.

### Karta słowa lub zwrotu

Wyświetla termin w kolorze turkusowym `#00ffea`, obok głośnik, poniżej jasne pogrubione znaczenie i opcjonalne wyjaśnienie. Wyjaśnienie jest zwykłym tekstem bez specjalnego formatowania cytatów, zabezpieczonym przez `QT.escapeHtml`.

### Parametry wizualne

Źródło: [styles.css](../styles.css), selektory `#__qt_sentence_translation` oraz `.__qt_ai-explain-overlay`.

| Element | Aktualna konfiguracja |
| --- | --- |
| Tło | `#0f0f23bf`, półprzezroczysty ciemny granat |
| Rozmycie tła | `blur(20px) saturate(1.4)` |
| Narożniki | `16px` |
| Obramowanie | `1px solid rgba(255,255,255,0.08)` |
| Cień | `0 8px 32px rgba(0,0,0,0.4)` oraz wewnętrzna jasna obwódka |
| Maksymalna szerokość | `min(520px, calc(100vw - 24px))` |
| Maksymalna wysokość | `min(560px, calc(100vh - 48px))` |
| Pozycja | `fixed`, `z-index: 2147483647` |
| Typografia bazowa | `14px/1.5`, Inter i fonty systemowe |
| Nawigacja | Małe półprzezroczyste przyciski; niedostępna strzałka ma przezroczystość `0.25` |

`positionOverlay()` kotwiczy kartę najpierw względem aktywnie podświetlonego zwrotu, następnie względem napisów lub zapamiętanej geometrii. Standardowy odstęp wynosi 16 px. Jeśli nad napisami brakuje miejsca, karta przechodzi pod nie. Pozycja jest ograniczana marginesem 12 px od krawędzi okna.

Rozmiary tekstu są wyliczane względem efektywnego rozmiaru napisów, z ograniczeniami:

| Treść | Mnożnik | Zakres |
| --- | --- | --- |
| Termin | 0,58 | 13–30 px |
| Znaczenie i tłumaczenie zdania | 0,48 | 12–26 px |
| Wyjaśnienie | 0,40 | 11–20 px |
| Metadane i licznik | 0,30 | 9–15 px |

### Ładowanie i animacja

Po uruchomieniu pojawia się kompaktowy loader z `✨` i lokalizowanym komunikatem analizy. Po uzyskaniu wyniku mechanizm `revealOverlayContent()` mierzy zawartość, rozszerza kartę i odsłania tekst. CSS przewiduje wejście karty przez 0,2 s, zmianę wymiarów przez 0,22 s i odsłonięcie treści przez 0,13 s. Obramowanie AI wykorzystuje obracany gradient stożkowy w odcieniach fioletu i turkusu. W CSS istnieją reguły ograniczające animacje przy `prefers-reduced-motion`.

### Podświetlenia napisów

Aktualny termin otrzymuje klasę `__qt_ai-sub-active` i turkusowo-fioletowe wyróżnienie. Pozostałe dopasowane elementy kolejki mają fioletowe podświetlenie (`__qt_ai-sub-queued` / `__qt_ai-sub-upcoming`). Wielowyrazowe zwroty mogą być grupowane przez `__qt_ai-sub-wrap`. Kliknięcie dopasowanego elementu napisów pozwala przejść do jego kroku. Nie każde słowo musi mieć odpowiednik w kolejce.

Dopasowanie korzysta z widocznego tekstu, normalizuje Unicode oraz warianty apostrofów i wymaga całego zwrotu. `won't ya` dopasowuje oba słowa w `Won’t ya`, także przy podziale napisów na wiersze. Nie stosuje zastępczego podświetlenia pojedynczego składnika, prefiksów ani podobnych form czasownika. Aktywny zwrot ma pierwszeństwo; nachodzące na niego elementy kolejki nie otrzymują osobnego podświetlenia. Czyszczenie zaznaczeń usuwa również ich stare przypisania kliknięć.

### Elementy, których aktualnie nie widać

Pigułki kredytów AI nie są renderowane w nagłówku (`display: none`). Karta całego zdania oraz pojedyncze słowa słownikowe nie posiadają etykiety typu w nagłówku, natomiast frazy (idiomy, czasowniki złożone, wyrażenia wielowyrazowe) mają w lewym górnym rogu subtelny, szary tekst bez tła. Kod przechowuje metadane analizy i CEFR.

## 3. Sterowanie

Źródło: [universal-video-controller.js](../video/universal-video-controller.js), `handleKeyDown()`, oraz pomocniczy listener w [subtitle-overlay.js](../video/subtitle-overlay.js).

| Klawisz / interakcja | Działanie |
| --- | --- |
| Enter, numeryczny Enter, Q | Otwiera analizę; przy otwartej analizie zamyka ją i wznawia film |
| W, ↑, Escape | Zamyka otwartą analizę i wznawia film |
| D, → | Następny krok analizy |
| A, ← | Poprzedni krok analizy |
| Z, V | Zapisuje aktualny element do powtórek |
| X | Generuje przykładowe zdanie AI i zapisuje kartę |
| Strzałki w nagłówku | Zmieniają krok; nie przechodzą poza granice kolejki |
| Dopasowany zwrot w napisach | Przechodzi do przypisanego kroku |
| Głośnik | Steruje odsłuchem treści |

Kontroler pomija zdarzenia podczas wpisywania tekstu w polu edycji. Przytrzymany Enter/Q nie przełącza wielokrotnie widoku (`e.repeat`). Nawigacja A/D w otwartym trybie AI przełącza kroki zamiast przewijać napisy.

## 4. Przepływ danych i stan

```mermaid
sequenceDiagram
    actor U as Użytkownik
    participant C as Kontroler wideo
    participant O as SubtitleOverlay
    participant T as TranslatorService
    participant P as GeminiProxy / backend
    U->>C: Enter / Q
    C->>O: handleAIExplain(video)
    O->>O: Pobranie napisu, pauza, loader
    O->>T: QT.geminiExplainSentence(text, targetLang, context, options)
    T->>P: Prompt analizy
    P-->>T: Odpowiedź AI
    T-->>O: Zwalidowane translation + items
    O->>O: Kolejka [zdanie, ...elementy]
    O->>U: Karta 1/N, podświetlenia, TTS
```

`handleAIExplain()` wykonuje następujące operacje:

1. Pobiera `activeText`, tekst z rejestru albo ostatni napis z historii.
2. Zwiększa `aiExplainRequestId`; odpowiedź może zmienić widok tylko przy aktywnej sesji i zgodnym identyfikatorze.
3. Kończy czytanie i zamyka tooltip słowa bez wznowienia filmu. Przywraca napisy po innych trybach, usuwa dodatkowe tłumaczenie pod nimi, ustawia `data-lectoro-ai-active` i pauzuje wideo.
4. Zapamiętuje położenie napisów, pobiera cache użycia AI i pokazuje loader.
5. Pobiera język ojczysty przez `QT.getTargetLang()`, język nauki przez `SharedTranslatorService.getLearningLang()` oraz kontekst przez `getActiveSubtitleContext()`.
6. Wywołuje `QT.geminiExplainSentence()`, będące delegacją do `SharedTranslatorService.explainSentence()`. Ten przepływ nie przygotowuje wcześniej tłumaczenia Google.
7. Normalizuje tłumaczenie, odrzuca elementy bez terminu i definicje rozpoznane jako nazwy własne. Buduje kolejkę, której pierwszym elementem zawsze jest całe zdanie.
8. Pokazuje pierwszy krok, aktualizuje podświetlenia i uruchamia TTS.

Serwis tłumaczeń korzysta z promptu w [ai-prompts.js](../shared/ai-prompts.js), sprawdza język źródłowy i docelowy oraz wymagane tłumaczenie. Parametry żądania analizy to temperatura `0.2` i `maxOutputTokens: 8192`; jest to górny limit odpowiedzi, a nie wymagana długość. Tryb samego tłumaczenia zachowuje limit 500 tokenów. Dłuższa analiza może zwiększyć czas i koszt generowania. Warstwę pośredniczącą obsługują [gemini-proxy.js](../shared/gemini-proxy.js), [background.js](../background.js) i backend [functions/index.js](../functions/index.js). W aktualnym kodzie backendu wskazano model `gemini-2.5-flash-lite`; nie jest to weryfikacja konfiguracji wdrożonej usługi.

## 5. Lektor i automatyczne przechodzenie

Wspólny serwis TTS obsługuje teraz Gemini 2.5 Flash TTS z głosami Sulafat i Algieba w miejsce ElevenLabs. Wybrany tryb głosu i limity decydują o użyciu syntezy premium; dostępny pozostaje głos przeglądarki. Szczegóły migracji: [Gemini TTS](Gemini-TTS.md).

Dla całego zdania lektor czyta tłumaczenie w języku ojczystym. Dla słowa/zwrotu bez strzałki czyta najpierw termin w języku nauki, następnie po 350 ms znaczenie i wyjaśnienie w języku ojczystym. Dla elementów zawierających strzałkę (np. skróty i redukcje mówione: `goin'`, znaczenie: `dalej`, objaśnienie: `goin' → going`), lektor odczytuje pełną 3-etapową sekwencję:
1. **Słowo / zdanie (termin)** w języku nauki (`learning language`, np. „goin'”).
2. **Tłumaczenie** po 350 ms w języku ojczystym (`native language`, np. „dalej”).
3. **Objaśnienie ze strzałką** po kolejnych 350 ms w języku nauki (`learning language`, np. „goin', going”).

Cudzysłowy nie dzielą wypowiedzi i nie przełączają języka ani głosu. Dotyczy to także zapisanych wcześniej opisów z cytatami, lektora przeglądarki i syntezy premium. Każde wywołanie TTS korzysta z jawnie przekazanego języka. Znaki strzałek (np. `→`, `->`, `⇒`) w wyjaśnieniach skrótów są konwertowane na naturalne pauzy (przecinki), dzięki czemu lektor nie wymawia na głos nazw symboli (np. „strzałka w prawo”). Przycisk głośnika w tooltipie uwzględnia pełny tekst (`słowo. tłumaczenie. objaśnienie`).

Po odsłuchu kolejny krok uruchamia się po 900 ms; bez treści oznaczonej jako odczytana opóźnienie wynosi 3000 ms. Ręczna zmiana kroku wyłącza automatyczne przechodzenie w bieżącej sesji. Ostatni krok pozostaje otwarty. `aiExplainSpeechToken` unieważnia starszy odsłuch po zmianie kroku lub zamknięciu.

## 6. Zapis do powtórek

**Z / V — zwykły zapis:** zapisuje aktualny termin i znaczenie, języki, wyjaśnienie oraz, jeśli ma zastosowanie, oryginalne zdanie kontekstowe i jego tłumaczenie. Próbuje też dołączyć zrzut wideo, URL i czas zapisu. Dla karty całego zdania nie powiela zdania w polu kontekstu. Operacja kończy się wywołaniem `QT.saveWord()`.

**X — zdanie AI:** wywołuje `QT.geminiGenerateSentence()` dla aktualnego elementu, po czym zapisuje wygenerowany przykład i tłumaczenie przez `QT.saveWord()`. Powtórzenie samego terminu nie jest zachowywane jako nowy przykład. Po sukcesie przykład może pojawić się pod treścią karty.

Przyciski mają stany ładowania i potwierdzenia. `aiSavedIndices` i `aiAiSavedIndices` przechowują osobno informację o zapisie dla kroków bieżącej sesji. Sam Enter nie eksportuje bezpośrednio danych do Anki.

## 7. Błędy, limit i zamykanie

- Przy zwykłym błędzie AI kod próbuje uzyskać samo tłumaczenie przez `SharedTranslatorService.translate()`, a następnie `QT.translate()`. Jeśli analiza się nie powiodła, możliwy jest widok `1/1` bez rozbicia na słowa.
- Jeśli nie uda się uzyskać tłumaczenia, karta pokazuje komunikat błędu.
- Błąd rozpoznany przez `GeminiProxy.isLimitError()` prowadzi do karty limitu zamiast zwykłego fallbacku. Użytkownik może zamknąć kartę, wznowić film albo przejść do zakupu planu. Akcja zakupu wywołuje `startCheckout("basic")`, a przy błędzie otwiera plany.
- `closeAiTooltip()` unieważnia żądanie, usuwa listener, timery, podświetlenia i kartę, czyści kolejkę oraz zatrzymuje TTS. Domyślnie wznawia odtwarzanie; wywołujący może przekazać `resumeVideo: false`.

## 8. Mapa implementacji i weryfikacja

| Plik | Odpowiedzialność |
| --- | --- |
| [video/universal-video-controller.js](../video/universal-video-controller.js) | Skróty i przekazanie sterowania do nakładki |
| [video/subtitle-overlay.js](../video/subtitle-overlay.js) | Sesja Enter, rendering, pozycjonowanie, TTS, zapis i limit |
| [styles.css](../styles.css) | Karta, animacje, przyciski i podświetlenia napisów |
| [core.js](../core.js) | Fasada `QT`, wspólne akcje i stopka zapisu |
| [shared/translator-service.js](../shared/translator-service.js) | Wywołanie i walidacja analizy |
| [shared/ai-prompts.js](../shared/ai-prompts.js) | Instrukcje analizy dla modelu |
| [shared/gemini-proxy.js](../shared/gemini-proxy.js) | Proxy, cache odpowiedzi i użycia AI |
| [tests/ai-explanations.test.js](../tests/ai-explanations.test.js) | Testy kontraktu odpowiedzi, języków, filtracji i promptów |

Testy serwisu nie potwierdzają faktycznego wyglądu nakładki. Do wizualnej kontroli należy otworzyć analizę w odtwarzaczu, sprawdzić ładowanie, kartę zdania i zwrotu, nawigację, oba zapisy oraz pozycjonowanie przy krawędziach i w pełnym ekranie.
