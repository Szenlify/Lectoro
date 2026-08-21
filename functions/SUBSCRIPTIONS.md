# Konfiguracja subskrypcji

Pełna konfiguracja płatności Stripe (Checkout, webhook, Customer Portal,
środowisko testowe i produkcyjne) znajduje się w pliku `../stripe.md`.
Poniższa ręczna zmiana planu jest przeznaczona wyłącznie do administracyjnych
testów i napraw — zwykłe płatne plany nadaje webhook Stripe.

Nowy użytkownik może rozpocząć jeden 3-dniowy okres próbny planu BASIC albo
PRO. Stripe Checkout zawsze wymaga podania karty, ustawia dziś należność na
0 i rozpoczyna miesięczne rozliczenie po zakończeniu trialu. Backend sprawdza
historię subskrypcji klienta oraz pola `stripeTrialUsed` i
`stripeHasSubscribed`, aby nie przyznać kolejnego trialu po anulowaniu.

## Sekrety API

Klucz nie jest przechowywany w rozszerzeniu ani w repozytorium. Ustaw go jako
Firebase Functions Secret:

```powershell
firebase functions:secrets:set LECTORO_GEMINI_API_KEY
firebase functions:secrets:set ELEVENLABS_API_KEY
firebase deploy --only functions
```

Nie dodawaj tych samych nazw do `functions/.env`. Zmienna zwykła i sekret o
tej samej nazwie powodują błąd Cloud Run: `Secret environment variable overlaps
non secret environment variable`.

CLI poprosi o wklejenie wartości. Cloud Function otrzymuje sekret tylko podczas
wykonania żądania; klient dostaje wyłącznie wynik audio.

## Ręczna zmiana planu — najprostsza metoda

1. Otwórz Firebase Console → Firestore Database.
2. Utwórz kolekcję `subscriptionPlans` i dokument o ID równym UID użytkownika.
3. Ustaw pole tekstowe `plan` na `free`, `basic` albo `pro`.
4. Funkcja `syncUserPlanClaim` automatycznie zapisze plan w Firebase Auth
   Custom Claims. Użytkownik powinien ponownie otworzyć ustawienia rozszerzenia
   lub zalogować się ponownie.

Zwykły użytkownik nie ma dostępu do kolekcji `subscriptionPlans` — brak reguły
zezwalającej oznacza pełną blokadę. Edycja w Firebase Console działa z
uprawnieniami administratora.

## Opcjonalna zmiana planu skryptem

Uruchom polecenie w zaufanym środowisku z ustawionymi Application Default
Credentials (`GOOGLE_APPLICATION_CREDENTIALS` wskazującym konto serwisowe):

```powershell
npm run plan:set -- FIREBASE_UID basic
```

Dozwolone plany: `free`, `basic`, `pro`. Skrypt ustawia Custom Claim `plan` i
informacyjną kopię pola w `users/{uid}`. Rozszerzenie wymusza odświeżenie tokenu
podczas otwarcia ustawień, więc nowy plan trafi następnie do
`chrome.storage.local`.

## Usunięcie ręcznie nadanego planu

Samo usunięcie `users/{uid}` nie usuwa planu z Firebase Auth Custom Claims.
Żeby wyczyścić dokument sterujący `syncUserPlanClaim`, claim oraz pola
subskrypcji bez usuwania konta i pozostałych danych użytkownika, uruchom:

```powershell
cd functions
npm run plan:remove -- FIREBASE_UID
```

Możesz podać kilka UID-ów lub adresów e-mail:

```powershell
npm run plan:remove -- UID_1 UID_2 osoba@example.com
```

Najpierw można sprawdzić zakres zmian bez zapisu:

```powershell
npm run plan:remove -- --dry-run UID_1 UID_2
```

Opcja `--revoke-sessions` dodatkowo unieważnia tokeny odświeżania i wymaga od
użytkowników ponownego logowania. Bez tej opcji wystarczy ponownie otworzyć
ustawienia rozszerzenia, które wymuszają pobranie nowego tokenu.

Skrypt nie anuluje aktywnej subskrypcji ani nie usuwa klienta w Stripe. Najpierw
anuluj subskrypcję w Stripe; inaczej późniejszy webhook może ponownie nadać plan.
Pola historii `stripeTrialUsed` i `stripeHasSubscribed` pozostają celowo, aby
operacja administracyjna nie przyznawała użytkownikowi kolejnego trialu.

## Aktualne limity produktu

Jedynym źródłem prawdy dla limitów jest `SUBSCRIPTION_LIMITS` w pliku
`subscription-config.js`. Ta sama konfiguracja jest używana przez rozszerzenie
i Firebase Functions.

| Plan | Trial | AI / miesiąc | Zapisane fiszki SRS | ElevenLabs / żądanie | ElevenLabs / miesiąc |
| --- | ---: | ---: | ---: | ---: | ---: |
| FREE | — | 10 | 50 | niedostępne | niedostępne |
| BASIC | 3 dni | 200 | 3 000 | 500 znaków | 20 000 znaków |
| PRO | 3 dni | 1 200 | 10 000 | 1 000 znaków | 120 000 znaków |

`priceMonthly` steruje ceną wyświetlaną w rozszerzeniu. Kwota pobierana od
użytkownika jest przypisana do `STRIPE_BASIC_PRICE_ID` i
`STRIPE_PRO_PRICE_ID`, więc zmianę ceny trzeba również wykonać w Stripe i
zaktualizować odpowiedni sekret Firebase.
