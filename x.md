# Kompletna Instrukcja Przejścia na Produkcję i Publikacji Lectoro w Chrome Web Store

Niniejszy dokument zawiera zwięzłą, krok-po-kroku instrukcję migracji wszystkich testowych API, bazy danych Firestore, magazynu Cloudflare R2, płatności Stripe Live oraz procedury publikacji wtyczki w Chrome Web Store.

---

## 🗺️ Mapa Plików i Zmiennych do Zmiany w Projekcie

| Komponent | Pliki w repozytorium do aktualizacji | Wartości / Zmienne |
| :--- | :--- | :--- |
| **Firebase / Firestore** | `firebase/firebase-config.js`<br>`.firebaserc`<br>`firebase/.firebaserc` | `apiKey`, `projectId`, `clientId`, `projects.default` |
| **Stripe Live** | `functions/.env`<br>Firebase Secret Manager | `STRIPE_BASIC_PRICE_ID`, `STRIPE_PRO_PRICE_ID`<br>`STRIPE_SECRET_KEY` (`sk_live_...`), `STRIPE_WEBHOOK_SECRET` (`whsec_...`) |
| **Cloudflare R2** | `functions/.env`<br>Firebase Secret Manager<br>`shared/utils.js`<br>`shared/tts-service.js`<br>`manifest.json` | `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`, `R2_ACCESS_KEY_ID`<br>`R2_SECRET_ACCESS_KEY`<br>Domeny w `host_permissions` |
| **AI (Gemini & ElevenLabs)** | Firebase Secret Manager | `LECTORO_GEMINI_API_KEY`, `ELEVENLABS_API_KEY` |
| **Backend URLs** | `functions/stripe-billing.js`<br>`shared/subscription-service.js`<br>`shared/gemini-proxy.js`<br>`manifest.json` | `PUBLIC_FUNCTIONS_URL`, `BILLING_FUNCTIONS_URL`, `PROXY_URL`, `host_permissions` |
| **Google OAuth / CWS** | `firebase/firebase-config.js`<br>`manifest.json` | `clientId`, autoryzowane URI w GCP (`https://<EXTENSION_ID>.chromiumapp.org/`) |

---

## KROK 1: Produkcyjny Firebase i Baza Firestore

