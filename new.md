# 📋 Plan porządkowania kodu Lectoro

---

## 🗂️ Co mamy teraz – czyli co to jest ten projekt

To rozszerzenie Chrome do nauki słówek. Ma kilka plików i każdy robi za dużo rzeczy naraz.

### Pliki i ich rozmiary:
| Plik | Rozmiar | Problem |
|------|---------|---------|
| `popup.html` | **3088 linii** | Cały CSS jest wewnątrz pliku HTML zamiast w osobnym pliku |
| `popup.js` | **2173 linii** | Jeden gigantyczny plik – robi za dużo rzeczy naraz |
| `content.js` | **1934 linii** | Jeden duży plik |
| `core.js` | **1174 linii** | Lepiej niż reszta, ale nadal spory |
| `background.js` | **566 linii** | OK |
| `styles.css` | **1127 linii** | Styl dla content.js – OK |
| `shared/utils.js` | 65 linii | Dobre ✅ |
| `shared/srs.js` | 173 linii | Dobre ✅ |
| `shared/ai-prompts.js` | 185 linii | Dobre ✅ |
| `shared/quiz-export.js` | 70KB | Duże, ale osobny plik – OK |

---

## 🔴 Problem 1: CSS w środku HTML (popup.html) [DONE]

### Co jest nie tak:
Otwórzcie `popup.html` – pierwsze **~2000 linii** to TYLKO CSS wrzucony między znaczniki `<style>`. To jak mieć garderobę w lodówce – działa, ale szuka się w niej godzinami.

### Co zrobić:
**Wyciągnij cały CSS z `popup.html` do osobnego pliku `popup.css`**

W `popup.html` linia 6 zaczyna się `<style>` i kończy się gdzieś około linii 2000.
Wytnij całą zawartość (sam CSS, bez `<style>` i `</style>`) i wklej do nowego pliku `popup.css`.

Zamiast `<style>...</style>` w HTML, dodaj na samej górze `<head>`:
```html
<link rel="stylesheet" href="popup.css">
```

---

## 🔴 Problem 2: popup.js – jeden plik robi 7 różnych rzeczy [DONE]

### Co jest nie tak:
`popup.js` ma 2173 linii i zawiera:
1. Ustawienia głosu (voiceSelect, rate, volume)
2. ElevenLabs TTS
3. Listę słówek + filtrowanie
4. Eksport do Anki (.zip z audio)
5. Eksport do CSV
6. System powtórek (flashcardy, SRS)
7. Bibliotekę filmów

To jakby jeden pracownik w sklepie był jednocześnie kasjerem, magazynierem, kierownikiem, ochroniarzem i sprzątaczem.

### Co zrobić – rozbij popup.js na osobne pliki:

**popup/settings.js** (linie ~217–422 z popup.js)
Wszystko co dotyczy ustawień: język, głos, rate, volume, Gemini API key, ElevenLabs.

**popup/words.js** (linie ~424–600 z popup.js)
Filtrowanie słówek, renderowanie listy słówek, usuwanie słówek.

**popup/export.js** (linie ~680–1018 z popup.js)
Eksport Anki ZIP, eksport CSV, funkcja buildZip, crc32, downloadFile.

**popup/review.js** (linie ~1105–1971 z popup.js)
Cały system fiszek: kolejka powtórek, renderowanie pytania/odpowiedzi, ocenianie, klawiatura.

**popup/tts.js** (linie ~1219–1455 z popup.js)
TTS w popupie: popupSpeak, stopPopupSpeak, pickPopupVoice, cleanTextForPopupTTS.

**popup/library.js** (linie ~2023–2173 z popup.js)
Biblioteka filmów: ładowanie JSON, filtrowanie, renderowanie kart.

**popup/firebase-ui.js** (linie ~70–214 z popup.js)
UI synchronizacji Firebase: renderSyncUI.

**popup/init.js** (zostaje główny plik, ~100 linii)
Tylko: inicjalizacja zakładek, auto-switch na Review jeśli są powtórki, nasłuchiwanie storage.

---

## 🟡 Problem 3: Duplikacja kodu TTS [DONE]

