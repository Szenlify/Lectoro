# Lectoro — Koszty, Metryki i Analiza Marży

> **Data opracowania:** Wrzesień 2026  
> **Status:** Zweryfikowany model kosztów jednostkowych i biznesowych  
> **Podstawa:** Oficjalne cenniki Cloudflare R2, Google Cloud / Firebase, Google Gemini API, ElevenLabs, Stripe oraz pomiary z implementacji Lectoro.

---

## 1. Architektura i Usługi Zewnętrzne

Projekt Lectoro opiera się na 5 filarach infrastruktury chmurowej:
1. **Cloudflare R2** — globalny magazyn obiektowy bez opłat za transfer (Zero Egress Fees) dla słowników haseł (`dictionaries/live/`), nagrań audio TTS (`audio-cache/`) oraz zrzutów ekranu fiszek użytkowników (`user-media/`).
2. **Google Cloud Firestore & Firebase Auth** — baza danych profili użytkowników, synchronizacja słownictwa, transakcyjne blokady limitów i weryfikacja tożsamości JWT.
3. **Google Cloud Functions (2nd Gen)** — bezserwerowe środowisko Node.js 20 (`geminiProxy`, `deleteUserAccount`, `stripeBilling`, `liveTranslation`).
4. **Google Gemini API (Gemini 2.5 Flash Lite)** — generowanie haseł słownikowych, wyjaśnień kontekstowych zdań oraz pytań quizowych.
5. **Stripe Billing & Checkout** — obsługa subskrypcji kartowych, portalu klienta i webhooków płatności.

Dodatkowo opcjonalnie:
- **ElevenLabs API** — zaawansowana synteza mowy AI (z pełnym buforowaniem w R2).
- **Google Cloud Secret Manager** — bezpieczne wstrzykiwanie kluczy API do Cloud Functions w czasie cold startu.

---

## 2. Szczegółowe Zestawienie Stawek i Jednostek Rozliczeniowych

| Usługa | Operacja / Zasób | Jednostka rozliczeniowa | Darmowy pakiet miesięczny (Free Tier) | Stawka jednostkowa ponad pakiet | Źródło danych |
|---|---|---|---|---|---|
| **Cloudflare R2** | Storage | GB-miesiąc | 10 GB | $0.015 / GB-miesiąc | Cloudflare Docs (2026) |
| **Cloudflare R2** | Class A (Put, List) | 1 000 000 żądań | 1 000 000 / mies. | $4.50 / 1M ($0.0000045 / op) | Cloudflare Docs (2026) |
| **Cloudflare R2** | Class B (Get, Head) | 1 000 000 żądań | 10 000 000 / mies. | $0.36 / 1M ($0.00000036 / op) | Cloudflare Docs (2026) |
| **Cloudflare R2** | Egress (Transfer) | GB | Nielimitowany ($0.00) | **$0.00 / GB** | Cloudflare Zero Egress |
| **Firestore** | Reads | 100 000 operacji | 50 000 / dzień (1.5M / mies.) | $0.06 / 100k ($0.0000006 / op) | Firebase Pricing (2026) |
| **Firestore** | Writes | 100 000 operacji | 20 000 / dzień (600k / mies.) | $0.18 / 100k ($0.0000018 / op) | Firebase Pricing (2026) |
| **Firestore** | Deletes | 100 000 operacji | 20 000 / dzień (600k / mies.) | $0.02 / 100k ($0.0000002 / op) | Firebase Pricing (2026) |
| **Firestore** | Storage | GB-miesiąc | 1 GB | $0.18 / GB-miesiąc | Firebase Pricing (2026) |
| **Cloud Functions** | Invocations | 1 000 000 wywołań | 2 000 000 / mies. | $0.40 / 1M ($0.0000004 / wyw.) | Google Cloud Run Pricing |
| **Cloud Functions** | Compute (CPU/RAM) | GB-sekundy / GHz-s | 400 000 GB-s, 200 000 GHz-s | ~$0.0000025 / s dla 256MB | Google Cloud Run Pricing |
| **Firebase Auth** | Weryfikacja tożsamości | MAU (aktywni użytkownicy) | 50 000 MAU | $0.0055 / MAU powyżej 50k | Firebase Auth Pricing |
| **Secret Manager** | Dostęp do sekretu | 10 000 operacji | 10 000 / mies. | $0.03 / 10 000 operacji | Secret Manager Pricing |
| **Gemini Flash Lite** | Input tokens | 1 000 000 tokenów | Brak (płatność wg użycia) | $0.075 / 1M ($0.000075 / 1k) | Google AI Studio (2026) |
| **Gemini Flash Lite** | Output tokens | 1 000 000 tokenów | Brak (płatność wg użycia) | $0.300 / 1M ($0.000300 / 1k) | Google AI Studio (2026) |
| **ElevenLabs** | TTS Voice generation | 1 000 znaków | 10 000 znaków / mies. | $0.18 - $0.24 / 1 000 znaków | ElevenLabs Creator Tier |
| **Stripe** | Prowizja od płatności | 1 transakcja | Brak | EEA: 1.5% + 0.30 EUR / US: 2.9% + $0.30 | Stripe Pricing EU/Global |

