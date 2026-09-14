# Słowniki Lectoro (Dictionaries)

Ten folder zawiera pakiety słowników oraz statyczne frazy używane przez rozszerzenie Lectoro.

---

## 📁 Struktura folderu

```
dictionaries/
├── packs/          # Główne paczki słowników językowych (np. en-pl.json, en-de.json)
├── phrase/         # Statyczne frazy wielowyrazowe do trybu Word-by-word (np. en-pl.json)
└── README.md       # Ta instrukcja
```

- **`packs/`**: Zawiera skonsolidowane paczki słów. Każdy plik `en-<target>.json` zawiera tysiące zweryfikowanych słówek z definicją, synonimami i 3 zdaniami przykładowymi.
- **`phrase/`**: Lekkie pliki JSON mapujące całe zwroty (np. `"play with fire": "igrać z ogniem"`).

---

## 🚀 Jak wrzucać nowe paczki i słowa do Cloudflare R2?

Wszystkie paczki trafiają do bucketa Cloudflare R2 pod ścieżkę:
`dictionaries/packs/<source>-<target>.json` (np. `dictionaries/packs/en-pl.json`)

Masz do wyboru 3 proste sposoby:

### Sposób 1: Automatycznie w chmurze (Zero obsługi)
W Google Cloud działa wdrożona funkcja harmonogramu **`consolidateDictionaryDaily`**:
- Codziennie o **3:00 w nocy** funkcja automatycznie pobiera wszystkie nowe słówka dodane przez użytkowników w ciągu dnia z folderu `dictionaries/live/`, scala je i aktualizuje plik paczki w R2.
- Nie musisz niczego klikać ani włączać komputera.

---

### Sposób 2: Przez wbudowany skrypt CLI (Z terminala)
Możesz w dowolnym momencie z poziomu głównego katalogu Lectoro wymusić scalenie i upload paczek na R2:

```bash
# 1. Wgranie i scalenie konkretnego języka (np. en-pl):
R2_SECRET_ACCESS_KEY="TWÓJ_SECRET_KEY" node functions/consolidate-cli.js en-pl --force

# 2. Wgranie i scalenie wszystkich 10 języków naraz:
R2_SECRET_ACCESS_KEY="TWÓJ_SECRET_KEY" node functions/consolidate-cli.js all --force
```

> **Wskazówka:** `R2_ACCESS_KEY_ID` (`fa5ae76d960a9dad174cef0c23989065`) oraz `R2_ACCOUNT_ID` są już domyślnie skonfigurowane w skrypcie, więc wystarczy podać sam `R2_SECRET_ACCESS_KEY`.

---

### Sposób 3: Ręcznie przez Cloudflare Dashboard (Przeciągnij i upuść)
Jeśli przygotujesz własny plik `.json` ze słówkami:
1. Zaloguj się na [dash.cloudflare.com](https://dash.cloudflare.com).
2. W menu bocznym wybierz **R2** → kliknij bucket **`lectoro-media`**.
3. Wejdź do katalogu **`dictionaries`** → **`packs`** (lub utwórz go, jeśli nie istnieje).
4. Kliknij przycisk **Upload** i przeciągnij swój plik (np. `en-pl.json`).
5. Plik od razu będzie publicznie dostępny pod adresem:
   `https://pub-ee4534784e534bd9af38ba8022bc5e1e.r2.dev/dictionaries/packs/en-pl.json`

---

## 📝 Format pliku paczki JSON (`schemaVersion: 2`)

Każdy plik w folderze `packs/` musi mieć następującą strukturę:

```json
{
  "schemaVersion": 2,
  "source": "en",
  "target": "pl",
  "updatedAt": 1742000000000,
  "entries": {
    "time": {
      "t": "czas",
      "d": {
        "s": "The indefinite continued progress of existence and events.",
        "t": "Ciągły upływ chwil i zdarzeń."
      },
      "s": ["period", "moment"],
      "e": [
        { "s": "I do not have enough time today.", "t": "Nie mam dzisiaj wystarczająco dużo czasu." },
        { "s": "What time is the meeting?", "t": "O której godzinie jest spotkanie?" },
        { "s": "Time flies when you are having fun.", "t": "Czas leci szybko, kiedy dobrze się bawisz." }
      ],
      "languageValidation": 1
    }
  }
}
```

### Wymagania pól pojedynczego wpisu:
- `t`: Główne tłumaczenie słowa w języku docelowym (maks. 120 znaków).
- `d.s` i `d.t`: Definicja słowa — odpowiednio w języku źródłowym i docelowym (maks. 300 znaków).
- `s`: Tablica synonimów (maks. 2 synonimy, maks. 80 znaków każdy).
- `e`: **Dokładnie 3** dwujęzyczne przykłady zdań zawierające to słowo (`s` – źródło, `t` – tłumaczenie, maks. 300 znaków).
- `languageValidation`: Wartość `1` (potwierdzenie przejścia weryfikacji językowej).

---

## ⚡ Jak rozszerzenie korzysta z tych paczek?

1. **Pobieranie w tle:** Rozszerzenie raz na 12 godzin (lub przy starcie/zmianie języka) pyta R2 o plik paczki, wysyłając nagłówek `If-None-Match: <etag>`.
2. **0 bajtów transferu:** Jeśli plik na R2 się nie zmienił, serwer zwraca `304 Not Modified`. Żadne dane nie są ponownie pobierane.
3. **Błyskawiczne działanie (0 ms):** Słówka są zapisywane w lokalnej bazie `IndexedDB` przeglądarki użytkownika. Podczas oglądania wideo na YouTube/Netflixie tłumaczenia pojawiają się natychmiast bez obciążania sieci.
