[TODO]

1. zdjecia od powtorek do claudflare R2 w webp w malej rozdzielczosci

[DONE] 2. zmiejsz zyzycie odczytu/zapisu i usuniec bazy danych firebase niech synchronizuje "writeBatch()" do bazy danych to z chrome local storage chrome manualnym kliknieciu przycisku synchronizuj w settings a przy uzyciu przycisku wyloguj najpierw synchronizuj powtorki a potem wyloguj dodatkowo przy przycisku synchronizuj niech sie pojawi czerwona kropka mrygajaca sugerujaca ze sa rzeczy niesynchronizowane oraz dodaj Auto-sync po przestaniu klikania powtorek co 30 sekund niech wysle paczke do firebase w tle tak zeby zmiejszyc koszta bazy danych firebase funkcje AI z cloud firebase function niech liczy w pamieci wczesniejsze pobranie z firebase i dolicza lokalnie niech pamieta limity oraz Jeśli użytkownik zainstaluje wtyczkę na laptopie i komputerze stacjonarnym: Przy synchronizacji stosuj prostą zasadę "Last-Write-Wins" (wygrywa najnowsza zmiana)


4. zrob w kazdym jezyku aby był text UI nagłowki wszystkie w zaleznosci jaki zalezny jest język a jako defaul jest angielski [na pozniej jako ostatnie]

3. na netflix jak tlumacze cale zdanie to jak nie ruszam myszka i napisy opadaja wtedy kiedy chowa sie dolny pasek playera to tez tlumaczenie opada a adapter napisow nie opada wiec chcialbym aby tlumaczenie tez nie opadalo


7. napisy reel niech sie pojawiaja tam gdzie jest najciemniejsze miejsce na filmiku ale zawsze tak aby byly cale widoczne i 15% od granicy frame video

8. piracka biblioteka

11. w settings w div kredytow jest napis Limit odnawia się co miesiąc. podaj date obok kiedy dokladnie sie odnowi na kolor var ghost


14. WSAD i strzalki niech dzialaja na kazdym filmie i zabezpiecz tak ze np w social mediach jest duzo filmow na raz to ten ktory widzie na srceene aktualnie nie inny

16. netflix przewijanie i odrazu netflix wyswietla mi strone Pardom i tlumaczenie

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

