# Stripe w Lectoro — instrukcja od zera, bardzo dokładnie

Ta instrukcja prowadzi przez konfigurację płatności tak, jakbyśmy składali klocki. Najpierw robimy bezpieczny test na „udawanych pieniądzach”, a dopiero na końcu włączamy prawdziwe płatności.

Instrukcja jest przygotowana dla tego konkretnego projektu:

- projekt Firebase: `extension-eng`,
- region funkcji: `europe-west1`,
- plan `FREE`: bez płatności,
- plan `BASIC`: `7.99 USD` co miesiąc,
- plan `PRO`: `19.99 USD` co miesiąc.

> **Bardzo ważne:** najpierw wykonaj wszystko w środowisku testowym Stripe. Nie wklejaj prawdziwego klucza `sk_live_...`, dopóki test kartą `4242 4242 4242 4242` nie przejdzie od początku do końca.

## 1. Co zostało już zrobione w kodzie

Nie musisz pisać mechanizmu płatności od zera. Projekt ma już:

1. przyciski zakupu planów BASIC i PRO w ustawieniach rozszerzenia;
2. bezpieczną funkcję serwerową tworzącą Stripe Checkout;
3. Stripe Customer Portal do zmiany planu, karty i anulowania abonamentu;
4. webhook, czyli bezpieczne „powiadomienie od Stripe do Firebase”;
5. automatyczne zapisanie planu w Firebase Auth Custom Claims i Firestore;
6. blokadę przed kupieniem dwóch aktywnych abonamentów naraz;
7. stronę potwierdzenia po zakupie lub anulowaniu płatności;
8. testy mapowania identyfikatorów cen Stripe na plany Lectoro.

Najważniejsze pliki:

- `functions/stripe-billing.js` — cały bezpieczny backend Stripe;
- `shared/subscription-service.js` — połączenie rozszerzenia z backendem;
- `popup/settings.js` — przyciski „Wybierz”, „Zmień plan” i „Zarządzaj”;
- `firebase/firestore.rules` — użytkownik nie może sam dopisać sobie płatnego planu;
- `functions/package.json` — oficjalny pakiet Stripe dla Node.js.

## 2. Jak płatność działa — prosty obrazek słowny

1. Użytkownik loguje się w Lectoro.
2. Klika `Wybierz BASIC` albo `Wybierz PRO`.
3. Rozszerzenie wysyła do Firebase tylko nazwę planu i token zalogowanego użytkownika.
4. Firebase sam wybiera właściwy `price_...`. Użytkownik nie może podmienić ceny.
5. Firebase prosi Stripe o bezpieczną stronę Checkout.
6. Użytkownik wpisuje kartę na stronie Stripe. Dane karty nie przechodzą przez Lectoro.
7. Stripe wysyła webhook do Firebase.
8. Firebase sprawdza podpis webhooka i dopiero wtedy ustawia plan BASIC albo PRO.
9. Po ponownym otwarciu rozszerzenia Lectoro odświeża token i pokazuje nowy plan.

Plan FREE nie potrzebuje produktu ani ceny w Stripe. Powrót do FREE odbywa się przez anulowanie płatnej subskrypcji w Customer Portal. Jeżeli anulowanie jest ustawione na koniec okresu, użytkownik zachowuje płatny plan do końca opłaconego miesiąca.

## 3. Czego potrzebujesz

Przygotuj:

