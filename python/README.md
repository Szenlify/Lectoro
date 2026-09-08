# Jakość tłumaczeń i uruchomienie na Macu

Generator działa bez płatnego API. Google tłumaczy pojedyncze hasła bez kontekstu:
wynik jest wersją roboczą, nie zweryfikowanym słownikiem. Zwiększenie `--count`
nie poprawia jakości. Nie uruchamiaj wszystkich par, jeśli potrzebujesz tylko EN→PL.

W głównym folderze `Lectoro` na macOS/Linux:

```bash
python3 -m venv python/.venv
python/.venv/bin/python -m pip install -r python/requirements.txt
# Paczka tylko z dostarczonych korekt, bez zapytań do Google:
python/.venv/bin/python python/build_en_pl.py --count 50000 --curated-only
# Pełna baza robocza, z pierwszeństwem korekt i zachowaniem postępu:
python/.venv/bin/python python/build_en_pl.py --count 50000
```

Opcjonalny plik `python/overrides/en-pl.json` może zawierać własne korekty,
znaczenia i przykłady. Brak tego pliku oznacza brak ręcznych korekt.
W `translations` wpisuj tylko krótkie odpowiedniki, bez objaśnień gramatycznych.

Korekty mają pierwszeństwo także przed błędami zapisanymi wcześniej w SQLite.
Można nadal używać prostego formatu `{"book": ["książka"]}`. Dla wielu znaczeń:

```json
{
  "bank": {
    "senses": [
      {
        "id": "financial-institution",
        "partOfSpeech": "noun",
        "translations": ["bank"],
        "definition": "Instytucja prowadząca rachunki i udzielająca kredytów.",
        "examples": [{"source": "I went to the bank.", "target": "Poszedłem do banku."}]
      }
    ]
  }
}
```

Zachowuj `id` znaczenia przy poprawkach i zmianie kolejności. Generator buduje
z niego stabilne `senseId`. `reviewStatus: manual-override` oznacza wpis z pliku
korekt, a `machine-generated` wynik Google; żaden status nie oznacza niezależnej
recenzji. Hover w napisach pokazuje pełną listę krótkich odpowiedników oraz zdania przykładowe.
Kliknięcie zdania rozwija jego tłumaczenie; ponowne kliknięcie je chowa. Nie pokazujemy
części mowy, opisów znaczeń ani przycisku wyboru znaczenia. Metadane pozostają w danych,
ponieważ pomagają lokalnemu dopasowaniu do kontekstu.

Tryb S (word by word) wybiera tylko jeden odpowiednik. Najpierw korzysta z kontekstu,
potem z `primaryTranslations` w paczce, a na końcu z pierwszego odpowiednika.
Domyślne EN→PL `all` to `wszystko`. Hover nadal pokazuje `cały / wszyscy / wszystkie / wszystko`.
Opisy takie jak `czasownik pomocniczy (bez osobnego tłumaczenia)` są odfiltrowywane,
także ze starszych paczek. `is` pokazuje `jest`. Jeden odpowiednik może być krótką frazą,
gdy naturalne tłumaczenie tego wymaga (np. `poddać się`); nie obcinamy go do jednego wyrazu.

Dobór kontekstowy jest lokalną heurystyką wykorzystującą przykłady i proste reguły
gramatyczne angielskiego. Nie gwarantuje poprawności w każdym zdaniu. Przykłady muszą
być obecne w paczce; zwykły GoogleTranslator ich nie tworzy.

## Generowanie tłumaczeń i przykładów bez płatnego API

