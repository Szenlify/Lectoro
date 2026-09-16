# Szczegółowy Plan Synchronizacji Podwójnych Napisów (Dual Subtitles)
### Na podstawie inżynierii wstecznej Language Reactor (LR) i adaptacji dla Lectoro

---

## 1. Wstęp i cel opracowania

Niniejszy dokument stanowi kompletne studium architektoniczne i plan wdrożeniowy systemu **podwójnych napisów (Dual Subtitles: język oryginalny + tłumaczenie)** dla projektu **Lectoro** na platformach **YouTube** oraz **Netflix**, w oparciu o analizę kodu źródłowego wiodącego rozwiązania rynkowego — **Language Reactor (LR)** (pliki `pageScript_lly.min.js`, `pageScript_lln.min.js`, `content_youtube.js`, `content_netflix.js`).

---

## 2. Inżynieria wsteczna Language Reactor (LR)

### A. YouTube w Language Reactor (`pageScript_lly.min.js`)

Language Reactor nie korzysta wyłącznie z publicznego DOM-u, lecz wstrzykuje do kontekstu strony (`MAIN world`) skrypt, który bezpośrednio integruje się z wewnętrznym API YouTube.

#### 1. Przechwytywanie instancji odtwarzacza YouTube (`movie_player`)
LR przechwytuje wewnętrzny obiekt odtwarzacza za pomocą monkey-patchingu metody `Function.prototype.bind`:
```javascript
// LR wykrywa wywołanie bind na obiekcie posiadającym getPlayerResponse
let originalBind = Function.prototype.bind;
Function.prototype.bind = function() {
    if (arguments[0] && typeof arguments[0] === "object" && "getPlayerResponse" in arguments[0]) {
        ytPlayerInstance = arguments[0]; // zapamiętanie instancji odtwarzacza
    }
    return originalBind.apply(this, arguments);
};
```
Dzięki temu LR zyskuje dostęp do oficjalnego interfejsu odtwarzacza:
- `player.getOption("captions", "tracklist", { includeAsr: true })` — pełna lista ścieżek (w tym auto-generowane ASR).
- `player.getOption("captions", "track")` — aktualnie wybrana ścieżka.
- `player.setOption("captions", "track", trackObj)` — płynna zmiana ścieżki.
- `player.getPlayerResponse()` — metadane wideo i manifest podpisanych URL-i `captionTracks`.

#### 2. Przechwytywanie tokenów autoryzacyjnych (`POT` / Proof of Origin)
YouTube zabezpiecza zapytania `timedtext` tokenem integralności bota (`pot`). LR przechwytuje te tokeny poprzez nadpisanie `XMLHttpRequest.prototype.open`:
```javascript
const originalXhrOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(method, url) {
    if (typeof url === "string" && url.includes("/timedtext?")) {
        const params = new URLSearchParams(url.split("?")[1]);
        const pot = params.get("pot");
        const v = params.get("v");
        if (pot && v) {
            cachedPotTokens[v] = pot; // używane do podpisywania kolejnych żądań o napisy
        }
    }
    return originalXhrOpen.apply(this, arguments);
};
```

#### 3. Pobieranie napisów pierwotnych i wtórnych
LR dzieli proces na dwie ścieżki:
- **Master Track (język oryginalny)**: Pobierany bezpośrednio z URL `baseTrack` (zazwyczaj w formacie `json3`).
- **Secondary Track (język tłumaczenia)**:
  1. **Human Translation (`hTranslations`)**: LR sprawdza najpierw, czy w `textTracks` istnieje oficjalna ścieżka przetłumaczona przez człowieka dla danego języka (nie-ASR). Jeśli tak, pobiera ją priorytetowo.
  2. **Machine Translation (`mTranslations`)**: Jeśli brak wersji ludzkiej, LR wysyła żądanie do YouTube TimedText z parametrem `&tlang={targetLang}`, pobierając tłumaczenie maszynowe.

