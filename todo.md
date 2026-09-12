1. Jesli mam konto płatne (nie free) zawsze przy czytaniu textu najpierw niech sprawdzi cashe pozniej zapytanie link do R2 jesli 404 bład to wtedy system voice niezaleznie w jakies funkcji czy to powtorki czy to text na internecie wszedzie gdzie uzywa sie TTS. w powtorkach tylko tam moze byc generowany glos elevenlabs i wysylaby do R2 claudflare bazy, jesli glos w bazie danych nie naliczaj znakow

2. Jak sa właczone dwa tryby tryb translate full sentence oraz translate word by word wtedy na netflixie style zaczynaja znikać tych trybów zaraz po wyświetleniu

3. sprawdz jak wyswietlaja sie ANKI po exporcie (zle, ma byc sam konkret bez tlumaczenia AI)

4. sprawdz api jak w cloud firebase to wyglada przed publikacją

5. guzik sync co ile czasu sie samo synchronizuje automatycznie (czy w ogole to robi)
16. Cloud Sync usunac sync wymyslic sposob zeby automatycznie to robilo np po wykryciu zmiany po 3 minutach samo niech sie synchronizuje

6. zgodnosc z CWS

7. Jesli plan płatny przycisk "Z" na video generuje tlumaczenie AI idealne pod nauke a nie zwykłe tłumaczenie

8. sprawdz quizy (TTS czesto zle czyta w złym głosie jak jest mieszane pytanie)

9. usunalem z popup.html ze mozna all words zaznaczyc i wygenerowac quiz usun rowniez funkcje ktora to robiła bo pewnie teraz to martwy kod

10. w trybie s slowo po slowie moge uzywac strzalek w bok zeby wybrac slowo do powtorek tak jak w trybie enter z chmurkami zrob ale jak nic nie nacisne strzalek w bok to jest tak jak jest teraz

11. Uczytelnij caly kod podziel na komponenty niezalezne od siebie zeby bylo mozna latwo rozwijac wtyczke ale zeby niczego nie popsuć.

12. Youtube shorts wlacza sie film ktory byl wczesien ogladany na youtubie a ogladam shortsy

13. Uprościc jak sie tylko da wtyczke

14. przy pierwszym pobraniu wtyczki otworz trial co i jak robic

15. tooltipy dla przycisków z opisem co robią



17. quizy czesto maja problem z wygenerowaniem quizu dopiero po kroryms kliknieciu załapuje // Successfully generated: update local quota
      await recordExportSuccess("quiz");
    } catch (err) {
      console.error("Quiz export error:", err);
      if (!GeminiProxy?.isLimitError?.(err)) {
        alert("Quiz generation error: " + (err.message || err));

        popup.html
Stack Trace
popup/export.js:1059 (anonymous function)




18. usunac calkowicie 15,000 chars/h translate dla free
19. usun calkowicie z projektu 
        "https://translate.googleapis.com/*",
        "https://translate.google.com/*",
    niech zawsze liczy uzycia AI nie wazne czy tekst jest w R2 czy nie
    dla kazdego planu
    
20. Usun przycisk  <div class="setting-group">
                    <label for="voiceSelect">TTS Reader Voice</label>
                    <select id="voiceSelect">
                        <option value="">🔊 Default</option>
                    </select>
                </div>


17. opis wszystkich kosztów i zweryfikowanie marży projektu:

cloudflare, kazde uzycie firebase firebase, 	
createStripePortalSession, 	
stripeWebhook, 	
createStripeCheckoutSession, 	
geminiProxy,	
stripeCheckoutResult
ext-firestore-stripe-payments-createCheckoutSession
ext-firestore-stripe-payments-createCustomer
ext-firestore-stripe-payments-handleWebhookEvents
ext-firestore-stripe-payments-onCustomerDataDeleted
ext-firestore-stripe-payments-createPortalLink
ext-firestore-stripe-payments-onUserDeleted
Cloud Firestore API
Secret Manager API
Token Service API
OAuth
API gemini 2.5 lite
Elevenlabs
łaczec na publicznym linku do R2 cloudflare
Slownik w cloudflare
zdjecia i ilosc isc trzymana w cloudflare
