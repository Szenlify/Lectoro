# 🛠️ Checklist Przedstartowa: Produkcyjne Wdrożenie Lectoro (Nowe Klucze & Nowa Baza)

Ten dokument to kompletna, precyzyjna instrukcja krok po kroku, która prowadzi przez proces konfiguracji **nowego, czystego środowiska produkcyjnego** (nowy projekt Firebase, nowe bazy danych, produkcyjny Stripe, produkcyjne API AI i ElevenLabs, Cloudflare R2 oraz publikacja w Chrome Web Store).

---

## 🗺️ Spis Treści
1. [Krok 1: Nowy Projekt Firebase & Firestore (Baza Danych)](#krok-1-nowy-projekt-firebase--firestore)
2. [Krok 2: Google Gemini API (Sztuczna Inteligencja)](#krok-2-google-gemini-api)
3. [Krok 3: Cloudflare R2 (Magazyn Audio i Obrazów)](#krok-3-cloudflare-r2)
4. [Krok 4: ElevenLabs API (Synteza Mowy)](#krok-4-elevenlabs-api)
5. [Krok 5: Stripe Live Mode (Prawdziwe Płatności & Webhooki)](#krok-5-stripe-live-mode)
6. [Krok 6: Wdrożenie Sekretów i Cloud Functions do Firebase](#krok-6-wdrożenie-sekretów-i-cloud-functions)
7. [Krok 7: Zmiany w Kodzie Rozszerzenia (Frontend)](#krok-7-zmiany-w-kodzie-rozszerzenia)
8. [Krok 8: Chrome Web Store (Publikacja i Wymogi Google)](#krok-8-chrome-web-store)
9. [Podsumowanie: Szybka Ściągawka Plików do Edycji](#podsumowanie-szybka-ściągawka-plików-do-edycji)

---

## Krok 1: Nowy Projekt Firebase & Firestore

### 1. Utworzenie Projektu
1. Wejdź na [Firebase Console](https://console.firebase.google.com/) i kliknij **Dodaj projekt** (np. `lectoro-prod` lub `letfluent-app`).
2. Wybierz plan **Blaze (Pay as you go)** — jest to wymagane do obsługi zewnętrznych zapytań API (Gemini, ElevenLabs, Stripe) w Cloud Functions. *(Nie martw się: w darmowych limitach Blaze nie zapłacisz nic).*

### 2. Konfiguracja Firestore Database
1. W menu bocznym wybierz **Firestore Database** -> **Utwórz bazę danych**.
2. Wybierz lokalizację: **`europe-west1`** (Frankfurt / Belgia) — ważne, aby była w tym samym regionie co funkcje!
3. Wybierz tryb: **Tryb produkcyjny (Production mode)**.

### 3. Konfiguracja Firebase Authentication
1. W menu bocznym przejdź do **Authentication** -> **Rozpocznij**.
2. W zakładce **Sign-in method** włącz:
   * **Email/Password** (włączony).
   * **Google** (włączony, podaj e-mail wsparcia).
3. W zakładce **Settings** -> **Authorized domains** (Autoryzowane domeny):
   * Dodaj domenę swojej wtyczki (po wygenerowaniu ID z Chrome Store: `chrome-extension://<TWÓJ_EXTENSION_ID>`).

### 4. Pobranie Nowych Danych Konfiguracyjnych
1. W ustawieniach projektu (ikona koła zębatego -> **Ustawienia projektu**) zjedź na dół do sekcji **Twoje aplikacje**.
2. Dodaj aplikację internetową (ikona `</>`), wpisz nazwę `Lectoro Extension`.
3. Skopiuj wygenerowany obiekt `firebaseConfig`.

---

## Krok 2: Google Gemini API

1. Wejdź na [Google AI Studio](https://aistudio.google.com/).
2. Podepnij ten sam projekt Google Cloud / Firebase (`lectoro-prod`) lub utwórz nowy klucz API.
3. Kliknij **Get API key** -> **Create API key**.
4. Skopiuj klucz: `AIzaSy...` (Będzie potrzebny jako `LECTORO_GEMINI_API_KEY`).
5. *(Opcjonalnie)* W Google Cloud Console ustaw budżet i alerty kosztowe (np. $20/mc).

---

## Krok 3: Cloudflare R2 (Audio Cache & Fiszki)

Cloudflare R2 zastępuje drogi Firebase Storage – zapewnia **0 zł za transfer danych**.

1. Zaloguj się na [Cloudflare Dashboard](https://dash.cloudflare.com/) -> przejdź do zakładki **R2**.
2. Kliknij **Create bucket** -> nazwij go np. `lectoro-media-prod`.
3. Wybierz domyślną lokalizację (np. WEMEA / Europa).
4. **Włącz Publiczny Dostęp:**
   * Wejdź w bucket -> zakładka **Settings** -> **Public Access**.
   * Włącz *R2.dev subdomain* (lub podepnij własną domenę np. `media.lectoro.app`).
   * Skopiuj adres URL (np. `https://pub-xxxxxx.r2.dev` lub `https://media.lectoro.app`).
5. **Konfiguracja CORS:**
   * W zakładce **Settings** -> **CORS Policy** wklej:
   ```json
   [
     {
       "AllowedOrigins": ["*"],
       "AllowedMethods": ["GET", "PUT", "DELETE", "HEAD"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag", "Content-Type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
6. **Wygenerowanie Kluczy API R2:**
   * Przejdź do: R2 -> **Manage R2 API Tokens** -> **Create API Token**.
   * Uprawnienia: **Object Read & Write**.
   * Skopiuj:
     * **Access Key ID**
     * **Secret Access Key**
     * **Account ID** (widoczny w prawym pasku bocznym R2).

---

## Krok 4: ElevenLabs API (Głosy Premium)

1. Zaloguj się na [ElevenLabs.io](https://elevenlabs.io/).
2. Przejdź na płatny pakiet (np. *Starter* $5/mc lub *Creator* $22/mc dla produkcji).
3. Kliknij na swój profil w prawym dolnym rogu -> **API Keys** -> Utwórz nowy klucz.
4. Skopiuj klucz: `xi-api-key` (Będzie potrzebny jako `ELEVENLABS_API_KEY`).

---

## Krok 5: Stripe Live Mode (Prawdziwe Płatności)

> ⚠️ **Ważne:** Wszystkie poniższe kroki wykonaj w Stripe po przełączeniu przełącznika na górze z **Test Mode** na **Live Mode**!

### 1. Utworzenie Produktów i Cen w Stripe
W panelu Stripe (**Katalog produktów** -> **+ Dodaj produkt**):
1. **Produkt 1: Lectoro BASIC**
   * Nazwa: `Lectoro BASIC`
   * Cena: `7.99 USD`
   * Rozliczenie: **Cyklicznie (co miesiąc)**
   * Skopiuj wygenerowany identyfikator ceny: `price_1Pxxxxxxxxxxxxxx`
2. **Produkt 2: Lectoro PRO**
   * Nazwa: `Lectoro PRO`
   * Cena: `19.99 USD`
   * Rozliczenie: **Cyklicznie (co miesiąc)**
   * Skopiuj wygenerowany identyfikator ceny: `price_1Pyyyyyyyyyyyyyy`
3. *(Opcjonalnie)* **Plany Roczne:**
   * `Lectoro BASIC Annual` -> `59.99 USD` / rok.
   * `Lectoro PRO Annual` -> `149.99 USD` / rok.

### 2. Konfiguracja Portalu Klienta (Customer Portal)
1. Przejdź do **Ustawienia** -> **Billing** -> **Portal klienta**.
2. Włącz:
   * Pozwól klientom na zmianę planu (dodaj produkty Basic i Pro).
   * Pozwól klientom na anulowanie subskrypcji (ustaw: *Anuluj na koniec okresu rozliczeniowego*).
   * Pozwól na aktualizację metod płatności i pobieranie faktur PDF.
3. Kliknij **Zapisz zmiany**.

### 3. Konfiguracja Webhooka Stripe
1. Przejdź do: **Developers** -> **Webhooks** -> **Dodaj punkt końcowy**.
2. **Adres URL punktu końcowego:**
   ```
   https://europe-west1-<NOWY_FIREBASE_PROJECT_ID>.cloudfunctions.net/stripeWebhook
   ```
3. **Wybierz zdarzenia do nasłuchiwania (Events):**
   * `checkout.session.completed`
   * `customer.subscription.created`
   * `customer.subscription.updated`
   * `customer.subscription.deleted`
   * `invoice.payment_failed`
4. Kliknij **Dodaj punkt końcowy**.
5. W szczegółach utworzonego webhooka kliknij **Podpis tajny (Signing secret)** -> **Odkryj**.
6. Skopiuj klucz: `whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx`.

### 4. Pobranie Produkcyjnego Klucza Tajnego Stripe
1. Przejdź do: **Developers** -> **API keys**.
2. Skopiuj **Secret key** (zaczyna się od `sk_live_...`).

---

## Krok 6: Wdrożenie Sekretów i Cloud Functions do Firebase

Otwórz terminal w folderze projektu `/Users/kondziu/Desktop/Softileo/Lectoro`.

### 1. Przełączenie Projektu Firebase w CLI
```bash
# Zaloguj się jeśli trzeba
firebase login

# Dodaj i ustaw nowy projekt produkcyjny
firebase use --add
# Wybierz swój nowy projekt (np. lectoro-prod) i nadaj mu alias "default" lub "production"
```
Sprawdź plik [.firebaserc](file:///Users/kondziu/Desktop/Softileo/Lectoro/.firebaserc):
```json
{
  "projects": {
    "default": "NOWY-PROJEKT-FIREBASE-ID"
  }
}
```

### 2. Ustawienie Sekretów w Firebase Secret Manager
Wklejaj po kolei poniższe komendy. Terminal poprosi Cię o wklejenie odpowiednich kluczy:

```bash
# 1. Gemini AI
firebase functions:secrets:set LECTORO_GEMINI_API_KEY

# 2. ElevenLabs
firebase functions:secrets:set ELEVENLABS_API_KEY

# 3. Cloudflare R2
firebase functions:secrets:set R2_ACCESS_KEY_ID
firebase functions:secrets:set R2_SECRET_ACCESS_KEY
firebase functions:secrets:set R2_ACCOUNT_ID
firebase functions:secrets:set R2_BUCKET_NAME
firebase functions:secrets:set R2_PUBLIC_URL

# 4. Stripe Live
firebase functions:secrets:set STRIPE_SECRET_KEY
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
```

### 3. Aktualizacja Mapowania Cen Stripe w Kodzie Backendowym
Otwórz plik [functions/stripe-billing.js](file:///Users/kondziu/Desktop/Softileo/Lectoro/functions/stripe-billing.js) i podmień identyfikatory cen na **prawdziwe z Live Mode**:

```javascript
const STRIPE_PLANS = {
    basic: {
        priceId: "price_1P_TWOJ_NOWY_LIVE_BASIC_ID", // np. price_1Nxxxx
        plan: "basic",
        name: "Lectoro BASIC",
    },
    pro: {
        priceId: "price_1P_TWOJ_NOWY_LIVE_PRO_ID",   // np. price_1Nyyyy
        plan: "pro",
        name: "Lectoro PRO",
    },
};
```

### 4. Wdrożenie Backend i Reguł Bazy Danych
```bash
# Wdrażamy funkcje chmurowe i reguły Firestore jednocześnie
firebase deploy --only functions,firestore:rules
```

---

## Krok 7: Zmiany w Kodzie Rozszerzenia (Frontend)

Przed spakowaniem wtyczki do pliku ZIP, zaktualizuj pliki konfiguracyjne:

### 1. Plik `firebase/firebase-config.js`
Podmień cały obiekt na dane z nowej aplikacji Firebase:
```javascript
const firebaseConfig = {
    apiKey: "AIzaSyD_NOWY_KLUCZ_WEB_FIREBASE...",
    authDomain: "NOWY-PROJEKT-ID.firebaseapp.com",
    projectId: "NOWY-PROJEKT-ID",
    storageBucket: "NOWY-PROJEKT-ID.firebasestorage.app",
    messagingSenderId: "123456789012",
    appId: "1:123456789012:web:abcdef123456"
};
```

### 2. Plik `manifest.json`
1. **Pole `host_permissions`:**
   Upewnij się, że zawiera adres Twoich nowych funkcji Firebase:
   ```json
   "host_permissions": [
       "https://identitytoolkit.googleapis.com/*",
       "https://firestore.googleapis.com/*",
       "https://securetoken.googleapis.com/*",
       "https://europe-west1-NOWY-PROJEKT-ID.cloudfunctions.net/*",
       "<all_urls>"
   ]
   ```
2. **Pole `"key"`:**
   * **Przed pierwszą publikacją w Chrome Web Store:** Usuń pole `"key"` z `manifest.json`! Google Chrome Web Store automatycznie wygeneruje unikalny klucz publiczny i nada wtyczce oficjalny `Extension ID`.
   * Po opublikowaniu (lub pobraniu draftu) Google przypisze stały ID.

---

## Krok 8: Chrome Web Store (Publikacja i Wymogi Google)

### 1. Konto Dewelopera Chrome
1. Wejdź na [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/).
2. Zarejestruj konto dewelopera (jednorazowa opłata Google: $5 USD).

### 2. Przygotowanie Paczki ZIP
W głównym folderze projektu utwórz archiwum `.zip` zawierające wszystkie pliki wtyczki **oprócz**:
* folderu `.git/`
* folderu `functions/node_modules/`
* plików `stripe.md`, `marketing.md`, `lectoro.md`, `beforestart.md`, `todo.md`
* plików testowych `*.test.js`

### 3. Wymagane Materiały Graficzne do Sklepu:
* **Ikona:** `128x128 px` PNG.
* **Zrzuty ekranu (Screenshots):** minimum 4 grafiki w formacie `1280x800 px` lub `640x400 px`:
  1. *Odtwarzacz Netflix / YouTube z interaktywnymi napisami.*
  2. *Dymek tłumaczenia zaznaczonego tekstu na stronie WWW.*
  3. *Karty powtórek SRS z krystalicznym audio ElevenLabs.*
  4. *Generator testów i quizów AI.*
* **Kafelki promocyjne (Promotional Tiles):**
  * Mały kafelek: `440x280 px`.
  * Główny banner (Marquee): `1400x560 px`.

### 4. Polityka Prywatności (Privacy Policy) — Wymóg Google:
Google wymaga podania publicznego adresu URL z Polityką Prywatności.
* Utwórz prostą stronę (np. na GitHub Pages, Notion lub darmowym Carrd.co) opisującą:
  * Wtyczka przetwarza adresy e-mail wyłącznie w celu autoryzacji konta (Firebase Auth).
  * Zaznaczany tekst i napisy są wysyłane do API Gemini / ElevenLabs wyłącznie na żądanie użytkownika w celu tłumaczenia/audio.
  * Żadne dane przeglądania nie są sprzedawane podmiotom trzecim.

### 5. Uzasadnienie Uprawnień (Single Purpose Description):
W formularzu zgłoszeniowym Google zapyta o powód użycia uprawnień:
* `storage` & `unlimitedStorage`: *Do lokalnego przechowywania bazy słówek i działania w trybie offline.*
* `identity`: *Do logowania przez konto Google w Firebase.*
* `scripting` & `<all_urls>`: *Do wstrzykiwania nakładki napisów na odtwarzaczach wideo i tłumaczenia zaznaczonego tekstu.*

---

## 📋 Podsumowanie: Szybka Ściągawka Plików do Edycji

| Plik | Co zmieniasz? |
| :--- | :--- |
| [firebase/firebase-config.js](file:///Users/kondziu/Desktop/Softileo/Lectoro/firebase/firebase-config.js) | Nowe klucze z Firebase Console (`apiKey`, `authDomain`, `projectId`, itp.) |
| [.firebaserc](file:///Users/kondziu/Desktop/Softileo/Lectoro/.firebaserc) | Nowe ID projektu Firebase (`default: "lectoro-prod"`) |
| [functions/stripe-billing.js](file:///Users/kondziu/Desktop/Softileo/Lectoro/functions/stripe-billing.js) | Nowe identyfikatory cen `price_...` z Live Mode Stripe |
| [manifest.json](file:///Users/kondziu/Desktop/Softileo/Lectoro/manifest.json) | Nowy adres URL w `host_permissions` i usunięcie deweloperskiego `"key"` |
| **Firebase Secrets** | Komendy `firebase functions:secrets:set` dla wszystkich 9 kluczy API |