---

## 3. Koszt Jednostkowy Kluczowych Przepływów Użytkownika

### 3.1. Podwójne napisy YouTube & Netflix (Dual Subtitles)
- **Mechanizm:** Pobieranie gotowych ścieżek napisów udostępnianych bezpośrednio przez YouTube (ASR / format JSON3) i Netflix (manifest tracks).
- **Połączenia z backendem:** 0 zapytań (rozszerzenie komunikuje się lokalnie w przeglądarce).
- **Koszt chmurowy:** **$0.0000** (nielimitowane dla każdego planu).

### 3.2. Słownik i Hover na słowie (Word Details)
- **Trafienie w cache R2 (80% przypadków):**
  - 1 x Cloud Functions invocation: $0.0000004
  - 1 x R2 Class B read (GetObject): $0.00000036
  - 1 x Firestore write (rezerwacja limitu / idempotencja): $0.0000018
  - Gemini LLM: $0.00 (brak wywołania)
  - **Koszt sumaryczny przy cache hit:** **~$0.0000026** (mniej niż 3 dziesięciotysięczne części centa!).
- **Brak w cache R2 (Fresh Gemini Generation, 20% przypadków):**
  - 1 x Cloud Functions invocation: $0.0000004 + compute ~$0.000005 (czas ~1.2s)
  - 1 x Gemini 2.5 Flash Lite prompt (~160 tokenów wejściowych + ~120 tokenów JSON wyjściowych):
    - Input: 160 * $0.000000075 = $0.000012
    - Output: 120 * $0.00000030 = $0.000036
    - Razem Gemini: $0.000048
  - 1 x R2 Class A write (PutObject): $0.0000045
  - 1 x Firestore transaction write: $0.0000018
  - **Koszt sumaryczny przy fresh generation:** **~$0.0000597** (~0.006 centa).

### 3.3. Wyjaśnienie całego zdania (`Enter` / sentence explanation)
- Wywołanie w locie modelu Gemini (zdania nie są trwale zapisywane w R2):
  - Gemini Flash Lite (~250 tokenów wejścia + ~140 tokenów wyjścia JSON): ~$0.0000608
  - Cloud Functions compute: ~$0.000006
  - Firestore quota write: $0.0000018
  - **Koszt sumaryczny:** **~$0.0000686** (~0.007 centa).

### 3.4. Wygenerowanie Quizu (10 pytań Cloze/Definition)
- Wywołanie Gemini z kontekstem 10 słów:
  - Wejście ~850 tokenów + wyjście ~600 tokenów: ~$0.000244
  - Cloud Functions: ~$0.000015
  - **Koszt sumaryczny:** **~$0.000259** (~0.026 centa).

