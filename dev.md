# Audyt architektury i kosztów wtyczki Lectoro

**Stan kodu:** 2026-08-21. Audyt obejmuje kod rozszerzenia, Firebase/Firestore, funkcje backendowe, Cloudflare R2, Gemini, ElevenLabs i Stripe. Wnioski opisują stan faktycznie zaimplementowany; ceny usług są zmienne, dlatego tabela wskazuje przede wszystkim jednostki rozliczeniowe i odsyła do oficjalnych cenników.

## 1. Przepływ działania wtyczki (workflow krok po kroku)

1. Manifest MV3 uruchamia service workera [`background.js`](./background.js), skrypty MAIN-world dla [YouTube](./youtube-player-bridge.js) i [Netflix](./netflix-player-bridge.js) oraz skrypty content na wszystkich stronach ([`manifest.json`](./manifest.json)).
2. [`content.js`](./content.js) i [`core.js`](./core.js) tworzą pływający pasek/tooltip. Użytkownik zaznacza tekst, klika słowo w napisach albo otwiera funkcję z popupu.
3. Zwykłe tłumaczenie trafia bezpośrednio do nieoficjalnego endpointu Google Translate. Tłumaczenie AI, wyjaśnienie napisów, przykładowe zdanie i quiz trafiają przez [`GeminiProxy.request()`](./shared/gemini-proxy.js) do funkcji [`geminiProxy`](./functions/index.js), która weryfikuje Firebase ID token, sprawdza plan i rezerwuje zużycie w Firestore przed wywołaniem Gemini.
4. Przy zapisie fiszki [`buildSaveEntry()`](./core.js) zbiera tekst, tłumaczenie, kontekst i opcjonalny kadr filmu; [`WordRepository.saveWordInternal()`](./shared/word-repository.js) normalizuje dane, deduplikuje je, sprawdza limit planu i zapisuje całą tablicę `savedWords` w `chrome.storage.local`.
5. Jeśli fiszka zawiera obraz jako `data:` i użytkownik jest zalogowany, klient uruchamia w tle pojedynczy upload przez [`GeminiProxy.uploadCardImage()`](./shared/gemini-proxy.js). Po sukcesie lokalny Base64 jest zastępowany publicznym URL-em R2.
6. [`background.js`](./background.js) obserwuje zmiany `savedWords`, zapisuje dziennik `pendingFirebaseChanges` i co 60 s uruchamia synchronizację. Najpierw próbuje wysłać pozostałe obrazy Base64, następnie grupuje usunięcia R2 i zapisuje zmiany Firestore w paczkach do 500 operacji.
7. Pełna synchronizacja najpierw opróżnia kolejkę, potem pobiera dokumenty Firestore stronami po 500, scala je strategią last-write-wins (`updatedAt`) i wysyła lokalne nowsze rekordy.
8. Popup prowadzi powtórki SRS, eksport, ustawienia, logowanie i subskrypcję. Odczyt może użyć lokalnego `speechSynthesis` albo ElevenLabs przez backend; wynik ElevenLabs jest buforowany w IndexedDB.
9. Po wylogowaniu wykonywana jest synchronizacja typu flush-only, a następnie `chrome.storage.local.clear()`. IndexedDB z audio nie jest czyszczone.

### Istotne własności przepływu danych

- Lokalny zapis fiszki następuje przed uploadem/synchronizacją, więc awaria sieci nie blokuje interfejsu.
- `savedWords` jest monolityczną tablicą: każda edycja/powtórka przepisuje cały zbiór i uruchamia porównanie stanu w workerze. Koszt CPU, pamięci i I/O rośnie liniowo z liczbą fiszek.
- Kolejka zmian przechowuje pełne rekordy, również duże obrazy Base64. Przy wielu zmianach offline może istotnie zwiększyć zużycie `chrome.storage.local`.
- Serializacja Firestore w [`toFirestoreFields()`](./firebase/firebase-sync.js) pomija część lokalnych pól, m.in. `aiSentence`, `aiSentenceTranslated`, `url` i zapisywane lokalnie `sr_easeFactor`. Po odtworzeniu danych wyłącznie z chmury informacje te mogą zniknąć lub wrócić do wartości domyślnych.

## 2. Zarządzanie Cache & Storage (tekst, obrazy, audio)

