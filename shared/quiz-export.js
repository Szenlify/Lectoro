/**
 * Lectoro – Quiz Export & Interactive Exam Engine (Lazy Loaded)
 * Generates print-ready PDF school exams and interactive, self-graded quizzes
 * with audio TTS, real-time feedback, Levenshtein matching, and gamified progress.
 *
 * Designed to be dynamically loaded on demand when the user clicks "Generuj quiz".
 */

(function initQuizExport(root) {
    "use strict";

    // ── 0. Language Configuration & i18n Dictionary ────────────────────
    function getLangName(code) {
        if (
            typeof LectoroConstants !== "undefined" &&
            typeof LectoroConstants.getLanguageName === "function"
        ) {
            return LectoroConstants.getLanguageName(code);
        }
        if (
            typeof AIPrompts !== "undefined" &&
            typeof AIPrompts.getLangName === "function"
        ) {
            return AIPrompts.getLangName(code);
        }
        const c = String(code || "").toLowerCase();
        return (
            (typeof LectoroConstants !== "undefined" &&
                LectoroConstants.LANG_NAMES?.[c]) ||
            c.toUpperCase()
        );
    }

    // Polish adjectives & genitives for Polish exam headings
    const QUIZ_LANG_ADJ_PL = {
        en: "angielskiego",
        es: "hiszpańskiego",
        de: "niemieckiego",
        fr: "francuskiego",
        it: "włoskiego",
        pt: "portugalskiego",
        pl: "polskiego",
        ja: "japońskiego",
        ko: "koreańskiego",
        nl: "niderlandzkiego",
        cs: "czeskiego",
    };

    const QUIZ_I18N = {
        pl: {
            examTitlePrefix: "Sprawdzian z języka",
            defaultTitle: "Quiz słownictwa",
            name: "Imię i nazwisko",
            class: "Klasa",
            date: "Data",
            tasks: "zadań",
            questions: "pytań",
            maxPoints: "Maks. liczba punktów",
            score: "Liczba punktów",
            grade: "Ocena",
            answerKey: "Klucz odpowiedzi",
            gradingScale: "Skala ocen",
            pctPoints: "% punktów",
            goodLuck: "Powodzenia!",
            wordsCount: "słówek",
            printBtn: "🖨️ Drukuj / Zapisz jako PDF",
            checkAllBtn: "✅ Sprawdź",
            resetBtn: "🔄 Zacznij od nowa",
            answered: "Odpowiedziano",
            streak: "Seria",
            streakInRow: "z rzędu!",
            yourAnswerPlaceholder: "Twoja odpowiedź… (Enter = sprawdź)",
            hint: "podpowiedź",
            trueLabel: "Prawda",
            falseLabel: "Fałsz",
            selectPlaceholder: "— wybierz —",
            correctLabel: "Poprawna odpowiedź",
            noAnswer: "Brak odpowiedzi",
            similarity: "zgodność",
            passed: "zaliczone",
            result: "Wynik",
            pointsSuffix: "pkt",
            listenLabel: "Odczytaj na głos",
            dontKnow: "Nie pamiętam",
            reviewTitle: "Powtórka błędów",
            reviewInstructions: "Błędne słowa wracają po kilku pytaniach. Odpowiedz poprawnie bez podpowiedzi, aby je utrwalić.",
            masteryTitle: "Pamięć słówek",
            masteryMastered: "Opanowane",
            masteryAlmost: "Prawie znam",
            masteryLearning: "Uczę się",
            masteryWeak: "Do nauki",
            reviewReady: "Czas na powtórkę",
            recallInstructions: "Wpisz słowo lub zwrot z pamięci. Bez odpowiedzi A/B/C/D — liczy się samodzielne przypomnienie.",
            contextRecallInstructions: "Wpisz brakujące słowo lub zwrot z pamięci. Błędne odpowiedzi wrócą później.",
            matchingInstructions: "Dopasuj słowa do znaczeń. To krótka rozgrzewka przed aktywnym przypominaniem.",
            choiceInstructions: "Wybierz właściwe słowo. Ta część ma mniejszą wagę niż samodzielne wpisywanie.",
            praise: [
                "Świetnie! 🎉",
                "Brawo! 👏",
                "Super! ⭐",
                "Rewelacja! 🚀",
                "Tak trzymaj! 💪",
                "Perfekcyjnie! ✨",
                "Ekstra! 🌟",
            ],
            encourage: [
                "Prawie! Spróbuj jeszcze raz 💭",
                "Nie poddawaj się! 🙂",
                "Blisko! Sprawdź jeszcze raz 🔍",
                "Ups! 🤔",
                "Kolejnym razem się uda! 🍀",
            ],
            grades: {
                6: "celujący",
                5: "bardzo dobry",
                4: "dobry",
                3: "dostateczny",
                2: "dopuszczający",
                1: "niedostateczny",
            },
            sectionTitles: {
                multiple_choice: "Wielokrotny wybór",
                recall: "Przypomnij sobie",
                context_recall: "Przypomnij w kontekście",
                matching: "Dopasuj pary",

                true_false: "Prawda czy fałsz",
                correct_form: "Popraw formę słowa",
                odd_one_out: "Który wyraz nie pasuje?",
            },
        },
        en: {
            examTitlePrefix: "Vocabulary Exam",
            defaultTitle: "Vocabulary Quiz",
            name: "Full Name",
            class: "Class / Group",
            date: "Date",
            tasks: "sections",
            questions: "questions",
            maxPoints: "Max Score",
            score: "Final Score",
            grade: "Grade",
            answerKey: "Answer Key",
            gradingScale: "Grading Scale",
            pctPoints: "% Score",
            goodLuck: "Good luck!",
            wordsCount: "words",
            printBtn: "🖨️ Print / Save as PDF",
            checkAllBtn: "✅ Check all answers & see score",
            resetBtn: "🔄 Reset & try again",
            answered: "Answered",
            streak: "Streak",
            streakInRow: "in a row!",
            yourAnswerPlaceholder: "Your answer… (Enter = check)",
            hint: "hint",
            trueLabel: "True",
            falseLabel: "False",
            selectPlaceholder: "— choose —",
            correctLabel: "Correct answer",
            noAnswer: "No answer provided",
            similarity: "similarity",
            passed: "passed",
            result: "Result",
            pointsSuffix: "pts",
            listenLabel: "Listen aloud",
            dontKnow: "I don't remember",
            reviewTitle: "Mistake Review",
            reviewInstructions: "Missed words return after a few questions. Recall them correctly without hints to strengthen memory.",
            masteryTitle: "Vocabulary Memory",
            masteryMastered: "Mastered",
            masteryAlmost: "Almost there",
            masteryLearning: "Learning",
            masteryWeak: "Needs work",
            reviewReady: "Review ready",
            recallInstructions: "Type the word or phrase from memory. No A/B/C/D options — active recall matters most.",
            contextRecallInstructions: "Recall the missing word or phrase from memory. Missed items will return later.",
            matchingInstructions: "Match words to meanings as a short warm-up before active recall.",
            choiceInstructions: "Choose the correct word. This warm-up counts less than producing the answer yourself.",
            praise: [
                "Excellent! 🎉",
                "Great job! 👏",
                "Awesome! ⭐",
                "Brilliant! 🚀",
                "Keep it up! 💪",
                "Flawless! ✨",
                "Spot on! 🌟",
            ],
            encourage: [
                "Almost! Try once more 💭",
                "Keep going! 🙂",
                "Very close! Check spelling 🔍",
                "Oops! 🤔",
                "You'll get it next time! 🍀",
            ],
            grades: {
                6: "Outstanding (A+)",
                5: "Excellent (A)",
                4: "Good (B)",
                3: "Satisfactory (C)",
                2: "Passing (D)",
                1: "Needs Improvement (F)",
            },
            sectionTitles: {
                multiple_choice: "Multiple Choice",
                recall: "Active Recall",
                context_recall: "Recall in Context",
                matching: "Match the Pairs",

                true_false: "True or False",
                correct_form: "Correct Word Form",
                odd_one_out: "Odd One Out",
            },
        },
        es: {
            examTitlePrefix: "Examen de vocabulario",
            defaultTitle: "Cuestionario de vocabulario",
            name: "Nombre y apellido",
            class: "Clase / Grupo",
            date: "Fecha",
            tasks: "secciones",
            questions: "preguntas",
            maxPoints: "Puntaje máx.",
            score: "Puntaje final",
            grade: "Calificación",
            answerKey: "Clave de respuestas",
            gradingScale: "Escala de calificación",
            pctPoints: "% de aciertos",
            goodLuck: "¡Buena suerte!",
            wordsCount: "palabras",
            printBtn: "🖨️ Imprimir / Guardar en PDF",
            checkAllBtn: "✅ Comprobar respuestas",
            resetBtn: "🔄 Reiniciar",
            answered: "Respondidas",
            streak: "Racha",
            streakInRow: "¡seguidas!",
            yourAnswerPlaceholder: "Tu respuesta… (Enter = comprobar)",
            hint: "pista",
            trueLabel: "Verdadero",
            falseLabel: "Falso",
            selectPlaceholder: "— seleccionar —",
            correctLabel: "Respuesta correcta",
            noAnswer: "Sin respuesta",
            similarity: "coincidencia",
            passed: "aprobado",
            result: "Resultado",
            pointsSuffix: "pts",
            listenLabel: "Escuchar pronunciación",
            praise: [
                "¡Excelente! 🎉",
                "¡Muy bien! 👏",
                "¡Genial! ⭐",
                "¡Fantástico! 🚀",
                "¡Sigue así! 💪",
                "¡Perfecto! ✨",
                "¡Maravilloso! 🌟",
            ],
            encourage: [
                "¡Casi! Inténtalo de nuevo 💭",
                "¡No te rindas! 🙂",
                "¡Muy cerca! Revisa la ortografía 🔍",
                "¡Ups! 🤔",
                "¡A la próxima lo logras! 🍀",
            ],
            grades: {
                6: "Sobresaliente",
                5: "Notable",
                4: "Bien",
                3: "Suficiente",
                2: "Insuficiente",
                1: "Muy deficiente",
            },
            sectionTitles: {
                multiple_choice: "Opción múltiple",
                recall: "Recuerdo activo",
                context_recall: "Recuerdo en contexto",
                matching: "Une las parejas",

                true_false: "Verdadero o falso",
                correct_form: "Forma correcta de la palabra",
                odd_one_out: "¿Cuál no encaja?",
            },
        },
        de: {
            examTitlePrefix: "Wortschatzprüfung",
            defaultTitle: "Vokabel-Quiz",
            name: "Name, Vorname",
            class: "Klasse / Gruppe",
            date: "Datum",
            tasks: "Aufgaben",
            questions: "Fragen",
            maxPoints: "Max. Punktzahl",
            score: "Erreichte Punkte",
            grade: "Note",
            answerKey: "Lösungsschlüssel",
            gradingScale: "Notenskala",
            pctPoints: "% Punkte",
            goodLuck: "Viel Erfolg!",
            wordsCount: "Vokabeln",
            printBtn: "🖨️ Drucken / Als PDF speichern",
            checkAllBtn: "✅ Alle prüfen",
            resetBtn: "🔄 Zurücksetzen",
            answered: "Beantwortet",
            streak: "Serie",
            streakInRow: "in Folge!",
            yourAnswerPlaceholder: "Deine Antwort… (Enter = prüfen)",
            hint: "Hinweis",
            trueLabel: "Richtig",
            falseLabel: "Falsch",
            selectPlaceholder: "— wählen —",
            correctLabel: "Richtige Antwort",
            noAnswer: "Keine Antwort",
            similarity: "Übereinstimmung",
            passed: "bestanden",
            result: "Ergebnis",
            pointsSuffix: "Pkt.",
            listenLabel: "Vorlesen",
            praise: [
                "Ausgezeichnet! 🎉",
                "Super gemacht! 👏",
                "Klasse! ⭐",
                "Hervorragend! 🚀",
                "Weiter so! 💪",
                "Perfekt! ✨",
                "Spitze! 🌟",
            ],
            encourage: [
                "Fast! Versuch es noch einmal 💭",
                "Nicht aufgeben! 🙂",
                "Ganz nah dran! 🔍",
                "Hoppla! 🤔",
                "Beim nächsten Mal klappt es! 🍀",
            ],
            grades: {
                6: "Sehr gut (1)",
                5: "Gut (2)",
                4: "Befriedigend (3)",
                3: "Ausreichend (4)",
                2: "Mangelhaft (5)",
                1: "Ungenügend (6)",
            },
            sectionTitles: {
                multiple_choice: "Multiple-Choice",
                recall: "Aktives Erinnern",
                context_recall: "Erinnern im Kontext",
                matching: "Paare zuordnen",

                true_false: "Richtig oder Falsch",
                correct_form: "Richtige Wortform",
                odd_one_out: "Was passt nicht?",
            },
        },
        fr: {
            examTitlePrefix: "Contrôle de vocabulaire",
            defaultTitle: "Quiz de vocabulaire",
            name: "Nom et prénom",
            class: "Classe / Groupe",
            date: "Date",
            tasks: "exercices",
            questions: "questions",
            maxPoints: "Total des points",
            score: "Score obtenu",
            grade: "Note",
            answerKey: "Corrigé",
            gradingScale: "Barème de notation",
            pctPoints: "% de réussite",
            goodLuck: "Bonne chance !",
            wordsCount: "mots",
            printBtn: "🖨️ Imprimer / Enregistrer en PDF",
            checkAllBtn: "✅ Tout vérifier",
            resetBtn: "🔄 Réinitialiser",
            answered: "Répondu",
            streak: "Série",
            streakInRow: "d'affilée !",
            yourAnswerPlaceholder: "Votre réponse… (Entrée = vérifier)",
            hint: "indice",
            trueLabel: "Vrai",
            falseLabel: "Faux",
            selectPlaceholder: "— choisir —",
            correctLabel: "Bonne réponse",
            noAnswer: "Aucune réponse",
            similarity: "similarité",
            passed: "validé",
            result: "Résultat",
            pointsSuffix: "pts",
            listenLabel: "Écouter la prononciation",
            praise: [
                "Excellent ! 🎉",
                "Bravo ! 👏",
                "Super ! ⭐",
                "Remarquable ! 🚀",
                "Continue comme ça ! 💪",
                "Parfait ! ✨",
                "Génial ! 🌟",
            ],
            encourage: [
                "Presque ! Réessaie encore 💭",
                "Ne lâche rien ! 🙂",
                "Tout près ! Vérifie l'orthographe 🔍",
                "Oups ! 🤔",
                "La prochaine fois sera la bonne ! 🍀",
            ],
            grades: {
                6: "Très bien (A+)",
                5: "Bien (A)",
                4: "Assez bien (B)",
                3: "Passable (C)",
                2: "Insuffisant (D)",
                1: "Très insuffisant (F)",
            },
            sectionTitles: {
                multiple_choice: "Choix multiple",
                recall: "Rappel actif",
                context_recall: "Rappel en contexte",
                matching: "Associer les paires",

                true_false: "Vrai ou Faux",
                correct_form: "Forme correcte du mot",
                odd_one_out: "Trouvez l'intrus",
            },
        },
        it: {
            examTitlePrefix: "Verifica di vocabolario",
            defaultTitle: "Quiz di vocabolario",
            name: "Nome e cognome",
            class: "Classe / Gruppo",
            date: "Data",
            tasks: "esercizi",
            questions: "domande",
            maxPoints: "Punti massimi",
            score: "Punteggio finale",
            grade: "Voto",
            answerKey: "Soluzioni",
            gradingScale: "Scala di valutazione",
            pctPoints: "% punteggio",
            goodLuck: "In bocca al lupo!",
            wordsCount: "vocaboli",
            printBtn: "🖨️ Stampa / Salva in PDF",
            checkAllBtn: "✅ Verifica risposte",
            resetBtn: "🔄 Ricomincia",
            answered: "Risposte date",
            streak: "Serie",
            streakInRow: "di fila!",
            yourAnswerPlaceholder: "La tua risposta… (Invio = verifica)",
            hint: "suggerimento",
            trueLabel: "Vero",
            falseLabel: "Falso",
            selectPlaceholder: "— scegli —",
            correctLabel: "Risposta esatta",
            noAnswer: "Nessuna risposta",
            similarity: "somiglianza",
            passed: "superato",
            result: "Risultato",
            pointsSuffix: "pti",
            listenLabel: "Ascolta pronuncia",
            praise: [
                "Ottimo! 🎉",
                "Bravissimo! 👏",
                "Fantastico! ⭐",
                "Eccellente! 🚀",
                "Continua così! 💪",
                "Perfetto! ✨",
                "Splendido! 🌟",
            ],
            encourage: [
                "Quasi! Riprova ancora 💭",
                "Non mollare! 🙂",
                "Molto vicino! Controlla l'ortografia 🔍",
                "Ops! 🤔",
                "La prossima volta andrà bene! 🍀",
            ],
            grades: {
                6: "Ottimo",
                5: "Distinto",
                4: "Buono",
                3: "Discreto",
                2: "Sufficiente",
                1: "Insufficiente",
            },
            sectionTitles: {
                multiple_choice: "Scelta multipla",
                recall: "Richiamo attivo",
                context_recall: "Richiamo nel contesto",
                matching: "Abbina le coppie",

                true_false: "Vero o Falso",
                correct_form: "Forma corretta della parola",
                odd_one_out: "Trova l'intruso",
            },
        },
        pt: {
            examTitlePrefix: "Exame de vocabulário",
            defaultTitle: "Quiz de vocabulário",
            name: "Nome completo",
            class: "Turma / Grupo",
            date: "Data",
            tasks: "seções",
            questions: "questões",
            maxPoints: "Pontuação máx.",
            score: "Pontuação final",
            grade: "Nota",
            answerKey: "Gabarito",
            gradingScale: "Escala de notas",
            pctPoints: "% de acertos",
            goodLuck: "Boa sorte!",
            wordsCount: "palavras",
            printBtn: "🖨️ Imprimir / Salvar em PDF",
            checkAllBtn: "✅ Verificar respostas",
            resetBtn: "🔄 Reiniciar",
            answered: "Respondidas",
            streak: "Sequência",
            streakInRow: "seguidas!",
            yourAnswerPlaceholder: "Sua resposta… (Enter = verificar)",
            hint: "dica",
            trueLabel: "Verdadeiro",
            falseLabel: "Falso",
            selectPlaceholder: "— escolher —",
            correctLabel: "Resposta correta",
            noAnswer: "Sem resposta",
            similarity: "semelhança",
            passed: "aprovado",
            result: "Resultado",
            pointsSuffix: "pts",
            listenLabel: "Ouvir pronúncia",
            praise: [
                "Excelente! 🎉",
                "Muito bem! 👏",
                "Incrível! ⭐",
                "Sensacional! 🚀",
                "Continue assim! 💪",
                "Perfeito! ✨",
                "Fantástico! 🌟",
            ],
            encourage: [
                "Quase! Tente novamente 💭",
                "Não desista! 🙂",
                "Muito perto! Verifique a grafia 🔍",
                "Ops! 🤔",
                "Na próxima você consegue! 🍀",
            ],
            grades: {
                6: "Excelente (A+)",
                5: "Muito Bom (A)",
                4: "Bom (B)",
                3: "Satisfatório (C)",
                2: "Regular (D)",
                1: "Insuficiente (F)",
            },
            sectionTitles: {
                multiple_choice: "Múltipla escolha",
                recall: "Recordação ativa",
                context_recall: "Recordação em contexto",
                matching: "Associe os pares",

                true_false: "Verdadeiro ou Falso",
                correct_form: "Forma correta da palavra",
                odd_one_out: "Qual não pertence?",
            },
        },
        nl: {
            examTitlePrefix: "Woordenschattoets",
            defaultTitle: "Woordenschatquiz",
            name: "Volledige naam",
            class: "Klas / Groep",
            date: "Datum",
            tasks: "onderdelen",
            questions: "vragen",
            maxPoints: "Max. score",
            score: "Eindscore",
            grade: "Cijfer",
            answerKey: "Antwoordsleutel",
            gradingScale: "Beoordelingsschaal",
            pctPoints: "% score",
            goodLuck: "Veel succes!",
            wordsCount: "woorden",
            printBtn: "🖨️ Afdrukken / Opslaan als PDF",
            checkAllBtn: "✅ Alles controleren",
            resetBtn: "🔄 Opnieuw beginnen",
            answered: "Beantwoord",
            streak: "Reeks",
            streakInRow: "op rij!",
            yourAnswerPlaceholder: "Jouw antwoord… (Enter = controleren)",
            hint: "tip",
            trueLabel: "Waar",
            falseLabel: "Niet waar",
            selectPlaceholder: "— kies —",
            correctLabel: "Juiste antwoord",
            noAnswer: "Geen antwoord",
            similarity: "overeenkomst",
            passed: "geslaagd",
            result: "Resultaat",
            pointsSuffix: "ptn",
            listenLabel: "Beluisteren",
            praise: [
                "Uitstekend! 🎉",
                "Goed gedaan! 👏",
                "Super! ⭐",
                "Briljant! 🚀",
                "Ga zo door! 💪",
                "Vlekkeloos! ✨",
                "Geweldig! 🌟",
            ],
            encourage: [
                "Bijna! Probeer nog eens 💭",
                "Niet opgeven! 🙂",
                "Heel dichtbij! 🔍",
                "Oeps! 🤔",
                "Volgende keer lukt het! 🍀",
            ],
            grades: {
                6: "Uitmuntend (10)",
                5: "Zeer goed (9)",
                4: "Goed (8)",
                3: "Voldoende (6-7)",
                2: "Matig (5)",
                1: "Onvoldoende (<5)",
            },
            sectionTitles: {
                multiple_choice: "Meerkeuze",
                recall: "Actief herinneren",
                context_recall: "Herinneren in context",
                matching: "Koppel de paren",

                true_false: "Waar of Niet waar",
                correct_form: "Juiste woordvorm",
                odd_one_out: "Welk woord hoort er niet bij?",
            },
        },
        cs: {
            examTitlePrefix: "Test slovní zásoby",
            defaultTitle: "Kvíz slovní zásoby",
            name: "Jméno a příjmení",
            class: "Třída / Skupina",
            date: "Datum",
            tasks: "úloh",
            questions: "otázek",
            maxPoints: "Max. počet bodů",
            score: "Získané body",
            grade: "Známka",
            answerKey: "Klíč odpovědí",
            gradingScale: "Stupnice hodnocení",
            pctPoints: "% bodů",
            goodLuck: "Hodně štěstí!",
            wordsCount: "slovíček",
            printBtn: "🖨️ Vytisknout / Uložit jako PDF",
            checkAllBtn: "✅ Zkontrolovat vše",
            resetBtn: "🔄 Začít znovu",
            answered: "Zodpovězeno",
            streak: "Série",
            streakInRow: "v řadě!",
            yourAnswerPlaceholder: "Tvoje odpověď… (Enter = zkontrolovat)",
            hint: "nápověda",
            trueLabel: "Pravda",
            falseLabel: "Nepravda",
            selectPlaceholder: "— vyber —",
            correctLabel: "Správná odpověď",
            noAnswer: "Bez odpovědi",
            similarity: "shoda",
            passed: "splněno",
            result: "Výsledek",
            pointsSuffix: "b.",
            listenLabel: "Přečíst nahlas",
            praise: [
                "Skvělé! 🎉",
                "Výborně! 👏",
                "Super! ⭐",
                "Paráda! 🚀",
                "Jen tak dál! 💪",
                "Perfektní! ✨",
                "Úžasné! 🌟",
            ],
            encourage: [
                "Těsně! Zkus to ještě jednou 💭",
                "Nevzdávej to! 🙂",
                "Velmi blízko! 🔍",
                "Jejda! 🤔",
                "Příště to vyjde! 🍀",
            ],
            grades: {
                6: "Výborný (1)",
                5: "Chvalitebný (2)",
                4: "Dobrý (3)",
                3: "Dostatečný (4)",
                2: "Dostatečný (4-)",
                1: "Nedostatečný (5)",
            },
            sectionTitles: {
                multiple_choice: "Výběr z možností",
                recall: "Aktivní vybavení",
                context_recall: "Vybavení v kontextu",
                matching: "Spojte dvojice",

                true_false: "Pravda nebo Nepravda",
                correct_form: "Správný tvar slova",
                odd_one_out: "Které slovo nepatří?",
            },
        },
        ja: {
            examTitlePrefix: "語彙テスト",
            defaultTitle: "単語クイズ",
            name: "氏名",
            class: "クラス",
            date: "日付",
            tasks: "問",
            questions: "問",
            maxPoints: "満点",
            score: "得点",
            grade: "評価",
            answerKey: "解答",
            gradingScale: "評価基準",
            pctPoints: "% 正答率",
            goodLuck: "頑張ってください！",
            wordsCount: "単語",
            printBtn: "🖨️ 印刷 / PDF保存",
            checkAllBtn: "✅ すべての回答を確認",
            resetBtn: "🔄 やり直す",
            answered: "回答済み",
            streak: "連続正解",
            streakInRow: "問連続！",
            yourAnswerPlaceholder: "回答を入力… (Enter = 確認)",
            hint: "ヒント",
            trueLabel: "正しい",
            falseLabel: "誤り",
            selectPlaceholder: "— 選択 —",
            correctLabel: "正解",
            noAnswer: "未回答",
            similarity: "一致度",
            passed: "合格",
            result: "結果",
            pointsSuffix: "点",
            listenLabel: "音声を聞く",
            praise: [
                "素晴らしい！🎉",
                "よくできました！👏",
                "すごい！⭐",
                "完璧です！🚀",
                "その調子！💪",
                "見事！✨",
                "最高！🌟",
            ],
            encourage: [
                "惜しい！もう一度 💭",
                "諦めないで！🙂",
                "あと少し！🔍",
                "次はきっとできる！🍀",
            ],
            grades: {
                6: "秀 (S)",
                5: "優 (A)",
                4: "良 (B)",
                3: "可 (C)",
                2: "認 (D)",
                1: "不可 (F)",
            },
            sectionTitles: {
                multiple_choice: "選択問題",
                recall: "能動的想起",
                context_recall: "文脈で思い出す",
                matching: "マッチング",

                true_false: "正誤判定",
                correct_form: "適切な語形",
                odd_one_out: "仲間外れ探し",
            },
        },
    };

    function getI18n(langCode) {
        const raw = String(langCode || "en")
            .toLowerCase()
            .trim();
        const base = raw.split(/[-_]/)[0];
        const dict = QUIZ_I18N[raw] || QUIZ_I18N[base] || QUIZ_I18N.en;
        const fallback = QUIZ_I18N.en;
        return {
            ...fallback,
            ...dict,
            grades: { ...fallback.grades, ...(dict.grades || {}) },
            sectionTitles: {
                ...fallback.sectionTitles,
                ...(dict.sectionTitles || {}),
            },
            praise:
                dict.praise && dict.praise.length
                    ? dict.praise
                    : fallback.praise,
            encourage:
                dict.encourage && dict.encourage.length
                    ? dict.encourage
                    : fallback.encourage,
        };
    }

    function getExamTitle(srcLang, tgtLang) {
        const defaultLearning =
            (typeof LectoroConstants !== "undefined" &&
                LectoroConstants.DEFAULT_READING_SETTINGS?.learningLang) ||
            "en";
        const defaultTarget =
            (typeof LectoroConstants !== "undefined" &&
                LectoroConstants.DEFAULT_READING_SETTINGS?.targetLang) ||
            "pl";
        const src = (srcLang || defaultLearning).toLowerCase();
        const tgt = (tgtLang || defaultTarget).toLowerCase().split(/[-_]/)[0];
        const srcName = getLangName(src);

        if (tgt === "pl") {
            const adj = QUIZ_LANG_ADJ_PL[src];
            return adj
                ? `Sprawdzian z języka ${adj}`
                : `Sprawdzian ze słownictwa (${srcName})`;
        }
        if (tgt === "es") return `Examen de vocabulario (${srcName})`;
        if (tgt === "de") return `Wortschatzprüfung – ${srcName}`;
        if (tgt === "fr") return `Contrôle de vocabulaire (${srcName})`;
        if (tgt === "it") return `Verifica di vocabolario (${srcName})`;
        if (tgt === "pt") return `Exame de vocabulário (${srcName})`;
        if (tgt === "nl") return `Woordenschattoets (${srcName})`;
        if (tgt === "cs") return `Test slovní zásoby (${srcName})`;
        if (tgt === "ja") return `${srcName} 単語テスト`;
        return `${srcName} Vocabulary Exam`;
    }

    const QUIZ_POINTS_PER_TYPE = {
        matching: 0.5,
        multiple_choice: 1,
        recall: 3,
        context_recall: 3,
        true_false: 0.5,
        correct_form: 2,
        odd_one_out: 0.5,
    };

    function quizSectionQuestionCount(sec) {
        return sec.type === "matching"
            ? (sec.pairs || []).length
            : (sec.questions || []).length;
    }

    function quizSectionPoints(sec) {
        return (
            quizSectionQuestionCount(sec) *
            (QUIZ_POINTS_PER_TYPE[sec.type] ?? 1)
        );
    }

    function quizTotalPoints(quiz) {
        return (quiz.sections || []).reduce(
            (sum, sec) => sum + quizSectionPoints(sec),
            0,
        );
    }

    function quizTotalQuestions(quiz) {
        return (quiz.sections || []).reduce(
            (sum, sec) => sum + quizSectionQuestionCount(sec),
            0,
        );
    }

    function cleanString(str) {
        return typeof str === "string" ? str.trim() : "";
    }

    function makeQuizCardId(word, fallbackLang = "en") {
        const lang = String(word?.srcLang || fallbackLang || "en").toLowerCase();
        const original = cleanString(word?.original).normalize("NFC").toLowerCase();
        const seed = `${lang}|${original}`;
        let hash = 2166136261;
        for (let i = 0; i < seed.length; i++) {
            hash ^= seed.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return `card_${(hash >>> 0).toString(36)}`;
    }

    function pickQuizWords(sorted, count, source, masteryStore = {}) {
        if (source === "random") {
            const excludeCount = Math.min(sorted.length, count);
            let pool = sorted.slice(excludeCount);
            if (pool.length < count) pool = sorted;
            return [...pool].sort(() => Math.random() - 0.5).slice(0, count);
        }
        if (source === "smart") {
            const now = Date.now();
            return [...sorted]
                .map((word, index) => {
                    const rec = masteryStore?.[makeQuizCardId(word)] || {};
                    const score = Math.max(0, Math.min(100, Number(rec.score) || 0));
                    const wrongs = Math.max(0, Number(rec.wrongs) || 0);
                    const nextReview = Number(rec.nextReview) || 0;
                    const overdue = !nextReview || nextReview <= now;
                    return {
                        word,
                        index,
                        priority: 100 - score + (overdue ? 25 : -10) + Math.min(20, wrongs * 2),
                    };
                })
                .sort((a, b) => b.priority - a.priority || a.index - b.index)
                .slice(0, count)
                .map((x) => x.word);
        }
        return sorted.slice(0, count);
    }

    function hasTargetMeaning(word, tgtLang) {
        if (!word?.tgtLang) return true;
        try {
            return AIPrompts.languageCode(word.tgtLang) === tgtLang;
        } catch (_) {
            return false;
        }
    }

    function buildFallbackLearningUnits(wordsPool, tgtLang, defaultLearning) {
        return wordsPool.map((word, index) => {
            const source = cleanString(word.original).slice(0, 300);
            const wordCount = source.split(/\s+/).filter(Boolean).length;
            const meaning = hasTargetMeaning(word, tgtLang)
                ? cleanString(word.translated).slice(0, 300)
                : "";
            const savedContext = cleanString(word.sentence).slice(0, 400);
            return {
                card_id: makeQuizCardId(word, defaultLearning),
                term: source,
                meaning,
                context: savedContext || (wordCount >= 3 ? source : ""),
                source,
                source_index: index,
            };
        });
    }

    function exactSourceSpan(source, candidate) {
        const src = cleanString(source).normalize("NFC").replace(/[’‘]/g, "'");
        const term = cleanString(candidate).normalize("NFC").replace(/[’‘]/g, "'");
        if (!src || !term) return "";
        const idx = src.toLocaleLowerCase().indexOf(term.toLocaleLowerCase());
        return idx >= 0 ? src.slice(idx, idx + term.length) : "";
    }

    async function refineLearningUnitsWithGemini(cards, srcLocale, tgtLocale) {
        if (
            typeof GeminiProxy === "undefined" ||
            typeof AIPrompts?.quizLearningUnits !== "function"
        ) {
            return cards;
        }
        const candidates = cards.filter((card) => {
            const count = card.source.split(/\s+/).filter(Boolean).length;
            return count >= 3 && card.meaning;
        });
        if (!candidates.length) return cards;
        try {
            const prompt = AIPrompts.quizLearningUnits({
                srcLang: srcLocale,
                tgtLang: tgtLocale,
                wordList: candidates.map((card) => ({
                    card_id: card.card_id,
                    source: card.source,
                    saved_meaning: card.meaning,
                    context: card.context,
                })),
            });
            const parsed = await GeminiProxy.requestJSON(prompt, {
                temperature: 0.1,
                maxOutputTokens: Math.min(3200, 400 + candidates.length * 110),
                cache: false,
            });
            if (!Array.isArray(parsed?.cards)) return cards;
            const byId = new Map(parsed.cards.map((item) => [cleanString(item?.card_id), item]));
            return cards.map((card) => {
                const item = byId.get(card.card_id);
                if (!item) return card;
                const exactTerm = exactSourceSpan(card.source, item.term);
                if (!exactTerm) return card;
                return {
                    ...card,
                    term: exactTerm.slice(0, 160),
                    meaning: cleanString(item.meaning).slice(0, 300) || card.meaning,
                    // The saved context is authoritative. AI only chooses the learning unit.
                    context: card.context,
                };
            });
        } catch (error) {
            console.warn("Quiz learning-unit refinement failed; using saved cards.", error);
            return cards;
        }
    }

    function uniqueCards(cards) {
        const seenTerms = new Set();
        const seenMeanings = new Set();
        return cards.filter((card) => {
            const term = cleanString(card.term).toLowerCase();
            const meaning = cleanString(card.meaning).toLowerCase();
            if (!term || !meaning || seenTerms.has(term) || seenMeanings.has(meaning)) return false;
            seenTerms.add(term);
            seenMeanings.add(meaning);
            return true;
        });
    }

    function buildRecallSection(cards, i18n) {
        const questions = cards
            .filter((card) => card.term && card.meaning)
            .map((card) => ({
                card_id: card.card_id,
                prompt: card.meaning,
                answer: card.term,
                acceptable_answers: [],
            }));
        return questions.length
            ? {
                  type: "recall",
                  instructions:
                      i18n.recallInstructions ||
                      "Przypomnij sobie słowo lub zwrot bez podglądania odpowiedzi.",
                  questions,
              }
            : null;
    }

    function buildMatchingSection(cards, i18n) {
        const pool = uniqueCards(cards).slice(0, 6);
        if (pool.length < 2) return null;
        return {
            type: "matching",
            instructions:
                i18n.matchingInstructions ||
                "Dopasuj słowa do ich znaczeń. To tylko rozgrzewka przed aktywnym przypominaniem.",
            pairs: pool.map((card) => ({
                card_id: card.card_id,
                a: card.term,
                b: card.meaning,
            })),
        };
    }

    function buildMultipleChoiceSection(cards, i18n) {
        const pool = uniqueCards(cards);
        if (pool.length < 4) return null;
        const count = Math.min(4, Math.max(2, Math.ceil(pool.length * 0.2)));
        const questions = pool.slice(0, count).map((card, index) => {
            const distractors = [];
            for (let offset = 1; offset < pool.length && distractors.length < 3; offset++) {
                const candidate = pool[(index + offset) % pool.length];
                if (candidate.card_id !== card.card_id) distractors.push(candidate.term);
            }
            const options = [card.term, ...distractors].sort(() => Math.random() - 0.5);
            return {
                card_id: card.card_id,
                question: card.meaning,
                options,
                answer: card.term,
            };
        });
        return questions.length
            ? {
                  type: "multiple_choice",
                  instructions:
                      i18n.choiceInstructions ||
                      "Wybierz właściwe słowo. Ta część jest rozgrzewką i ma mniejszą wagę niż samodzielne wpisywanie.",
                  questions,
              }
            : null;
    }

    function blankSavedContext(card) {
        const context = cleanString(card.context);
        const term = cleanString(card.term);
        if (!context || !term) return "";
        if (context.normalize("NFC").toLocaleLowerCase() === term.normalize("NFC").toLocaleLowerCase()) return "";
        const idx = context.toLocaleLowerCase().indexOf(term.toLocaleLowerCase());
        if (idx < 0) return "";
        return `${context.slice(0, idx)}___${context.slice(idx + term.length)}`;
    }

    function buildFallbackContextQuestions(cards, count, excludedCardIds = new Set()) {
        const questions = [];
        for (const card of cards) {
            if (questions.length >= count) break;
            if (excludedCardIds.has(card.card_id)) continue;
            const question = blankSavedContext(card);
            if (!question) continue;
            questions.push({
                card_id: card.card_id,
                question,
                answer: card.term,
                acceptable_answers: [],
            });
        }
        return questions;
    }

    function mergeSectionQuestions(primary, fallback, maxQuestions = Infinity) {
        const result = [];
        const seen = new Set();
        for (const source of [primary, fallback]) {
            for (const q of source || []) {
                if (result.length >= maxQuestions) break;
                const id = cleanString(q?.card_id) || `${cleanString(q?.answer)}|${cleanString(q?.question || q?.prompt)}`;
                if (!id || seen.has(id)) continue;
                seen.add(id);
                result.push(q);
            }
        }
        return result;
    }

    async function requestAiQuizSections(cards, chosenTypes, srcLocale, tgtLocale, contextCount) {
        if (!chosenTypes.length || typeof GeminiProxy === "undefined") return null;
        const prompt = AIPrompts.quiz({
            srcLang: srcLocale,
            tgtLang: tgtLocale,
            chosenTypes,
            contextCount,
            choiceCount: Math.min(4, Math.max(2, Math.ceil(cards.length * 0.2))),
            wordList: cards.map((card) => ({
                card_id: card.card_id,
                word: card.term,
                meaning: card.meaning,
                ...(card.context ? { context: card.context } : {}),
            })),
        });
        return GeminiProxy.requestJSON(prompt, {
            temperature: 0.25,
            maxOutputTokens: Math.min(5200, 500 + chosenTypes.length * 900),
            cache: false,
        });
    }

    // ── 1. High-retention Quiz Generator ────────────────────────────────
    async function generateQuizWithGemini(words, options = {}) {
        if (!Array.isArray(words) || !words.length)
            throw new Error("Choose vocabulary for the quiz first.");
        const defaultLearning =
            typeof SharedTranslatorService !== "undefined" &&
            typeof SharedTranslatorService.getLearningLang === "function"
                ? await SharedTranslatorService.getLearningLang()
                : (typeof LectoroConstants !== "undefined" &&
                      LectoroConstants.DEFAULT_READING_SETTINGS?.learningLang) ||
                  "en";
        const defaultTarget =
            typeof SharedTranslatorService !== "undefined" &&
            typeof SharedTranslatorService.getTargetLang === "function"
                ? await SharedTranslatorService.getTargetLang()
                : (typeof LectoroConstants !== "undefined" &&
                      LectoroConstants.DEFAULT_READING_SETTINGS?.targetLang) ||
                  "pl";
        const srcLocale = words[0]?.srcLang || defaultLearning;
        const srcLang = AIPrompts.languageCode(srcLocale);
        const tgtLocale = options.tgtLang || defaultTarget;
        const tgtLang = AIPrompts.languageCode(tgtLocale);
        if (
            words.some(
                (word) =>
                    AIPrompts.languageCode(word?.srcLang || defaultLearning) !== srcLang,
            )
        ) {
            throw new Error("Choose vocabulary from one source language per quiz.");
        }

        const wordsPool = words
            .filter((w) => typeof w.original === "string" && w.original.trim())
            .slice(0, 25);
        if (!wordsPool.length)
            throw new Error("Choose vocabulary for the quiz first.");

        let cards = buildFallbackLearningUnits(wordsPool, tgtLang, defaultLearning);
        cards = await refineLearningUnitsWithGemini(cards, srcLocale, tgtLocale);
        const i18n = getI18n(tgtLang);

        const chosenTypes = [
            ...new Set(
                options.chosenTypes?.length
                    ? options.chosenTypes
                    : AIPrompts.DEFAULT_QUIZ_TYPES,
            ),
        ].filter((type) => AIPrompts.QUIZ_TYPES.includes(type));
        if (!chosenTypes.length)
            throw new Error("Not enough vocabulary for the selected sections.");

        const sectionByType = new Map();
        if (chosenTypes.includes("matching")) {
            const section = buildMatchingSection(cards, i18n);
            if (section) sectionByType.set(section.type, section);
        }
        if (chosenTypes.includes("multiple_choice")) {
            const section = buildMultipleChoiceSection(cards, i18n);
            if (section) sectionByType.set(section.type, section);
        }
        if (chosenTypes.includes("recall")) {
            const section = buildRecallSection(cards, i18n);
            if (section) sectionByType.set(section.type, section);
        }

        const contextCount = Math.min(
            10,
            Math.max(2, Math.ceil(cards.filter((card) => card.meaning).length * 0.5)),
        );
        const aiTypes = chosenTypes.filter(
            (type) => !["matching", "multiple_choice", "recall"].includes(type),
        );
        const knownWords = new Set(cards.map((card) => card.term.toLowerCase()));
        const cardMap = new Map(cards.map((card) => [card.card_id, card]));
        let aiTitle = "";
        let validAiSections = [];

        if (aiTypes.length) {
            try {
                const parsed = await requestAiQuizSections(
                    cards,
                    aiTypes,
                    srcLocale,
                    tgtLocale,
                    contextCount,
                );
                if (parsed) {
                    if (
                        parsed.source_language &&
                        AIPrompts.languageCode(parsed.source_language) !== srcLang
                    ) {
                        throw new Error("AI returned unexpected quiz source language.");
                    }
                    if (
                        parsed.instruction_language &&
                        AIPrompts.languageCode(parsed.instruction_language) !== tgtLang
                    ) {
                        throw new Error("AI returned unexpected quiz instruction language.");
                    }
                    const normalized = normalizeQuizData(parsed, knownWords, tgtLang, cardMap);
                    validAiSections = normalized.sections;
                    aiTitle = normalized.title;
                }
            } catch (error) {
                console.warn("AI quiz enrichment failed; using deterministic learning quiz.", error);
            }

            // One small repair attempt for missing AI-only sections. Failure no longer kills the quiz.
            const missing = aiTypes.filter(
                (type) => !validAiSections.some((section) => section.type === type),
            );
            if (missing.length) {
                try {
                    const repair = await requestAiQuizSections(
                        cards,
                        missing,
                        srcLocale,
                        tgtLocale,
                        contextCount,
                    );
                    if (repair) {
                        const normalizedRepair = normalizeQuizData(
                            repair,
                            knownWords,
                            tgtLang,
                            cardMap,
                        );
                        const existing = new Set(validAiSections.map((section) => section.type));
                        validAiSections.push(
                            ...normalizedRepair.sections.filter((section) => !existing.has(section.type)),
                        );
                        aiTitle = aiTitle || normalizedRepair.title;
                    }
                } catch (error) {
                    console.warn("AI quiz repair failed; continuing with valid sections.", error);
                }
            }
        }

        for (const section of validAiSections) {
            if (section.type === "context_recall") {
                const used = new Set(
                    (section.questions || []).map((q) => cleanString(q.card_id)).filter(Boolean),
                );
                const fallback = buildFallbackContextQuestions(
                    cards,
                    contextCount,
                    used,
                );
                section.questions = mergeSectionQuestions(
                    section.questions,
                    fallback,
                    contextCount,
                );
            }
            sectionByType.set(section.type, section);
        }

        // If AI could not make context questions, saved examples become a safe fallback.
        if (chosenTypes.includes("context_recall") && !sectionByType.has("context_recall")) {
            const fallbackQuestions = buildFallbackContextQuestions(cards, contextCount);
            if (fallbackQuestions.length) {
                sectionByType.set("context_recall", {
                    type: "context_recall",
                    instructions:
                        i18n.contextRecallInstructions ||
                        "Wpisz brakujące słowo lub zwrot z pamięci. Błędne odpowiedzi wrócą później.",
                    questions: fallbackQuestions,
                });
            }
        }

        const sections = chosenTypes.map((type) => sectionByType.get(type)).filter(Boolean);
        if (!sections.length)
            throw new Error("No valid quiz questions could be created from these flashcards.");

        return {
            title: aiTitle || i18n.defaultTitle,
            source_language: srcLang,
            instruction_language: tgtLang,
            cards,
            sections,
        };
    }

    // Validate AI enrichment without throwing away already-valid questions.
    function normalizeQuizData(quiz, knownWords, tgtLang, cardMap = null) {
        if (!quiz || !Array.isArray(quiz.sections))
            throw new Error("AI returned an invalid quiz.");
        const i18n = getI18n(tgtLang);
        const seenSections = new Set();
        const key = (value) => cleanString(value).normalize("NFC").toLowerCase();
        const alternatives = (q) =>
            [
                ...new Set(
                    [
                        ...(Array.isArray(q.acceptable_answers)
                            ? q.acceptable_answers.map(cleanString)
                            : []),
                        ...(Array.isArray(q.alternatives)
                            ? q.alternatives.map(cleanString)
                            : []),
                    ].filter(Boolean),
                ),
            ].slice(0, 4);
        const oneBlank = (value) => (cleanString(value).match(/___/g) || []).length === 1;
        const resolveCardId = (q, answer) => {
            const supplied = cleanString(q?.card_id);
            if (supplied && (!cardMap || cardMap.has(supplied))) return supplied;
            if (!cardMap) return supplied;
            const match = [...cardMap.values()].find((card) => key(card.term) === key(answer));
            return match?.card_id || "";
        };
        const choice = (q, min, max) => {
            if (!Array.isArray(q.options)) return null;
            const options = q.options.map(cleanString);
            if (
                options.length < min ||
                options.length > max ||
                options.some((o) => !o) ||
                new Set(options.map(key)).size !== options.length
            )
                return null;
            const answer = options.find((o) => key(o) === key(q.answer));
            return answer ? { options, answer } : null;
        };
        const types = new Set([
            "matching",
            "multiple_choice",
            "recall",
            "context_recall",
            "true_false",
            "correct_form",
            "odd_one_out",
        ]);
        const sections = quiz.sections
            .map((sec) => {
                const type = cleanString(sec?.type).toLowerCase();
                if (!types.has(type) || seenSections.has(type)) return null;
                seenSections.add(type);
                const instructions = cleanString(sec.instructions) || i18n.sectionTitles[type] || "";
                if (type === "matching") {
                    if (!Array.isArray(sec.pairs)) return null;
                    const pairs = sec.pairs
                        .map((p) => {
                            const a = cleanString(p?.a);
                            const b = cleanString(p?.b);
                            const card_id = resolveCardId(p, a);
                            return a && b && (!knownWords?.size || knownWords.has(key(a)))
                                ? { card_id, a, b }
                                : null;
                        })
                        .filter(Boolean)
                        .slice(0, 6);
                    if (pairs.length < 2) return null;
                    const unique =
                        new Set(pairs.map((p) => key(p.a))).size === pairs.length &&
                        new Set(pairs.map((p) => key(p.b))).size === pairs.length;
                    return unique ? { type, instructions, pairs } : null;
                }
                if (!Array.isArray(sec.questions)) return null;
                const questions = sec.questions
                    .map((q) => {
                        if (!q || typeof q !== "object") return null;
                        if (type === "recall") {
                            const prompt = cleanString(q.prompt || q.question);
                            const answer = cleanString(q.answer);
                            if (!prompt || !answer || (knownWords?.size && !knownWords.has(key(answer)))) return null;
                            return {
                                card_id: resolveCardId(q, answer),
                                prompt,
                                answer,
                                acceptable_answers: alternatives(q),
                            };
                        }
                        if (type === "context_recall") {
                            const question = cleanString(q.question || q.sentence);
                            const answer = cleanString(q.answer);
                            if (
                                !oneBlank(question) ||
                                !answer ||
                                (knownWords?.size && !knownWords.has(key(answer)))
                            )
                                return null;
                            return {
                                card_id: resolveCardId(q, answer),
                                question,
                                answer,
                                acceptable_answers: alternatives(q),
                            };
                        }
                        if (type === "true_false") {
                            const statement = cleanString(q.statement);
                            return statement && typeof q.answer === "boolean"
                                ? {
                                      card_id: cleanString(q.card_id),
                                      statement,
                                      answer: q.answer,
                                  }
                                : null;
                        }
                        const valid = choice(q, type === "correct_form" ? 3 : 4, 4);
                        if (!valid) return null;
                        if (type === "correct_form") {
                            const sentence = cleanString(q.sentence);
                            return oneBlank(sentence)
                                ? {
                                      card_id: cleanString(q.card_id),
                                      sentence,
                                      ...valid,
                                  }
                                : null;
                        }
                        if (type === "multiple_choice") {
                            const question = cleanString(q.question);
                            return question
                                ? {
                                      card_id: resolveCardId(q, valid.answer),
                                      question,
                                      ...valid,
                                  }
                                : null;
                        }
                        return { ...valid, card_id: cleanString(q.card_id) };
                    })
                    .filter(Boolean);
                return questions.length ? { type, instructions, questions } : null;
            })
            .filter(Boolean);
        if (!sections.length)
            throw new Error("AI returned no valid quiz questions.");
        return { ...quiz, title: cleanString(quiz.title), sections };
    }

    function buildQuizHtml(quiz, words, options = {}) {
        quiz = {
            ...quiz,
            sections: (quiz.sections || []).filter((sec) =>
                Object.prototype.hasOwnProperty.call(
                    QUIZ_POINTS_PER_TYPE,
                    sec?.type,
                ),
            ),
        };
        const { escapeHtml } =
            typeof SharedUtils !== "undefined"
                ? SharedUtils
                : {
                      escapeHtml: (s) =>
                          (s || "")
                              .toString()
                              .replace(/&/g, "&amp;")
                              .replace(/</g, "&lt;")
                              .replace(/>/g, "&gt;")
                              .replace(/"/g, "&quot;"),
                  };

        const defaultLearning =
            (typeof LectoroConstants !== "undefined" &&
                LectoroConstants.DEFAULT_READING_SETTINGS?.learningLang) ||
            "en";
        const defaultTarget =
            (typeof LectoroConstants !== "undefined" &&
                LectoroConstants.DEFAULT_READING_SETTINGS?.targetLang) ||
            "pl";
        const srcLang = (words[0]?.srcLang || defaultLearning).toLowerCase();
        const tgtLang = (options.tgtLang || defaultTarget).toLowerCase();
        const i18n = getI18n(tgtLang);
        const title = escapeHtml(quiz.title || i18n.defaultTitle);
        const examTitle = escapeHtml(getExamTitle(srcLang, tgtLang));

        const totalPoints = quizTotalPoints(quiz);
        const totalQuestions = quizTotalQuestions(quiz);

        let qNum = 0;
        let secNum = 0;
        const sectionsHtml = (quiz.sections || [])
            .map((sec) => {
                secNum++;
                const heading = i18n.sectionTitles[sec.type] || sec.type;
                const secPoints = quizSectionPoints(sec);
                let body = "";

                if (
                    sec.type === "multiple_choice" ||
                    sec.type === "odd_one_out"
                ) {
                    body = (sec.questions || [])
                        .map((q) => {
                            qNum++;
                            const qText = q.question
                                ? `<p class="q-title"><b>${qNum}.</b> ${escapeHtml(q.question)}</p>`
                                : `<p class="q-title"><b>${qNum}.</b></p>`;
                            const opts = (q.options || [])
                                .map(
                                    (o, i) =>
                                        `<div class="quiz-option"><span class="opt-letter">${String.fromCharCode(65 + i)}</span> <span>${escapeHtml(o)}</span></div>`,
                                )
                                .join("");
                            return `<div class="quiz-item">${qText}<div class="quiz-options-grid">${opts}</div></div>`;
                        })
                        .join("");
                } else if (sec.type === "recall") {
                    body = (sec.questions || [])
                        .map((q) => {
                            qNum++;
                            return `<div class="quiz-item"><p class="q-title"><b>${qNum}.</b> ${escapeHtml(q.prompt)}</p><div class="quiz-answer-line"></div></div>`;
                        })
                        .join("");
                } else if (sec.type === "context_recall") {
                    body = (sec.questions || [])
                        .map((q) => {
                            qNum++;
                            return `<div class="quiz-item"><p class="q-title"><b>${qNum}.</b> ${escapeHtml(q.question)}</p><div class="quiz-answer-line"></div></div>`;
                        })
                        .join("");
                } else if (sec.type === "matching") {
                    const aList = (sec.pairs || [])
                        .map(
                            (p, i) =>
                                `<li><b>${i + 1}.</b> ${escapeHtml(p.a)}</li>`,
                        )
                        .join("");
                    const bList = [...(sec.pairs || [])]
                        .sort(() => Math.random() - 0.5)
                        .map(
                            (p, i) =>
                                `<li><b>${String.fromCharCode(65 + i)}.</b> ${escapeHtml(p.b)}</li>`,
                        )
                        .join("");
                    body = `<div class="quiz-matching-box"><ol class="quiz-match-col">${aList}</ol><ol class="quiz-match-col" type="A">${bList}</ol></div>`;
                } else if (sec.type === "true_false") {
                    body = (sec.questions || [])
                        .map((q) => {
                            qNum++;
                            return `<div class="quiz-item"><p class="q-title"><b>${qNum}.</b> ${escapeHtml(q.statement)} <span class="quiz-tf-box"><span class="tf-opt">☐ ${escapeHtml(i18n.trueLabel)}</span> <span class="tf-opt">☐ ${escapeHtml(i18n.falseLabel)}</span></span></p></div>`;
                        })
                        .join("");
                } else if (sec.type === "correct_form") {
                    body = (sec.questions || [])
                        .map((q) => {
                            qNum++;
                            const opts = (q.options || [])
                                .map(
                                    (o, i) =>
                                        `<div class="quiz-option"><span class="opt-letter">${String.fromCharCode(65 + i)}</span> <span>${escapeHtml(o)}</span></div>`,
                                )
                                .join("");
                            return `<div class="quiz-item"><p class="q-title"><b>${qNum}.</b> ${escapeHtml(q.sentence)}</p><div class="quiz-options-grid">${opts}</div></div>`;
                        })
                        .join("");
                }

                return `<section class="quiz-section">
                    <div class="section-head">
                        <h2>${secNum}. ${escapeHtml(heading)}</h2>
                        <span class="quiz-points-tag">${secPoints} ${escapeHtml(i18n.pointsSuffix)}</span>
                    </div>
                    <p class="quiz-instructions">${escapeHtml(sec.instructions || "")}</p>
                    ${body}
                </section>`;
            })
            .join("");

        const answerKeyHtml = (quiz.sections || [])
            .map((sec) => {
                if (
                    sec.type === "multiple_choice" ||
                    sec.type === "recall" ||
                    sec.type === "context_recall" ||
                    sec.type === "correct_form" ||
                    sec.type === "odd_one_out"
                ) {
                    return (sec.questions || [])
                        .map((q) => `<li>${escapeHtml(q.answer)}</li>`)
                        .join("");
                }
                if (sec.type === "true_false") {
                    return (sec.questions || [])
                        .map(
                            (q) =>
                                `<li>${q.answer ? i18n.trueLabel : i18n.falseLabel}</li>`,
                        )
                        .join("");
                }
                if (sec.type === "matching") {
                    return (sec.pairs || [])
                        .map(
                            (p) =>
                                `<li>${escapeHtml(p.a)} → ${escapeHtml(p.b)}</li>`,
                        )
                        .join("");
                }
                return "";
            })
            .join("");

        const dateString =
            typeof SharedUtils !== "undefined" && SharedUtils.dateTag
                ? SharedUtils.dateTag()
                : new Date().toISOString().slice(0, 10);

        return `<!DOCTYPE html>
<html lang="${escapeHtml(tgtLang)}">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 820px; margin: 30px auto; padding: 0 28px; color: #0f172a; line-height: 1.55; background: #ffffff; }
    .print-bar { display: flex; justify-content: flex-end; margin-bottom: 24px; }
    .print-btn { display: inline-flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 600; padding: 9px 18px; cursor: pointer; border-radius: 10px; border: 1px solid #cbd5e1; background: #f8fafc; color: #0f766e; transition: all .15s ease; }
    .print-btn:hover { background: #f0fdfa; border-color: #0d9488; color: #0d9488; }
    
    .exam-header { border: 1.5px solid #cbd5e1; border-radius: 12px; padding: 14px 18px; margin-bottom: 24px; background: #f8fafc; }
    .exam-header-row { display: flex; flex-wrap: wrap; gap: 14px 28px; font-size: 13.5px; color: #334155; font-weight: 500; }
    .exam-field { display: flex; align-items: baseline; gap: 8px; flex: 1; min-width: 180px; }
    .exam-line { flex: 1; min-width: 70px; border-bottom: 1.5px dotted #94a3b8; height: 1em; }
    
    h1 { font-size: 22px; font-weight: 800; text-align: center; color: #0f172a; letter-spacing: -0.02em; margin-bottom: 4px; }
    .quiz-subtitle { text-align: center; color: #64748b; font-size: 14px; margin-bottom: 18px; }
    
    .exam-meta-banner { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px 24px; font-size: 13px; font-weight: 600; color: #0f766e; background: #f0fdfa; border: 1px solid #ccfbf1; border-radius: 10px; padding: 10px 16px; margin-bottom: 20px; }
    .exam-score-row { display: flex; justify-content: space-between; align-items: center; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 18px; font-size: 13.5px; font-weight: 700; color: #1e293b; margin-bottom: 28px; }
    
    .quiz-section { page-break-inside: avoid; margin-bottom: 28px; padding-bottom: 20px; border-bottom: 1px solid #f1f5f9; }
    .quiz-section:last-of-type { border-bottom: none; }
    .section-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
    h2 { font-size: 15.5px; font-weight: 700; color: #0f172a; }
    .quiz-points-tag { font-size: 12px; font-weight: 700; color: #0d9488; background: #f0fdfa; border: 1px solid #ccfbf1; border-radius: 999px; padding: 2px 10px; white-space: nowrap; }
    .quiz-instructions { font-size: 13px; color: #64748b; margin-bottom: 14px; font-style: italic; }
    
    .quiz-item { margin: 12px 0 16px; }
    .quiz-answer-line { height: 24px; border-bottom: 1px solid #94a3b8; margin: 8px 0 2px; }
    .q-title { font-size: 14px; color: #1e293b; line-height: 1.5; margin-bottom: 8px; }
    .quiz-options-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 8px 14px; margin-top: 6px; }
    .quiz-option { display: flex; align-items: center; gap: 8px; font-size: 13.5px; color: #334155; }
    .opt-letter { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 6px; background: #f1f5f9; font-size: 12px; font-weight: 700; color: #475569; }
    
    .quiz-matching-box { display: flex; gap: 40px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 20px; margin-top: 8px; }
    .quiz-match-col { list-style: none; flex: 1; font-size: 13.5px; line-height: 1.8; color: #334155; }
    .quiz-hint { color: #64748b; font-size: 12.5px; font-style: italic; }
    .quiz-tf-box { margin-left: 12px; white-space: nowrap; font-size: 13px; font-weight: 600; color: #475569; }
    .tf-opt { margin-left: 8px; }
    .write-line { border-bottom: 1.5px dotted #cbd5e1; height: 26px; width: 100%; margin-top: 4px; }
    
    .answer-key { page-break-before: always; margin-top: 36px; padding-top: 20px; }
    .answer-key h2 { color: #0d9488; margin-bottom: 14px; }
    .answer-key ol { padding-left: 20px; font-size: 13.5px; line-height: 1.8; color: #334155; }
    
    .grading-scale { page-break-inside: avoid; margin-top: 30px; }
    .grade-table { border-collapse: collapse; width: 100%; max-width: 440px; font-size: 13px; margin-top: 10px; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0; }
    .grade-table th, .grade-table td { padding: 7px 14px; text-align: center; border: 1px solid #e2e8f0; }
    .grade-table th { background: #f0fdfa; color: #0f766e; font-weight: 700; }
    
    .exam-footer { text-align: center; font-size: 12.5px; color: #94a3b8; margin: 34px 0 20px; }
    @media print { .print-bar { display: none; } body { margin: 0; padding: 0; } }
</style>
</head>
<body>
    <div class="print-bar"><button type="button" class="print-btn" onclick="window.print()">${escapeHtml(i18n.printBtn)}</button></div>
    <div class="exam-header">
        <div class="exam-header-row">
            <div class="exam-field">${escapeHtml(i18n.name)}: <span class="exam-line"></span></div>
            <div class="exam-field" style="max-width:140px;">${escapeHtml(i18n.class)}: <span class="exam-line"></span></div>
            <div class="exam-field" style="max-width:180px;">${escapeHtml(i18n.date)}: <span class="exam-line"></span></div>
        </div>
    </div>
    <h1>${examTitle}</h1>
    <p class="quiz-subtitle">${title}</p>
    <div class="exam-meta-banner">
        <span>📝 <b>${secNum}</b> ${escapeHtml(i18n.tasks)} • <b>${totalQuestions}</b> ${escapeHtml(i18n.questions)}</span>
        <span>🏆 ${escapeHtml(i18n.maxPoints)}: <b>${totalPoints} ${escapeHtml(i18n.pointsSuffix)}</b></span>
        <span>📅 ${dateString}</span>
    </div>
    <div class="exam-score-row">
        <span>${escapeHtml(i18n.score)}: ______ / ${totalPoints} ${escapeHtml(i18n.pointsSuffix)}</span>
        <span>${escapeHtml(i18n.grade)}: ____________</span>
    </div>
    ${sectionsHtml}
    <section class="answer-key">
        <h2>${escapeHtml(i18n.answerKey)}</h2>
        <ol>${answerKeyHtml}</ol>
    </section>
    <section class="grading-scale">
        <h2>${escapeHtml(i18n.gradingScale)}</h2>
        <table class="grade-table">
            <tr><th>${escapeHtml(i18n.pctPoints)}</th><th>${escapeHtml(i18n.grade)}</th></tr>
            <tr><td>95–100%</td><td>${escapeHtml(i18n.grades[6])} (6)</td></tr>
            <tr><td>85–94%</td><td>${escapeHtml(i18n.grades[5])} (5)</td></tr>
            <tr><td>70–84%</td><td>${escapeHtml(i18n.grades[4])} (4)</td></tr>
            <tr><td>55–69%</td><td>${escapeHtml(i18n.grades[3])} (3)</td></tr>
            <tr><td>40–54%</td><td>${escapeHtml(i18n.grades[2])} (2)</td></tr>
            <tr><td>0–39%</td><td>${escapeHtml(i18n.grades[1])} (1)</td></tr>
        </table>
    </section>
    <p class="exam-footer">${escapeHtml(i18n.goodLuck)} • ${words.length} ${escapeHtml(i18n.wordsCount)} • ${dateString}</p>
</body>
</html>`;
    }

    // ── 4. Interactive, Gamified Quiz Engine ────────────────────────────
    function buildInteractiveQuizHtml(quiz, words, options = {}) {
        quiz = {
            ...quiz,
            sections: (quiz.sections || []).filter((sec) =>
                Object.prototype.hasOwnProperty.call(
                    QUIZ_POINTS_PER_TYPE,
                    sec?.type,
                ),
            ),
        };
        const { escapeHtml, escapeAttr } =
            typeof SharedUtils !== "undefined"
                ? SharedUtils
                : {
                      escapeHtml: (s) =>
                          (s || "")
                              .toString()
                              .replace(/&/g, "&amp;")
                              .replace(/</g, "&lt;")
                              .replace(/>/g, "&gt;")
                              .replace(/"/g, "&quot;"),
                      escapeAttr: (s) =>
                          (s || "")
                              .toString()
                              .replace(/"/g, "&quot;")
                              .replace(/'/g, "&#39;"),
                  };

        const defaultLearning =
            (typeof LectoroConstants !== "undefined" &&
                LectoroConstants.DEFAULT_READING_SETTINGS?.learningLang) ||
            "en";
        const defaultTarget =
            (typeof LectoroConstants !== "undefined" &&
                LectoroConstants.DEFAULT_READING_SETTINGS?.targetLang) ||
            "pl";
        const srcLang = (words[0]?.srcLang || defaultLearning).toLowerCase();
        const tgtLang = (options.tgtLang || defaultTarget).toLowerCase();
        const i18n = getI18n(tgtLang);
        const title = escapeHtml(quiz.title || i18n.defaultTitle);
        const examTitle = escapeHtml(getExamTitle(srcLang, tgtLang));

        const totalPoints = quizTotalPoints(quiz);
        const quizCards = Array.isArray(quiz.cards) ? quiz.cards : [];
        const cardById = new Map(quizCards.map((card) => [card.card_id, card]));
        const cardAttrs = (q, kind) => {
            const cardId = cleanString(q?.card_id);
            const card = cardById.get(cardId);
            return ` data-card-id="${escapeAttr(cardId)}" data-learning-kind="${escapeAttr(kind)}" data-review-prompt="${escapeAttr(card?.meaning || "")}"`;
        };

        const ttsIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
        const ttsBtn = (text, lang) =>
            text
                ? `<button type="button" class="tts-btn" data-tts-text="${escapeAttr(text)}" data-tts-lang="${escapeAttr(lang)}" onclick="qtSpeak(this)" title="${escapeAttr(i18n.listenLabel)}">${ttsIcon}</button>`
                : "";

        let qNum = 0;
        let secNum = 0;
        const sectionsHtml = (quiz.sections || [])
            .map((sec) => {
                secNum++;
                const heading = i18n.sectionTitles[sec.type] || sec.type;
                const secPoints = QUIZ_POINTS_PER_TYPE[sec.type] ?? 1;
                let body = "";

                if (sec.type === "multiple_choice" || sec.type === "odd_one_out") {
                    body = (sec.questions || [])
                        .map((q) => {
                            qNum++;
                            const qText = q.question
                                ? `<div class="q-text-row"><p class="q-text"><b>${qNum}.</b> ${escapeHtml(q.question)} <span class="pts-badge">${secPoints} ${escapeHtml(i18n.pointsSuffix)}</span></p></div>`
                                : `<p class="q-text"><b>${qNum}.</b> <span class="pts-badge">${secPoints} ${escapeHtml(i18n.pointsSuffix)}</span></p>`;
                            const opts = (q.options || [])
                                .map(
                                    (o) =>
                                        `<span class="opt-row"><button type="button" class="opt" onclick="selectOpt(this)">${escapeHtml(o)}</button>${ttsBtn(o, srcLang)}</span>`,
                                )
                                .join("");
                            return `<div class="q" data-qtype="choice" data-qid="${qNum}" data-points="${secPoints}" data-answer="${escapeAttr(q.answer)}"${cardAttrs(q, sec.type)}>
                                ${qText}
                                <div class="opts">${opts}</div>
                                <div class="q-feedback"></div>
                            </div>`;
                        })
                        .join("");
                } else if (sec.type === "recall" || sec.type === "context_recall") {
                    body = (sec.questions || [])
                        .map((q) => {
                            qNum++;
                            const isContext = sec.type === "context_recall";
                            const prompt = isContext ? q.question : q.prompt;
                            const alts = Array.isArray(q.acceptable_answers)
                                ? q.acceptable_answers
                                : Array.isArray(q.alternatives)
                                  ? q.alternatives
                                  : [];
                            const speak = isContext ? ttsBtn(prompt, srcLang) : "";
                            return `<div class="q active-recall" data-qtype="text" data-qid="${qNum}" data-points="${secPoints}" data-answer="${escapeAttr(q.answer)}" data-alternatives="${escapeAttr(JSON.stringify(alts))}"${cardAttrs(q, sec.type)}>
                                <div class="q-text-row"><p class="q-text"><b>${qNum}.</b> ${escapeHtml(prompt)} <span class="pts-badge">${secPoints} ${escapeHtml(i18n.pointsSuffix)}</span></p>${speak}</div>
                                <div class="input-row">
                                    <input type="text" class="q-input" autocomplete="off" spellcheck="false" placeholder="${escapeAttr(i18n.yourAnswerPlaceholder)}" onkeydown="if(event.key==='Enter'){event.preventDefault();gradeQuestion(this.closest('.q'));}">
                                    <button type="button" class="btn-mini" onclick="gradeQuestion(this.closest('.q'))">✓</button>
                                </div>
                                <div class="memory-actions">
                                    <button type="button" class="btn-memory" onclick="showMemoryHint(this.closest('.q'))">💡 ${escapeHtml(i18n.hint)}</button>
                                    <button type="button" class="btn-memory btn-dontknow" onclick="dontKnow(this.closest('.q'))">${escapeHtml(i18n.dontKnow || "I don't remember")}</button>
                                    <span class="memory-hint" aria-live="polite"></span>
                                </div>
                                <div class="q-match-bar"><div class="q-match-fill"></div><span class="q-match-label"></span></div>
                                <div class="q-feedback"></div>
                            </div>`;
                        })
                        .join("");
                } else if (sec.type === "matching") {
                    const rightOptions = (sec.pairs || []).map((p) => p.b);
                    body =
                        `<div class="matching-grid">` +
                        (sec.pairs || [])
                            .map((p) => {
                                qNum++;
                                const shuffled = [...rightOptions].sort(() => Math.random() - 0.5);
                                const opts = shuffled
                                    .map(
                                        (b) =>
                                            `<option value="${escapeAttr(b)}">${escapeHtml(b)}</option>`,
                                    )
                                    .join("");
                                return `<div class="q match-card" data-qtype="select" data-qid="${qNum}" data-points="${secPoints}" data-answer="${escapeAttr(p.b)}"${cardAttrs(p, sec.type)}>
                                    <div class="match-row">
                                        <div class="match-left-wrap">
                                            <span class="match-left"><b>${qNum}.</b> ${escapeHtml(p.a)}</span>${ttsBtn(p.a, srcLang)}
                                        </div>
                                        <div class="match-right-wrap">
                                            <select class="q-select" onchange="gradeQuestion(this.closest('.q'))"><option value="">${escapeHtml(i18n.selectPlaceholder)}</option>${opts}</select>
                                            <span class="pts-badge pts-badge-inline">${secPoints} ${escapeHtml(i18n.pointsSuffix)}</span>
                                        </div>
                                    </div>
                                    <div class="q-feedback"></div>
                                </div>`;
                            })
                            .join("") +
                        `</div>`;
                } else if (sec.type === "true_false") {
                    body = (sec.questions || [])
                        .map((q) => {
                            qNum++;
                            const expectedText = q.answer ? i18n.trueLabel : i18n.falseLabel;
                            return `<div class="q" data-qtype="choice" data-qid="${qNum}" data-points="${secPoints}" data-answer="${escapeAttr(expectedText)}"${cardAttrs(q, sec.type)}>
                                <div class="q-text-row"><p class="q-text"><b>${qNum}.</b> ${escapeHtml(q.statement)} <span class="pts-badge">${secPoints} ${escapeHtml(i18n.pointsSuffix)}</span></p>${ttsBtn(q.statement, tgtLang)}</div>
                                <div class="opts">
                                    <button type="button" class="opt" onclick="selectOpt(this)">${escapeHtml(i18n.trueLabel)}</button>
                                    <button type="button" class="opt" onclick="selectOpt(this)">${escapeHtml(i18n.falseLabel)}</button>
                                </div>
                                <div class="q-feedback"></div>
                            </div>`;
                        })
                        .join("");
                } else if (sec.type === "correct_form") {
                    body = (sec.questions || [])
                        .map((q) => {
                            qNum++;
                            const opts = (q.options || [])
                                .map(
                                    (o) =>
                                        `<span class="opt-row"><button type="button" class="opt" onclick="selectOpt(this)">${escapeHtml(o)}</button>${ttsBtn(o, srcLang)}</span>`,
                                )
                                .join("");
                            return `<div class="q" data-qtype="choice" data-qid="${qNum}" data-points="${secPoints}" data-answer="${escapeAttr(q.answer)}"${cardAttrs(q, sec.type)}>
                                <div class="q-text-row"><p class="q-text"><b>${qNum}.</b> ${escapeHtml(q.sentence)} <span class="pts-badge">${secPoints} ${escapeHtml(i18n.pointsSuffix)}</span></p>${ttsBtn(q.sentence, srcLang)}</div>
                                <div class="opts">${opts}</div>
                                <div class="q-feedback"></div>
                            </div>`;
                        })
                        .join("");
                }

                return `<section class="quiz-section">
                    <div class="sec-header">
                        <h2>${secNum}. ${escapeHtml(heading)}</h2>
                        <span class="quiz-section-points">${quizSectionPoints(sec)} ${escapeHtml(i18n.pointsSuffix)}</span>
                    </div>
                    <p class="instructions">${escapeHtml(sec.instructions || "")}</p>
                    ${body}
                </section>`;
            })
            .join("");

        const dateString =
            typeof SharedUtils !== "undefined" && SharedUtils.dateTag
                ? SharedUtils.dateTag()
                : new Date().toISOString().slice(0, 10);

        return `<!DOCTYPE html>
<html lang="${escapeHtml(tgtLang)}">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
    :root {
        --bg: #f8fafc;
        --card: #ffffff;
        --border: #e2e8f0;
        --border-hover: #cbd5e1;
        --text: #0f172a;
        --text-secondary: #334155;
        --muted: #64748b;
        --accent: #0d9488;
        --accent-hover: #0f766e;
        --accent-light: #f0fdfa;
        --accent-dim: rgba(13, 148, 136, 0.08);
        --accent-border: #ccfbf1;
        --mint: #10b981;
        --mint-light: #ecfdf5;
        --amber: #f59e0b;
        --rose: #e11d48;
        --rose-light: #fff1f2;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        max-width: 780px;
        margin: 0 auto;
        padding: 36px 20px 70px;
        background: var(--bg);
        color: var(--text);
        line-height: 1.55;
        position: relative;
    }
    
    /* Ambient background gradient */
    body::before {
        content: '';
        position: fixed;
        inset: 0;
        background: radial-gradient(circle at 10% 10%, rgba(13, 148, 136, 0.04) 0%, transparent 40%),
                    radial-gradient(circle at 90% 90%, rgba(6, 182, 212, 0.04) 0%, transparent 40%);
        pointer-events: none;
        z-index: -1;
    }

    h1 { font-size: 24px; font-weight: 800; margin: 0 0 6px; text-align: center; letter-spacing: -0.02em; color: var(--text); }
    .subtitle { color: var(--muted); font-size: 13.5px; margin: 0 0 18px; text-align: center; font-weight: 500; }
    
    .exam-meta-row {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 8px 22px;
        font-size: 13px;
        color: var(--muted);
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 10px 16px;
        margin-bottom: 22px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.02);
    }
    .exam-meta-row b { color: var(--text-secondary); }
    
    /* Sticky Gamified HUD */
    .hud {
        position: sticky;
        top: 14px;
        z-index: 600;
        background: rgba(255, 255, 255, 0.92);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 12px 18px;
        margin-bottom: 24px;
        box-shadow: 0 4px 20px -2px rgba(15, 23, 42, 0.06);
        display: flex;
        align-items: center;
        gap: 16px;
        flex-wrap: wrap;
    }
    .hud-score {
        font-size: 14.5px;
        font-weight: 800;
        color: var(--accent);
        display: flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
    }
    .hud-score .hud-score-num { font-size: 20px; display: inline-block; transition: transform .2s ease; }
    .hud-score.bump .hud-score-num { animation: score-bump .4s ease; }
    @keyframes score-bump { 0% { transform: scale(1); } 40% { transform: scale(1.35); color: var(--mint); } 100% { transform: scale(1); } }
    
    .hud-progress { flex: 1; min-width: 140px; }
    .progress-wrap { background: #e2e8f0; border-radius: 999px; height: 9px; overflow: hidden; margin-bottom: 4px; }
    .progress-bar { height: 100%; width: 0%; background: linear-gradient(90deg, var(--accent), #14b8a6, #06b6d4); transition: width .35s ease; border-radius: 999px; }
    .progress-label { font-size: 11.5px; font-weight: 600; color: var(--muted); }
    
    .hud-streak {
        font-size: 12.5px;
        font-weight: 700;
        color: #b45309;
        background: #fffbeb;
        border: 1px solid #fde68a;
        border-radius: 999px;
        padding: 4px 12px;
        white-space: nowrap;
        opacity: 0;
        transform: scale(0.8);
        transition: all .25s ease;
    }
    .hud-streak.show { opacity: 1; transform: scale(1); }
    
    .streak-badge {
        display: none;
        background: #fffbeb;
        color: #b45309;
        border: 1px solid #fde68a;
        font-weight: 700;
        font-size: 12.5px;
        padding: 6px 14px;
        border-radius: 999px;
        margin: 0 auto 20px;
        text-align: center;
    }
    .streak-badge.show { display: inline-block; animation: streak-pop .3s ease; }
    @keyframes streak-pop { 0% { transform: scale(0.6); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }

    /* Question Cards & Styling */
    .quiz-section { margin-bottom: 30px; }
    .sec-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
    h2 { font-size: 16px; font-weight: 700; color: var(--text); }
    .quiz-section-points { font-size: 12.5px; font-weight: 700; color: var(--accent); background: var(--accent-light); border: 1px solid var(--accent-border); padding: 2px 10px; border-radius: 999px; }
    .instructions { font-style: italic; color: var(--muted); font-size: 13px; margin: 0 0 14px; }
    
    .q {
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 16px 18px;
        margin-bottom: 12px;
        transition: border-color .2s, box-shadow .2s;
        box-shadow: 0 2px 8px -2px rgba(15, 23, 42, 0.04);
    }
    .q:hover { border-color: var(--border-hover); }
    .q-text { margin: 0 0 12px; font-size: 14px; font-weight: 500; color: var(--text); line-height: 1.5; }
    .pts-badge { display: inline-block; background: var(--accent-light); color: var(--accent); font-size: 11px; font-weight: 700; border-radius: 999px; padding: 2px 8px; vertical-align: middle; border: 1px solid var(--accent-border); }
    .pts-badge-inline { margin: 0 4px; }
    
    .opts { display: flex; flex-wrap: wrap; gap: 8px; }
    .opt {
        background: #f8fafc;
        border: 1.5px solid var(--border);
        color: var(--text-secondary);
        padding: 8px 16px;
        border-radius: 10px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        font-family: inherit;
        transition: all .15s ease;
    }
    .opt:hover { border-color: var(--accent); background: var(--accent-light); color: var(--accent-hover); transform: translateY(-1px); }
    .opt.selected { background: rgba(13, 148, 136, 0.12); border-color: var(--accent); color: var(--accent-hover); font-weight: 700; }
    
    .q-input, .q-select {
        width: 100%;
        padding: 10px 14px;
        border-radius: 10px;
        border: 1.5px solid var(--border);
        background: #f8fafc;
        color: var(--text);
        font-size: 13.5px;
        font-family: inherit;
        transition: border-color .15s, box-shadow .15s;
    }
    .q-input:focus, .q-select:focus {
        outline: none;
        border-color: var(--accent);
        background: #ffffff;
        box-shadow: 0 0 0 3px rgba(13, 148, 136, 0.15);
    }
    
    .match-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
    .match-left-wrap { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 140px; }
    .match-left { font-size: 14px; font-weight: 600; color: var(--text); }
    .match-right-wrap { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 180px; }
    .match-right-wrap .q-select { flex: 1; }
    .input-row { display: flex; gap: 8px; }
    .input-row .q-input { flex: 1; }
    .btn-mini {
        flex: 0 0 auto;
        background: linear-gradient(135deg, var(--accent), var(--accent-hover));
        color: #fff;
        border: none;
        border-radius: 10px;
        padding: 0 18px;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
        transition: opacity .15s;
    }
    .btn-mini:hover { opacity: 0.9; }
    
    .opt.opt-correct { background: rgba(16, 185, 129, 0.14) !important; border-color: #10b981 !important; color: #047857 !important; font-weight: 700; }
    .opt.opt-incorrect { background: rgba(225, 29, 72, 0.12) !important; border-color: #f43f5e !important; color: #be123c !important; }
    
    .q-feedback { margin-top: 10px; font-size: 12.5px; font-weight: 600; }
    .q.correct { border-color: #10b981; background: #fafdfb; }
    .q.correct .q-feedback { color: #047857; }
    .q.incorrect { border-color: #f43f5e; background: #fffdfd; }
    .q.incorrect .q-feedback { color: #be123c; }
    
    .q-feedback .fb-answer-label { color: var(--muted) !important; font-weight: 600; }
    .q-feedback .fb-answer-diff { font-weight: 800; font-size: 13.5px; letter-spacing: .2px; display: inline-block; margin-top: 2px; }
    .q-feedback .diff-ok { color: #059669 !important; font-weight: 800; }
    .q-feedback .diff-bad { color: #dc2626 !important; background: rgba(220, 38, 38, 0.12); border-radius: 4px; padding: 1px 3px; font-weight: 800; text-decoration: underline wavy #ef4444; }
    
    .q-match-bar { position: relative; height: 16px; background: #e2e8f0; border-radius: 999px; margin-top: 8px; overflow: hidden; display: none; }
    .q-match-fill { height: 100%; width: 0%; background: linear-gradient(90deg, #10b981, #34d399); transition: width .35s ease; border-radius: 999px; }
    .q-match-fill.low { background: linear-gradient(90deg, #f43f5e, #fb7185); }
    .q-match-label { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 800; color: #0f172a; }
    
    .actions { display: flex; gap: 12px; margin: 30px 0; }
    .actions button { font-size: 14px; font-weight: 700; padding: 13px 24px; border-radius: 12px; border: none; cursor: pointer; font-family: inherit; transition: all .15s ease; }
    .btn-check { background: linear-gradient(135deg, var(--accent), var(--accent-hover)); color: #ffffff; box-shadow: 0 4px 14px rgba(13, 148, 136, 0.28); }
    .btn-check:hover { opacity: 0.92; transform: translateY(-1px); }
    .btn-reset { background: #ffffff; color: var(--text-secondary); border: 1.5px solid var(--border) !important; }
    .btn-reset:hover { background: #f8fafc; border-color: var(--border-hover) !important; }
    
    .score-box { padding: 18px; border-radius: 14px; font-size: 16px; font-weight: 800; text-align: center; margin-top: 20px; }
    .score-box.good { background: #ecfdf5; border: 1.5px solid #a7f3d0; color: #065f46; }
    .score-box.mid { background: #fffbeb; border: 1.5px solid #fde68a; color: #92400e; }
    .score-box.bad { background: #fff1f2; border: 1.5px solid #fecdd3; color: #9f1239; }
    
    .q-text-row { display: flex; align-items: flex-start; gap: 6px; }
    .q-text-row .q-text { flex: 1; }
    .opt-row { display: inline-flex; align-items: center; gap: 2px; }
    .tts-btn { flex: 0 0 auto; background: none; border: none; color: var(--accent); cursor: pointer; padding: 5px; border-radius: 8px; display: inline-flex; align-items: center; opacity: .8; transition: all .15s; }
    .tts-btn svg { width: 16px; height: 16px; }
    .tts-btn:hover { opacity: 1; background: var(--accent-light); }
    .tts-btn.tts-loading { opacity: 1; animation: tts-pulse 1s ease-in-out infinite; }
    @keyframes tts-pulse { 0%, 100% { opacity: .4; } 50% { opacity: 1; } }
    
    .hint-badge { display: inline-block; background: var(--accent-light); color: var(--accent-hover); border: 1px solid var(--accent-border); border-radius: 999px; padding: 2px 10px; font-size: 11.5px; font-weight: 600; white-space: nowrap; vertical-align: middle; }

    .memory-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
    .btn-memory { border: 1px solid var(--border); background: #fff; color: var(--text-secondary); border-radius: 9px; padding: 6px 10px; font-size: 11.5px; font-weight: 700; cursor: pointer; font-family: inherit; }
    .btn-memory:hover { border-color: var(--accent); color: var(--accent-hover); background: var(--accent-light); }
    .btn-dontknow { color: #9f1239; }
    .memory-hint { font-size: 12px; font-weight: 800; color: var(--accent-hover); letter-spacing: .8px; }

    .mastery-panel { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 14px 16px; margin: 0 0 24px; box-shadow: 0 2px 8px -2px rgba(15,23,42,.04); }
    .mastery-panel h2 { margin-bottom: 10px; }
    .mastery-grid { display: grid; gap: 8px; }
    .mastery-row { display: grid; grid-template-columns: minmax(110px, 1fr) minmax(120px, 1.4fr) auto; gap: 10px; align-items: center; font-size: 12px; }
    .mastery-term { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mastery-track { height: 8px; border-radius: 999px; background: #e2e8f0; overflow: hidden; }
    .mastery-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--accent), #10b981); transition: width .3s ease; }
    .mastery-status { min-width: 86px; text-align: right; font-weight: 700; color: var(--muted); }

    .review-section { border-top: 1px dashed var(--border-hover); padding-top: 20px; margin-top: 8px; }
    .review-section .sec-header h2 { color: #9a3412; }
    .review-chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px; background: #fff7ed; color: #9a3412; border: 1px solid #fed7aa; font-size: 11px; font-weight: 800; margin-left: 6px; }
    .review-card { border-color: #fed7aa; }
    
    .confetti-piece { position: fixed; top: -12px; width: 8px; height: 14px; z-index: 9999; pointer-events: none; animation: confetti-fall linear forwards; border-radius: 2px; }
    @keyframes confetti-fall { to { transform: translateY(110vh) rotate(360deg); opacity: 0.85; } }
    
    .particle { position: fixed; z-index: 9999; pointer-events: none; font-size: 20px; will-change: transform, opacity; animation: particle-burst .9s cubic-bezier(.2,.7,.3,1) forwards; }
    @keyframes particle-burst { 0% { transform: translate(0,0) scale(1) rotate(0deg); opacity: 1; } 100% { transform: translate(var(--dx), var(--dy)) scale(0.3) rotate(var(--rot)); opacity: 0; } }
    
    .point-popup { position: fixed; z-index: 9999; pointer-events: none; font-weight: 900; font-size: 17px; color: #047857; text-shadow: 0 1px 0 rgba(255,255,255,.6); animation: point-float 1s ease-out forwards; }
    @keyframes point-float { 0% { transform: translateY(0) scale(0.8); opacity: 0; } 15% { opacity: 1; transform: translateY(-6px) scale(1.15); } 100% { transform: translateY(-70px) scale(1); opacity: 0; } }
    
    .q.pop-correct { animation: pop-glow .55s ease; }
    @keyframes pop-glow { 0% { box-shadow: 0 0 0 rgba(16,185,129,0); } 35% { box-shadow: 0 0 24px rgba(16,185,129,0.35); } 100% { box-shadow: 0 0 0 rgba(16,185,129,0); } }
    .q.shake-wrong { animation: shake-anim .4s ease; }
    @keyframes shake-anim { 10%, 90% { transform: translateX(-2px); } 20%, 80% { transform: translateX(4px); } 30%, 50%, 70% { transform: translateX(-7px); } 40%, 60% { transform: translateX(7px); } }
    
    .combo-banner { position: fixed; top: 38%; left: 50%; z-index: 10000; pointer-events: none; font-size: 32px; font-weight: 900; color: #fff; text-align: center; text-shadow: 0 4px 16px rgba(0,0,0,.2); background: linear-gradient(135deg, var(--accent), #06b6d4); padding: 16px 32px; border-radius: 18px; opacity: 0; animation: combo-pop 1.2s ease forwards; }
    @keyframes combo-pop { 0% { opacity: 0; transform: translate(-50%,-50%) scale(0.3) rotate(-6deg); } 18% { opacity: 1; transform: translate(-50%,-50%) scale(1.15) rotate(2deg); } 32% { transform: translate(-50%,-50%) scale(1) rotate(0deg); } 78% { opacity: 1; transform: translate(-50%,-50%) scale(1); } 100% { opacity: 0; transform: translate(-50%,-62%) scale(1.05); } }
</style>
</head>
<body>
    <h1>${examTitle}</h1>
    <p class="subtitle">${title}</p>
    <div class="exam-meta-row">
        <span>📝 <b>${secNum}</b> ${escapeHtml(i18n.tasks)} • <b>${qNum}</b> ${escapeHtml(i18n.questions)}</span>
        <span>🏆 ${escapeHtml(i18n.maxPoints)}: <b>${totalPoints} ${escapeHtml(i18n.pointsSuffix)}</b></span>
        <span>📅 ${dateString}</span>
    </div>
    <div class="hud">
        <div class="hud-score" id="hudScore">🏆 <span class="hud-score-num" id="hudScoreNum">0</span>&nbsp;/&nbsp;${totalPoints} ${escapeHtml(i18n.pointsSuffix)}</div>
        <div class="hud-progress">
            <div class="progress-wrap"><div class="progress-bar" id="progressBar" style="width:0%"></div></div>
            <p class="progress-label" id="progressLabel">${escapeHtml(i18n.answered)}: 0 / ${qNum}</p>
        </div>
        <span class="hud-streak" id="hudStreak">🔥 ${escapeHtml(i18n.streak)}: 0</span>
    </div>
    <span class="streak-badge" id="streakBadge"></span>
    <section class="mastery-panel">
        <h2>🧠 ${escapeHtml(i18n.masteryTitle || "Vocabulary Memory")}</h2>
        <div class="mastery-grid" id="masteryGrid"></div>
    </section>
    ${sectionsHtml}
    <section class="quiz-section review-section" id="reviewSection" style="display:none;">
        <div class="sec-header">
            <h2>↻ ${escapeHtml(i18n.reviewTitle || "Mistake Review")} <span class="review-chip" id="reviewCount">0</span></h2>
        </div>
        <p class="instructions">${escapeHtml(i18n.reviewInstructions || "Missed words return after a few questions.")}</p>
        <div id="reviewContainer"></div>
    </section>
    <div class="actions">
        <button type="button" class="btn-check" onclick="checkAllAnswers()">${escapeHtml(i18n.checkAllBtn)}</button>
        <button type="button" class="btn-reset" onclick="resetQuiz()">${escapeHtml(i18n.resetBtn)}</button>
    </div>
    <div id="scoreBox" class="score-box" style="display:none;"></div>
    <script>
    var I18N = ${JSON.stringify(i18n)};
    var CARD_LIST = ${JSON.stringify(quizCards).replace(/</g, "\\u003c")};
    var CARD_META = {};
    for (var ci = 0; ci < CARD_LIST.length; ci++) { CARD_META[CARD_LIST[ci].card_id] = CARD_LIST[ci]; }
    var PASS_THRESHOLD = 100;

    function selectOpt(btn) {
        var q = btn.closest('.q');
        var opts = q.querySelectorAll('.opt');
        for (var i = 0; i < opts.length; i++) { opts[i].classList.remove('selected'); }
        btn.classList.add('selected');
        q.dataset.selected = btn.textContent.trim();
        gradeQuestion(q);
    }

    var currentAudio = null;
    function qtSpeak(btn) {
        var rawText = btn.getAttribute('data-tts-text');
        var lang = btn.getAttribute('data-tts-lang') || 'en';
        if (!rawText) return;

        // Replace underscores with a natural short pause for TTS
        var speechText = rawText
            .replace(/_{1,}/g, ' , ')
            .replace(/\\s+/g, ' ')
            .trim();

        if (!speechText) return;

        if (currentAudio) {
            try { currentAudio.pause(); } catch (e) {}
            var prevLoading = document.querySelectorAll('.tts-btn.tts-loading');
            for (var p = 0; p < prevLoading.length; p++) { prevLoading[p].classList.remove('tts-loading'); }
        }

        btn.classList.add('tts-loading');
        var url = 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=' + encodeURIComponent(lang) + '&q=' + encodeURIComponent(speechText);
        var audio = new Audio(url);
        audio.playbackRate = 1.1;
        audio.defaultPlaybackRate = 1.1;
        currentAudio = audio;

        var stop = function () {
            btn.classList.remove('tts-loading');
            if (currentAudio === audio) currentAudio = null;
        };
        audio.addEventListener('ended', stop);
        audio.addEventListener('error', function () {
            if (typeof window !== 'undefined' && window.speechSynthesis) {
                try {
                    var utter = new SpeechSynthesisUtterance(speechText);
                    utter.lang = lang;
                    utter.rate = 1.0;
                    utter.onend = stop;
                    utter.onerror = stop;
                    window.speechSynthesis.speak(utter);
                    return;
                } catch (e) {}
            }
            stop();
        });
        var playPromise = audio.play();
        if (playPromise !== undefined) {
            playPromise.then(function () {
                audio.playbackRate = 1.1;
            }).catch(function () {
                if (typeof window !== 'undefined' && window.speechSynthesis) {
                    try {
                        var utter = new SpeechSynthesisUtterance(speechText);
                        utter.lang = lang;
                        utter.rate = 1.0;
                        utter.onend = stop;
                        utter.onerror = stop;
                        window.speechSynthesis.speak(utter);
                        return;
                    } catch (e) {}
                }
                stop();
            });
        }
    }

    function expandContractions(str) {
        if (!str) return '';
        var s = str.toString().toLowerCase()
            .replace(/[’‘\x60]/g, "'")
            .replace(/\\bcan['’]?t\\b/g, 'cannot')
            .replace(/\\bwon['’]?t\\b/g, 'will not')
            .replace(/\\bain['’]?t\\b/g, 'is not')
            .replace(/\\bshan['’]?t\\b/g, 'shall not')
            .replace(/\\blet['’]?s\\b/g, 'let us')
            .replace(/\\bdon['’]?t\\b/g, 'do not')
            .replace(/\\bdoesn['’]?t\\b/g, 'does not')
            .replace(/\\bdidn['’]?t\\b/g, 'did not')
            .replace(/\\bcouldn['’]?t\\b/g, 'could not')
            .replace(/\\bwouldn['’]?t\\b/g, 'would not')
            .replace(/\\bshouldn['’]?t\\b/g, 'should not')
            .replace(/\\bhasn['’]?t\\b/g, 'has not')
            .replace(/\\bhaven['’]?t\\b/g, 'have not')
            .replace(/\\bhadn['’]?t\\b/g, 'had not')
            .replace(/\\bisn['’]?t\\b/g, 'is not')
            .replace(/\\baren['’]?t\\b/g, 'are not')
            .replace(/\\bwasn['’]?t\\b/g, 'was not')
            .replace(/\\bweren['’]?t\\b/g, 'were not')
            .replace(/\\b(i)['’]?m\\b/g, '$1 am')
            .replace(/\\b(you|we|they)['’]?re\\b/g, '$1 are')
            .replace(/\\b(i|you|he|she|it|we|they)['’]?ve\\b/g, '$1 have')
            .replace(/\\b(i|you|he|she|it|we|they)['’]?ll\\b/g, '$1 will')
            .replace(/\\b(i|you|he|she|it|we|they)['’]?d\\b/g, '$1 would')
            .replace(/\\b(it|he|she|what|there|that|here|who)['’]?s\\b/g, '$1 is')
            .replace(/n['’]t\\b/g, ' not')
            .replace(/\\bgon['’]?na\\b/g, 'going to')
            .replace(/\\bgon['’](?=\\s|$)/g, 'going to')
            .replace(/\\bwan['’]?na\\b/g, 'want to')
            .replace(/\\bgot['’]?ta\\b/g, 'got to')
            .replace(/\\bkinda\\b/g, 'kind of');
        return s;
    }

    function cleanForMatching(str) {
        if (!str) return '';
        var s = expandContractions(str);
        // Remove apostrophes so "don't" and "dont" normalize identically
        s = s.replace(/['’‘\\x60]/g, '');
        // Strip all punctuation, quotes, dashes, brackets, etc.
        s = s.replace(/[.,\\/#!$%\\^&\\*;:{}=\\-_~()?\"'„”«»—–]/g, ' ');
        return s.replace(/\\s+/g, ' ').trim();
    }

    function normalize(s) {
        return (s || '').toString().normalize('NFC').toLowerCase()
            .replace(/['\u2019\u2018]/g, "'")
            .replace(/\\s+/g, ' ').trim()
            .replace(/[.!?]+$/g, '').trim();
    }

    function escapeHtmlClient(s) {
        return (s || '').toString()
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function levenshteinMatrix(a, b) {
        var m = a.length, n = b.length;
        var d = [];
        for (var i = 0; i <= m; i++) d[i] = [i];
        for (var j = 0; j <= n; j++) d[0][j] = j;
        for (var i2 = 1; i2 <= m; i2++) {
            for (var j2 = 1; j2 <= n; j2++) {
                var cost = a[i2 - 1] === b[j2 - 1] ? 0 : 1;
                d[i2][j2] = Math.min(
                    d[i2 - 1][j2] + 1,
                    d[i2][j2 - 1] + 1,
                    d[i2 - 1][j2 - 1] + cost
                );
            }
        }
        return d;
    }

    function checkTokenSequence(aWords, bWords) {
        var shortW = aWords.length <= bWords.length ? aWords : bWords;
        var longW = aWords.length <= bWords.length ? bWords : aWords;
        var matched = 0;
        var j = 0;
        for (var i = 0; i < shortW.length; i++) {
            while (j < longW.length && longW[j] !== shortW[i]) {
                j++;
            }
            if (j < longW.length && longW[j] === shortW[i]) {
                matched++;
                j++;
            }
        }
        return matched / longW.length;
    }

    function singleMatchPercent(userVal, answer) {
        if (!userVal || !answer) return 0;
        var rawUser = (userVal || '').toString().trim().toLowerCase();
        var rawAns = (answer || '').toString().trim().toLowerCase();
        if (rawUser === rawAns) return 100;

        var a = cleanForMatching(userVal);
        var b = cleanForMatching(answer);
        if (a === b) return 100;
        if (!a || !b) return 0;

        // 1. Subphrase containment: user typed a full sentence containing the expected target phrase
        if (a.indexOf(b) !== -1 && b.length >= 3) {
            return 95;
        }

        // 2. Inverse containment: user typed the core target phrase of a full target sentence
        if (b.indexOf(a) !== -1 && a.length >= 6) {
            return 88;
        }

        var aWords = a.split(' ').filter(Boolean);
        var bWords = b.split(' ').filter(Boolean);

        // 3. Word-level comparison with minor typo tolerance
        if (aWords.length >= 2 && bWords.length >= 2 && aWords.length === bWords.length) {
            var diffCount = 0;
            for (var w = 0; w < aWords.length; w++) {
                if (aWords[w] !== bWords[w]) {
                    var wd = levenshteinMatrix(aWords[w], bWords[w]);
                    var wDist = wd[aWords[w].length][bWords[w].length];
                    if (wDist === 1 && Math.min(aWords[w].length, bWords[w].length) >= 4) {
                        diffCount += 0.5;
                    } else if (wDist === 1) {
                        diffCount += 1;
                    } else {
                        diffCount += 2;
                    }
                }
            }
            if (diffCount === 0) return 100;
            if (diffCount <= 0.5) return 96;
            if (diffCount === 1) return 92;
            if (diffCount <= 1.5) return 88;
        }

        // 4. Token sequence ratio
        if (aWords.length >= 2 && bWords.length >= 2) {
            var seqRatio = checkTokenSequence(aWords, bWords);
            if (seqRatio >= 0.75) {
                return Math.max(88, Math.round(seqRatio * 100));
            }
        }

        var maxLen = Math.max(a.length, b.length);
        if (maxLen === 0) return 100;
        var d = levenshteinMatrix(a, b);
        var dist = d[a.length][b.length];
        var pct = Math.max(0, Math.round((1 - dist / maxLen) * 100));

        if (b.startsWith(a) && a.length / b.length >= 0.85) {
            pct = Math.max(pct, 90);
        }

        return pct;
    }

    function matchPercentWithBest(userVal, answer, alternatives) {
        var candidates = [answer];
        if (Array.isArray(alternatives)) {
            for (var i = 0; i < alternatives.length; i++) {
                if (alternatives[i] && candidates.indexOf(alternatives[i]) === -1) {
                    candidates.push(alternatives[i]);
                }
            }
        }
        var bestPct = 0;
        var bestAns = answer;
        for (var c = 0; c < candidates.length; c++) {
            var s = singleMatchPercent(userVal, candidates[c]);
            if (s > bestPct) {
                bestPct = s;
                bestAns = candidates[c];
            }
            if (bestPct === 100) break;
        }
        return { pct: bestPct, bestAnswer: bestAns };
    }

    function diffAnswerHtml(userVal, answer) {
        var a = (userVal || '').toString();
        var b = (answer || '').toString();
        var al = a.toLowerCase(), bl = b.toLowerCase();
        var d = levenshteinMatrix(al, bl);
        var i = al.length, j = bl.length;
        var marks = [];
        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && al[i - 1] === bl[j - 1] && d[i][j] === d[i - 1][j - 1]) {
                marks.push({ ch: b[j - 1], ok: true }); i--; j--;
            } else if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + 1) {
                marks.push({ ch: b[j - 1], ok: false }); i--; j--;
            } else if (j > 0 && d[i][j] === d[i][j - 1] + 1) {
                marks.push({ ch: b[j - 1], ok: false }); j--;
            } else {
                i--;
            }
        }
        marks.reverse();
        var html = '';
        for (var k = 0; k < marks.length; k++) {
            html += '<span class="' + (marks[k].ok ? 'diff-ok' : 'diff-bad') + '">' + escapeHtmlClient(marks[k].ch) + '</span>';
        }
        return html;
    }

    var answeredIds = {};
    var currentStreak = 0;
    var liveScore = 0;
    var answerEventCount = 0;
    var reviewQueue = [];
    var reviewSerial = 0;
    var masteryState = {};
    var PRAISE = I18N.praise || ['Great! 🎉'];
    var ENCOURAGE = I18N.encourage || ['Try again! 💭'];

    function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
    function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

    for (var mi = 0; mi < CARD_LIST.length; mi++) {
        var mc = CARD_LIST[mi];
        var saved = mc.mastery || {};
        masteryState[mc.card_id] = {
            score: clamp(Number(saved.score) || 0, 0, 100),
            recallWins: Math.max(0, Number(saved.recallWins) || 0),
            contextWins: Math.max(0, Number(saved.contextWins) || 0),
            wrongs: Math.max(0, Number(saved.wrongs) || 0),
            lastReviewed: Number(saved.lastReviewed) || 0,
            nextReview: Number(saved.nextReview) || 0
        };
    }

    function masteryStatus(rec) {
        if (rec.score >= 80 && rec.recallWins >= 2) return I18N.masteryMastered || 'Mastered';
        if (rec.score >= 55) return I18N.masteryAlmost || 'Almost there';
        if (rec.score >= 25) return I18N.masteryLearning || 'Learning';
        return I18N.masteryWeak || 'Needs work';
    }

    function renderMastery() {
        var grid = document.getElementById('masteryGrid');
        if (!grid) return;
        var html = '';
        for (var i = 0; i < CARD_LIST.length; i++) {
            var card = CARD_LIST[i];
            var rec = masteryState[card.card_id] || { score: 0, recallWins: 0 };
            html += '<div class="mastery-row">' +
                '<span class="mastery-term" title="' + escapeHtmlClient(card.term || '') + '">' + escapeHtmlClient(card.term || '') + '</span>' +
                '<span class="mastery-track"><span class="mastery-fill" style="display:block;width:' + clamp(rec.score, 0, 100) + '%"></span></span>' +
                '<span class="mastery-status">' + Math.round(rec.score) + '% · ' + escapeHtmlClient(masteryStatus(rec)) + '</span>' +
                '</div>';
        }
        grid.innerHTML = html;
    }

    function persistMastery(cardId) {
        var rec = masteryState[cardId];
        if (!cardId || !rec) return;
        try {
            window.parent.postMessage({
                action: 'QUIZ_MASTERY_UPDATE',
                card_id: cardId,
                mastery: rec
            }, '*');
        } catch (_) {}
    }

    function applyMastery(q, isCorrect) {
        if (!q || q.dataset.masteryRegistered === '1') return;
        var cardId = q.dataset.cardId || '';
        if (!cardId || !masteryState[cardId]) return;
        var rec = masteryState[cardId];
        var kind = q.dataset.learningKind || '';
        var hints = Math.max(0, Number(q.dataset.hintsUsed) || 0);
        var weights = {
            recall: 22,
            context_recall: 18,
            recall_review: 24,
            multiple_choice: 5,
            matching: 3,
            correct_form: 8,
            true_false: 2,
            odd_one_out: 2
        };
        if (isCorrect) {
            var factor = hints === 0 ? 1 : hints === 1 ? 0.65 : hints === 2 ? 0.35 : 0.1;
            rec.score = clamp(rec.score + Math.round((weights[kind] || 4) * factor), 0, 100);
            if ((kind === 'recall' || kind === 'recall_review') && hints === 0) rec.recallWins++;
            if (kind === 'context_recall' && hints === 0) rec.contextWins++;
        } else {
            rec.score = clamp(rec.score - 12, 0, 100);
            rec.wrongs++;
        }
        rec.lastReviewed = Date.now();
        var interval = rec.score >= 80 && rec.recallWins >= 2
            ? 7 * 24 * 60 * 60 * 1000
            : rec.score >= 55
              ? 2 * 24 * 60 * 60 * 1000
              : 12 * 60 * 60 * 1000;
        rec.nextReview = rec.lastReviewed + interval;
        q.dataset.masteryRegistered = '1';
        persistMastery(cardId);
        renderMastery();
    }

    function maskAnswer(answer, level) {
        var words = (answer || '').split(/(\s+)/);
        return words.map(function(part) {
            if (/^\s+$/.test(part)) return part;
            if (!part) return part;
            if (level >= 3) return part;
            var visible = level === 1 ? 1 : Math.max(1, Math.ceil(part.length / 2));
            return part.slice(0, visible) + Array(Math.max(0, part.length - visible) + 1).join('_');
        }).join('');
    }

    function showMemoryHint(q) {
        if (!q) return;
        var level = Math.min(3, (Number(q.dataset.hintsUsed) || 0) + 1);
        q.dataset.hintsUsed = String(level);
        var out = q.querySelector('.memory-hint');
        if (out) out.textContent = maskAnswer(q.dataset.answer || '', level);
    }

    function dontKnow(q) {
        if (!q) return;
        gradeQuestion(q, false, true);
    }

    function scheduleReview(cardId, q) {
        if (!cardId || !CARD_META[cardId]) return;
        for (var i = 0; i < reviewQueue.length; i++) {
            if (reviewQueue[i].cardId === cardId) return;
        }
        var delay = q && q.dataset.learningKind === 'recall_review' ? 2 : 3;
        reviewQueue.push({ cardId: cardId, dueAt: answerEventCount + delay });
    }

    function appendReviewQuestion(cardId) {
        var card = CARD_META[cardId];
        var container = document.getElementById('reviewContainer');
        var section = document.getElementById('reviewSection');
        if (!card || !container || !section) return;
        reviewSerial++;
        var q = document.createElement('div');
        q.className = 'q active-recall review-card';
        q.dataset.qtype = 'text';
        q.dataset.qid = 'review_' + cardId + '_' + reviewSerial;
        q.dataset.points = '0';
        q.dataset.answer = card.term || '';
        q.dataset.alternatives = '[]';
        q.dataset.cardId = cardId;
        q.dataset.learningKind = 'recall_review';
        q.dataset.reviewPrompt = card.meaning || '';
        q.innerHTML =
            '<div class="q-text-row"><p class="q-text"><b>↻</b> ' + escapeHtmlClient(card.meaning || '') +
            ' <span class="review-chip">' + escapeHtmlClient(I18N.reviewReady || 'Review ready') + '</span></p></div>' +
            '<div class="input-row"><input type="text" class="q-input" autocomplete="off" spellcheck="false" placeholder="' + escapeHtmlClient(I18N.yourAnswerPlaceholder || 'Your answer') + '">' +
            '<button type="button" class="btn-mini">✓</button></div>' +
            '<div class="memory-actions"><button type="button" class="btn-memory review-hint">💡 ' + escapeHtmlClient(I18N.hint || 'hint') + '</button>' +
            '<button type="button" class="btn-memory btn-dontknow review-dont">' + escapeHtmlClient(I18N.dontKnow || "I don't remember") + '</button>' +
            '<span class="memory-hint"></span></div>' +
            '<div class="q-match-bar"><div class="q-match-fill"></div><span class="q-match-label"></span></div><div class="q-feedback"></div>';
        var input = q.querySelector('.q-input');
        var check = q.querySelector('.btn-mini');
        var hint = q.querySelector('.review-hint');
        var dont = q.querySelector('.review-dont');
        if (input) input.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); gradeQuestion(q); } });
        if (check) check.addEventListener('click', function() { gradeQuestion(q); });
        if (hint) hint.addEventListener('click', function() { showMemoryHint(q); });
        if (dont) dont.addEventListener('click', function() { dontKnow(q); });
        container.appendChild(q);
        section.style.display = 'block';
        var count = document.getElementById('reviewCount');
        if (count) count.textContent = container.querySelectorAll('.q').length;
        updateProgress();
    }

    function processReviewQueue(force) {
        if (!reviewQueue.length) return;
        var due = [];
        var later = [];
        for (var i = 0; i < reviewQueue.length; i++) {
            if (force || reviewQueue[i].dueAt <= answerEventCount) due.push(reviewQueue[i]);
            else later.push(reviewQueue[i]);
        }
        reviewQueue = later;
        for (var j = 0; j < due.length; j++) appendReviewQuestion(due[j].cardId);
    }

    function flushReviewQueue() { processReviewQueue(true); }

    function playTone(freq, duration) {
        try {
            var ctx = playTone._ctx || (playTone._ctx = new (window.AudioContext || window.webkitAudioContext)());
            var osc = ctx.createOscillator();
            var gain = ctx.createGain();
            osc.frequency.value = freq;
            osc.type = 'sine';
            gain.gain.setValueAtTime(0.14, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + duration);
        } catch (e) {}
    }

    function updateProgress(qid) {
        if (qid) answeredIds[qid] = true;
        var bar = document.getElementById('progressBar');
        var label = document.getElementById('progressLabel');
        var totalQuestions = document.querySelectorAll('.q').length;
        if (!bar || !label || !totalQuestions) return;
        var answered = Object.keys(answeredIds).length;
        var pct = Math.round((answered / totalQuestions) * 100);
        bar.style.width = Math.min(100, pct) + '%';
        label.textContent = (I18N.answered || 'Answered') + ': ' + answered + ' / ' + totalQuestions;
    }

    function updateHUD() {
        var numEl = document.getElementById('hudScoreNum');
        var wrap = document.getElementById('hudScore');
        if (numEl) numEl.textContent = liveScore;
        if (wrap) { wrap.classList.remove('bump'); void wrap.offsetWidth; wrap.classList.add('bump'); }
        var streakEl = document.getElementById('hudStreak');
        if (streakEl) {
            if (currentStreak >= 1) {
                streakEl.textContent = '🔥 ' + (I18N.streak || 'Streak') + ': ' + currentStreak;
                streakEl.classList.add('show');
            } else {
                streakEl.classList.remove('show');
            }
        }
    }

    renderMastery();

    function spawnParticles(x, y, count) {
        var emojis = ['🎉', '✨', '⭐', '💥', '🔥', '👏', '🌟', '💫'];
        count = count || 14;
        for (var i = 0; i < count; i++) {
            (function () {
                var el = document.createElement('div');
                el.className = 'particle';
                el.textContent = emojis[Math.floor(Math.random() * emojis.length)];
                var angle = Math.random() * Math.PI * 2;
                var dist = 60 + Math.random() * 100;
                el.style.setProperty('--dx', (Math.cos(angle) * dist) + 'px');
                el.style.setProperty('--dy', (Math.sin(angle) * dist - 30) + 'px');
                el.style.setProperty('--rot', (Math.random() * 360 - 180) + 'deg');
                el.style.left = x + 'px';
                el.style.top = y + 'px';
                document.body.appendChild(el);
                setTimeout(function () { el.remove(); }, 950);
            })();
        }
    }

    function floatPoints(x, y, pts) {
        var el = document.createElement('div');
        el.className = 'point-popup';
        el.textContent = '+' + pts + ' ' + (I18N.pointsSuffix || 'pts');
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        document.body.appendChild(el);
        setTimeout(function () { el.remove(); }, 1050);
    }

    function showComboBanner(text) {
        var el = document.createElement('div');
        el.className = 'combo-banner';
        el.textContent = text;
        document.body.appendChild(el);
        setTimeout(function () { el.remove(); }, 1250);
    }

    function celebrateCorrect(q, pts) {
        var rect = q.getBoundingClientRect();
        var x = rect.left + rect.width / 2;
        spawnParticles(x, rect.top + Math.min(30, rect.height / 2), 16);
        floatPoints(x, rect.top, pts);
        q.classList.remove('pop-correct');
        void q.offsetWidth;
        q.classList.add('pop-correct');
    }

    function shakeWrong(q) {
        q.classList.remove('shake-wrong');
        void q.offsetWidth;
        q.classList.add('shake-wrong');
    }

    function updateStreak(isCorrect) {
        var badge = document.getElementById('streakBadge');
        if (isCorrect) {
            currentStreak++;
            if (badge && currentStreak >= 3) {
                badge.classList.remove('show');
                void badge.offsetWidth;
                badge.textContent = '🔥 ' + (I18N.streak || 'Streak') + ': ' + currentStreak + ' ' + (I18N.streakInRow || 'in a row!');
                badge.classList.add('show');
            }
            if (currentStreak === 3 || (currentStreak >= 5 && currentStreak % 5 === 0)) {
                showComboBanner('🔥 COMBO x' + currentStreak + '! 🔥');
                spawnParticles(window.innerWidth / 2, window.innerHeight / 2, 28);
                playTone(1050, 0.22);
            }
        } else {
            currentStreak = 0;
            if (badge) badge.classList.remove('show');
        }
    }

    function launchConfetti() {
        var colors = ['#0d9488', '#06b6d4', '#10b981', '#f59e0b', '#3b82f6', '#14b8a6'];
        for (var i = 0; i < 70; i++) {
            (function () {
                var el = document.createElement('div');
                el.className = 'confetti-piece';
                el.style.left = (Math.random() * 100) + 'vw';
                el.style.background = colors[Math.floor(Math.random() * colors.length)];
                el.style.animationDuration = (2 + Math.random() * 1.5) + 's';
                el.style.animationDelay = (Math.random() * 0.4) + 's';
                document.body.appendChild(el);
                setTimeout(function () { el.remove(); }, 4200);
            })();
        }
    }

    function questionPoints(q) {
        var n = parseFloat(q && q.dataset ? q.dataset.points : '');
        return Number.isFinite(n) ? n : 1;
    }

    function gradeQuestion(q, silent, forceWrong) {
        if (!q) return false;
        var type = q.dataset.qtype;
        var answer = q.dataset.answer || '';
        var rawAlts = q.dataset.alternatives;
        var alternatives = [];
        if (rawAlts) {
            try { alternatives = JSON.parse(rawAlts); } catch (_) {}
        }
        var userVal = '';
        if (type === 'choice') {
            userVal = q.dataset.selected || '';
        } else if (type === 'text') {
            var input = q.querySelector('.q-input');
            userVal = input ? input.value : '';
        } else if (type === 'select') {
            var sel = q.querySelector('.q-select');
            userVal = sel ? sel.value : '';
        }
        if (!userVal && !forceWrong) return false;

        var pct = null;
        var isCorrect = false;
        var bestAnswer = answer;
        if (type === 'text') {
            var matchRes = matchPercentWithBest(userVal, answer, alternatives);
            pct = forceWrong ? 0 : matchRes.pct;
            bestAnswer = matchRes.bestAnswer;
            isCorrect = !forceWrong && [answer].concat(alternatives).some(function(candidate) {
                return normalize(userVal) === normalize(candidate);
            });
            pct = isCorrect ? 100 : Math.min(pct, 99);
        } else {
            isCorrect = !forceWrong && normalize(userVal) === normalize(answer);
            if (!isCorrect && !forceWrong && alternatives.length > 0) {
                for (var aIdx = 0; aIdx < alternatives.length; aIdx++) {
                    if (normalize(userVal) === normalize(alternatives[aIdx])) {
                        isCorrect = true;
                        bestAnswer = alternatives[aIdx];
                        break;
                    }
                }
            }
        }

        var pts = questionPoints(q);
        var wasCorrect = q.dataset.wasCorrect === '1';
        q.classList.remove('correct', 'incorrect');
        q.classList.add(isCorrect ? 'correct' : 'incorrect');

        var fb = q.querySelector('.q-feedback');
        if (fb) {
            var pctSuffix = pct !== null ? (' (' + (I18N.similarity || 'similarity') + ': ' + pct + '%)') : '';
            if (type === 'text') {
                if (isCorrect) {
                    fb.innerHTML = '✓ ' + escapeHtmlClient(pick(PRAISE)) + pctSuffix;
                } else if (forceWrong || !userVal) {
                    fb.innerHTML = '✗ ' + escapeHtmlClient(I18N.dontKnow || I18N.noAnswer || 'No answer') +
                        '<br><span class="fb-answer-label">' + (I18N.correctLabel || 'Correct answer') + ':</span> <span class="fb-answer-diff">' + escapeHtmlClient(bestAnswer) + '</span>';
                } else {
                    var diffHtml = diffAnswerHtml(userVal, bestAnswer);
                    fb.innerHTML = '✗ ' + escapeHtmlClient(pick(ENCOURAGE)) + pctSuffix +
                        '<br><span class="fb-answer-label">' + (I18N.correctLabel || 'Correct answer') + ':</span> <span class="fb-answer-diff">' + diffHtml + '</span>';
                }
            } else if (isCorrect) {
                fb.innerHTML = '✓ ' + escapeHtmlClient(pick(PRAISE));
            } else {
                fb.innerHTML = '✗ ' + escapeHtmlClient(pick(ENCOURAGE)) + ' — <span class="fb-answer-label">' + (I18N.correctLabel || 'Correct answer') + ':</span> ' + escapeHtmlClient(bestAnswer);
            }
        }

        if (pct !== null) {
            var matchBar = q.querySelector('.q-match-bar');
            var matchFill = q.querySelector('.q-match-fill');
            var matchLabel = q.querySelector('.q-match-label');
            if (matchBar && matchFill && matchLabel) {
                matchBar.style.display = 'block';
                matchFill.style.width = pct + '%';
                matchFill.classList.toggle('low', pct < PASS_THRESHOLD);
                matchLabel.textContent = pct + '% ' + (I18N.similarity || 'similarity') + (isCorrect ? ' ✓ ' + (I18N.passed || 'passed') : '');
            }
        }

        if (type === 'choice') {
            var opts = q.querySelectorAll('.opt');
            for (var i = 0; i < opts.length; i++) {
                opts[i].classList.remove('opt-correct', 'opt-incorrect');
                var optText = opts[i].textContent.trim();
                if (optText === userVal) opts[i].classList.add(isCorrect ? 'opt-correct' : 'opt-incorrect');
                else if (!isCorrect && normalize(optText) === normalize(answer)) opts[i].classList.add('opt-correct');
            }
        }

        updateProgress(q.dataset.qid);
        applyMastery(q, isCorrect);

        var cardId = q.dataset.cardId || '';
        var hintsUsed = Number(q.dataset.hintsUsed) || 0;
        if (!isCorrect || (isCorrect && hintsUsed >= 3)) scheduleReview(cardId, q);

        if (!silent) {
            if (q.dataset.eventCounted !== '1') {
                answerEventCount++;
                q.dataset.eventCounted = '1';
            }
            playTone(isCorrect ? 880 : 220, isCorrect ? 0.16 : 0.28);
            updateStreak(isCorrect);
            if (isCorrect && !wasCorrect && pts > 0) {
                celebrateCorrect(q, pts);
            } else if (!isCorrect) {
                shakeWrong(q);
            }
        }

        if (isCorrect && !wasCorrect) {
            liveScore += pts;
            q.dataset.wasCorrect = '1';
        } else if (!isCorrect && wasCorrect) {
            liveScore = Math.max(0, liveScore - pts);
            q.dataset.wasCorrect = '0';
        }

        updateHUD();
        if (!silent) processReviewQueue(false);
        return isCorrect;
    }

    function checkAllAnswers() {
        var qs = document.querySelectorAll('.q');
        var totalPoints = 0, earnedPoints = 0;
        for (var i = 0; i < qs.length; i++) {
            var pts = questionPoints(qs[i]);
            totalPoints += pts;
            var input = qs[i].querySelector('.q-input, .q-select');
            var hasAnswer = qs[i].dataset.qtype === 'choice'
                ? !!qs[i].dataset.selected
                : !!(input && input.value);
            if (!hasAnswer) {
                qs[i].classList.remove('correct');
                qs[i].classList.add('incorrect');
                var fb2 = qs[i].querySelector('.q-feedback');
                if (fb2) fb2.textContent = '✗ ' + (I18N.noAnswer || 'No answer') + ' — ' + (I18N.correctLabel || 'Correct answer') + ': ' + qs[i].dataset.answer;
                updateProgress(qs[i].dataset.qid);
                applyMastery(qs[i], false);
                scheduleReview(qs[i].dataset.cardId || '', qs[i]);
                continue;
            }
            if (gradeQuestion(qs[i], true, false)) earnedPoints += pts;
        }
        flushReviewQueue();
        var box = document.getElementById('scoreBox');
        var pct = totalPoints ? Math.round((earnedPoints / totalPoints) * 100) : 0;
        var gradeName = I18N.grades[pct >= 95 ? 6 : pct >= 85 ? 5 : pct >= 70 ? 4 : pct >= 55 ? 3 : pct >= 40 ? 2 : 1];
        var reviewCount = document.querySelectorAll('#reviewContainer .q').length;
        box.style.display = 'block';
        box.textContent = (I18N.result || 'Result') + ': ' + earnedPoints + ' / ' + totalPoints + ' ' + (I18N.pointsSuffix || 'pts') + ' (' + pct + '%) — ' + (I18N.grade || 'Grade') + ': ' + gradeName +
            (reviewCount ? ' • ↻ ' + (I18N.reviewTitle || 'Mistake Review') + ': ' + reviewCount : '');
        box.className = 'score-box ' + (pct >= 70 ? 'good' : pct >= 40 ? 'mid' : 'bad');
        box.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (pct >= 70 && reviewCount === 0) launchConfetti();
    }

    function resetQuiz() {
        var reviewContainer = document.getElementById('reviewContainer');
        if (reviewContainer) reviewContainer.innerHTML = '';
        var reviewSection = document.getElementById('reviewSection');
        if (reviewSection) reviewSection.style.display = 'none';
        var reviewCount = document.getElementById('reviewCount');
        if (reviewCount) reviewCount.textContent = '0';
        reviewQueue = [];
        reviewSerial = 0;
        answerEventCount = 0;

        var opts = document.querySelectorAll('.opt');
        for (var i = 0; i < opts.length; i++) { opts[i].classList.remove('selected', 'opt-correct', 'opt-incorrect'); }
        var inputs = document.querySelectorAll('.q-input');
        for (var j = 0; j < inputs.length; j++) { inputs[j].value = ''; }
        var selects = document.querySelectorAll('.q-select');
        for (var k = 0; k < selects.length; k++) { selects[k].value = ''; }
        var qs = document.querySelectorAll('.q');
        for (var m = 0; m < qs.length; m++) {
            qs[m].classList.remove('correct', 'incorrect', 'pop-correct', 'shake-wrong');
            qs[m].dataset.selected = '';
            qs[m].dataset.wasCorrect = '';
            qs[m].dataset.masteryRegistered = '';
            qs[m].dataset.eventCounted = '';
            qs[m].dataset.hintsUsed = '';
            var fb = qs[m].querySelector('.q-feedback');
            if (fb) fb.textContent = '';
            var hintOut = qs[m].querySelector('.memory-hint');
            if (hintOut) hintOut.textContent = '';
            var matchBar = qs[m].querySelector('.q-match-bar');
            if (matchBar) matchBar.style.display = 'none';
            var matchFill = qs[m].querySelector('.q-match-fill');
            if (matchFill) { matchFill.style.width = '0%'; matchFill.classList.remove('low'); }
            var matchLabel = qs[m].querySelector('.q-match-label');
            if (matchLabel) matchLabel.textContent = '';
        }
        var scoreBox = document.getElementById('scoreBox');
        if (scoreBox) scoreBox.style.display = 'none';
        answeredIds = {};
        currentStreak = 0;
        liveScore = 0;
        updateHUD();
        var streakBadge = document.getElementById('streakBadge');
        if (streakBadge) streakBadge.classList.remove('show');
        updateProgress();
        renderMastery();
    }
    </script>
</body>
</html>`;
    }

    // ── 5. High-Level Export Orchestrator ──────────────────────────────
    async function loadQuizMasteryStore() {
        if (
            typeof chrome === "undefined" ||
            !chrome.storage?.local
        ) {
            return {};
        }
        try {
            return await new Promise((resolve) => {
                chrome.storage.local.get(["quizMasteryV2"], (data) => {
                    resolve(data?.quizMasteryV2 && typeof data.quizMasteryV2 === "object"
                        ? data.quizMasteryV2
                        : {});
                });
            });
        } catch (_) {
            return {};
        }
    }

    async function runExport({
        words,
        scope = "5",
        source = "smart",
        mode = "interactive",
        targetLang = "en",
    }) {
        if (!words || !words.length) {
            throw new Error("No words available to generate quiz.");
        }

        const sorted = [...words].sort(
            (a, b) => (b.timestamp || 0) - (a.timestamp || 0),
        );
        const count = Math.min(Math.max(1, parseInt(scope, 10) || 5), 25);
        const masteryStore = await loadQuizMasteryStore();
        const quizWords = pickQuizWords(sorted, count, source, masteryStore);

        const quiz = await generateQuizWithGemini(quizWords, {
            tgtLang: targetLang,
        });
        quiz.cards = (quiz.cards || []).map((card) => ({
            ...card,
            mastery: masteryStore[card.card_id] || null,
        }));
        const html =
            mode === "interactive"
                ? buildInteractiveQuizHtml(quiz, quizWords, {
                      tgtLang: targetLang,
                  })
                : buildQuizHtml(quiz, quizWords, { tgtLang: targetLang });

        if (
            typeof chrome !== "undefined" &&
            chrome.storage &&
            chrome.storage.local
        ) {
            await new Promise((resolve) => {
                chrome.storage.local.set(
                    {
                        latestQuizHtml: html,
                        latestQuizTitle: quiz.title || "Lectoro_Quiz",
                        latestQuizMode: mode,
                        latestQuizDate: Date.now(),
                    },
                    resolve,
                );
            });
        }

        if (typeof chrome !== "undefined" && chrome.tabs?.create) {
            const quizUrl = chrome.runtime.getURL("quiz.html");
            chrome.tabs.create({ url: quizUrl });
        } else if (typeof window !== "undefined") {
            const blob = new Blob([html], { type: "text/html;charset=utf-8" });
            const blobUrl = URL.createObjectURL(blob);
            window.open(blobUrl, "_blank");
        }
        return { quizWords, count: quizWords.length };
    }

    // Expose API
    const QuizExport = {
        generateQuizWithGemini,
        normalizeQuizData,
        buildQuizHtml,
        buildInteractiveQuizHtml,
        pickQuizWords,
        makeQuizCardId,
        loadQuizMasteryStore,
        runExport,
        getI18n,
        getExamTitle,
    };

    if (typeof window !== "undefined") {
        window.QuizExport = QuizExport;
    }
    if (typeof module !== "undefined" && module.exports) {
        module.exports = QuizExport;
    }
})(typeof globalThis !== "undefined" ? globalThis : this);
