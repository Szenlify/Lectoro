Po dokładnym przeczytaniu 

Google-Web-Store-Policies.md
 oraz wnikliwej analizie całego kodu projektu Lectoro, przygotowałem szczegółowy audyt zgodności.

Architektura techniczna rozszerzenia (Manifest V3, Service Worker, brak niebezpiecznych eval(), brak zdalnego pobierania kodu wykonywalnego) jest bardzo solidna. Istnieje jednak kilka krytycznych punktów blokujących publikację (w tym odniesienia do serwisów pirackich, brak Polityki Prywatności i wymaganych deklaracji prawnych).

Poniżej znajduje się kompletna lista rzeczy do naprawienia, dodania i zmiany, podzielona na kategorie ważności.

🚨 1. Kwestie krytyczne (Ryzyko natychmiastowego odrzucenia lub blokady konta)
A. Całkowite usunięcie nawiązań do serwisów pirackich (LookMovie)
Zasada CWS (Malicious & Prohibited Products / IP Infringement): „Do not encourage, facilitate, or enable the unauthorized access, download, or streaming of copyrighted content or media.”

W projekcie znajduje się dedykowany adapter i liczne odwołania do serwisu pirackiego lookmovie2.to:



adapters/lookmovie-adapter.js


shared/library-items.json
 (hotlinkowane miniatury bezpośrednio z domeny lookmovie2.to)
Wystąpienia w: 

manifest.json
, 

background.js
, 

adapters/player-registry.js
, 

video/subtitle-overlay.js
, 

video/video-hotkeys.js
 oraz 

styles.css
.
Co trzeba zrobić:

Przemianować/przebudować adapter: zmienić nazwę z lookmovie-adapter.js na ogólny adapter odtwarzaczy HTML5/Video.js (np. videojs-adapter.js lub generic-video-adapter.js).
Usunąć sprawdzanie domeny: usunąć dopasowanie /(^|\.)lookmovie/i.test(...) oraz wszelkie nazwy i selektory zawierające ciąg lookmovie.
Oczyścić shared/library-items.json: usunąć linki do lookmovie2.to oraz zastąpić je linkami do w pełni legalnych, otwartych materiałów (np. TED Talks, publiczne kanały edukacyjne YouTube) z bezpiecznymi miniaturami.


🔒 2. Prywatność, ochrona danych i wymóg „Limited Use”
A. Opublikowanie Polityki Prywatności (Privacy Policy)
Zasada CWS (Protecting User Privacy): Każdy produkt przetwarzający dane użytkownika musi posiadać publiczny link do Polityki Prywatności w panelu Chrome Web Store.

Rozszerzenie przetwarza dane osobowe i aktywność:

Adres e-mail, identyfikator użytkownika Google Auth / Firebase.
Zapisane słówka, konteksty zdań, historię i harmonogram powtórek SRS.
Zaznaczony tekst wysyłany do tłumaczeń i AI (Gemini Proxy).
Zrzuty ekranu wideo (uploadowane do Cloudflare R2).
Identyfikatory klienta Stripe przy płatnościach.
Co trzeba dodać:

Publiczny dokument Polityki Prywatności (online): Strona HTML / podstrona domeny rozszerzenia.
Obowiązkowa klauzula Limited Use: Polityka musi dosłownie zawierać zdanie:
"The use of information received from Google APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements."

Deklaracja braku sprzedaży danych: Wskazanie, że dane nie są sprzedawane brokerom danych, nie służą do targetowania reklam ani oceny zdolności kredytowej.
Wyszczególnienie partnerów/usług: Wymienienie Google Firebase, Google Gemini AI, Cloudflare R2, Stripe (oraz ewentualnie ElevenLabs).
Link wewnątrz rozszerzenia: Dodanie klikalnego linku do Polityki Prywatności w stopce 

popup.html
 lub zakładce Ustawienia / Pomoc.
💳 3. Monetyzacja, płatności i Stripe (Accepting Payment From Users)
Zasada CWS (Accepting Payment From Users): „You must clearly identify that you, not Google, are the seller of the products or services.” „Clearly and honestly describe the products or services that you are selling and conspicuously post your terms of sale (including any refund and return policies).”

Rozszerzenie zawiera płatne plany subskrypcyjne (Basic/Pro) zintegrowane ze Stripe Checkout i 3-dniowym okresem próbnym.

Co trzeba dodać w 

popup.html
 i opisie:

Identyfikacja sprzedawcy: Jasny komunikat (np. w sekcji subskrypcji lub stopce): „Sprzedawcą usługi subskrypcyjnej jest [Nazwa Firmy / Imię i Nazwisko], a nie Google.”
Regulamin i zasady zwrotów (Terms of Sale & Refunds): Link do Regulaminu i polityki anulowania subskrypcji.
Przejrzyste warunki okresu próbnego: Informacja, jak zrezygnować przed upływem 3 dni przez Customer Portal bez naliczenia opłat.
Wycena funkcji darmowych vs płatnych: Zapewnienie użytkownika w opisie w Store, co dokładnie jest darmowe (np. podstawowy tłumacz, lokalne słówka), a co wymaga planu PRO (zaawansowane modele AI, lektor neural).