### Co jest nie tak:
Funkcja czyszczenia tekstu dla TTS jest napisana **dwa razy**:

- W `core.js` jest `cleanTextForTTS(text)` (linia ~108)
- W `popup.js` jest `cleanTextForPopupTTS(text)` (linia ~1225)

Obie robią prawie to samo (usuwają `#`, podwójne spacje). To jak mieć dwa piloty do jednego telewizora – jeden z nich jest zbędny.

### Co zrobić:
Zostaw tylko jedną wersję w `shared/utils.js` jako `SharedUtils.cleanTextForTTS()`.
Usuń `cleanTextForPopupTTS` z `popup.js` i zamień wywołania na `SharedUtils.cleanTextForTTS()`.

---

## 🟡 Problem 4: Duplikacja funkcji pickVoice [DONE]

### Co jest nie tak:
- W `core.js` jest `pickBestVoice(savedVoiceName, lang)`
- W `popup.js` jest `pickPopupVoice(savedVoiceName, lang)` (linia ~1239)

Kod jest **prawie identyczny** – obie szukają głosu Google pasującego do języka.

### Co zrobić:
Przenieś jedną wersję do `shared/utils.js` jako `SharedUtils.pickBestVoice()`.
Usuń duplikat z `popup.js`.

---

## 🟡 Problem 5: Duplikacja highlight tekstu

### Co jest nie tak:
- W `popup.js` w funkcji `loadWords()` (linia ~535) jest regex który podświetla słówko w zdaniu
- W `popup.js` jest też `highlightReviewSentence()` (linia ~1051) która robi **prawie to samo** dla fiszek

### Co zrobić:
Połącz w jedną funkcję `SharedUtils.highlightWordInSentence(sentence, word, cssClass)` w `shared/utils.js`.

---

## 🟡 Problem 6: Duplikacja funkcji usuwania słówek

### Co jest nie tak:
Są **trzy** funkcje do usuwania słówek z bardzo podobnym kodem:
- `deleteWord(original, timestamp)` – z listy słówek
- `deleteReviewWord(w)` – z fiszek
- Fragment w `clearAll` – masowe usuwanie widocznych

Każda robi `chrome.storage.local.get → filter → set → sendMessage`.

### Co zrobić:
Stwórz jedną wspólną funkcję (np. w `popup/words.js`):
```js
async function deleteWordsFromStorage(wordsToDelete, afterCallback) { ... }
```
I wywołuj ją z każdego miejsca.

---

## 🟡 Problem 7: HTML generowany bezpośrednio w JS (template strings)

### Co jest nie tak:
W `popup.js` jest mnóstwo takich fragmentów:
```js
card.innerHTML = `<div class="review-flashcard">
    <div class="review-question">
        <div class="review-word-row">...
```

To jest HTML **wklejony do środka JavaScriptu** jako długi string. Ciężko to edytować, ciężko znaleźć błąd.

### Co zrobić (opcjonalne, ale polecane):
Stwórz funkcje-generatory HTML, np.:
```js
function createFlashcardHtml(word, sentence, lang) { ... }
function createAnswerHtml(word, sentence, labels) { ... }
```

---

## 🟢 Co zostawić bez zmian (już OK)

- `shared/utils.js` – mały, czysty ✅
- `shared/srs.js` – dobry algorytm SRS, oddzielony ✅
- `shared/ai-prompts.js` – wszystkie prompty w jednym miejscu ✅
- `firebase/` – oddzielny katalog ✅
- `background.js` – 566 linii, znośne ✅
- `styles.css` – styl dla content script, OK ✅

---

## 📁 Jak powinna wyglądać struktura po zmianach

```
Lectoro/
├── manifest.json
├── background.js
├── content.js
├── core.js
├── styles.css          ← styl dla content script (bez zmian)
│
├── popup.html          ← tylko HTML, bez bloku <style>
├── popup.css           ← [NOWY] wszystkie style popupu
│
├── popup/              ← [NOWY KATALOG]
│   ├── init.js         ← inicjalizacja, zakładki, storage listener
│   ├── settings.js     ← ustawienia języka, TTS, API keys
│   ├── words.js        ← lista słówek, filtrowanie, usuwanie
│   ├── export.js       ← Anki ZIP, CSV, download helpers
│   ├── review.js       ← flashcardy, SRS, klawiatura
│   ├── tts.js          ← popupSpeak, stopPopupSpeak, pickVoice
│   ├── library.js      ← biblioteka filmów
│   └── firebase-ui.js  ← UI synchronizacji Firebase
│
├── shared/
│   ├── utils.js        ← + cleanTextForTTS, pickBestVoice, highlightWord
│   ├── srs.js
│   ├── ai-prompts.js
│   ├── quiz-export.js
│   └── library-items.json
│
└── firebase/
    ├── firebase-config.js
    └── firebase-sync.js