| Dane | Lokalizacja i klucz | Zachowanie przy trafieniu | Inwalidacja / usuwanie | Ryzyka |
|---|---|---|---|---|
| Tłumaczenia Google | `Map` + `chrome.storage.local.persistentTranslateCache` w [`translator-service.js`](./shared/translator-service.js) | Z cache korzysta głównie tooltip napisów (`subCache`, limit 300). Główne `QT.translate()` deleguje do `translate()`, a nie `translateWithCache()`, więc zwykłe zaznaczenia omijają cache | Brak TTL. FIFO po przekroczeniu limitu; `clear()` istnieje, ale nie ma wywołania/UI. Całość znika przy wylogowaniu przez `chrome.storage.local.clear()` | Kilka niezależnych instancji używa tego samego klucza storage i może nadpisywać sobie snapshoty. Trafienie nie odświeża kolejności, więc nie jest to LRU. Główna ścieżka generuje zbędne requesty |
| Odpowiedzi Gemini | Procesowy `Map` w [`gemini-proxy.js`](./shared/gemini-proxy.js), limit 200 | Identyczny prompt/parametry w tej samej stronie nie wywołują backendu | Brak TTL; utrata po przeładowaniu strony/ubiciu kontekstu; FIFO. `clearAiCache()` nie ma funkcji użytkowej | Brak persistent cache i single-flight: równoległe identyczne missy płacą osobno. Prompt quizu zawiera nonce, więc zawsze omija cache |
| Profil/subskrypcja/usage | `subscriptionProfileCache`, `aiUsageCache` w `chrome.storage.local` ([`subscription-service.js`](./shared/subscription-service.js), [`gemini-proxy.js`](./shared/gemini-proxy.js)) | Przez 1 h unika ponownego odczytu backendu; cache jest wiązany z UID, planem i miesiącem | TTL 1 h, zmiana użytkownika/planu/miesiąca, force refresh lub wylogowanie | Start workera odświeża profil i usage dwiema osobnymi akcjami; każda angażuje funkcję i odczyt Firestore |
| Fiszki/tekst | `chrome.storage.local.savedWords` | Odczyt całej tablicy; brak zewnętrznego requestu | Bez TTL; ręczne usunięcie/wyczyszczenie albo wylogowanie | Monolityczny zapis O(n), limit przestrzeni rozszerzenia, brak wersjonowania schematu cache |
| Obrazy przed uploadem | Pole `screenshot` jako skompresowany WebP/JPEG `data:` w `savedWords` i kolejce zmian | Używany lokalnie do czasu uzyskania URL R2 | Zastępowany URL-em po uploadzie; zostaje bezterminowo po błędzie; znika z local storage przy usunięciu/wylogowaniu | Base64 zwiększa payload o ok. 33%. Nieudany upload może potem spowodować odrzucenie całego batcha Firestore, bo reguły ograniczają długość `screenshot` |
| Obrazy po uploadzie | R2 `cards/{uid}/{wordId}.{ext}`; lokalnie publiczny URL | Przeglądarka/CDN może użyć `Cache-Control: public, max-age=31536000, immutable` | Brak TTL/lifecycle w kodzie. Usunięcie fiszki uruchamia DeleteObjects; `deleteAll` najpierw listuje prefiks. Wylogowanie nie usuwa R2 | Nadpisanie stałego klucza przy `immutable` może pokazywać stary obraz. URL nie jest podpisany; prywatność opiera się na trudnym do odgadnięcia UID/UUID |
| Napisy | Tablice cue w pamięci strony; Netflix URL cache w `Map` workera, limit 25 | Ponowne użycie sparsowanych cue/odpowiedzi w bieżącym kontekście | Reset przy nawigacji/odtworzeniu skryptu; Netflix FIFO bez TTL; bufor napisów ograniczony do 3000, przy przepełnieniu zostaje 2000 | Cache workera MV3 jest efemeryczny. Brak wspólnego cache między kartami |
| Audio ElevenLabs | IndexedDB `LectoroAudioDB` w [`audio-cache.js`](./shared/audio-cache.js), klucz `${text}|${voiceId}` | Blob jest odtwarzany bez R2/Firestore/ElevenLabs, jeśli `createdAt >= cacheNotBefore` | Brak TTL, limitu rozmiaru, LRU, cleanup i obsługi wylogowania. Edycja ustawia `ttsCacheInvalidatedAt`, lecz tylko ignoruje stary blob — nie usuwa go | Trwały wzrost bazy i osierocone warianty. `cacheFirst` przekazywane z popupu nie jest używane; `findByText()` także nie jest używane |
| Audio serwerowe | R2 `audio/{voiceId}/{sha256(trim(lower(text)))}.mp3` | Backend wykonuje `GetObject`; hit omija ElevenLabs i nie zużywa limitu znaków użytkownika | Brak TTL/lifecycle/delete; plik zostaje na stałe | Klucz nie uwzględnia modelu ani ustawień syntezy. Równoległe missy mogą wykonać kilka syntez i nadpisać ten sam obiekt |

