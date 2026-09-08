# Lokalne słowniki

Każdy plik językowy ma 20 startowych haseł. Klucz to angielska forma podstawowa,
a wartość to tłumaczenie w języku nazwy pliku, np. w `pl.json`:

```json
{
  "apple": "jabłko",
  "walk": "chodzić"
}
```

Dopisuj kolejne pary w tym samym formacie, w UTF-8. Po edycji przeładuj rozszerzenie
i stronę filmu, aby odświeżyć słownik przechowywany w pamięci service workera.
Nie trzeba wdrażać Firebase ani generować nowego pliku JavaScript.

`shared/local-dictionary.js` najpierw sprawdza dokładne hasło, potem kandydatów
dla angielskich końcówek `s`, `es`, `ies`, `ing`, `ed`, form dzierżawczych,
podwojonych spółgłosek i kilku form nieregularnych. Kandydat musi istnieć w JSON.
Przykłady: `apples → apple`, `walking → walk`, `running → run`, `written → write`.
To proste heurystyki, nie pełny analizator gramatyczny; tłumaczenie zachowuje formę
podstawową ze słownika. Dokładną formę, np. `"running": "bieganie"`, możesz dopisać
osobno, aby miała pierwszeństwo.

Język docelowy pochodzi z ustawienia Native language (`targetLang`). Język źródłowy
wybierasz w Learning language (`learningLang`, domyślnie angielski). Ten wybór
obowiązuje w słownikach, tłumaczeniach Google/Gemini i oznaczeniach języka;
automatyczne rozpoznawanie oraz język ścieżki filmu go nie zmieniają.
Przykład: English + Polish daje `EN → PL`, również dla krótkiego słowa `president`.
Cache jest oddzielny dla każdej pary języków. W ustawieniach i słownikach pozostaje
20 obsługiwanych języków. Dla innych języków nauki niż angielski dopasowujemy dokładne wartości
w słowniku źródłowym i wspólne angielskie klucze; nie stosujemy do nich angielskich
reguł odmiany. Przy rozbudowie par innych niż angielski dodaj klucz do obu plików.

Chmurki słów i podpowiedzi po najechaniu korzystają tylko z plików rozszerzenia.
Brakujące słowo nie powoduje połączenia z Google, Gemini ani Firebase.

# Tłumaczenie zdań i koszty

Nowe tłumaczenie dla zalogowanego użytkownika z dostępnym limitem korzysta
z istniejącego proxy i `gemini-2.5-flash-lite`: krótki prompt, `temperature: 0`,
`text/plain`, `thinkingBudget: 0`, ograniczenie odpowiedzi do 128–1024 tokenów
zależnie od długości tekstu. Konfiguracja wyłączenia myślenia jest opisana w
[dokumentacji Gemini](https://ai.google.dev/gemini-api/docs/generate-content/thinking).

Wspólny cache do 500 tłumaczeń przetrwa restart workera. Identyczne równoległe
zapytania są łączone. Tryb tylko word-by-word nie tłumaczy ani nie odczytuje całego
zdania. Nowe tłumaczenie AI używa jednego żądania do proxy, bez osobnego żądania
`usage`; serwer sprawdza i rozlicza limit atomowo w tym samym wywołaniu. Nadal
obowiązuje istniejący model rozliczeń: jedno nowe udane żądanie = jeden kredyt AI,
nie liczba tokenów modelu. Nieudane odpowiedzi są wycofywane z limitu na serwerze.
Wywołania proxy, Firestore i modelu nadal mogą generować koszty.

Gość lub użytkownik z wykorzystanym limitem miesięcznym korzysta z dotychczasowego
Google Translate. Znany lokalnie wykorzystany limit nie powoduje wywołania proxy.
Jeśli limit wyczerpał się na innym urządzeniu, odpowiedź serwera uruchamia fallback
i zapisuje stan lokalnie. Błąd przeciążenia usługi pokazuje chmurkę z przyciskiem
Try again. Automatyczne ponawianie wywołań Gemini dla tłumaczeń jest wyłączone.

Zmiana protokołu wymaga wdrożenia `functions/index.js` i `functions/ai-response.js`
do istniejącej funkcji `geminiProxy` przed udostępnieniem nowej wersji rozszerzenia.
Klucz Gemini pozostaje sekretem na serwerze. Testy lokalne nie wywołują płatnych API.
