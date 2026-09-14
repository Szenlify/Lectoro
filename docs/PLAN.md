# 1. Problem

W przykładzie YouTube widać istotny problem: pojedynczy blok zawiera koniec jednego zdania i początek następnego, a tłumaczenie ma inne czasy poszczególnych słów. Plan oprę na wspólnych, przygotowanych wcześniej parach napisów. Oddzielę dokładną synchronizację obu wierszy od dokładności wobec mowy, która zależy od jakości danych źródłowych.

# 2. Cel

Stworzyć system do nauki języków obcych (Lectoro), który:

- pobiera napisy z YouTube i Netflixa
- inteligentnie układa napisy oraz tłumaczenie, tak aby były idealnie synchronizowane
- działa bezpłatnie i niezawodnie dla tysięcy użytkowników
- wyświetla napisy w jednym rzędzie, z tłumaczeniem pod spodem (w jednym rzędzie)
- daje użytkownikowi gotowy wynik, bez konieczności obliczeń w trakcie odtwarzania

# 3. Podstawy techniczne

## 3.1 Pliki źródłowe

- [youtube-genereted-json.md](docs/youtube-genereted-json.md) — struktura JSON z napisami z YouTube
- [youtube.md](docs/youtube.md) — szczegółowy opis formatu napisów z YouTube
- [netflix.md](docs/netflix.md) — format napisów z Netflixa

## 3.2 Wymagania

- Bezpłatne API
- Niezawodność
- Skalowalność (tysiące użytkowników)
- Idealna synchronizacja napisów i tłumaczenia
- Szybkie obliczenia (wynik dostępny od razu)

# 4. Proces implementacji

## 4.1 Pobieranie danych

- yt-dlp + youtube-dl (bezpłatne, działają w Polsce)
- Netflix: analizowana struktura JSON (nie ma wbudowanego eksportu)

## 4.2 Algorytm synchronizacji

1. Pobierz napisy z obu źródeł
2. Wyrównaj sygnatury czasowe (timestamps)
3. Znajdź idealne momenty podziału zdań
4. Utwórz synchronizowany plik, gdzie:
   - napisy i tłumaczenie są idealnie dopasowane co do milisekundy
   - zdania kończą się i zaczynają w tych samych momentach

## 4.3 Idealna synchronizacja — matematyka

Nie opieraj się tylko na długości tekstu.
Użyj algorytmów dopasowujących sygnatury czasowe w oparciu o:

- duration
- start
- text
- timestamp
- segments (opcjonalnie, jeśli dostępne)

# 5. Wady i ich eliminacja

## 5.1 problem: podział zdań

YouTube: jeden blok → koniec jednego zdania + początek drugiego
Netflix: (brak formatu) — analizujstrukturę

*Rozwiązanie*: zaawansowana analiza tekstu i synchronizacja czasu

## 5.2 problem: obliczenia w trakcie odtwarzania

Użytkownik nie powinien czekać

*Rozwiązanie*: wszystko musi być policzone z góry

## 5.3 problem: niezawodność i koszty

Nie używaj drogich API AI

*Rozwiązanie*: czyste algorytmy + yt-dlp + youtube-dl

# 6. Layout użytkownika

## 6.1 Standardowe wyświetlanie (przykładowe)

```
Napisy (1. język)                             Napisy (2. język — tłumaczenie)

English: Hello, how are you?                    Polski: Witaj, jak się masz?

English: I am fine, thank you.                  Polski: Czuję się dobrze, dziękuję.
```

## 6.2 Podział na segmenty (optymalny)

```
┌─────────────────────────────────────────────┐
│  Hello, how are you?                        │ napisy
│  Polski: Witaj, jak się masz?               │ tłumaczenie
└─────────────────────────────────────────────┘
```

# 7. Co muszę przygotować

1.Dokładną analizę formatów JSON z YouTube i Netflixa
2. Algorytm dzielenia zdań na podstawie sygnatur czasowych
3. Optymalną strukturę danych do przechowywania par napisy-tłumaczenie
4. Gotowy, działający kod backendu i frontendu
5. Strategię skalowania, aby obsłużyć tysiące użytkowników bez kosztów API

# 8. Plan działania

W dokumencie [PLAN.md](docs/PLAN.md) zawrzyj:

- Dokładny algorytm synchronizacji
- Przykładowe dane wejściowe i oczekiwane wyjściowe
- Wady i zalety każdego podejścia
- Ostateczną strukturę danych
- Gotowe fragmenty kodu, które można skopiować i użyć