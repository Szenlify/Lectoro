[TODO]

1. zdjecia od powtorek do claudflare R2 w webp w malej rozdzielczosci

[DONE] 2. zmiejsz zyzycie odczytu/zapisu i usuniec bazy danych firebase niech synchronizuje "writeBatch()" do bazy danych to z chrome local storage chrome manualnym kliknieciu przycisku synchronizuj w settings a przy uzyciu przycisku wyloguj najpierw synchronizuj powtorki a potem wyloguj dodatkowo przy przycisku synchronizuj niech sie pojawi czerwona kropka mrygajaca sugerujaca ze sa rzeczy niesynchronizowane oraz dodaj Auto-sync po przestaniu klikania powtorek co 30 sekund niech wysle paczke do firebase w tle tak zeby zmiejszyc koszta bazy danych firebase funkcje AI z cloud firebase function niech liczy w pamieci wczesniejsze pobranie z firebase i dolicza lokalnie niech pamieta limity oraz Jeśli użytkownik zainstaluje wtyczkę na laptopie i komputerze stacjonarnym: Przy synchronizacji stosuj prostą zasadę "Last-Write-Wins" (wygrywa najnowsza zmiana)

3. cache'owanie audio elevanlabs w Chrome Extension, żeby nie płacić dwa razy za te same fiszki [nie sprawdzone]

4. zrob w kazdym jezyku aby był text UI nagłowki wszystkie w zaleznosci jaki zalezny jest język a jako defaul jest angielski [na pozniej jako ostatnie]

6. Popraw content.js tooltip/chmurka czasem jak cos zaznaczam nie widze tooltipa z 3 przyciskami ale nie moge dalej kopiowac textu ani w text kliknac wiec czasem go nie widze a pewnie jest i czasami nawet wcisne niewidoczny przycisk, czasami sie zacina i mimo ze tts nic nie mowi to ikonka jest aktywna i nie moge nacisnac drugi raz w nia, przeanalizuj caly content.js

7. napisy reel niech sie pojawiaja tam gdzie jest najciemniejsze miejsce na filmiku ale zawsze tak aby byly cale widoczne i 15% od granicy frame video

8. piracka biblioteka

9. dodaj spiner w trakcie otwierania Stripe do 


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



zmien geminiproxy na apiproxy bo sie myli nazwa