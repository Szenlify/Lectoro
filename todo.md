[TODO]
wyslano 2 pobrano 2 w synchronizacji

ograniczone tlumaczenia na godzine

Oferuj Plan Roczny z góry:
Użytkownik płaci od razu $59.99 (ok. 240 PLN). Jeden taki zakup daje Ci natychmiastowy zastrzyk gotówki równy 7-8 miesiącom pojedynczego abonamentu!
Wykorzystaj e-mail marketing:
Każdy, kto loguje się w Firebase Auth, zostawia swój e-mail. Wyślij po 3 dniach automatyczny mail: "Oto 3 triki, jak uczyć się 2x szybciej z Lectoro + zniżka 20% na plan Basic ważna przez 48h".



Ból klienta jest silny i powtarzalny: Ludzie mają wyrzuty sumienia, że marnują czas na Netflixie/YouTube zamiast się uczyć. Lectoro daje im rozgrzeszenie: "Oglądasz serial, ale w rzeczywistości uczysz się angielskiego/hiszpańskiego".

Efekt "WOW" w 15 sekund: Użytkownik instaluje wtyczkę, odpala film, najeżdża na słowo, natychmiast słyszy krystaliczny głos ElevenLabs i widzi zrzut kadru. To natychmiast buduje wysoką postrzeganą wartość.

do usuniecia pozniej:
.git/
functions/
scratch/
dev.md
todo.md
stripe.md
firebase.json
.firebaserc
.DS_Store
testy i pliki TypeScript


2. zrob w kazdym jezyku aby był text UI nagłowki wszystkie w zaleznosci jaki zalezny jest język a jako defaul jest angielski [na pozniej jako ostatnie]

1. https://pub-ee4534784e534bd9af38ba8022bc5e1e.r2.dev/audio/EXAVITQu4vr4xnSDxMaL/5870cc58ef1c7f7a54cd4ddfcb1ebccb16b0de0d54e55f8f3751233e9e8dd55c.mp3
sposob na pobieranie audio bed uzywania sekretow do R2 moze zapisac audio w inny sposob ale musi byc ono krotkie po w url moze chyba byc 64znaki wiec jesli jesli text jest dluzszy wtedy juz nie zapisze a chodzilo mi o https://pub-ee4534784e534bd9af38ba8022bc5e1e.r2.dev/audio/where-are-you-been.mp3 takie uniwersalne audio chce zeby uzytkownicy kazdy uzytkownik nie tworzyl od nowa tylko aby sprawdzal czy jest taki url jesli nie ma blad 404 to wtedy niech generuje, a dluzsze slowa lub slowa z zdaniami to chyba nie znajde uniwersalnego sposobu

2. popraw prompty AI bo teraz tlumacza czesto bez sensu lub nie w tym jezyku

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

Wciel się w rolę doświadczonego Software Architekta i Senior Developera.

przeanalizuj aplikacje zrob aby byla oszczedna bo bedzie ja pobierac tysiace uzytkownikow wiec kazde zaoszczedzone pytanie token do serverow jest bardzo potrzebna przy tym zachowanie bezpieczenstwa aplikacji oraz szybka bo popup teraz czasami dlugo sie otwiera oraz zachowanie dalania wszystkich funkcji jak gemini ai, eleven laps oraz pamietaj o Centralizacja Logiki (Single Source of Truth) i Wykrywanie Duplikacji (Zasada DRY - Don't Repeat Yourself)oraz na koniec zrob firebase deploy i sprawdz czy wszystko dziala 