#### 4. Algorytm dopasowywania czasowego w LR (Moduł 151)
Kluczowy algorytm LR (`alignedTranslationSubs`) odpowiada za to, że napisy z dwóch różnych ścieżek idealnie się pokrywają, nawet gdy tłumacz ma inne ramy czasowe niż oryginał:
```javascript
function calculateOverlap(cue1, cue2) {
    return Math.min(cue1.end, cue2.end) - Math.max(cue1.begin, cue2.begin);
}

function alignTranslationsToSource(sourceCues, translationCues) {
    const alignedTranslations = {}; // klucz: indeks napisu oryginalnego
    const attachedToSource = {};

    for (let n = 0; n < translationCues.length; n++) {
        const tCue = translationCues[n];
        let maxOverlap = 0;
        let bestSourceIndex = -1;
        const matchingIndices = [];

        // Krok 1: Znalezienie napisu oryginalnego o największym pokryciu czasowym
        for (let i = 0; i < sourceCues.length; i++) {
            const overlap = calculateOverlap(tCue, sourceCues[i]);
            if (overlap > maxOverlap) {
                maxOverlap = overlap;
                bestSourceIndex = i;
            }
        }
        if (bestSourceIndex !== -1) matchingIndices.push(bestSourceIndex);

        // Krok 2: Dołączenie do innych kafelków, jeśli pokrycie > 500ms LUB > 80% czasu trwania
        const tDuration = tCue.end - tCue.begin;
        for (let i = 0; i < sourceCues.length; i++) {
            const overlap = calculateOverlap(tCue, sourceCues[i]);
            if (overlap > 500 || (tDuration > 0 && overlap / tDuration > 0.8)) {
                if (!matchingIndices.includes(i)) matchingIndices.push(i);
            }
        }

        // Krok 3: Zapisanie tłumaczenia do odpowiednich kafelków oryginalnych
        for (const srcIdx of matchingIndices) {
            if (alignedTranslations[srcIdx] === undefined) {
                alignedTranslations[srcIdx] = tCue.text;
                attachedToSource[srcIdx] = [n];
            } else {
                // Jeśli do jednego oryginału pasuje więcej niż jedno tłumaczenie - łączymy spacją
                alignedTranslations[srcIdx] += " " + tCue.text;
                attachedToSource[srcIdx].push(n);
            }
        }
    }

    return alignedTranslations;
}
```

---

### B. Netflix w Language Reactor (`pageScript_lln.min.js`)

Na Netfliksie napisy są zabezpieczone DRM-em i segmentowane. LR stosuje zaawansowany mechanizm na poziomie manifestu odtwarzacza.

#### 1. Odblokowanie wszystkich ścieżek językowych świata (`showAllSubDubTracks`)
Netflix domyślnie zwraca w manifeście tylko 4–5 lokalnych języków. LR modyfikuje żądanie manifestu w locie przez `JSON.stringify`:
```javascript
const nativeStringify = JSON.stringify;
JSON.stringify = function(value) {
    if (value && typeof value === "object" && value.params) {
        // Wymuszenie pobrania pełnej listy ścieżek audio i napisów
        value.params.supportsPartialHydration = true;
        value.params.showAllSubDubTracks = true;
        if (Array.isArray(value.params.profiles)) {
            // Wymuszenie dostępności WebVTT zamiast binarnego DFXP
            value.params.profiles.push("webvtt-lssdh-ios8");
        }
    }
    return nativeStringify.apply(this, arguments);
};
```

#### 2. Przechwycenie manifestu z URL-ami WebVTT przez `JSON.parse`
```javascript
const nativeParse = JSON.parse;
JSON.parse = function(text) {
    const data = nativeParse.apply(this, arguments);
    if (data && data.result && (data.result.timedtexttracks || data.result.textTracks)) {
        // Zapisanie kompletnego manifestu napisów ze wszystkimi URL-ami CDN
        const movieId = data.result.movieId;
        cachedNetflixManifests[movieId] = data.result;
    }
    return data;
};
```

#### 3. Dostęp do API odtwarzacza Netflix
LR uzyskuje uchwyt do instancji wideo przez:
```javascript
const videoPlayerApi = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
const sessionIds = videoPlayerApi.getAllPlayerSessionIds().filter(id => id.startsWith("watch"));
const player = videoPlayerApi.getVideoPlayerBySessionId(sessionIds[0]);

// Pobranie ID aktywnej ścieżki:
const currentTextTrackId = player.getTimedTextTrack()?.trackId;
```

#### 4. Pobieranie i synchronizacja podwójnych napisów
1. Z manifestu odczytywany jest URL `webvtt-lssdh-ios8` dla aktywnej ścieżki (Master).
2. Z manifestu odczytywany jest URL `webvtt-lssdh-ios8` dla wybranego języka tłumaczenia (Secondary).
3. Oba pliki WebVTT są pobierane i parsowane do postaci listy kafelków `{ begin, end, text }`.
4. Stosowany jest ten sam algorytm dopasowywania czasowego (`alignTranslationsToSource`), dzięki czemu napisy wtórne idealnie dostosowują się do rytmu kafelków pierwotnych.

---

## 3. Stan obecny w Lectoro vs Language Reactor