### Cykl życia audio

1. Standardowy przycisk głośnika używa przeglądarkowego `speechSynthesis`: nie powstaje plik, nie ma cache ani kosztu API.
2. Tryb ElevenLabs wywołuje [`TTSService.speak()`](./shared/tts-service.js): najpierw exact-match w IndexedDB, potem kontrola planu i akcja `tts` funkcji `geminiProxy`.
3. Backend sprawdza R2. Przy missie transakcyjnie rezerwuje znaki w Firestore, wywołuje model `eleven_flash_v2_5`, asynchronicznie zapisuje MP3 do R2 i zwraca dane klientowi.
4. Klient zapisuje Blob w IndexedDB i odtwarza go przez Object URL. URL jest zwalniany na `ended`/`error`, ale [`cancel()`](./shared/tts-service.js) go nie wywołuje — częste anulowanie powoduje wyciek blob URL do końca życia dokumentu.

### Zarządzanie pamięcią procesu

- Rejestr odtwarzaczy w [`player-registry.js`](./adapters/player-registry.js) korzysta z `WeakMap`, `AbortController`, odłącza obserwatory i usuwa odtwarzacze z `Set`; to ogranicza wycieki przy SPA.
- Bridge Netflixa patchuje globalnie `JSON.parse`, `fetch` i XHR na cały czas życia strony i ich nie przywraca. Zwiększa to koszt każdej pasującej operacji strony i ryzyko konfliktu z aplikacją Netflix.
- Eksport ZIP w [`popup/export.js`](./popup/export.js) buforuje obrazy/audio i buduje nieskompresowany ZIP w pamięci. Dla dużych kolekcji chwilowe zużycie pamięci może być wielokrotnością rozmiaru eksportu.

## 3. Komunikacja z Cloudflare R2 i Firebase

### Upload i usuwanie zdjęć

- **Upload jest pojedynczy, nie batchowy.** Każda fiszka wykonuje osobny POST JSON z obrazem Base64 przez [`GeminiProxy.uploadCardImage()`](./shared/gemini-proxy.js), a backend wykonuje jeden `PutObject` w [`R2Storage.uploadCardImage()`](./functions/r2-storage.js).
- **Trigger:** natychmiast po lokalnym `saveWord()` jako zadanie asynchroniczne. Druga ścieżka retry działa przed synchronizacją Firestore w [`flushPendingChanges()`](./background.js).
- Nie ma blokady in-flight/idempotency po stronie klienta. Ręczna synchronizacja uruchomiona w trakcie pierwszego uploadu może wykonać drugi POST/PUT dla tego samego klucza.
- Usunięcia są grupowane: jedna akcja proxy może zawierać wiele ID, a backend usuwa trzy możliwe rozszerzenia na ID. Limit R2 to 1000 kluczy na `DeleteObjects`, więc implementacja dzieli listę na maks. 333 ID.
- **Błąd kosztowy:** [`WordRepository.deleteWord()`](./shared/word-repository.js) usuwa obraz od razu, a obserwator `savedWords` zapisuje to samo usunięcie do kolejki i worker usuwa je ponownie. `clearAllWords()` analogicznie wykonuje `deleteAllUserImages`, po czym synchronizacja ponawia usunięcia per ID. R2 DELETE jest obecnie bezpłatny, ale oba przebiegi płacą za wywołanie backendu i odczyt profilu Firestore; `deleteAll` dodatkowo płaci za `ListObjects`.

### Czy R2 angażuje Firebase?

Tak. Klient **nie używa presigned URL ani bezpośredniego uploadu do R2**:

1. Pobiera/odświeża Firebase ID token.
2. Wywołuje endpoint gen2/Cloud Run [`geminiProxy`](./functions/index.js) z bearer tokenem.
3. Backend wykonuje `verifyIdToken`, kontrolę limitu w pamięci instancji oraz odczyt `users/{uid}` z Firestore dla każdej akcji.
4. Dopiero backend, używając sekretów R2, wykonuje `PutObject`, `DeleteObjects`, `ListObjects` lub `GetObject`.