Nowy wariant `--engine ollama` generuje jednocześnie krótki główny odpowiednik,
alternatywne znaczenia i 1–2 zdania przykładowe z tłumaczeniem dla każdego znaczenia.
Wymaga działającej lokalnej [Ollamy](https://ollama.com/download) i pobranego modelu
obsługującego wybrane języki. Skrypt nie instaluje ani nie pobiera modelu automatycznie.
Zastąp `NAZWA_MODELU` rzeczywistą nazwą lokalnego modelu z `ollama list`.

```bash
python/.venv/bin/python python/build_en_pl.py --engine ollama --model NAZWA_MODELU --count 50000 --timeout 300
```

Endpoint jest stały: `http://127.0.0.1:11434/api/chat`. Skrypt nie korzysta z płatnego
API ani nie przełącza się automatycznie na model chmurowy. Korzysta z JSON Schema,
sprawdza obecność hasła w przykładzie, główny odpowiednik oraz kompletność odpowiedzi.
Błędny lub ucięty wynik zatrzymuje sesję i nie trafia do cache. Gotowe wpisy są
zachowane; powtórzenie tego samego polecenia wznawia pracę. Weryfikacja struktury
nie zastępuje sprawdzenia poprawności językowej modelu.

Cache jest osobny dla silnika/modelu i wersji instrukcji. Stare tłumaczenie Google
bez przykładów nie jest traktowane jako ukończony wpis Ollamy. Zmiana modelu zaczyna
osobną kolejkę. Eksport gotowych wpisów bez generowania:

```bash
python/.venv/bin/python python/build_en_pl.py --engine ollama --model NAZWA_MODELU --count 50000 --export-only
```

Dotychczasowe polecenie bez `--engine ollama` nadal używa Google i tworzy tylko
tłumaczenia. `--retry-failed` dotyczy Google; dla Ollamy wznowienie jest zwykłym
powtórzeniem polecenia. Limit `--max-requests` obejmuje hasła generowane w jednej sesji.


Podczas tłumaczenia terminal pokazuje pasek pokrycia całej listy (wliczając cache
i korekty), liczbę zapytań w sesji, błędy i ETA sesji. ETA pojawia się po pierwszym
zapytaniu i obejmuje bieżący limit zapytań, nie wszystkie przyszłe wznowienia.
Błędy nie zwiększają liczby ukończonych haseł. W logu przekierowanym do pliku
postęp pojawia się okresowo w osobnych liniach. Trwający stary proces nie załaduje
zmian kodu: przerwij go Ctrl+C, poczekaj na zapis paczki i uruchom ponownie.

Raport `python/work/reports/en-pl.json` zawiera `needsReview` z wynikami Google,
flagami identycznego tekstu źródłowego i wielkich liter oraz `missing` z brakami.
Identyczny tekst może być poprawny (np. zapożyczenie), dlatego nie jest automatycznie
usuwany. `complete` dotyczy pokrycia listy, a nie poprawności. `qualityChecked`
pozostaje `false`: kontrola struktury i heurystyki nie zastępują oceny językowej.
`--curated-only` pomija wyniki Google i nie wykonuje zapytań tłumaczących.
Po poprawkach użyj `--export-only` do odświeżenia pełnej paczki lub
`--curated-only` do paczki samych korekt. Obie opcje aktualizują katalog w folderze
wyjściowym; paczka samych korekt ma ograniczone pokrycie.

Na nowym komputerze odtwórz `.venv`, a folder `python/work` skopiuj ze starego.
W Gicie zapisane są skrypty i korekty, ale nie lokalny postęp ani paczki `dist`.

# Co zrobić

Wykonuj polecenia w PowerShell, w głównym folderze Lectoro.

1. Zainstaluj Python 3.10 lub nowszy i zależności:

```powershell
python -m venv python/.venv
python/.venv/Scripts/python.exe -m pip install -r python/requirements.txt
```

2. Uruchom budowanie nowego słownika EN→PL z 50 000 najczęstszych haseł i dodatkowych fraz:

```powershell
python/.venv/Scripts/python.exe python/build_en_pl.py --count 50000
python/.venv/Scripts/python.exe python/build_en_pl.py --count 50000 --retry-failed
python/.venv/bin/python python/build_en_pl.py --count 50000 --retry-failed
```

Skrypt sam tworzy listę z `wordfreq` i tłumaczy przez `GoogleTranslator`. Nie potrzebujesz starego słownika, klucza API ani Gemini. Większą listę uzyskasz przez `--count 100000`.

3. Przetłumacz angielski na pozostałe języki:

```powershell
python/.venv/Scripts/python.exe python/translate_languages.py --sources en --targets ja,de,ko,fr,nl,he,es,it,cs,pt --count 50000
```

Dla każdej pary spośród 12 obsługiwanych języków użyj:

```powershell
python/.venv/Scripts/python.exe python/translate_languages.py --sources all --targets all --count 50000
```

Zostaw komputer włączony. To długi proces: domyślnie do 50 000 wywołań na uruchomienie, każde z przerwą 1,5 s plus czas odpowiedzi. Wszystkie pary to miliony wywołań. Po osiągnięciu limitu, przerwaniu lub błędzie Google powtórz to samo polecenie później. **Nie usuwaj `python/work`** — tam jest zapisany postęp. Gotowe hasła nie są tłumaczone ponownie.

Opcjonalnie dopisz frazy do `python/extra/en.txt` (dla innych źródeł np. `pl.txt`). Poprawki tłumaczeń umieść w `python/overrides/en-pl.json`, np. `{"above board":"uczciwy / jawny"}`, i ponownie uruchom skrypt z `--export-only`. Sprawdź tłumaczenia przed publikacją; lista częstotliwości nie obejmuje wszystkich słów i znaczeń.

Pojedyncze `TranslationNotFound` odkłada hasło do uzupełnienia i nie kończy pracy. Skrypt zatrzyma się po 3 takich błędach z rzędu albo od razu przy innym błędzie, np. limicie Google. Zwykłe wznowienie przetwarza nowe hasła. Odłożone hasła uzupełnij później osobnym poleceniem:

```powershell
python/.venv/Scripts/python.exe python/build_en_pl.py --count 50000 --retry-failed
```

# Co umieścić w R2

Wgraj **folder `dictionaries` z `python/dist` do głównego poziomu Twojego bucketa R2**, zachowując nazwy wygenerowanych podfolderów:

```text
dictionaries/
  catalog.json
  releases/
    google-.../
      en-pl.json
      licenses.json
    google-.../
      en-de.json
      licenses.json
```

Najpierw wgraj `releases`, **`catalog.json` na końcu**. Nie zmieniaj ręcznie wygenerowanych JSON-ów. Po kolejnej sesji wgraj nowe podfoldery oraz aktualny katalog. Każda paczka zawiera dotychczas ukończone hasła; liczbę brakujących sprawdzisz w `python/work/reports`.

Jeśli potrzebujesz tylko ponownie zapisać ukończone tłumaczenia, bez połączenia z Google:

```powershell
python/.venv/Scripts/python.exe python/build_en_pl.py --count 50000 --export-only
```

Po przypadkowym sformatowaniu lub zmianie paczki skrypt utworzy nową wersję z końcówką `-r1`, `-r2` itd. Wgraj tę nową wersję i aktualny `catalog.json`; nie usuwaj zapisanych tłumaczeń z `python/work`.

W R2 włącz publiczny dostęp. Katalog musi być dostępny pod adresem:

```text
https://pub-ee4534784e534bd9af38ba8022bc5e1e.r2.dev/dictionaries/catalog.json
```

Ustaw dla JSON `Content-Type: application/json; charset=utf-8`. Dla katalogu ustaw `Cache-Control: public, max-age=300`, a dla plików w `releases`: `public, max-age=31536000, immutable`.

Przeładuj rozszerzenie i stronę filmu. Wybierz język nauki i docelowy odpowiadające wgranej parze. Aktualizacja wcześniej pobranego katalogu może potrwać do 6 godzin. Nie wrzucaj na R2 ani do paczki rozszerzenia folderów `.venv`, `work` ani skryptów Python.