| Cecha | Language Reactor (LR) | Lectoro (Stan obecny) | Wnioski / Co usprawniamy |
| :--- | :--- | :--- | :--- |
| **Architektura Bridge** | Wstrzykiwanie skryptu `pageScript_*.min.js` do strony | Wstrzykiwanie `youtube-player-bridge.js` i `netflix-player-bridge.js` do MAIN world | Architektura Lectoro jest zgodna z Manifest V3 i nie wymaga zmian koncepcyjnych. |
| **YouTube POT Token** | Przechwytuje parametr `pot` w XHR | Dotychczas korzysta z podpisanych URL-i z `getPlayerResponse` | Warto dodać przechwytywanie `pot` jako fallback w razie zaostrzenia botguardu YouTube. |
| **Netflix Odblokowanie Ścieżek** | Wymusza `showAllSubDubTracks: true` w `JSON.stringify` | Przechwytuje manifest `manifest.tracks` | **Kluczowa zmiana**: Dodać `showAllSubDubTracks = true` w bridge'u Netfliksa, aby odblokować wszystkie języki! |
| **Format napisów Netflix** | Wymusza profil `webvtt-lssdh-ios8` | Obsługuje WebVTT i TTML/XML | Standard `webvtt-lssdh-ios8` jest najlżejszy i najdokładniejszy. |
| **Algorytm dopasowania** | Czasowy overlap (max overlap + >500ms / 80%) | Czasowy overlap + Sentence Stitching | W Lectoro usunęliśmy nadmierne scalanie zdań; dodajemy bezpieczny overlap. |
| **Pairing (Kombinacja klastrów)** | Grupuje maksymalnie 2 klastry jeśli < 16 słów | Funkcja `pairTwoClusters` | Utrzymujemy limit 16 słów / 85 znaków, aby uniknąć przepełnienia ekranu. |

---

## 4. Szczegółowy Plan Implementacji w Lectoro

### Krok 1: Aktualizacja Bridge'a Netflix (`netflix-player-bridge.js`)
**Cel:** Odblokowanie wszystkich ścieżek językowych świata dla każdego filmu i serialu.
1. Dodać proxy na `JSON.stringify` przechwytujące zapytania manifestu Netfliksa.
2. Automatycznie ustawiać:
   - `params.supportsPartialHydration = true`
   - `params.showAllSubDubTracks = true`
   - `params.profiles.push("webvtt-lssdh-ios8")`
3. Przechwytywać odpowiedź `timedtexttracks` i przekazywać do adaptera Lectoro przez `CustomEvent`.

### Krok 2: Aktualizacja Bridge'a YouTube (`youtube-player-bridge.js`)
**Cel:** Odporność na blokady autoryzacyjne YouTube i obsługa tłumaczeń ASR.
1. Dodać podsłuchiwanie `XMLHttpRequest.prototype.open` w poszukiwaniu tokenów `pot` oraz `v`.
2. Przy pobieraniu tłumaczenia maszynowego `&tlang={targetLang}`, dołączać przechwycony token `pot`, jeśli jest wymagany przez YouTube.
3. Zachować priorytet: najpierw oficjalne napisy ludzkie (`hTranslations`), a w razie braku — napisy maszynowe `tlang` (`mTranslations`).

### Krok 3: Wdrożenie uniwersalnego algorytmu Temporal Overlap w `shared/subtitle-service.js`
**Cel:** Zapewnienie, że napisy tłumaczenia nigdy nie rozjeżdżają się z napisami głównymi.
1. Zdefiniować kanoniczną strukturę kafelka w Lectoro:
   ```typescript
   interface UnifiedCue {
       startTime: number;     // sekundy
       endTime: number;       // sekundy
       text: string;          // linia 1 (Master)
       lines: string[];       // sformatowane linie oryginału
       translation: string;   // linia 2 (Secondary)
       tStartMs?: number;     // opcjonalne oryginalne milisekundy
       dDurationMs?: number;
   }
   ```
2. Zintegrować algorytm `alignSlaveTrackToMaster` z zasadą LR:
   - **Główny właściciel**: Kafelek Master o największym wspólnym czasie trwania (`max overlap`).
   - **Próg podziału**: Jeśli tłumaczenie trwa dłużej i zachodzi na kolejny kafelek Master o więcej niż `500 ms` lub `80%` czasu, tłumaczenie jest powielane/dzielone czysto na granicy słów.
   - **Puste kafelki**: Zastosować stworzoną wcześniej naprawę `repairEmptyTranslatedEvents` dla pustych kafelków `\n` z YouTube.