1. **Utworzenie projektu produkcyjnego:**
   - Wejdź na [Firebase Console](https://console.firebase.google.com/) i utwórz nowy projekt (np. `lectoro-app` lub `lectoro-prod`).
2. **Włączenie Authentication:**
   - W menu bocznym wybierz **Build → Authentication → Get Started**.
   - W zakładce **Sign-in method** włącz dostawcę **Google** i zapisz.
3. **Włączenie Cloud Firestore:**
   - Wybierz **Build → Firestore Database → Create database**.
   - Wybierz tryb **Production mode** oraz region (zalecany: `europe-west1` / Frankfurt lub `us-central1`).
4. **Pobranie konfiguracji Web App:**
   - W ustawieniach projektu (*Project Settings → General*) kliknij ikonę `</>` (Web App) i zarejestruj aplikację (np. `Lectoro Extension`).
   - Skopiuj `apiKey`, `projectId` oraz identyfikator klienta OAuth.
5. **Aktualizacja plików w projekcie:**
   - W pliku `firebase/firebase-config.js` wklej nowe wartości:
     ```javascript
     const FIREBASE_CONFIG = {
         apiKey: "NOWY_PRODUKCYJNY_API_KEY",
         projectId: "NOWY_PRODUKCYJNY_PROJECT_ID",
         clientId: "PRODUKCYJNY_GOOGLE_CLIENT_ID.apps.googleusercontent.com",
     };
     ```
   - W plikach `.firebaserc` oraz `firebase/.firebaserc` zmień domyślny projekt:
     ```json
     {"projects":{"default":"NOWY_PRODUKCYJNY_PROJECT_ID"}}
     ```

---

## KROK 2: Płatności Stripe LIVE

1. **Przełączenie na tryb Live:**
   - Wejdź na [Stripe Dashboard](https://dashboard.stripe.com/).
   - Upewnij się, że Twoje konto jest aktywowane (KYC / dane firmowe) i wyłącz przełącznik **Test mode** (przejdź do trybu **Live**).
2. **Utworzenie Produktów i Cen:**
   - Wejdź w **Product Catalog → Add Product**:
     - **Produkt 1:** `Lectoro Basic` → Model: Recurring, Cena: `$7.99 USD` miesięcznie. Skopiuj wygenerowany identyfikator ceny (np. `price_1P...`).
     - **Produkt 2:** `Lectoro Pro` → Model: Recurring, Cena: `$19.99 USD` miesięcznie. Skopiuj wygenerowany identyfikator ceny (np. `price_1P...`).
3. **Konfiguracja Stripe Customer Portal:**
   - Wejdź w **Settings → Billing → Customer portal** ([link](https://dashboard.stripe.com/settings/billing/portal)).
   - Dodaj oba produkty (`Lectoro Basic` i `Lectoro Pro`) do katalogu produktów w portalu.
   - Zaznacz opcje: *Allow customers to switch plans*, *Allow customers to cancel subscriptions*, *Allow customers to update payment methods*.
   - W polu **Default return URL** wpisz:
     `https://<REGION>-<PRODUKCYJNY_PROJECT_ID>.cloudfunctions.net/stripeCheckoutResult?status=portal`
   - Kliknij **Save changes**.
4. **Konfiguracja Produkcyjnego Webhooka:**
   - Wejdź w **Developers → Webhooks → Add destination** ([link](https://dashboard.stripe.com/webhooks)).
   - **Endpoint URL:** `https://<REGION>-<PRODUKCYJNY_PROJECT_ID>.cloudfunctions.net/stripeWebhook`
   - **Select events:** Zaznacz następujące zdarzenia:
     - `checkout.session.completed`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `customer.subscription.paused`
     - `customer.subscription.resumed`
     - `invoice.payment_succeeded`
     - `invoice.payment_failed`
   - Kliknij **Add endpoint** i odkryj klucz podpisu (**Signing secret**, format `whsec_...`).
5. **Pobranie Live Secret Key:**
   - Wejdź w **Developers → API keys** i skopiuj **Secret key** (format `sk_live_...`).

---

## KROK 3: Produkcyjny Cloudflare R2 (Audio TTS & Grafiki)

1. **Utworzenie Bucketu R2:**
   - Wejdź do [Cloudflare Dashboard → R2](https://dash.cloudflare.com/) i utwórz bucket (np. `lectoro-media-prod`).
2. **Publiczny Dostęp & Własna Domena:**
   - W ustawieniach bucketu (*Settings → Public access*) włącz **R2.dev subdomain** lub podepnij domenę własną (np. `https://media.lectoro.app`).
   - Skopiuj publiczny URL bazowy (np. `https://pub-xxxx.r2.dev` lub `https://media.lectoro.app`).
3. **Konfiguracja CORS w R2:**
   - W zakładce **Settings → CORS Policy** wklej:
     ```json
     [
       {
         "AllowedOrigins": ["*"],
         "AllowedMethods": ["GET", "HEAD"],
         "AllowedHeaders": ["*"],
         "MaxAgeSeconds": 86400
       }
     ]
     ```
4. **Wygenerowanie R2 API Token:**
   - W menu R2 kliknij **Manage R2 API Tokens → Create API Token**.
   - Uprawnienia: **Admin Read & Write** (Object Read & Write).
   - Skopiuj: `Account ID`, `Access Key ID`, `Secret Access Key`.
5. **Aktualizacja w kodzie rozszerzenia:**
   - Jeśli adres R2 uległ zmianie, zaktualizuj bazowy adres w plikach:
     - `shared/utils.js` (funkcje `resolveImageUrl` oraz `getR2AudioUrl`)
     - `shared/tts-service.js` (funkcja `playCachedAudio`)
     - `manifest.json` (w sekcji `host_permissions` dopisz nowy adres publiczny R2)

---

## KROK 4: Produkcyjne Klucze AI (Gemini & ElevenLabs)

1. **Google Gemini API Key:**
   - Wejdź do [Google AI Studio](https://aistudio.google.com/) lub Google Cloud Vertex AI.
   - Wygeneruj produkcyjny klucz API z podpiętą kartą rozliczeniową (Pay-as-you-go).
2. **ElevenLabs API Key:**
   - Zaloguj się na [ElevenLabs](https://elevenlabs.io/) na płatnym planie (np. Creator lub Pro, aby mieć wystarczający limit znaków).
   - Przejdź do **Profile → API Keys** i wygeneruj produkcyjny klucz `xi-api-key`.

---

## KROK 5: Konfiguracja Środowiska i Wdrożenie Backend (Cloud Functions)

1. **Utworzenie pliku `functions/.env`:**
   W katalogu `functions/` utwórz lub zaktualizuj plik `.env` z wartościami produkcyjnymi (plik ten nie zawiera tajnych kluczy prywatnych, tylko ID):
   ```env
   STRIPE_BASIC_PRICE_ID=price_1PXXXXXXXXXXXXX
   STRIPE_PRO_PRICE_ID=price_1PXXXXXXXXXXXXX

   R2_ACCOUNT_ID=TWOJ_PRODUKCYJNY_R2_ACCOUNT_ID
   R2_BUCKET_NAME=lectoro-media-prod
   R2_PUBLIC_URL=https://media.lectoro.app
   R2_ACCESS_KEY_ID=TWOJ_PRODUKCYJNY_R2_ACCESS_KEY_ID
   ```

2. **Wprowadzenie Tajnych Sekretów do Firebase Secret Manager:**
   W terminalu w głównym katalogu projektu wykonaj (po kolei dla każdego sekretu):
   ```bash
   firebase use NOWY_PRODUKCYJNY_PROJECT_ID

   firebase functions:secrets:set STRIPE_SECRET_KEY
   # Wklej: sk_live_...

   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
   # Wklej: whsec_...

   firebase functions:secrets:set LECTORO_GEMINI_API_KEY
   # Wklej: produkcyjny klucz Gemini

   firebase functions:secrets:set ELEVENLABS_API_KEY
   # Wklej: produkcyjny klucz ElevenLabs

   firebase functions:secrets:set R2_SECRET_ACCESS_KEY
   # Wklej: produkcyjny Secret Access Key z Cloudflare R2
   ```

3. **Deploy Backend i Reguł Bazy:**
   ```bash
   cd functions
   npm install
   firebase deploy --only firestore:rules,functions
   ```

4. **Weryfikacja adresów URL po wdrożeniu:**
   Po zakończeniu wdrożenia Firebase wyświetli publiczne adresy Cloud Functions (np. w regionie `europe-west1`).
   Upewnij się, że adresy w kodzie odpowiadają nowemu projektowi:
   - `functions/stripe-billing.js` → stała `PUBLIC_FUNCTIONS_URL`
   - `shared/subscription-service.js` → stałe `PROXY_URL` i `BILLING_FUNCTIONS_URL`
   - `shared/gemini-proxy.js` → stała `PROXY_URL`
   - `manifest.json` → `host_permissions`

---

## KROK 6: Google OAuth & Połączenie Stałego Extension ID

Logowanie Google Sign-In w rozszerzeniu MV3 korzysta z `chrome.identity.launchWebAuthFlow`. Aby autoryzacja działała na produkcji:

1. **Zbudowanie pierwszej paczki produkcyjnej:**
   W głównym katalogu projektu uruchom skrypt budujący:
   ```bash
   node scripts/build-cws-zip.js
   ```
   Skrypt wygeneruje plik `dist/lectoro-cws-v1.0.0.zip` (automatycznie usuwając zbędne pliki deweloperskie i pole `key`).

2. **Wgranie Draftu do Chrome Web Store Developer Dashboard:**
   - Wejdź na [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devcenter).
   - Kliknij **Add new item** i wgraj plik `dist/lectoro-cws-v1.0.0.zip`.
   - Zapisz wersję roboczą (Draft). Google natychmiast przydzieli wtyczce stały **32-literowy Extension ID** (np. `abcdefghijklmnopabcdefghijklmnop`).

3. **Konfiguracja OAuth 2.0 Client ID w Google Cloud Console:**
   - Wejdź na [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials) dla projektu Firebase.
   - Kliknij **Create Credentials → OAuth client ID**:
     - **Typ aplikacji:** `Web application` (lub `Chrome extension`).
     - **Authorized redirect URIs (Autoryzowane identyfikatory URI przekierowania):**
       `https://<32_LITEROWY_EXTENSION_ID>.chromiumapp.org/`
       `https://<32_LITEROWY_EXTENSION_ID>.chromiumapp.org`
   - Skopiuj wygenerowany **Client ID** i wklej go do `firebase/firebase-config.js` w polu `clientId`.
   - W panelu CWS w zakładce **Package** możesz także skopiować klucz publiczny (**Public Key**) i wkleić go do pola `"key"` w lokalnym `manifest.json` (do lokalnych testów bez zmiany ID).

---

## KROK 7: Wymogi Publikacji w Chrome Web Store (Checklista)

### 1. Wymagane Strony Prawne (Musi działać online przed zgłoszeniem!)
- **Polityka Prywatności:** `https://lectoro.app/privacy`
  - **Obowiązkowa klauzula (Google Limited Use):**
    > *"Lectoro's use and transfer of information received from Google APIs to any other app will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements."*
  - Wyszczególnienie zbieranych danych: adres e-mail konta Google (uwierzytelnianie), zapisane słówka/fiszki (postępy SRS), dane subskrypcji Stripe.
  - Oświadczenie o braku sprzedaży danych i braku śledzenia historii przeglądania.
- **Regulamin Serwisu (Terms of Service):** `https://lectoro.app/terms`

### 2. Formularz Privacy Practices w panelu CWS (Gotowe uzasadnienia po angielsku)

| Uprawnienie | Permission Justification (do wklejenia w panelu) |
| :--- | :--- |
| **Single Purpose** | `Lectoro is an AI-powered language learning assistant that provides instant text translation on web pages, bilingual video subtitles for YouTube and Netflix, spaced repetition (SRS) flashcards, and interactive AI explanations.` |
| **Host permissions** | `Required to display translation tooltips when text is highlighted on web pages, render dual subtitle overlays on HTML5 video players, and securely communicate with our backend proxy for AI explanations, cloud sync, and audio synthesis.` |
| **storage** | `Used to persist user settings (target language, speech rate), vocabulary flashcards, SRS review schedules, and offline sync queues locally on the user's device.` |
| **identity** | `Used for secure Google Sign-In authentication via Firebase to synchronize the user's saved vocabulary and flashcards across multiple devices.` |
| **alarms** | `Used for periodic background synchronization of learning data, token refresh, and scheduling notifications for due spaced repetition reviews.` |
| **scripting** | `Used to dynamically inject subtitle overlay components into embedded video frames (iframes) when the user interacts with video content.` |
| **activeTab** | `Used exclusively to capture a screenshot of the current video frame as a visual memory aid when the user saves a new flashcard.` |

### 3. Wymagane Grafiki do Panelu Dewelopera
- **Ikona główna:** `128 x 128 px` (znajduje się w `icons/icon128.png`).
- **Small Promo Tile (Mały kafelek promocyjny):** `440 x 280 px` (PNG/JPEG) – obowiązkowy.
- **Zrzuty ekranu (Screenshots):** `1280 x 800 px` (min. 1 zrzut, zalecane 4–5 prezentujące: napisy na wideo, dymek tłumaczenia na stronie www, widok powtórek SRS, widok quizu).
- **Marquee Promo Tile:** `1400 x 560 px` (opcjonalny, do wyróżnienia wtyczki na stronie głównej CWS).

---

## 🚀 Szybka Ściąga / Procedura Wdrożenia (Runbook)

```bash
# 1. Zaloguj się do produkcyjnego Firebase
firebase login
firebase use <PROD_PROJECT_ID>

# 2. Ustaw sekrety produkcyjne
firebase functions:secrets:set STRIPE_SECRET_KEY
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
firebase functions:secrets:set LECTORO_GEMINI_API_KEY
firebase functions:secrets:set ELEVENLABS_API_KEY
firebase functions:secrets:set R2_SECRET_ACCESS_KEY

# 3. Zbuduj i wdróż backend
cd functions
npm install
firebase deploy --only firestore:rules,functions

# 4. Wróć do głównego folderu i zbuduj paczkę CWS
cd ..
node scripts/build-cws-zip.js

# 5. Wgraj dist/lectoro-cws-v1.0.0.zip do Chrome Web Store Developer Console!
```