```

W `popup.html` w sekcji `<head>` dodaj:
```html
<link rel="stylesheet" href="popup.css">
```

Na dole `popup.html` przed `</body>` dodaj skrypty w kolejności:
```html
<script src="shared/utils.js"></script>
<script src="shared/srs.js"></script>
<script src="shared/ai-prompts.js"></script>
<script src="shared/quiz-export.js"></script>
<script src="firebase/firebase-config.js"></script>
<script src="firebase/firebase-sync.js"></script>
<script src="popup/firebase-ui.js"></script>
<script src="popup/tts.js"></script>
<script src="popup/settings.js"></script>
<script src="popup/words.js"></script>
<script src="popup/export.js"></script>
<script src="popup/review.js"></script>
<script src="popup/library.js"></script>
<script src="popup/init.js"></script>
```

---

## 🔢 Kolejność kroków – co robić najpierw

**Krok 1** – Wyciągnij CSS z popup.html do popup.css
- Otwórz `popup.html`
- Znajdź blok `<style>` (zaczyna się na linii 6)
- Wytnij CAŁĄ zawartość między `<style>` a `</style>` (bez samych tagów)
- Wklej do nowego pliku `popup.css`
- W `popup.html` zamień `<style>...</style>` na `<link rel="stylesheet" href="popup.css">`
- Sprawdź czy popup wygląda tak samo

**Krok 2** – Wydziel popup/tts.js
- Wytnij z `popup.js` funkcje: `cleanTextForPopupTTS`, `pickPopupVoice`, `popupSpeak`, `stopPopupSpeak`, `attachReviewSpeakHandlers`
- Wklej do nowego pliku `popup/tts.js`
- Dodaj `<script src="popup/tts.js">` w HTML **przed** `popup.js`

**Krok 3** – Wydziel popup/library.js
- Wytnij z `popup.js` od linii 2023 do końca (cała sekcja Library)
- Wklej do `popup/library.js`

**Krok 4** – Wydziel popup/review.js
- Wytnij sekcję SRS/powtórek (od linii ~1105 do ~1971)
- Wklej do `popup/review.js`

**Krok 5** – Wydziel popup/export.js
- Wytnij `buildZip`, `crc32`, eksport Anki, eksport CSV, `markAsDownloaded`, `downloadFile`, `dateTag`, `csvCell`
- Wklej do `popup/export.js`

**Krok 6** – Wydziel popup/words.js
- Wytnij `loadWords`, `deleteWord`, `deleteReviewWord`, `deleteAllReviews`, `filterWords`, helpery czasu
- Wklej do `popup/words.js`

**Krok 7** – Wydziel popup/settings.js
- Wytnij wszystko co dotyczy ustawień (lang select, voice, rate, volume, EL, Gemini key)
- Wklej do `popup/settings.js`

**Krok 8** – Usuń duplikaty
- Przenieś `cleanTextForTTS` do `shared/utils.js`
- Przenieś `pickBestVoice` do `shared/utils.js`
- Połącz funkcje highlight zdania w jedną

**Krok 9** – popup.js staje się popup/init.js
- Powinno zostać tylko parę dziesiątek linii: tab switching, auto-switch na review, storage listener

---

## 🎨 Jak użyć Tailwinda w projekcie (krok po kroku dla dziecka)

> ⚠️ **Ważne**: Rozszerzenia Chrome to specjalny przypadek. Tailwind nie może być po prostu podpięty przez CDN jak zwykła strona – trzeba go "skompilować" do czystego pliku CSS. Poniżej najłatwiejsza metoda.

---

### Metoda A – Standalone CLI (NAJPROSTSZA, bez Node.js)

To jest jak ściągnięcie jednego narzędzia które samo robi całą robotę.

**Krok 1:** Pobierz plik wykonywalny Tailwind CLI
```
https://github.com/tailwindlabs/tailwindcss/releases/latest
```
Pobierz plik `tailwindcss-macos-arm64` (dla Mac z Apple Silicon) albo `tailwindcss-macos-x64` (dla starszych Mac).

**Krok 2:** Zmień nazwę pobranego pliku na `tailwindcss` i przenieś do folderu projektu.

**Krok 3:** Nadaj mu uprawnienia uruchamiania w terminalu:
```bash
chmod +x tailwindcss
```

**Krok 4:** Stwórz plik `popup-source.css` z zawartością:
```css
@import "tailwindcss";
```

**Krok 5:** Uruchom kompilację:
```bash
./tailwindcss -i popup-source.css -o popup.css --watch
```
Flaga `--watch` oznacza: "obserwuj zmiany w HTML i JS i automatycznie aktualizuj CSS".

**Krok 6:** W `popup.html` zostaw już istniejący link:
```html
<link rel="stylesheet" href="popup.css">
```

**Krok 7:** Teraz możesz używać klas Tailwinda w `popup.html`:
```html
<div class="flex items-center gap-4 p-4 bg-gray-900 rounded-xl">
```

Tailwind sam wykryje jakich klas użyłeś i doda tylko je do `popup.css`.

---

### Metoda B – Przez npm/Node.js (jeśli już masz Node.js)

**Krok 1:** W terminalu, w folderze projektu:
```bash
npm init -y
npm install tailwindcss @tailwindcss/cli
```

**Krok 2:** Stwórz plik `popup-source.css`:
```css
@import "tailwindcss";
```

**Krok 3:** Dodaj do `package.json` w sekcji "scripts":
```json
"scripts": {
  "build:css": "npx @tailwindcss/cli -i popup-source.css -o popup.css",
  "dev:css": "npx @tailwindcss/cli -i popup-source.css -o popup.css --watch"
}
```

**Krok 4:** Uruchamiaj podczas pracy:
```bash
npm run dev:css
```

**Krok 5:** Przed wypuszczeniem rozszerzenia:
```bash
npm run build:css
```

To skompiluje Tailwind do minimalnego pliku `popup.css` który wgrywasz do Chrome.

---

### Czego NIE robić z Tailwindem w rozszerzeniu Chrome

❌ Nie dodawaj tego do HTML – w rozszerzeniu nie działa:
```html
<!-- TO NIE ZADZIAŁA W CHROME EXTENSION -->
<script src="https://cdn.tailwindcss.com"></script>
```

❌ Nie dodawaj `tailwindcss` do manifest.json – to nie jest zwykły skrypt.

✅ Jedyne co dodajesz do manifestu to już skompilowany plik `popup.css`.

---

### Jak wygląda popup.html po przejściu na Tailwinda

Zamiast tego w CSS:
```css
.header { display: flex; align-items: center; gap: 12px; padding: 20px; }
```

Możesz pisać klasy bezpośrednio w HTML:
```html
<div class="flex items-center gap-3 p-5">
```

Ale uwaga – istniejące zmienne CSS (`:root { --accent: #818cf8; }`) możesz zachować i używać razem z Tailwindem bez żadnego problemu.

---

### Podsumowanie kolejności dla Tailwinda

1. Pobierz Tailwind CLI (jeden plik z GitHub)
2. Stwórz `popup-source.css` z linią `@import "tailwindcss"`
3. Uruchom `./tailwindcss -i popup-source.css -o popup.css --watch`
4. W `popup.html` podepnij `popup.css` (zamiast dotychczasowego bloku `<style>`)
5. Zacznij używać klas Tailwinda w HTML
6. Przed wydaniem rozszerzenia uruchom bez `--watch` żeby zbudować produkcyjny CSS
