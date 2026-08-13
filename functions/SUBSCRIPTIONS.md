# Konfiguracja subskrypcji

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