### 3.5. Zrzut ekranu fiszki (Flashcard Screenshot)
- Średni rozmiar: 80–180 KB (WebP zoptymalizowany pod kątem jakości/rozmiaru).
- Przechowywanie w R2: 1000 zrzutów = ~150 MB = **$0.00225 / miesiąc**.
- Odczyt: Class B = $0.00000036. Transfer: $0.00.

---

## 4. Weryfikacja API i Usług Stripe z `todo.md`

W repozytorium i notatkach roboczych pojawiały się odniesienia do rozszerzeń Firebase Stripe (`ext-firestore-stripe-payments-*`):
- `ext-firestore-stripe-payments-createCheckoutSession`
- `ext-firestore-stripe-payments-createCustomer`
- `ext-firestore-stripe-payments-handleWebhookEvents`
- `ext-firestore-stripe-payments-onCustomerDataDeleted`
- `ext-firestore-stripe-payments-createPortalLink`
- `ext-firestore-stripe-payments-onUserDeleted`

### Ustalenia audytu technicznego:
1. **Brak konieczności instalacji zewnętrznego rozszerzenia Stripe Extension:**  
   Wszystkie niezbędne funkcje subskrypcyjne zostały zaimplementowane jako autorskie, dedykowane i zoptymalizowane Cloud Functions:
   - `createStripeCheckoutSession` (tworzenie sesji płatności z powrotem do rozszerzenia),
   - `createStripePortalSession` (dostęp do Stripe Customer Portal do zarządzania subskrypcją/anulowania),
   - `stripeWebhook` (obsługa zdarzeń `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`),
   - `stripeCheckoutResult` (odpytywanie o stan sesji z poziomu popupu).
2. **Oszczędność:**  
   Brak podwójnego rozliczania webhooków i brak narzutu dodatkowych dokumentów w kolekcjach `customers/{uid}/checkout_sessions`. Bezpośrednie funkcje zużywają standardowy darmowy kontyngent Cloud Functions.

---

## 5. Model Kosztów dla Planów Subskrypcyjnych

Założenia cennika konsumenckiego (przeliczone na EUR/USD):
- **Plan Free:** 0 zł / 0 EUR / $0.00 (limit: 30 operacji AI / miesiąc)
- **Plan Basic:** 29 zł / 6.99 EUR / $7.99 miesięcznie (limit: 500 operacji AI / miesiąc)
- **Plan Pro:** 59 zł / 13.99 EUR / $14.99 miesięcznie (limit: 2 000 operacji AI / miesiąc)

Średni wskaźnik trafienia w cache R2 (Cache Hit Ratio) dla rosnącej bazy haseł: **75% – 85%**.

### 5.1. Scenariusz: Plan Free (Użytkownik bezpłatny)
- **Użycie:** 30 operacji AI miesięcznie (24 R2 hits + 6 fresh Gemini generations).
- Koszt Gemini: 6 * $0.0000597 = $0.000358
- Koszt R2 (Class A + B + storage): $0.000035
- Koszt Firestore (Reads + Writes): $0.000054
- Koszt Functions: Mieszczący się w darmowym pakiecie 2M wywołań.
- **Koszt miesięczny per aktywny użytkownik Free: ~$0.00045 (mniej niż 0.05 centa!).**
- **Wniosek:** 10 000 aktywnych użytkowników darmowych generuje łączne koszty rzędu zaledwie **~$4.50 miesięcznie**, co mieści się z zapasem w darmowych pakietach Firebase/Cloudflare.

### 5.2. Scenariusz: Plan Basic ($7.99 / miesięcznie)