Skutek dla pojedynczego uploadu: co najmniej jedno wywołanie funkcji + weryfikacja Auth + jeden odczyt Firestore + jedna operacja R2 Class A + transfer Base64. Firestore/Cloud Functions pozostają więc w ścieżce kosztowej każdego obrazu.

### Token sesji/autoryzacji

- [`firebase-sync.js`](./firebase/firebase-sync.js) zapisuje w `chrome.storage.local.firebaseAuth` obiekt zawierający m.in. `idToken`, `refreshToken`, UID, e-mail i `expiresAt`; nie jest to cache tylko na czas sesji i nie jest szyfrowany przez aplikację.
- Logowanie Google używa OAuth implicit token, a następnie wymienia go przez Firebase Identity Toolkit na Firebase ID/refresh token.
- ID token jest używany, jeśli ma ponad 5 minut ważności. W przeciwnym razie `securetoken.googleapis.com` wydaje nowy token; wynik jest ponownie zapisywany lokalnie.
- Worker stosuje single-flight dla odświeżania, ograniczając równoległe refresh requesty w obrębie jednej instancji service workera.
- Odpowiedź 400/401 podczas refreshu usuwa `firebaseAuth`; błąd przejściowy zwraca `null`. Jawne wylogowanie po flushu czyści **całe** `chrome.storage.local`, lecz nie odwołuje tokenu Google i nie czyści IndexedDB audio.
- Rate limiter backendu jest mapą w pamięci pojedynczej instancji (`maxInstances: 10`), więc nie jest globalnym limitem użytkownika i słabo chroni budżet przy skalowaniu/zimnych startach.

## 4. Audyt kosztów (per funkcja/akcja)