- konto Stripe: [dashboard.stripe.com](https://dashboard.stripe.com/),
- dostęp do projektu Firebase `extension-eng`,
- terminal otwarty w głównym katalogu projektu Lectoro,
- zainstalowane Node.js, npm i Firebase CLI,
- konto Google z prawem wdrażania Cloud Functions i używania Secret Manager.

Sprawdź narzędzia w terminalu:

```bash
node --version
npm --version
firebase --version
```

Jeżeli polecenie `firebase` nie istnieje:

```bash
npm install -g firebase-tools
```

Potem zaloguj się i wybierz właściwy projekt:

```bash
firebase login
firebase use extension-eng
```

Po drugim poleceniu powinien pojawić się komunikat, że aktywnym projektem jest `extension-eng`.

---

# CZĘŚĆ A — TESTOWE PŁATNOŚCI

## 4. Włącz środowisko testowe Stripe

1. Wejdź na [Stripe Dashboard](https://dashboard.stripe.com/).
2. Zaloguj się.
3. Wybierz środowisko testowe. W zależności od wyglądu panelu może nazywać się `Test mode`, `Test environment` albo `Sandbox`.
4. Sprawdź bardzo uważnie, czy panel pokazuje, że pracujesz na danych testowych.

Stripe trzyma testowe i prawdziwe dane osobno. Testowy produkt, cena, klucz i webhook nie działają w trybie produkcyjnym — i odwrotnie.

## 5. Utwórz produkt i cenę BASIC

Otwórz [Products w trybie testowym](https://dashboard.stripe.com/test/products). Jeżeli link otworzy inny widok, użyj lewego menu: `Product catalog` → `Products`.

1. Kliknij `Add product` albo `+ Add product`.
2. W polu `Name` wpisz dokładnie:

   ```text
   Lectoro BASIC
   ```

3. W polu `Description` możesz wpisać:

   ```text
   Miesięczny plan BASIC rozszerzenia Lectoro
   ```

4. W sekcji ceny wybierz cenę cykliczną: `Recurring`.
5. Model ceny wybierz zwykły/stały: `Flat rate` albo `Standard pricing`.
6. W polu kwoty wpisz:

   ```text
   7.99
   ```

7. Waluta: `USD`.
8. Okres rozliczeniowy: `Monthly` albo `Every month`.
9. Jeżeli pojawi się `Tax behavior`, wybierz jedną wartość, na przykład `Exclusive`. Zapamiętaj ją. Dla PRO musi być **identyczna**, inaczej Customer Portal może nie pozwolić zmienić planu.
10. Nie włączaj liczenia ilości użytkowników/seats. Ilość ma zawsze wynosić `1`.
11. Kliknij `Save product`.
12. Otwórz zapisany produkt. Przy jego miesięcznej cenie znajdź identyfikator zaczynający się od `price_`.
13. Kliknij `Copy price ID` i zapisz go tymczasowo w bezpiecznym miejscu. Nazwij go sobie `STRIPE_BASIC_PRICE_ID `.

Przykład kształtu identyfikatora — **nie kopiuj tego przykładu**:

```text
price_1U45
```

## 6. Utwórz produkt i cenę PRO

Ponownie kliknij `Add product`.

Wypełnij pola tak:

| Pole w Stripe | Wartość |
|---|---|
| `Name` | `Lectoro PRO` |
| `Description` | `Miesięczny plan PRO rozszerzenia Lectoro` |
| Typ ceny | `Recurring` |
| Model | `Flat rate` / `Standard pricing` |
| Kwota | `19.99` |
| Waluta | `USD` |
| Okres | `Monthly` / co miesiąc |
| `Tax behavior` | dokładnie takie samo jak w BASIC |
| Ilość | zawsze `1`, bez seats |

Zapisz produkt, skopiuj jego `price_...` i nazwij go sobie `STRIPE_PRO_PRICE_ID`.

Masz teraz dwa różne identyfikatory:

```text
STRIPE_BASIC_PRICE_ID = price_ta
STRIPE_PRO_PRICE_ID   = price_1U4
```

Nie zamieniaj ich miejscami. Kod przyznaje plan na podstawie tych identyfikatorów, a nie nazwy produktu widocznej na ekranie.

## 7. Skopiuj testowy tajny klucz API

1. Otwórz [Stripe API keys — test](https://dashboard.stripe.com/test/apikeys).
2. Znajdź `Secret key`.
3. Kliknij `Reveal test key`.
4. Skopiuj wartość zaczynającą się od:

   ```text
   sk_test_
   ```

To będzie `STRIPE_SECRET_KEY`.

Klucza `Publishable key` zaczynającego się od `pk_test_` **nie potrzebujesz**. Ten projekt używa hostowanego Stripe Checkout, a sesję tworzy backend. Nigdy nie wklejaj `sk_test_...` lub `sk_live_...` do JavaScriptu rozszerzenia, HTML, GitHuba ani wiadomości.

## 8. Utwórz webhook w Stripe

Webhook to dzwonek: Stripe dzwoni do Firebase i mówi „ta płatność naprawdę się udała” albo „abonament został anulowany”. Bez webhooka pieniądze mogą zostać pobrane, ale plan nie zmieni się w Lectoro.

1. Otwórz `Workbench` → `Webhooks`. Pomocny jest też bezpośredni link: [Stripe Workbench — Webhooks](https://dashboard.stripe.com/test/workbench/webhooks).
2. Kliknij `Create new destination`.
3. Jako wersję API zdarzeń wybierz widoczną na tym ekranie `2025-03-31.basil`.
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.paid
invoice.payment_failed
Kod odczytuje okres rozliczeniowy z elementów subskrypcji, zgodnie z formatem tej wersji.
4. W sekcji `Event destination scope` wybierz `Your account`. Nie wybieraj `Connected accounts` — ta opcja jest potrzebna platformom Stripe Connect obsługującym płatności na cudzych połączonych kontach, a Lectoro przyjmuje płatności na własne konto Stripe.
5. Zaznacz dokładnie te zdarzenia:

   ```text
   checkout.session.completed
   customer.subscription.created
   customer.subscription.updated
   customer.subscription.deleted
   invoice.paid
   invoice.payment_failed
   ```

6. Kliknij `Continue`.
7. Jako typ miejsca docelowego wybierz `Webhook`.
8. W polu `Endpoint URL` wklej dokładnie:

   ```text
   https://europe-west1-extension-eng.cloudfunctions.net/stripeWebhook
   ```

9. W polu `Description` wpisz na przykład:

   ```text
   Lectoro Firebase test webhook
   ```

10. Kliknij `Create destination`.
11. Otwórz utworzony webhook.
12. Znajdź `Signing secret`, kliknij `Reveal` i skopiuj wartość zaczynającą się od:

   ```text
   whsec_50f
   ```

To będzie `STRIPE_WEBHOOK_SECRET`. Ten sekret jest inny dla każdego webhooka i inny w środowisku testowym oraz produkcyjnym.

Stripe nie musi zobaczyć działającej funkcji w chwili tworzenia wpisu. Za chwilę ją wdrożysz dokładnie pod podany adres.

## 9. Skonfiguruj Customer Portal

Customer Portal to strona Stripe, na której użytkownik może zmienić kartę, przejść między BASIC i PRO albo anulować subskrypcję.

1. Otwórz [Customer Portal — ustawienia testowe](https://dashboard.stripe.com/test/settings/billing/portal). Jeżeli link wygląda inaczej, wejdź przez `Settings` → `Billing` → `Customer portal`.
2. Włącz możliwość aktualizacji `Payment methods`.
3. Włącz `Invoice history`, aby użytkownik mógł zobaczyć rachunki.
4. W sekcji zarządzania subskrypcją włącz `Switch plan` / zmianę planu.
5. Dodaj do dozwolonego katalogu produkty `Lectoro BASIC` i `Lectoro PRO` oraz ich miesięczne ceny.
6. Wyłącz zmianę `Quantity`. Lectoro nie sprzedaje liczby stanowisk.
7. Włącz `Cancel subscription`.
8. Najbezpieczniejsza typowa opcja to anulowanie `At the end of the billing period`. Dzięki temu użytkownik zachowuje opłacony plan do końca miesiąca.
9. Opcjonalnie włącz zbieranie powodu anulowania.
10. W polu domyślnego adresu powrotu możesz wpisać:

    ```text
    https://europe-west1-extension-eng.cloudfunctions.net/stripeCheckoutResult?status=portal
    ```

    Kod i tak podaje ten adres przy tworzeniu każdej sesji portalu.
11. Uzupełnij nazwę firmy, kolor i logo, jeżeli Stripe o nie poprosi.
12. Kliknij `Save`.

Jeżeli zmiana BASIC ↔ PRO nie pojawia się w portalu, najpierw sprawdź, czy oba produkty dodano do katalogu portalu i czy obie ceny mają takie samo `Tax behavior`. Szczegóły ograniczeń portalu opisuje [oficjalna dokumentacja Stripe](https://docs.stripe.com/customer-management/configure-portal).

## 10. Włóż cztery wartości do Firebase Secret Manager

W terminalu przejdź do **głównego katalogu projektu**, czyli tam, gdzie znajduje się `firebase.json`.

Najpierw sprawdź projekt:

```bash
firebase use
```

W wyniku musi być `extension-eng`.

Teraz wykonuj polecenia pojedynczo. Po każdym poleceniu terminal poprosi o wartość. Wklej tylko sam klucz/identyfikator — bez nazwy, bez cudzysłowów i bez spacji na końcu — a potem naciśnij Enter.

### Sekret 1 — tajny klucz Stripe

```bash
firebase functions:secrets:set STRIPE_SECRET_KEY
```

Wklej `sk_test_...` z kroku 7.
STRIPE_BASIC_PRICE_ID = price_1U
STRIPE_PRO_PRICE_ID   = price_1

### Sekret 2 — podpis webhooka

```bash
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
```

Wklej `whsec_5` z kroku 8.

### Sekret 3 — cena BASIC

```bash
firebase functions:secrets:set STRIPE_BASIC_PRICE_ID
```

Wklej `price_...` produktu BASIC z kroku 5.

### Sekret 4 — cena PRO

```bash
firebase functions:secrets:set STRIPE_PRO_PRICE_ID
```

Wklej `price_...` produktu PRO z kroku 6.

Firebase może zapytać, czy usunąć stare wersje sekretu. Przy pierwszym ustawieniu nie ma starej wersji. Przy późniejszej zmianie najpierw wdroż nową wersję funkcji, a dopiero potem można posprzątać nieużywane wersje.

Możesz sprawdzić, czy nazwy istnieją, bez wyświetlania ich tajnej treści:

```bash
firebase functions:secrets:get STRIPE_SECRET_KEY
firebase functions:secrets:get STRIPE_WEBHOOK_SECRET
firebase functions:secrets:get STRIPE_BASIC_PRICE_ID
firebase functions:secrets:get STRIPE_PRO_PRICE_ID
```

## 11. Zainstaluj zależności i uruchom testy

W głównym katalogu projektu wykonaj:

```bash
npm --prefix functions install
npm --prefix functions test
```

Testy powinny zakończyć się bez błędów. Ostrzeżenie o lokalnej wersji Node może się pojawić, jeżeli komputer ma Node 20, ponieważ Cloud Functions w tym projekcie są ustawione na Node 22. Wdrożenie użyje Node 22.

## 12. Wdróż funkcje Stripe i reguły Firestore

Wykonaj:

```bash
firebase deploy --only functions:createStripeCheckoutSession,functions:createStripePortalSession,functions:stripeWebhook,functions:stripeCheckoutResult,firestore:rules
```

Poczekaj na zakończenie. Muszą zostać wdrożone cztery funkcje:

```text
createStripeCheckoutSession
createStripePortalSession
stripeWebhook
stripeCheckoutResult
```

Jeżeli Firebase poprosi o włączenie API, na przykład Cloud Build, Artifact Registry albo Secret Manager, zaakceptuj. Projekt może wymagać aktywnego planu rozliczeniowego Google Cloud `Blaze`, nawet gdy mieści się w darmowych limitach.

Po wdrożeniu otwórz w przeglądarce:

[https://europe-west1-extension-eng.cloudfunctions.net/stripeCheckoutResult?status=portal](https://europe-west1-extension-eng.cloudfunctions.net/stripeCheckoutResult?status=portal)

Powinna pojawić się ciemna strona Lectoro z informacją o zapisaniu ustawień. To prosty test, że publiczny adres działa.

## 13. Przeładuj rozszerzenie

1. Otwórz w Chrome:

   ```text
   chrome://extensions
   ```

2. Włącz `Developer mode`, jeśli nie jest włączony.
3. Znajdź Lectoro.
4. Kliknij ikonę przeładowania `Reload`.
5. Otwórz rozszerzenie.
6. Zaloguj się kontem Google.
7. Wejdź do ustawień i przewiń do `Plany subskrypcyjne`.

## 14. Zrób testowy zakup BASIC

1. Kliknij `Wybierz BASIC`.
2. Powinna otworzyć się nowa karta na domenie Stripe, zwykle `checkout.stripe.com`.
3. Wpisz testowe dane:

| Pole | Wartość testowa |
|---|---|
| Numer karty | `4242 4242 4242 4242` |
| Data ważności | dowolna przyszła, np. `12/34` |
| CVC | dowolne trzy cyfry, np. `123` |
| Imię i nazwisko | dowolne testowe |
| Adres | dowolny poprawny testowy adres |

4. Zatwierdź płatność.
5. Stripe pokaże stronę Lectoro z komunikatem `Płatność zakończona`.
6. Zamknij tę kartę.
7. Zamknij i ponownie otwórz popup rozszerzenia. Aktualizacja webhooka zwykle trwa kilka sekund.
8. Plan BASIC powinien mieć oznaczenie aktywnego planu i przycisk `Zarządzaj`.

Do testów wolno używać tylko danych testowych. Stripe wyraźnie zabrania używania prawdziwych danych karty w trybie testowym; lista kart testowych jest w [oficjalnej instrukcji Stripe](https://docs.stripe.com/testing).

## 15. Sprawdź, czy wszystkie cztery miejsca mówią to samo

### A. Stripe — płatność

W testowym panelu Stripe wejdź do `Payments`. Powinna być udana płatność `7.99 USD`.

### B. Stripe — subskrypcja

Wejdź do `Billing` → `Subscriptions`. Powinna istnieć aktywna subskrypcja `Lectoro BASIC`.

### C. Stripe — webhook

1. Wejdź do `Workbench` → `Webhooks`.
2. Otwórz webhook Lectoro.
3. Otwórz `Event deliveries`.
4. Zdarzenia powinny mieć status `Delivered` i odpowiedź HTTP `200`.

Najważniejsze jest `checkout.session.completed`. Powinny też pojawić się zdarzenia subskrypcji i faktury.

### D. Firebase — użytkownik

Otwórz [Firestore projektu extension-eng](https://console.firebase.google.com/project/extension-eng/firestore/databases/-default-/data).

Wejdź do kolekcji `users`, a potem do dokumentu zalogowanego użytkownika. Powinny pojawić się pola podobne do:

```text
plan: "basic"
subscriptionStatus: "active"
stripeCustomerId: "cus_..."
stripeSubscriptionId: "sub_..."
stripeCancelAtPeriodEnd: false
stripeCurrentPeriodEnd: ...data...
```

Nie edytuj ich ręcznie. Te pola należą do backendu.

Logi webhooka sprawdzisz również poleceniem:

```bash
firebase functions:log --only stripeWebhook
```

## 16. Przetestuj zmianę BASIC → PRO

1. Przy aktywnym BASIC kliknij `Zmień plan` na karcie PRO albo `Zarządzaj` na karcie BASIC.
2. Otworzy się Stripe Customer Portal.
3. Wybierz zmianę abonamentu.
4. Wybierz `Lectoro PRO — 19.99 USD monthly`.
5. Potwierdź.
6. Zamknij portal i po kilku sekundach ponownie otwórz Lectoro.
7. Plan powinien zmienić się na PRO.

Jeżeli portal nie pokazuje PRO, wróć do kroku 9 i dodaj oba produkty do dozwolonego katalogu.

## 17. Przetestuj anulowanie i powrót do FREE

1. Kliknij `Zarządzaj` albo `Przejdź na FREE`.
2. W portalu Stripe wybierz anulowanie subskrypcji.
3. Potwierdź anulowanie.
4. Jeżeli wybrano anulowanie na koniec okresu, subskrypcja nadal ma status `active`, a Lectoro nadal pokazuje płatny plan. To poprawne — miesiąc został opłacony.
5. Dopiero po faktycznym zakończeniu subskrypcji webhook `customer.subscription.deleted` ustawi FREE.

W teście możesz w panelu Stripe anulować subskrypcję natychmiast, aby od razu sprawdzić powrót do FREE.

## 18. Co się dzieje, gdy płatność się nie uda

Webhook `invoice.payment_failed` ponownie sprawdza aktualny stan abonamentu. W tej implementacji tylko status `active` albo `trialing` daje płatny plan. Status `past_due`, `unpaid`, `incomplete`, `paused` albo `canceled` powoduje bezpieczny powrót do FREE. Użytkownik może wejść do Customer Portal, poprawić kartę, a po udanej płatności webhook ponownie nada właściwy plan.

---

# CZĘŚĆ B — PRAWDZIWE PŁATNOŚCI

## 19. Najpierw uzupełnij konto firmowe Stripe

Przed włączeniem prawdziwych płatności Stripe może wymagać:

- danych firmy lub działalności,
- weryfikacji tożsamości,
- rachunku bankowego do wypłat,
- danych publicznych widocznych klientowi,
- adresu pomocy technicznej,
- linku do regulaminu i polityki prywatności.

Wypełnij te dane zgodnie z prawdą. Kod nie konfiguruje podatków, VAT, regulaminu, faktur prawnych ani obowiązków konsumenckich. Przed sprzedażą skonsultuj sposób rozliczeń, VAT i treść regulaminu z księgowym lub prawnikiem właściwym dla kraju firmy i klientów.

## 20. Przełącz Stripe na tryb produkcyjny

W Stripe wyjdź z `Sandbox` / `Test mode` i przejdź do prawdziwego konta. Od tej chwili każdą rzecz tworzysz ponownie, bo dane testowe i produkcyjne są rozdzielone.

## 21. Utwórz produkcyjne produkty BASIC i PRO

Powtórz kroki 5 i 6 w trybie produkcyjnym:

- `Lectoro BASIC`, `7.99 USD`, recurring monthly;
- `Lectoro PRO`, `19.99 USD`, recurring monthly;
- ten sam `Tax behavior` dla obu cen;
- bez ilości/seats.

Skopiuj nowe produkcyjne `price_...`. Mogą wyglądać podobnie do testowych, ale są innymi obiektami.

## 22. Skonfiguruj produkcyjny Customer Portal

Ustawienia portalu są osobne dla testu i produkcji. Powtórz krok 9 w trybie produkcyjnym: dodaj produkcyjne produkty BASIC i PRO, włącz zmianę planu, kartę, historię faktur i anulowanie.

## 23. Utwórz produkcyjny webhook

W produkcyjnym `Workbench` → `Webhooks` utwórz nowy webhook.

Ustaw:

- API: `2025-03-31.basil`,
- `Events on your account`,
- te same sześć zdarzeń,
- URL:

  ```text
  https://europe-west1-extension-eng.cloudfunctions.net/stripeWebhook
  ```

Skopiuj **nowy produkcyjny** `whsec_...`.

## 24. Skopiuj produkcyjny tajny klucz

W produkcyjnych `Developers` / `API keys` odsłoń klucz zaczynający się od:

```text
sk_live_
```

Traktuj go jak hasło do pieniędzy firmy. Nie zapisuj go w repozytorium.

## 25. Nadpisz cztery sekrety wartościami produkcyjnymi

W głównym katalogu projektu wykonaj po kolei:

```bash
firebase functions:secrets:set STRIPE_SECRET_KEY
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
firebase functions:secrets:set STRIPE_BASIC_PRICE_ID
firebase functions:secrets:set STRIPE_PRO_PRICE_ID
```

Tym razem wklej odpowiednio:

1. `sk_live_...`,
2. produkcyjny `whsec_...`,
3. produkcyjny `price_...` BASIC,
4. produkcyjny `price_...` PRO.

Nie wolno mieszać trybów. Na przykład `sk_live_...` nie znajdzie testowego `price_...`.

## 26. Wdróż funkcje ponownie

Sama zmiana sekretu nie przełącza już uruchomionej wersji funkcji. Wdróż nowe rewizje:

```bash
firebase deploy --only functions:createStripeCheckoutSession,functions:createStripePortalSession,functions:stripeWebhook
```

Po wdrożeniu funkcje korzystają z wartości produkcyjnych.

## 27. Ostatnia kontrola przed pierwszym klientem

Sprawdź:

- czy Stripe jest w trybie produkcyjnym;
- czy BASIC kosztuje `7.99 USD / month`;
- czy PRO kosztuje `19.99 USD / month`;
- czy produkcyjny portal zawiera oba plany;
- czy produkcyjny webhook ma sześć zdarzeń i poprawny URL;
- czy wszystkie wdrożenia Firebase zakończyły się sukcesem;
- czy regulamin, polityka prywatności, dane firmy, podatki i e-maile Stripe są skonfigurowane;
- czy przycisk planu otwiera stronę `checkout.stripe.com` z poprawną ceną.

Nie używaj karty `4242...` w trybie produkcyjnym. Jeśli robisz końcowy test live, użyj legalnie własnej prawdziwej metody płatności, a potem anuluj i ewentualnie zwróć płatność z panelu Stripe.

---

# ROZWIĄZYWANIE PROBLEMÓW

## `Nie udało się otworzyć płatności Stripe`

Sprawdź logi:

```bash
firebase functions:log --only createStripeCheckoutSession
```

Najczęstsze powody:

- `STRIPE_SECRET_KEY` nie istnieje albo jest z innego trybu;
- `STRIPE_BASIC_PRICE_ID` / `STRIPE_PRO_PRICE_ID` ma zły identyfikator;
- cena jest jednorazowa zamiast `Recurring monthly`;
- po zmianie sekretu nie wykonano ponownego wdrożenia;
- konto Firebase/Google Cloud nie ma aktywnego rozliczania dla funkcji.

## `No configuration provided` przy otwieraniu portalu

Customer Portal nie został zapisany w aktualnym trybie Stripe. Wróć do kroku 9 dla testu albo kroku 22 dla produkcji i kliknij `Save`.

## Płatność się udała, ale nadal jest FREE

1. Sprawdź `Workbench` → `Webhooks` → `Event deliveries`.
2. Otwórz `checkout.session.completed`.
3. Jeśli odpowiedź nie ma HTTP `200`, otwórz szczegóły błędu.
4. Sprawdź logi:

   ```bash
   firebase functions:log --only stripeWebhook
   ```

5. Upewnij się, że `STRIPE_WEBHOOK_SECRET` pochodzi z dokładnie tego webhooka i tego trybu.
6. Upewnij się, że sekrety cen odpowiadają cenom użytym w zakupionej subskrypcji.
7. W Stripe możesz użyć `Resend` dla nieudanego zdarzenia po naprawie konfiguracji.
8. Zamknij i otwórz rozszerzenie, aby wymusiło świeży token Firebase.

## Webhook pokazuje `Invalid webhook signature`

Do Firebase wpisano niewłaściwy `whsec_...` albo po zmianie nie wdrożono funkcji. Skopiuj `Signing secret` z właściwego Event Destination, wykonaj ponownie:

```bash
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
firebase deploy --only functions:stripeWebhook
```

Kod używa niezmienionego `req.rawBody`, ponieważ Stripe wymaga surowego ciała żądania do weryfikacji podpisu. Opisuje to [oficjalna dokumentacja webhooków Stripe](https://docs.stripe.com/webhooks).

## Portal nie pozwala zmienić BASIC na PRO

Sprawdź kolejno:

1. `Switch plan` jest włączone.
2. Oba produkty i obie miesięczne ceny są dodane do katalogu portalu.
3. Obie ceny są w USD.
4. Obie są miesięczne.
5. Obie mają takie samo `Tax behavior`, które nie jest `Unspecified`.
6. Subskrypcja ma tylko jeden produkt i ilość `1`.

## Stripe nalicza inną cenę niż popup

Cena pokazywana w popupie pochodzi z `functions/subscription-config.js`, a cena pobierana naprawdę pochodzi z obiektu `price_...` w Stripe. Muszą być ręcznie zgodne:

```text
BASIC: popup 7.99 USD  ↔  Stripe BASIC 7.99 USD monthly
PRO:   popup 19.99 USD ↔  Stripe PRO 19.99 USD monthly
```

Jeżeli zmieniasz cenę, w Stripe zwykle tworzysz nowy Price, potem zmieniasz właściwy sekret `STRIPE_*_PRICE_ID`, wdrażasz funkcje i aktualizujesz wartość w `subscription-config.js`. Istniejących cen Stripe nie da się swobodnie zmieniać po utworzeniu.

## Użytkownik ma dwa abonamenty

Nowy kod sprawdza aktywne subskrypcje przed Checkout i kieruje istniejącego abonenta do portalu, więc normalny interfejs nie utworzy drugiej. Jeśli duplikat powstał ręcznie w Stripe, anuluj błędną subskrypcję w panelu Stripe. Webhook wybiera aktywny znany plan, preferując PRO, gdy jedna subskrypcja zawiera rozpoznaną cenę PRO.

---

# Bezpieczeństwo — czego nigdy nie robić

1. Nie umieszczaj `sk_test_...`, `sk_live_...` ani `whsec_...` w repozytorium.
2. Nie wysyłaj tajnego klucza do rozszerzenia.
3. Nie przyznawaj planu tylko dlatego, że przeglądarka wyświetliła stronę sukcesu. Plan nadaje wyłącznie podpisany webhook.
4. Nie pozwalaj użytkownikowi przesłać własnego Stripe Price ID. Front wysyła tylko `basic` albo `pro`, a backend wybiera cenę.
5. Nie edytuj ręcznie pól `plan` i `stripe...` w dokumentach użytkownika, chyba że świadomie naprawiasz dane administracyjnie.
6. Nie mieszaj obiektów testowych i produkcyjnych.
7. Nie loguj pełnych sekretów ani danych kart.

# Oficjalne materiały

- [Stripe: abonamenty przez Checkout](https://docs.stripe.com/payments/checkout/build-subscriptions)
- [Stripe: webhooki i podpisy](https://docs.stripe.com/webhooks)
- [Stripe: Customer Portal](https://docs.stripe.com/customer-management/integrate-customer-portal)
- [Stripe: produkty i ceny](https://docs.stripe.com/products-prices/manage-prices)
- [Stripe: testowe karty](https://docs.stripe.com/testing)
- [Firebase: sekrety Cloud Functions](https://firebase.google.com/docs/functions/config-env#secret_parameters)
