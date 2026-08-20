[TODO]
Cashing subskrypcji w Storage rozszerzenia:
Wtyczka przechowuje profil subskrypcji w chrome.storage.local i odpytuje backend o status tylko raz na godzinę (lub po zakupie), co minimalizuje obciążenie Firestore.

Wprowadź 3-dniowy Darmowy Okres Próbny (Free Trial) w Stripe:
Wymaga podania karty, ale nie pobiera opłaty przez pierwsze 3 dni.
Oferuj Plan Roczny z góry:
Użytkownik płaci od razu $59.99 (ok. 240 PLN). Jeden taki zakup daje Ci natychmiastowy zastrzyk gotówki równy 7-8 miesiącom pojedynczego abonamentu!
Wykorzystaj e-mail marketing:
Każdy, kto loguje się w Firebase Auth, zostawia swój e-mail. Wyślij po 3 dniach automatyczny mail: "Oto 3 triki, jak uczyć się 2x szybciej z Lectoro + zniżka 20% na plan Basic ważna przez 48h".

Produkt & Launch
    Publikacja w Chrome Store & Testy     :done, 2026-01-01, 14d
    Uruchomienie Stripe Live & Plany Roczne:2026-01-15, 14d
    section Marketing Organiczny
    TikTok / Reels / Shorts (1 wideo/dzień):2026-01-15, 150d
    Reddit / Grupy FB / Product 
    r/EnglishLearningHunt       :2026-02-01, 60d
    section Skalowanie & Influencerzy
    Ekspansja Globalna (Język EN/ES)       :2026-03-01, 90d
    Współpraca z mikro-twórcami (Affiliate):2026-04-01, 60d

. 💎 Dlaczego Lectoro ma ogromny potencjał na ten wynik?

Ból klienta jest silny i powtarzalny: Ludzie mają wyrzuty sumienia, że marnują czas na Netflixie/YouTube zamiast się uczyć. Lectoro daje im rozgrzeszenie: "Oglądasz serial, ale w rzeczywistości uczysz się angielskiego/hiszpańskiego".

Efekt "WOW" w 15 sekund: Użytkownik instaluje wtyczkę, odpala film, najeżdża na słowo, natychmiast słyszy krystaliczny głos ElevenLabs i widzi zrzut kadru. To natychmiast buduje wysoką postrzeganą wartość.


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

Wciel się w rolę doświadczonego Software Architekta i Senior Developera.

przeanalizuj aplikacje zrob aby byla bardzo oszczedna bo bedzie ja pobierac tysiace uzytkownikow wiec kazde zaoszczedzone pytanie token do serverow jes bardzo potrzebna przy tym zachowanie bezpieczenstwa aplikacji oraz zachowanie dalania wszystkich funkcji jak gemini ai, eleven laps na koniec zrob firebase deploy i sprawdz czy wszystko dziala
