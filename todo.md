[TODO]

1. zdjecia od powtorek do claudflare R2 w webp w malej rozdzielczosci

4. zrob w kazdym jezyku aby był text UI nagłowki wszystkie w zaleznosci jaki zalezny jest język a jako defaul jest angielski [na pozniej jako ostatnie]

5. na netflix jak tlumacze cale zdanie to jak nie ruszam myszka i napisy opadaja wtedy kiedy chowa sie dolny pasek playera to tez tlumaczenie opada a adapter napisow nie opada wiec chcialbym aby tlumaczenie tez nie opadalo

6. jak naciskam jakis przycisk WSAD strzalki to pokazuje sie na dole pasek sterowania netflix, niech go nie pokazuje oraz jak najade kursorem na slowo, hover to film sie nie stopuje, zrob identycznie jak na youtubie neich stopuje sie video po najechaniu

7. dodaj na netflixie ze po kazdym wypowiedzianym zdaniu i opcje 1. moze byc zatrzymany film 2. wstrzymuje sie na 1s/2s/3s z paskiem ladowania na samej gorze od prawej do lewej

8. też na youtubie niech pobiera napisy json i niech bedzie opcja jak na netflixie zeby przewijal do poczatku napisow lub do konca

8. napisy reel niech sie pojawiaja tam gdzie jest najciemniejsze miejsce na filmiku ale zawsze tak aby byly cale widoczne

9. piracka biblioteka

10. w settings w div kredytow jest napis Limit odnawia się co miesiąc. podaj date obok kiedy dokladnie sie odnowi jesli subskrybuje to dokladna data kiedy mi pobiera pienidze oraz kiedy wtedy ma sie pakiet odnawiac, a na koncie free pakiet ma sie nie odnawiać.

15. przy wybiorze glosy probka glosu do oczytu (zapisana w projekcie tak zeby nie generowaly kosztow)

16. popraw prompty AI tak aby byly krotkie, po angielsku, zeby jak najmniej tokenow ai zuzywalo i idealnie dopracowane

1. po Nacisnieciu Enter,S itp niech kazdy klawisz WSAD, E , Enter itp kasuje tooltipa i wznawia video

1. Klawisz "Z" jesli jest plan Basic lub Pro to tlumaczenia ma robic AI tak jak za pomoca Enter poprostu tlumaczenie bez wyjasnienia

1. Uporzadkuj kod aby netflix nie wiedzial skad biore napisy tylko niech je przyjmuje, wyodrebnij logike lookmovie do osobnego pliku, i podziel kod aby kazdy plik bral logike z jednego pliku jesli potrzeba 

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