### Krok 4: Sklejanie par (Cluster Pairing) i restrykcyjne limity ekranowe
**Cel:** Czytelny widok maksymalnie 2 linijek, bez ścian tekstu.
1. Reguła w `pairTwoClusters`:
   - Jeśli kafelek Master ma $\ge 10$ słów lub $\ge 55$ znaków: wyświetlać **pojedynczo**.
   - Jeśli suma kafelka 1 i 2 wynosi $\ge 16$ słów lub $\ge 80$ znaków: wyświetlać **pojedynczo**.
   - Jeśli tłumaczenie przekracza $16$ słów: wyświetlać **pojedynczo**.
   - Przerwy w dialogu $> 2.2$ sekundy: **nigdy nie łączyć przez pauzę**.
2. Blokada w `alignTimedSentenceTracks`:
   - Jeśli brak kropek/wykrzykników (`complete: false`), kategoryczny zakaz scalania wielu kafelków ASR w jeden wielki blok.

### Krok 5: Precyzyjna synchronizacja odtwarzacza (Playback Sync & Seeking)
**Cel:** Błyskawiczna reakcja na przewijanie i skróty klawiszowe A/D.
1. Zastosować sprawdzony w LR bufor wyprzedzenia **125 ms** (`seekTime = Math.max(0, cue.startTime - 0.125)`).
   - Dzięki 125 ms marginesu odtwarzacz nie "obcina" pierwszej głoski słowa po przewinięciu do poprzedniego/następnego napisu.
2. Na Netfliksie: kategoryczny zakaz dotykania `video.currentTime` — wszelkie skoki wyłącznie przez `player.seek(targetMs)` API Netfliksa, aby zapobiec desynchronizacji buforów Widevine DRM (błąd M7375).

---

## 5. Przykłady kodu gotowe do integracji w Lectoro

### A. Wymuszenie wszystkich ścieżek Netfliksa (`netflix-player-bridge.js`)
```javascript
// Wstrzykiwane do MAIN world Netfliksa
(function patchNetflixManifestParams() {
    const origStringify = JSON.stringify;
    JSON.stringify = function(val) {
        if (val && typeof val === "object" && val.params && val.params.supportsPartialHydration !== undefined) {
            val.params.supportsPartialHydration = true;
            val.params.showAllSubDubTracks = true;
            if (Array.isArray(val.params.profiles)) {
                if (!val.params.profiles.includes("webvtt-lssdh-ios8")) {
                    val.params.profiles.push("webvtt-lssdh-ios8");
                }
            }
        }
        return origStringify.apply(this, arguments);
    };
})();
```

### B. Obliczanie optymalnego pokrycia czasowego (`shared/subtitle-service.js`)
```javascript
function alignSlaveTrackToMaster(masterCues, slaveCues) {
    if (!masterCues?.length) return [];
    if (!slaveCues?.length) return masterCues.map(m => ({ ...m, translation: "" }));

    return masterCues.map((master) => {
        let bestSlaveText = "";
        let maxOverlap = 0;

        for (const slave of slaveCues) {
            const overlap = Math.min(master.endTime, slave.endTime) - Math.max(master.startTime, slave.startTime);
            if (overlap > maxOverlap) {
                maxOverlap = overlap;
                bestSlaveText = slave.text;
            } else if (overlap > 0.5 && overlap > (slave.endTime - slave.startTime) * 0.8) {
                bestSlaveText = bestSlaveText ? `${bestSlaveText} ${slave.text}` : slave.text;
            }
        }

        return {
            ...master,
            translation: cleanCueText(bestSlaveText),
        };
    });
}
```

---

## 6. Plan weryfikacji i testów

1. **Testy jednostkowe w Node (`npm test`)**:
   - Sprawdzenie dopasowywania kafelków o identycznych czasach.
   - Sprawdzenie kafelków przesuniętych o 200–500 ms (asynchroniczne napisy ASR).
   - Testy limitów wielkości napisów (odrzucenie łączenia kafelków powyżej 16 słów).
   - Test odblokowania manifestu Netfliksa i profilu `webvtt-lssdh-ios8`.
2. **Weryfikacja manualna w przeglądarce**:
   - **YouTube**: Odtworzenie filmu z automatycznymi napisami (ASR) oraz piosenki (brak kropek). Weryfikacja, czy napisy nie zlewają się w ścianę tekstu i czy tłumaczenie PL pojawia się synchronicznie pod tekstem EN.
   - **Netflix**: Uruchomienie filmu na koncie testowym, zmiana języka na egzotyczny (np. japoński, koreański) i weryfikacja, czy Lectoro potrafi wyświetlić polskie tłumaczenie obok oryginalnego audio.
