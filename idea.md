# Pomysły na rozwój Lectoro — usprawnienie nauki angielskiego

Analiza obecnego stanu: Lectoro to rozszerzenie do przeglądarki łączące
tłumaczenie (hover + zaznaczenie + napisy wideo), TTS (Browser/ElevenLabs),
tłumaczenie AI (Gemini) z generowaniem zdań i wyjaśnień, zapisywanie słówek
ze zrzutem ekranu, powtórki SR (Anki SM-2, 4 oceny, tryb odwrócony),
eksport do Anki (cloze + audio + obrazek) i CSV, oraz synchronizację Firebase.
To już solidny fundament pod "immersion learning" (czytanie + wideo) +
flashcards. Poniżej pomysły jak pójść dalej.

## 1. Aktywne ćwiczenia (poza "obejrzyj i oceń")

- **Fill-in-the-blank / cloze test w popupie** – zamiast tylko pokazywać
  tłumaczenie, czasem poprosić o wpisanie brakującego słowa w zdaniu
  (mamy już `aiSentence` z cloze do Anki — można to samo wykorzystać
  do ćwiczenia w rozszerzeniu, nie tylko w eksporcie).
- **Tryb pisania (typing recall)** zamiast/obok przycisków 1–4: user wpisuje
  tłumaczenie, system porównuje (fuzzy match) i sam sugeruje ocenę
  (Again/Hard/Good/Easy), user tylko potwierdza — mocno podnosi retencję.
- **Ćwiczenie ze słuchu (dictation)**: puszczamy TTS zdania, user wpisuje
  co usłyszał, porównanie z oryginałem.
- **Multiple choice quiz** jako lżejszy tryb powtórek (szybkie sesje na
  telefonie/przerwie) — 1 poprawna + 3 dystraktory z innych zapisanych słów.
- **Speaking practice** – Web Speech API (SpeechRecognition) do sprawdzania
  wymowy: user powtarza słowo/zdanie, dostaje prosty score dopasowania.

## 2. Lepsze wykorzystanie AI (Gemini już jest zintegrowane)

- **Automatyczne dodatkowe przykłady zdań** dla zapisanego słowa (2–3 różne
  konteksty) generowane on-demand w widoku powtórki, żeby uniknąć uczenia
  się słowa w jednym sztywnym kontekście.
- **Wyjaśnienie gramatyczne/idiomów** — już mamy `explanation` z AI translate;
  można to samo pokazywać przy przeglądaniu słówek (zakładka "Słowa"), nie
  tylko w tooltipie na stronie.
- **Automatyczna kategoryzacja słówek** przez AI: część mowy, poziom CEFR
  (A1–C1), temat/tag (np. "biznes", "potoczne", "phrasal verb") — pozwala
  potem filtrować i budować tematyczne talie do powtórek.
- **Generator mini-dialogów** z użyciem N ostatnio zapisanych słów, żeby
  poćwiczyć je razem w kontekście (jak "review sentence" ale zbiorczo).
- **AI-tłumaczenie phrasal verbs / idiomów** z priorytetem — wykrywanie że
  zaznaczony fragment to idiom i tłumaczenie całości, nie dosłowne.

## 3. Statystyki, motywacja, gamifikacja

- **Dashboard postępów** w popupie: wykres słówek dodanych/dziennie,
  retencja (% dobrych ocen), streak dni nauki, liczba słów "opanowanych"
  (np. interval > 21 dni).
- **Codzienny streak + przypomnienie** (mamy już `alarms` w manifest) —
  notyfikacja "Masz X słów do powtórki" jeśli user nie otworzył popupu.
- **Cele dzienne** (np. "10 nowych słów" / "20 powtórek dziennie") z paskiem
  postępu, podobnie jak Duolingo.
- **"Word of the day"** wybierane z zapisanych, ale jeszcze nieopanowanych.

## 4. Lepsza integracja z czytaniem/wideo (rdzeń produktu)

- **Podświetlanie znanych/nieznanych słów na całej stronie** — słowa już
  zapisane i "opanowane" wyszarzone, nowe/trudne podświetlone, żeby user
  widział na pierwszy rzut oka co jest nowe w tekście.
- **Tryb "czytanie z asystą"**: automatyczne tłumaczenie X% najrzadszych
  słów na stronie od razu jako etykiety (Word Cloud Mode już to częściowo
  robi dla napisów — rozszerzyć na zwykłe strony/artykuły).
- **Licznik unikalnych nowych słów na danej stronie/wideo** przed
  rozpoczęciem czytania, żeby ocenić trudność tekstu.
- **Historia obejrzanych/przeczytanych treści** z listą użytych/zapisanych
  słów per URL/tytuł odcinka — ułatwia wracanie do kontekstu przy powtórce
  (mamy już `screenshot`, można dodać link/tytuł źródła).
- **Wsparcie dla YouTube auto-napisów** (nie tylko Netflix/LookMovie) —
  duży dodatkowy zasób do nauki.

## 5. Rozszerzenie systemu powtórek (SRS)

- **Osobne talie/tagi** (np. wg źródła, tematu, poziomu) z możliwością
  powtarzania wybranej talii zamiast wszystkiego naraz.
- **Statystyki trudności per słowo**: licznik "Again" w historii, żeby
  wykryć słowa systematycznie zapominane i np. zaproponować dodatkowy
  przykład/mnemonic wygenerowany przez AI.
- **Leech detection** (jak w Anki) — słowo ocenione "Again" N razy z rzędu
  oznaczane specjalnie i np. wyświetlane z dodatkowym kontekstem/podpowiedzią.
- **Powtórki grupowe krótkie sesje** (np. "5 min sprint") dla szybkiej nauki
  w wolnej chwili, niezależnie od pełnej kolejki "due".

## 6. UX / drobne usprawnienia

- **Bulk edit / tagowanie** słówek w zakładce "Słowa" (obecnie tylko usuwanie).
- **Wyszukiwarka/filtr tekstowy** w liście zapisanych słów (obecnie tylko
  filtry czasowe + "nowe").
- **Import słówek** (CSV/Anki) — mamy eksport, warto dodać import, żeby
  łatwo migrować istniejące talie.
- **Skróty klawiszowe konfigurowalne** (obecnie sztywne 1–4, Spacja, Z) —
  ustawienia w popupie dla zaawansowanych userów.
- **Ciemny/jasny motyw** jeśli jeszcze nie ma — sprawdzić spójność stylu
  na różnych stronach docelowych.

## Priorytety (subiektywna kolejność wpływu na naukę / nakład pracy)

1. Typing recall / fill-in-the-blank w powtórkach (duży wzrost retencji,
   dane już istnieją — `aiSentence`, `sentence`).
2. Dashboard postępów + streak/notyfikacje (motywacja do systematyczności).
3. Tagi/talie + filtrowanie po źródle/temacie.
4. AI: dodatkowe przykłady zdań + CEFR/tagi przy zapisie słowa.
5. Podświetlanie znanych/nowych słów na stronie (poza wideo).
