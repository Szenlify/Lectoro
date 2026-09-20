# Polityka prywatności Lectoro AI

**Ostatnia aktualizacja:** 20 września 2026 r.  
**Oficjalna domena:** [lectoroai.com](https://lectoroai.com) (oraz [lectoroai.vercel.app](https://lectoroai.vercel.app))  
**Kontakt:** lectoroai@gmail.com / support@lectoroai.com  

---

## 🛡️ Oświadczenie o zgodności z Chrome Web Store i zasadami ograniczonego użycia (Limited Use)

Rozszerzenie **Lectoro AI** ściśle przestrzega [Zasad Programu dla Deweloperów Chrome Web Store](https://developer.chrome.com/docs/webstore/program_policies/), w tym rygorystycznych wymogów dotyczących **Ograniczonego Użycia (Limited Use Policy)**:

1. **Cel użytkowania:** Dane użytkownika są pozyskiwane i wykorzystywane wyłącznie w celu świadczenia i ulepszania widocznych dla użytkownika funkcji edukacyjnych rozszerzenia (nauka języków, dwujęzyczne napisy na YouTube i Netflix, wyjaśnienia językowe AI, naturalna synteza mowy, powtórki fiszek SRS).
2. **Zakaz transferu danych:** Dane nie są przekazywane podmiotom trzecim, z wyjątkiem sprawdzonych procesorów infrastrukturalnych niezbędnych do świadczenia usługi (Google Cloud / Firebase, Cloudflare R2, Stripe), wymogów prawa lub procedur fuzji/przejęcia.
3. **Zakaz wykorzystywania do reklam:** Dane użytkownika **NIGDY nie są sprzedawane, monetyzowane, udostępniane brokerom danych ani wykorzystywane do celów reklamy spersonalizowanej, retargetingu lub profilowania komercyjnego**.
4. **Zakaz oceny zdolności kredytowej:** Dane użytkownika **NIGDY nie są wykorzystywane do określania zdolności kredytowej ani do celów pożyczkowych**.
5. **Dostęp ludzi do danych:** Pracownicy ani administratorzy Lectoro AI nie czytają prywatnych danych użytkowników, chyba że użytkownik wyrazi na to wyraźną, uprzednią zgodę w celu rozwiązania problemu technicznego, jest to niezbędne dla celów bezpieczeństwa (badanie nadużyć systemowych) lub wymagane przepisami powszechnie obowiązującego prawa.

---

## 1. Wprowadzenie i Administrator Danych

Niniejsza Polityka Prywatności określa zasady gromadzenia, przetwarzania, przechowywania i ochrony danych osobowych przez **Lectoro AI** („Lectoro”, „my”, „nasze”) w ramach korzystania z rozszerzenia przeglądarki Chrome oraz powiązanego serwisu internetowego pod adresem [lectoroai.com](https://lectoroai.com).

Instalując rozszerzenie Lectoro AI lub korzystając z powiązanych usług, akceptujesz zasady opisane w niniejszym dokumencie.

---

## 2. Jakie informacje zbieramy i w jakim celu

Rozszerzenie działa w oparciu o zasadę **minimalizacji danych (Privacy by Design)**. Domyślnie działa w trybie gościa (offline-first), nie wymagając podawania jakichkolwiek danych osobowych.

### A. Dane uwierzytelniające i konto (opcjonalne)
Gdy decydujesz się zalogować przy użyciu konta Google (Firebase Authentication), przetwarzamy:
- Identyfikator użytkownika Google (UID), adres e-mail, imię i nazwisko oraz URL awatara profilu.
- **Cel:** Identyfikacja konta, synchronizacja bazy zapisanych słówek w chmurze między Twoimi urządzeniami oraz weryfikacja statusu subskrypcji.

### B. Dane edukacyjne i fiszki (SRS)
- Zapisane przez Ciebie słowa, tłumaczenia, fragmenty zdań kontekstowych (z filmów lub artykułów), historia powtórek SRS (interwały czasowe, współczynniki pamięciowe) oraz wyniki generowanych quizów AI.
- **Cel:** Realizacja spersonalizowanego algorytmu powtórek (Spaced Repetition System) i budowanie osobistego słownika.
- **Domyślne miejsce zapisu:** Pamięć lokalna Twojej przeglądarki (`chrome.storage.local`). W chmurze (Google Firebase Firestore) dane zapisują się wyłącznie wtedy, gdy użytkownik jest zalogowany.

### C. Zrzuty ekranu kontekstu wideo (`activeTab`)
- W momencie gdy oglądasz wideo (np. na YouTube lub Netflix) i **świadomie klikasz przycisk zapisu zdania lub używasz skrótu klawiszowego**, rozszerzenie może wykonać wykadrowany zrzut ekranu bieżącej klatki wideo.
- **Cel:** Dołączenie kontekstu wizualnego do tworzonej fiszki słownictwa.
- **Zabezpieczenie:** Zrzut ekranu jest tworzony wyłącznie na wyraźne żądanie użytkownika. Nie jest analizowany maszynowo, nie jest przekazywany do trenowania modeli i jest dostępny wyłącznie w Twoim osobistym panelu nauki.

### D. Dane telemetryczne i diagnostyczne
- Wersja rozszerzenia, typ przeglądarki, system operacyjny, zanonimizowane kody błędów technicznych.
- **Cel:** Zapewnienie stabilności, usuwanie usterek technicznych i zapobieganie awariom wtyczki.

---

## 3. Czego kategorycznie NIE zbieramy

- **NIE monitorujemy Twojej ogólnej historii przeglądania** ani nie rejestrujemy odwiedzanych witryn, które nie są związane z aktywnym tłumaczeniem lub odtwarzaniem napisów.
- **NIE przechwytujemy, nie znamy ani nie przechowujemy Twoich haseł ani danych logowania** do serwisów YouTube, Netflix czy innych platform streamingowych.
- **NIE rejestrujemy naciśnięć klawiszy (keylogger)** w formularzach prywatnych, polach haseł, czatach ani formularzach bankowych.
- **NIE przechowujemy pełnych numerów kart płatniczych** — płatności są procesowane w 100% przez certyfikowanego operatora Stripe (PCI-DSS Level 1).

---

## 4. Zewnętrzni dostawcy infrastruktury i przetwarzanie AI

W celu zapewnienia najwyższej jakości edukacyjnej, Lectoro AI korzysta ze sprawdzonych, wiodących na rynku partnerów technologicznych:

1. **Google Cloud & Gemini AI (Vertex AI / Gemini API)**:
   - **Zakres:** Odpowiada za generowanie kontekstowych wyjaśnień gramatycznych, analizę idiomów oraz naturalną syntezę mowy (Gemini 2.5 Flash TTS).
   - **Prywatność i brak trenowania modeli:** Zapytania są przetwarzane za pośrednictwem komercyjnego endpointu API Google Cloud. Zgodnie z warunkami biznesowymi Google Cloud, **Google NIE wykorzystuje zapytań ani treści przesyłanych przez użytkowników Lectoro AI do trenowania publicznych modeli sztucznej inteligencji**.
2. **Cloudflare R2 Storage & CDN**:
   - **Zakres:** Bezpieczny magazyn danych służący do szybkiego dostarczania spakowanych paczek słowników językowych oraz buforowania (cache) zanonimizowanych nagrań audio wymowy pojedynczych słów. Pliki w CDN nie zawierają żadnych danych osobowych użytkownika.
3. **Google Firebase (Google Ireland Limited / Google LLC)**:
   - **Zakres:** Firebase Authentication (bezpieczne logowanie OAuth), Cloud Firestore (szyfrowana baza danych fiszek) oraz Firebase Cloud Functions (architektura bezserwerowa obsługująca zapytania).
4. **Google Translate API**:
   - **Zakres:** Zapewnienie natychmiastowych tłumaczeń maszynowych pojedynczych słów oraz napisów w trybie fallback.
5. **Stripe Payments (Stripe, Inc.)**:
   - **Zakres:** Bezpieczna obsługa płatności, 3-dniowych okresów próbnych (trial) oraz zarządzanie subskrypcjami planów Basic i Pro.

Wszystkie transfery danych do powyższych podmiotów są zabezpieczone nowoczesnym szyfrowaniem **TLS 1.3**.

---

## 5. Przechowywanie danych, bezpieczeństwo i retencja

- **Szyfrowanie:** Wszystkie dane przesyłane pomiędzy rozszerzeniem a naszymi usługami w chmurze są szyfrowane w transmisji (TLS 1.3), a w bazie Firebase Firestore — szyfrowane w spoczynku przy użyciu algorytmu AES-256.
- **Czas przechowywania:** Dane konta i fiszki użytkownika są przechowywane przez okres aktywności konta. W przypadku braku logowania lub rezygnacji, dane są przechowywane do momentu zgłoszenia żądania ich usunięcia.
- **Usunięcie konta:** Użytkownik może w każdej chwili trwale usunąć swoje konto wraz ze wszystkimi powiązanymi fiszkami bezpośrednio z poziomu ustawień rozszerzenia lub wysyłając e-mail na adres `lectoroai@gmail.com`.

---

## 6. Prawa użytkownika (RODO / GDPR oraz CCPA)

Osobom korzystającym z Lectoro AI przysługują pełne prawa wynikające z Ogólnego Rozporządzenia o Ochronie Danych (RODO) oraz California Consumer Privacy Act (CCPA):

- **Prawo dostępu i przenoszenia danych:** Masz prawo w dowolnym momencie wyeksportować wszystkie swoje zapisane słowa i dane nauki do plików w formatach Anki (.apkg/.txt) lub Excel/CSV (.xlsx/.csv).
- **Prawo do sprostowania:** Możesz swobodnie edytować tłumaczenia, notatki i definicje zapisanych słówek bezpośrednio w widoku „Słowa”.
- **Prawo do usunięcia danych („prawo do bycia zapomnianym”):** Masz prawo zażądać całkowitego i bezpowrotnego usunięcia swojego konta oraz powiązanych danych z chmury.
- **Prawo do wycofania zgody:** Możesz w każdej chwili wylogować się z konta i korzystać z wtyczki w trybie lokalnym offline.

---

## 7. Informacje prawne i brak powiązania z podmiotami trzecimi

- **YouTube™** jest zarejestrowanym znakiem towarowym firmy **Google LLC**.
- **Netflix™** jest zarejestrowanym znakiem towarowym firmy **Netflix, Inc.**
- Rozszerzenie Lectoro AI jest niezależnym oprogramowaniem stworzonym w celach edukacyjnych. Nie jest ono powiązane, oficjalnie zatwierdzone, sponsorowane ani stowarzyszone z firmami Google LLC, Netflix, Inc., TED Conferences LLC ani jakimikolwiek ich podmiotami zależnymi.

---

## 8. Kontakt i Inspektor Ochrony Danych

W przypadku jakichkolwiek pytań, wątpliwości lub wniosków dotyczących prywatności, ochrony danych osobowych bądź realizacji przysługujących Ci praw, prosimy o kontakt:

**Zespół Ochrony Prywatności Lectoro AI**  
- **E-mail:** [lectoroai@gmail.com](mailto:lectoroai@gmail.com) / [support@lectoroai.com](mailto:support@lectoroai.com)  
- **Oficjalna witryna:** [https://lectoroai.com](https://lectoroai.com)  
- **Adres serwisu WWW:** [https://lectoroai.vercel.app](https://lectoroai.vercel.app)