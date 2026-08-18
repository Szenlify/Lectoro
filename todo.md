[TODO]

1. zdjecia od powtorek do claudflare R2 w webp w malej rozdzielczosci

2. zrob w kazdym jezyku aby był text UI nagłowki wszystkie w zaleznosci jaki zalezny jest język a jako defaul jest angielski [na pozniej jako ostatnie]

3. na netflix jak tlumacze cale zdanie to jak nie ruszam myszka i napisy opadaja wtedy kiedy chowa sie dolny pasek playera to tez tlumaczenie opada a adapter napisow nie opada wiec chcialbym aby tlumaczenie tez nie opadalo

4. jak naciskam jakis przycisk WSAD strzalki to pokazuje sie na dole pasek sterowania netflix, niech go nie pokazuje oraz jak najade kursorem na slowo, hover to film sie nie stopuje, zrob identycznie jak na youtubie neich stopuje sie video po najechaniu

5. dodaj na netflixie ze po kazdym wypowiedzianym zdaniu i opcje 1. moze byc zatrzymany film 2. wstrzymuje sie na 1s/2s/3s z paskiem ladowania na samej gorze od prawej do lewej

6. też na youtubie niech pobiera napisy json i niech bedzie opcja jak na netflixie zeby przewijal do poczatku napisow lub do konca

7. napisy reel niech sie pojawiaja tam gdzie jest najciemniejsze miejsce na filmiku ale zawsze tak aby byly cale widoczne

8. piracka biblioteka

9. w settings w div kredytow jest napis Limit odnawia się co miesiąc. podaj date obok kiedy dokladnie sie odnowi jesli subskrybuje to dokladna data kiedy mi pobiera pienidze oraz kiedy wtedy ma sie pakiet odnawiac, a na koncie free pakiet ma sie nie odnawiać.

10. przy wybiorze glosy probka glosu do oczytu (zapisana w projekcie tak zeby nie generowaly kosztow)

11. popraw prompty AI tak aby byly krotkie, po angielsku, zeby mniej tokenow ai zuzywalo i idealnie dopracowane

12. po Nacisnieciu Enter ,S  niech kazdy klawisz WSAD itp kasuje tooltipa i wznawia video
dla przykladu tlumacze za pomoca "Enter" AI, video sie pauzuje i drukie klikniecie Enter zamyka tooltip tlumaczenia i wznawia wideo a chcialbym dodatkowo aby klawisze WSAD tez zamykaly tooltip i wznawialy wideo

13. Klawisz "Z" jesli jest plan Basic lub Pro to tlumaczenia ma robic AI tak jak za pomoca Enter poprostu tlumaczenie bez wyjasnienia

14. Uporzadkuj kod aby netflix nie wiedzial skad biore napisy tylko niech je przyjmuje, wyodrebnij logike lookmovie do osobnego pliku, i podziel kod aby kazdy plik bral logike z jednego pliku jesli potrzeba

15. Tłumaczenia w locie na stronach: Wyłącznie Web Speech API (wbudowana synteza mowy w przeglądarkę – darmowa, natychmiastowa, zero obciążenia serwera). oraz w powtorkach rewiew zrob z Web Speech API opcje pod klikniecie i pod przycik "spacja" nagrywanie slowa/zdania ktore musze powtorzyc tak samo jak w powtorce oraz niech pokazuje litery na zielono ktore dobrze wypowiedziane a na czerwono te co zle to bedzie opcja shadowing ze sprawdzaniem wymowy

firebase login
firebase deploy --only functions --project extension-eng"
lub
firebase deploy --only functions,firestore:rules --project extension-eng

firebase use extension-eng
firebase functions:secrets:set ELEVENLABS_API_KEY

firebase.cmd functions:secrets:set LECTORO_GEMINI_API_KEY
firebase.cmd functions:secrets:set ELEVENLABS_API_KEY

Po ustawieniu obu sekretów odczekaj 2–5 minut i wdrażaj osobno:
firebase.cmd deploy --only "functions:geminiProxy"
Następnie:
firebase.cmd deploy --only "functions:syncUserPlanClaim"
Na końcu:
firebase.cmd deploy --only "firestore:rules"

firebase deploy --only "functions,firestore:rules"

# Klucz Gemini API – wstaw swój klucz poniżej

# NIGDY nie commituj tego pliku do Git!

# Plik jest w .gitignore

GEMINI_API_KEY=x

1. zmien geminiproxy na apiproxy bo sie myli nazwa

zalety:

fiszki z youtube reels
fiszki z social media / facebook / X / instagram / komentarze

Platformy najbardziej otwarte na przechwytywanie napisów

1. YouTube (Najłatwiejszy)Jak działa: Pobiera napisy przez proste zapytania sieciowe (timedtext) w formacie JSON/XML lub renderuje je w znanej strukturze DOM (.ytp-caption-segment). Wnioski: Idealny zestaw danych (posiada znaczniki czasu, tekst i opcjonalnie automatyczne tłumaczenia).

2. Netflix Jak działa: Renderuje napisy bezpośrednio w warstwie HTML (.player-timedtext) lub przesyła je w pakietach JSON/TTML. Wnioski: Bardzo stabilne źródło dla wtyczek językowych. Wymaga jedynie reagowania na ew. rzadkie zmiany klas CSS w odtwarzaczu.

3. Disney+ & Max (HBO)Jak działa: Obie platformy korzystają z odtwarzaczy bazujących na standardzie HTML5 (np. Shaka Player) i plikach WebVTT/TTML. Wnioski: Napisy trafiają do kontenerów tekstowych w DOM (np. .shaka-text-container), skąd wtyczka może łatwo czytać tekst w czasie rzeczywistym.

4. Amazon Prime VideoJak działa: Napisy są osadzane w przejrzystej strukturze HTML (np. .atvwebplayersdk-captions-text). Wnioski: Bardzo łatwy odczyt przez standardowy podgląd zmian w drzewie DOM.

Wciel się w rolę doświadczonego Software Architekta i Senior Developera. Twoim zadaniem jest przeprowadzenie dogłębnego audytu (Code Review) kodu projektu. Zależy mi na maksymalnym uporządkowaniu architektury.

Przeanalizuj kod pod kątem trzech głównych obszarów:

1. Eliminacja Martwego Kodu (Dead Code)
   Zidentyfikuj i wypisz wszystkie nieużywane zmienne, funkcje, komponenty, klasy, Upewnij się, że ich usunięcie nie popsuje działania aplikacji.

2. Wykrywanie Duplikacji (Zasada DRY - Don't Repeat Yourself)
   Znajdź fragmenty kodu, które są skopiowane lub realizują dokładnie tę samą logikę w minimalnie różny sposób w wielu miejscach. Zwróć uwagę nie tylko na identyczne linie, ale też na powtarzające się wzorce (np. identyczne wywołania API, powtarzająca się logika walidacji czy transformacji danych).

1. nie czytaj znaku ♪ zawsze go wycinaj z TTS
2. Web Speech API

3. Centralizacja Logiki (Single Source of Truth)
   Zaproponuj plan refaktoryzacji, który przeniesie rozproszoną logikę do jednego, spójnego miejsca. Inne pliki powinny jedynie importować gotowe metody/funkcje, stając się "głupimi" konsumentami logiki biznesowej. Zastanów się, czy logikę lepiej wydzielić do klasycznych funkcji pomocniczych (utils), dedykowanych serwisów (services)