🎯 4. Opis, pojedynczy cel (Single Purpose) i metadane
A. Niespójny i zbyt wąski opis w manifest.json
Stan obecny:
json
"description": "Select any word or sentence, click the translate icon, and get an instant translation. Choose your target language in the popup."
Problem: Opis wspomina jedynie o zaznaczaniu tekstu, całkowicie pomijając napisy do filmów (Netflix/YouTube), powtórki SRS, wymowę TTS oraz wsparcie AI. Google odrzuca rozszerzenia za ukryte/niewymienione w opisie funkcje.
Zmiana: Sformułowanie opisu definiującego jeden spójny cel (np. „Kompleksowy asystent nauki języków: tłumaczenie tekstu na stronach, podwójne napisy do wideo (YouTube, Netflix), fiszki SRS oraz wyjaśnienia AI.”).
B. Ujednolicenie nazwy


manifest.json
: "Lectoro AI - Translation & Reader"


popup.html
: <h1><span>Lectoro - AI Tutor</span></h1>
Rekomendacja: Zsynchronizowanie nazwy w manifeście, oknie popup oraz na grafice promocyjnej.
🔑 5. Uprawnienia i dostęp do domen (Least Privilege)
W 

manifest.json
 zadeklarowane są uprawnienia:

permissions: ["storage", "alarms", "identity", "scripting", "activeTab"]
content_scripts: *://*/* (na wszystkie strony)
host_permissions: 5 domen (Firebase, Cloud Functions, Cloud Run)
Wszystkie te uprawnienia są realnie używane w kodzie, jednak przy publikacji Google zażąda uzasadnienia (Permission Justification).

Gotowe uzasadnienia do wpisania w Developer Dashboard:

Uprawnienie	Uzasadnienie dla Google Reviewer
*://*/* (Content Scripts)	Wymagane do działania dymku tłumaczenia po zaznaczeniu tekstu na dowolnej stronie przeglądanej przez użytkownika oraz nakładki na odtwarzacze wideo.
storage	Przechowywanie ustawień, słownika słówek i historii powtórek w trybie offline-first.
identity	Logowanie jednoklikowe kontem Google w celu synchronizacji bazy słówek z kontem użytkownika w chmurze Firebase.
alarms	Odświeżanie tokenów uwierzytelniających, okresowa synchronizacja w tle oraz przypomnienia o powtórkach SRS.
scripting	Dołączanie modułu napisów do ramek wideo (<iframe>) na żądanie użytkownika.
activeTab	Wykonanie zrzutu ekranu bieżącego kadru wideo jako kontekstu do zapisywanej fiszki po kliknięciu przez użytkownika.

📦 6. Przygotowanie paczki .ZIP i konfiguracja techniczna
Usunięcie "key" z 

manifest.json
 przed pierwszym zgłoszeniem:
Jeśli publikujesz nowe rozszerzenie, usuń pole "key". Chrome Web Store wygeneruje własny klucz i stały Extension ID.
Po opublikowaniu i uzyskaniu ostatecznego Extension ID, zaktualizuj identyfikator URI przekierowania w Google Cloud Console (https://<extension-id>.chromiumapp.org/).
Wykluczenie plików zbędnych z paczki publikacyjnej:
W paczce ZIP dla Web Store nie mogą znaleźć się:
Folder 

functions/
 (kod backendu Cloud Functions i pliki testów *.test.js),
Pliki konfiguracyjne Firebase (

firebase.json
, 

.firebaserc
, 

firestore.rules
),
Pliki Markdown z notatkami (

stripe.md
, 

start.md
, 

todo.md
, 

Google-Web-Store-Policies.md
),
Ukryte pliki systemu (.DS_Store, .git).
📋 7. Wymagania konta i panelu dewelopera Google
Weryfikacja dwuetapowa (2-Step Verification): Wymagana na koncie Google, z którego rejestrowany jest Developer Account.
Materiały graficzne do panelu CWS:
Zrzuty ekranu: min. 1 (optymalnie 4–5) w rozdzielczości 1280x800 px lub 640x400 px (prezentujące realny interfejs: tłumacz, napisy na YouTube/Netflix, widok powtórek).
Mała płytka promocyjna (Promo Tile): 440x280 px.
Ikona główna: 128x128 px (jest w 

icons/icon128.png
).
Kategoria w sklepie: Wybierz Productivity (Produktywność) lub Education (Edukacja).
Podsumowanie kolejnych kroków
Zrefaktorować lookmovie-adapter.js i oczyścić kod/bibliotekę z nazw i linków pirackich.
Zaktualizować opis w manifest.json oraz ujednolicić nazwę.
Utworzyć stronę Polityki Prywatności z klauzulą Limited Use i dodać do niej link w popup.html.
Dodać informację o sprzedawcy i regulaminie w sekcji planów subskrypcyjnych.
Przygotować paczkę ZIP bez plików backendu/notatek i uzupełnić uzasadnienia uprawnień w Developer Dashboard.
