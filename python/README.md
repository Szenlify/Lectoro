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