| Typ użytkownika | Liczba operacji AI | Koszt AI (Gemini) | Koszt R2 & Firestore | Prowizja Stripe (EEA 1.5% + 0.30€) | Koszt całkowity | Przychód netto | **Marża zysku (%)** |
|---|---|---|---|---|---|---|---|
| **Lekki (20% limitu)** | 100 operacji | $0.0012 | $0.0003 | $0.45 | **$0.45** | **$7.54** | **94.4%** |
| **Typowy (50% limitu)** | 250 operacji | $0.0030 | $0.0008 | $0.45 | **$0.45** | **$7.54** | **94.4%** |
| **Maksymalny (100% limitu)** | 500 operacji | $0.0060 | $0.0015 | $0.45 | **$0.46** | **$7.53** | **94.2%** |

### 5.3. Scenariusz: Plan Pro ($14.99 / miesięcznie)

| Typ użytkownika | Liczba operacji AI | Koszt AI (Gemini) | Koszt R2 & Firestore | Prowizja Stripe (EEA 1.5% + 0.30€) | Koszt całkowity | Przychód netto | **Marża zysku (%)** |
|---|---|---|---|---|---|---|---|
| **Lekki (25% limitu)** | 500 operacji | $0.0060 | $0.0015 | $0.55 | **$0.56** | **$14.43** | **96.3%** |
| **Typowy (50% limitu)** | 1 000 operacji | $0.0120 | $0.0030 | $0.55 | **$0.57** | **$14.42** | **96.2%** |
| **Maksymalny (100% limitu)** | 2 000 operacji | $0.0240 | $0.0060 | $0.55 | **$0.58** | **$14.41** | **96.1%** |

---

## 6. Próg Rentowności (Break-Even Point)

### Koszty stałe miesięczne projektu:
- Domena internetowa: ~$1.00 / mies. ($12/rok).
- Cloudflare R2 bazowa subskrypcja: $0.00 (pakiet Free Tier do 10 GB).
- Firebase / Google Cloud: $0.00 (pakiet Blaze w ramach darmowych kontyngentów).
- Opcjonalny pakiet ElevenLabs Creator (dla syntezy audio AI): $22.00 / mies.
- **Łączne koszty stałe bazy: ~$23.00 / miesiąc** (lub zaledwie ~$1.00 / mies. bez ElevenLabs przy użyciu natywnego Web Speech API).

### Obliczenie Break-Even:
- Zysk netto z jednego abonenta **Basic**: $7.53
- Zysk netto z jednego abonenta **Pro**: $14.41
- **Próg rentowności przy uwzględnieniu ElevenLabs ($23/mies.):**
  - Wystarczą **4 subskrypcje Basic** (4 * $7.53 = $30.12) lub **2 subskrypcje Pro** (2 * $14.41 = $28.82), aby projekt był w 100% samowystarczalny i zyskowny!
- Każdy kolejny subskrybent generuje ponad **94% czystej marży operacyjnej**.

---

## 7. Wnioski i Zabezpieczenia Finansowe

1. **Ujednolicone rozliczanie odczytów R2:**  
   Wdrożone w `functions/live-translation.js` pobieranie 1 jednostki limitu także przy trafieniu w R2 zabezpiecza przed zjawiskiem nieograniczonego zużywania zasobów backendu przez użytkowników, jednocześnie utrzymując koszty modeli LLM bliskie zeru.
2. **Idempotencja żądań:**  
   Unikalny klucz `idempotencyKey` powstrzymuje utratę limitu i powielanie zapytań przy powtórkach sieciowych i równoległych kartach przeglądarki.
3. **Prywatność mediów:**  
   Zrzuty ekranu fiszek posiadają nagłówek `Cache-Control: private, no-cache, no-transform` oraz są kaskadowo kasowane z R2 i Firestore w procedurze `deleteUserAccount`.
4. **Nielimitowane napisy YouTube/Netflix:**  
   Brak opłat za pobieranie oficjalnych ścieżek platformowych pozwala na promowanie „nieograniczonej nauki z filmów” w materiałach marketingowych Chrome Web Store bez ryzyka finansowego.
