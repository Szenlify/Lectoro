[TODO]

1. jakie klucze co i jak krok por kroku co musze mieniac kiedy bede stawial juz produkcyjna chrome extension

2. zrob w kazdym jezyku aby był text UI nagłowki wszystkie w zaleznosci jaki zalezny jest język a jako defaul jest angielski [na pozniej jako ostatnie]

5. dodaj na netflixie ze po kazdym wypowiedzianym zdaniu i opcje 1. moze byc zatrzymany film 2. wstrzymuje sie na 1s/2s/3s z paskiem ladowania na samej gorze od prawej do lewej

11. popraw prompty AI tak aby byly krotkie, po angielsku, zeby mniej tokenow ai zuzywalo i idealnie dopracowane

15. w powtorkach rewiew zrob z Web Speech API opcje pod klikniecie przycik "spacja" nagrywanie slowa/zdania ktore musze powtorzyc tak samo jak w powtorce oraz niech pokazuje litery na zielono ktore dobrze wypowiedziane a na czerwono te co zle to bedzie opcja shadowing ze sprawdzaniem wymowy. niech w czasie sluchaia bedzie ikona ktora emituje sluchanie

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

zalety:

fiszki z youtube reels
fiszki z social media / facebook / X / instagram / komentarze

Platformy najbardziej otwarte na przechwytywanie napisów

3. Disney+ & Max (HBO)Jak działa: Obie platformy korzystają z odtwarzaczy bazujących na standardzie HTML5 (np. Shaka Player) i plikach WebVTT/TTML. Wnioski: Napisy trafiają do kontenerów tekstowych w DOM (np. .shaka-text-container), skąd wtyczka może łatwo czytać tekst w czasie rzeczywistym.

4. Amazon Prime VideoJak działa: Napisy są osadzane w przejrzystej strukturze HTML (np. .atvwebplayersdk-captions-text). Wnioski: Bardzo łatwy odczyt przez standardowy podgląd zmian w drzewie DOM.

Wciel się w rolę doświadczonego Software Architekta i Senior Developera. Twoim zadaniem jest przeprowadzenie dogłębnego audytu (Code Review) kodu projektu. Zależy mi na maksymalnym uporządkowaniu architektury.

Przeanalizuj kod pod kątem trzech głównych obszarów:

1. Eliminacja Martwego Kodu (Dead Code)
   Zidentyfikuj i wypisz wszystkie nieużywane zmienne, funkcje, komponenty, klasy, Upewnij się, że ich usunięcie nie popsuje działania aplikacji.

2. Wykrywanie Duplikacji (Zasada DRY - Don't Repeat Yourself)
   Znajdź fragmenty kodu, które są skopiowane lub realizują dokładnie tę samą logikę w minimalnie różny sposób w wielu miejscach. Zwróć uwagę nie tylko na identyczne linie, ale też na powtarzające się wzorce (np. identyczne wywołania API, powtarzająca się logika walidacji czy transformacji danych).

3. Centralizacja Logiki (Single Source of Truth)
   Zaproponuj plan refaktoryzacji, który przeniesie rozproszoną logikę do jednego, spójnego miejsca. Inne pliki powinny jedynie importować gotowe metody/funkcje, stając się "głupimi" konsumentami logiki biznesowej. Zastanów się, czy logikę lepiej wydzielić do klasycznych funkcji pomocniczych (utils), dedykowanych serwisów (services)