| Akcja / funkcja | Usługa i jednostki kosztowe | Co zwiększa koszt / ryzyko |
|---|---|---|
| Zwykłe tłumaczenie: [`translate()`](./shared/translator-service.js) | Nieoficjalny Google Translate `client=gtx`; request sieciowy | Główna ścieżka omija istniejący cache; hover/click i powtórzenia mogą mnożyć requesty. Brak gwarantowanego SLA i ryzyko throttlingu/blokady |
| AI translate, AI sentence, subtitle explain, review AI: [`GeminiProxy.request()`](./shared/gemini-proxy.js) | Cloud Run/Functions request+CPU+RAM; Firebase Auth; min. 2 odczyty i 1 zapis Firestore (profil + transakcja usage); tokeny wejścia/wyjścia Gemini 2.5 Flash-Lite | Brak cache między stronami i single-flight. Backend retry na 429/5xx daje do 3 prób. Długi kontekst/`maxOutputTokens` zwiększa koszt; rollback po błędzie dodaje kolejną transakcję |
| Generowanie quizu: [`generateQuizWithGemini()`](./shared/quiz-export.js) | Jak wyżej; do 60 fiszek i `maxOutputTokens: 8000` | Największy jednorazowy prompt/output. Nonce gwarantuje miss cache, więc każde generowanie jest płatne |
| Cold start/odświeżenie profilu i usage | 2 wywołania `geminiProxy`, 2 weryfikacje Auth, 2 odczyty Firestore | `initializeAiUsage()` odświeża podobne dane dwiema akcjami. TTL 1 h ogranicza koszt, lecz brakuje wspólnego requestu |
| Zapis fiszki lokalnej | `chrome.storage.local`; bez kosztu chmurowego do sync | Cała tablica i pełny dziennik zmian są serializowane ponownie; duże Base64 grożą limitem/quota storage |
| Upload obrazu: `uploadCardImage` | Cloud Run/Functions; Auth; 1 odczyt Firestore; R2 `PutObject` = Class A; storage GB-month | 1 request na obraz, brak batcha, Base64 +33%, możliwy wyścig natychmiastowego uploadu z retry sync. Obiekt bez TTL generuje stały storage |
| Odczyt publicznego obrazu, np. eksport | R2 `GetObject` = Class B i transfer/CPU klienta | Eksport pobiera każdy brakujący obraz; duża kolekcja = N odczytów. `immutable` pomaga dopiero po cache przeglądarki |
| Usunięcie jednej/wielu fiszek | Cloud Run/Functions; Auth; 1 odczyt Firestore; R2 `DeleteObjects` (DELETE bez opłaty operacyjnej) | Ta sama operacja jest wykonywana natychmiast i ponownie z kolejki; podwójny koszt funkcji/Firestore |
| `deleteAllUserImages` | Jak wyżej + `ListObjectsV2` = R2 Class A za każdą stronę listy | Następna synchronizacja ponownie usuwa ID. Koszt listowania i czas rosną z liczbą obiektów użytkownika |
| Sync push: [`commitBatch()`](./firebase/firebase-sync.js) | Firestore: 1 write/delete na dokument; requesty grupowane do 500 | Batching zmniejsza liczbę HTTP, ale nie liczbę płatnych zapisów. Retry powtarza request; batch z niedozwolonym Base64 może odrzucić wszystkie operacje |
| Sync pull: [`fetchAllRemoteWords()`](./firebase/firebase-sync.js) | Firestore: 1 read na zwrócony dokument, minimum 1 read na zapytanie; transfer | Każdy pełny sync czyta cały zbiór stronami po 500 zamiast delty. Koszt O(N) przy każdym ręcznym/logowaniowym sync |
| Token refresh / logowanie | Firebase Authentication / Identity Platform MAU oraz requesty Identity Toolkit/Secure Token | Token odświeżany tylko blisko wygaśnięcia; persistent refresh token zwiększa skutek kradzieży profilu rozszerzenia |
| ElevenLabs TTS: [`handleTts()`](./functions/index.js) | Na każdy lokalny miss: Cloud Run/Auth/1 read profilu + R2 Get Class B. Na R2 miss dodatkowo transakcja Firestore, znaki ElevenLabs, R2 Put Class A i storage | Brak single-flight po hash: równoległe missy mnożą syntezę i rezerwacje. Lokalne IDB i globalny R2 cache mocno redukują kolejne użycia, ale oba są bez TTL |
| Lista głosów: [`getElevenLabsVoices()`](./shared/tts-service.js) | Cloud Run/Auth/Firestore read + ElevenLabs `/voices` | Cache tylko w pamięci popupu; każde ponowne otwarcie/nowy kontekst może pobrać listę ponownie |
| Eksport audio Google: [`fetchAudioBlob()`](./popup/export.js) | Nieoficjalny Google Translate TTS, 1 request na fiszkę | Brak deduplikacji/persistent cache; każdy eksport ponownie pobiera wszystkie pliki. Ryzyko limitów i niedostępności endpointu |
| Eksport ZIP/CSV/Anki | Lokalny CPU/RAM; opcjonalnie N odczytów obrazów i N requestów TTS | ZIP jest budowany w pamięci bez kompresji; może zawiesić kartę lub przekroczyć pamięć przy dużym zbiorze |
| Checkout/portal: [`stripe-billing.js`](./functions/stripe-billing.js) | Cloud Run, Firebase Auth/Firestore, Stripe API; opłaty Stripe przy udanej płatności | Tworzenie klienta, odczyty subskrypcji i sesji. Brak bezpośredniej opłaty za typowy call Stripe, ale są koszty funkcji/Firestore |
| Webhook Stripe | Cloud Run; Stripe API; Firebase Auth Admin; Firestore reads/writes | Brak trwałej deduplikacji po Stripe event ID. Retry webhooka i kilka zdarzeń jednego cyklu subskrypcji powtarza synchronizację claims/profilu |
| Skrypty administracyjne planu | Firebase Auth Admin + Firestore reads/writes/transaction | Koszt jednorazowy/operatora; błędne wielokrotne uruchomienie ponawia operacje |

Nie znaleziono wywołań OpenAI ani Anthropic. Aktywne płatne modele to Gemini i opcjonalnie ElevenLabs.

### Referencje do bieżących cenników

- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/) — `PutObject`/`ListObjects` to Class A, `GetObject` to Class B, delete jest bezpłatny; storage jest rozliczany za GB-miesiąc.
- [Cloud Firestore pricing](https://firebase.google.com/docs/firestore/pricing/) i [Firebase pricing](https://firebase.google.com/pricing) — reads/writes/deletes, storage, transfer, Auth i Functions.
- [Cloud Run pricing](https://cloud.google.com/run/pricing) oraz [Cloud Functions quotas](https://firebase.google.com/docs/functions/quotas) — requesty, czas CPU/RAM i limity skalowania.
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) — tokeny input/output dla używanego modelu.
- [ElevenLabs API pricing](https://elevenlabs.io/pricing/api) — TTS rozliczany wg liczby znaków/modelu.
- [Stripe pricing](https://stripe.com/pricing) — opłaty transakcyjne zależne od rynku i metody płatności.

## 5. Ekstrakcja napisów per platforma

| Platforma | Dokładne pliki | Mechanizm | Klasyfikacja |
|---|---|---|---|
| **X.com / Twitter** | [`player-registry.js`](./adapters/player-registry.js); pomocnicze selektory tweeta w [`core.js`](./core.js) dotyczą tylko kadru/kontekstu | Brak dedykowanego adaptera X, przechwytywania requestów i selektora DOM napisów. Ogólny adapter wykrywa `<video>` i czyta `video.textTracks[*].activeCues` po `cuechange`. Zadziała tylko, jeśli X udostępni napisy jako natywny HTML5 TextTrack; własne napisy DOM X nie są obsłużone | **Natywne API TextTrack; brak pełnej implementacji X** |
| **Netflix** | [`netflix-player-bridge.js`](./netflix-player-bridge.js), [`netflix-adapter.js`](./adapters/netflix-adapter.js), [`background.js`](./background.js), [`subtitle-service.js`](./shared/subtitle-service.js), fallback [`player-registry.js`](./adapters/player-registry.js) | MAIN-world bridge przechwytuje `JSON.parse`, `fetch` i XHR, aby wykryć manifesty/timed text; dodatkowo odczytuje wewnętrzne API `videoPlayer` i aktywną ścieżkę. Adapter wybiera VTT/DFXP/TTML, a worker pobiera tylko dozwolone hosty Netflix i cache'uje URL. Parser zamienia odpowiedź na cue. Awaryjnie obserwowany jest DOM `.player-timedtext` | **Network interception/hooking + wewnętrzne API odtwarzacza + DOM fallback** |
| **YouTube** | [`youtube-player-bridge.js`](./youtube-player-bridge.js), [`youtube-adapter.js`](./adapters/youtube-adapter.js), [`subtitle-service.js`](./shared/subtitle-service.js), fallback [`player-registry.js`](./adapters/player-registry.js) | Bridge pobiera `captionTracks` z `getPlayerResponse`, `ytInitialPlayerResponse`, `ytplayer.config` lub `getOption`; przechwytuje też fetch/XHR do `/api/timedtext`. Adapter próbuje wariantów JSON3/VTT/srv3 i parsuje wynik. Fallback obserwuje `.ytp-caption-window-container`, `.caption-visual-line`, `.ytp-caption-segment` | **Dedykowane/wewnętrzne API playera + timedtext fetch/hooking + DOM fallback** |
| **TED** | [`ted-adapter.js`](./adapters/ted-adapter.js), [`player-registry.js`](./adapters/player-registry.js) | Adapter czyta widoczne węzły `#subtitles-container`/selektory napisów oraz `video.textTracks.activeCues`. MutationObserver i `cuechange` odświeżają tekst | **Parsowanie DOM + natywne API TextTrack; bez network interception** |

Wspólne formaty JSON3, WebVTT, TTML/DFXP i SRT są parsowane w [`subtitle-service.js`](./shared/subtitle-service.js). Największa luka funkcjonalna to X.com: obecny kod ma wyłącznie generyczny fallback i nie stanowi niezawodnego scrapera napisów tej platformy.

## 6. Executive Summary

- Architektura jest local-first i odporna na krótkie awarie sieci, ale monolityczne `savedWords`, pełne pull-sync i kolejka z Base64 będą źle skalować się wraz z kolekcją użytkownika.
- Najważniejsze optymalizacje kosztowe: podłączyć główny workflow do cache tłumaczeń, scalić profile/usage refresh, usunąć podwójną ścieżkę kasowania R2 oraz dodać single-flight dla uploadu i TTS.
- Cache obrazów i audio nie ma lifecycle/TTL; IndexedDB audio nie jest czyszczone przy wylogowaniu, a publiczne obrazy R2 są cache'owane jako `immutable` przez rok.
- Każda operacja R2 przechodzi przez Firebase/Cloud Run i co najmniej jeden odczyt profilu Firestore; upload nie jest bezpośredni ani batchowy.
- Netflix i YouTube mają rozbudowane mechanizmy hybrydowe, TED korzysta z DOM/TextTrack, natomiast X.com nie ma dedykowanej ekstrakcji i działa tylko warunkowo przez natywne `textTracks`.
- Priorytet jakości danych: uzupełnić mapowanie pól Firestore, aby synchronizacja nie traciła pól lokalnych; priorytet pamięci: dodać limity/cleanup IndexedDB i zwalnianie Object URL przy anulowaniu TTS.
