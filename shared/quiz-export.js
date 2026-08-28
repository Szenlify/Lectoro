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
        if (typeof LectoroConstants !== "undefined" && typeof LectoroConstants.getLanguageName === "function") {
            return LectoroConstants.getLanguageName(code);
        }
        if (typeof AIPrompts !== "undefined" && typeof AIPrompts.getLangName === "function") {
            return AIPrompts.getLangName(code);
        }
        const c = String(code || "").toLowerCase();
        return (typeof LectoroConstants !== "undefined" && LectoroConstants.LANG_NAMES?.[c]) || c.toUpperCase();
    }

    // Polish adjectives & genitives for Polish exam headings
    const QUIZ_LANG_ADJ_PL = {
        en: "angielskiego",
        es: "hiszpańskiego",
        de: "niemieckiego",
        fr: "francuskiego",
        it: "włoskiego",
        pt: "portugalskiego",
        ru: "rosyjskiego",
        pl: "polskiego",
        uk: "ukraińskiego",
        ja: "japońskiego",
        ko: "koreańskiego",
        zh: "chińskiego",
        nl: "niderlandzkiego",
        sv: "szwedzkiego",
        tr: "tureckiego",
        cs: "czeskiego",
        sk: "słowackiego",
        ar: "arabskiego",
        hi: "hindi",
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
            praise: ["Świetnie! 🎉", "Brawo! 👏", "Super! ⭐", "Rewelacja! 🚀", "Tak trzymaj! 💪", "Perfekcyjnie! ✨", "Ekstra! 🌟"],
            encourage: ["Prawie! Spróbuj jeszcze raz 💭", "Nie poddawaj się! 🙂", "Blisko! Sprawdź jeszcze raz 🔍", "Ups! 🤔", "Kolejnym razem się uda! 🍀"],
            grades: { 6: "celujący", 5: "bardzo dobry", 4: "dobry", 3: "dostateczny", 2: "dopuszczający", 1: "niedostateczny" },
            sectionTitles: {
                multiple_choice: "Wielokrotny wybór",
                fill_blank: "Uzupełnij luki",
                matching: "Dopasuj pary",
                translation: "Przetłumacz",
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
            praise: ["Excellent! 🎉", "Great job! 👏", "Awesome! ⭐", "Brilliant! 🚀", "Keep it up! 💪", "Flawless! ✨", "Spot on! 🌟"],
            encourage: ["Almost! Try once more 💭", "Keep going! 🙂", "Very close! Check spelling 🔍", "Oops! 🤔", "You'll get it next time! 🍀"],
            grades: { 6: "Outstanding (A+)", 5: "Excellent (A)", 4: "Good (B)", 3: "Satisfactory (C)", 2: "Passing (D)", 1: "Needs Improvement (F)" },
            sectionTitles: {
                multiple_choice: "Multiple Choice",
                fill_blank: "Fill in the Blanks",
                matching: "Match the Pairs",
                translation: "Translate",
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
            praise: ["¡Excelente! 🎉", "¡Muy bien! 👏", "¡Genial! ⭐", "¡Fantástico! 🚀", "¡Sigue así! 💪", "¡Perfecto! ✨", "¡Maravilloso! 🌟"],
            encourage: ["¡Casi! Inténtalo de nuevo 💭", "¡No te rindas! 🙂", "¡Muy cerca! Revisa la ortografía 🔍", "¡Ups! 🤔", "¡A la próxima lo logras! 🍀"],
            grades: { 6: "Sobresaliente", 5: "Notable", 4: "Bien", 3: "Suficiente", 2: "Insuficiente", 1: "Muy deficiente" },
            sectionTitles: {
                multiple_choice: "Opción múltiple",
                fill_blank: "Completa los espacios",
                matching: "Une las parejas",
                translation: "Traduce",
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
            praise: ["Ausgezeichnet! 🎉", "Super gemacht! 👏", "Klasse! ⭐", "Hervorragend! 🚀", "Weiter so! 💪", "Perfekt! ✨", "Spitze! 🌟"],
            encourage: ["Fast! Versuch es noch einmal 💭", "Nicht aufgeben! 🙂", "Ganz nah dran! 🔍", "Hoppla! 🤔", "Beim nächsten Mal klappt es! 🍀"],
            grades: { 6: "Sehr gut (1)", 5: "Gut (2)", 4: "Befriedigend (3)", 3: "Ausreichend (4)", 2: "Mangelhaft (5)", 1: "Ungenügend (6)" },
            sectionTitles: {
                multiple_choice: "Multiple-Choice",
                fill_blank: "Lückentext",
                matching: "Paare zuordnen",
                translation: "Übersetzen",
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
            praise: ["Excellent ! 🎉", "Bravo ! 👏", "Super ! ⭐", "Remarquable ! 🚀", "Continue comme ça ! 💪", "Parfait ! ✨", "Génial ! 🌟"],
            encourage: ["Presque ! Réessaie encore 💭", "Ne lâche rien ! 🙂", "Tout près ! Vérifie l'orthographe 🔍", "Oups ! 🤔", "La prochaine fois sera la bonne ! 🍀"],
            grades: { 6: "Très bien (A+)", 5: "Bien (A)", 4: "Assez bien (B)", 3: "Passable (C)", 2: "Insuffisant (D)", 1: "Très insuffisant (F)" },
            sectionTitles: {
                multiple_choice: "Choix multiple",
                fill_blank: "Texte à trous",
                matching: "Associer les paires",
                translation: "Traduire",
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
            praise: ["Ottimo! 🎉", "Bravissimo! 👏", "Fantastico! ⭐", "Eccellente! 🚀", "Continua così! 💪", "Perfetto! ✨", "Splendido! 🌟"],
            encourage: ["Quasi! Riprova ancora 💭", "Non mollare! 🙂", "Molto vicino! Controlla l'ortografia 🔍", "Ops! 🤔", "La prossima volta andrà bene! 🍀"],
            grades: { 6: "Ottimo", 5: "Distinto", 4: "Buono", 3: "Discreto", 2: "Sufficiente", 1: "Insufficiente" },
            sectionTitles: {
                multiple_choice: "Scelta multipla",
                fill_blank: "Riempi gli spazi",
                matching: "Abbina le coppie",
                translation: "Traduci",
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
            praise: ["Excelente! 🎉", "Muito bem! 👏", "Incrível! ⭐", "Sensacional! 🚀", "Continue assim! 💪", "Perfeito! ✨", "Fantástico! 🌟"],
            encourage: ["Quase! Tente novamente 💭", "Não desista! 🙂", "Muito perto! Verifique a grafia 🔍", "Ops! 🤔", "Na próxima você consegue! 🍀"],
            grades: { 6: "Excelente (A+)", 5: "Muito Bom (A)", 4: "Bom (B)", 3: "Satisfatório (C)", 2: "Regular (D)", 1: "Insuficiente (F)" },
            sectionTitles: {
                multiple_choice: "Múltipla escolha",
                fill_blank: "Preencha as lacunas",
                matching: "Associe os pares",
                translation: "Traduza",
                true_false: "Verdadeiro ou Falso",
                correct_form: "Forma correta da palavra",
                odd_one_out: "Qual não pertence?",
            },
        },
        uk: {
            examTitlePrefix: "Контрольна робота зі словника",
            defaultTitle: "Вікторина зі словникового запасу",
            name: "Прізвище та ім'я",
            class: "Клас / Група",
            date: "Дата",
            tasks: "завдань",
            questions: "питань",
            maxPoints: "Макс. балів",
            score: "Отримано балів",
            grade: "Оцінка",
            answerKey: "Ключ відповідей",
            gradingScale: "Шкала оцінювання",
            pctPoints: "% балів",
            goodLuck: "Успіхів!",
            wordsCount: "слів",
            printBtn: "🖨️ Друк / Зберегти як PDF",
            checkAllBtn: "✅ Перевірити все",
            resetBtn: "🔄 Почати заново",
            answered: "Відповіді",
            streak: "Серія",
            streakInRow: "поспіль!",
            yourAnswerPlaceholder: "Ваша відповідь… (Enter = перевірити)",
            hint: "підказка",
            trueLabel: "Правда",
            falseLabel: "Хибно",
            selectPlaceholder: "— обрати —",
            correctLabel: "Правильна відповідь",
            noAnswer: "Немає відповіді",
            similarity: "схожість",
            passed: "зараховано",
            result: "Результат",
            pointsSuffix: "бал.",
            listenLabel: "Озвучити",
            praise: ["Чудово! 🎉", "Молодець! 👏", "Супер! ⭐", "Блискуче! 🚀", "Так тримати! 💪", "Ідеально! ✨", "Відмінно! 🌟"],
            encourage: ["Майже! Спробуй ще раз 💭", "Не здавайся! 🙂", "Дуже близько! Перевір написання 🔍", "Ой! 🤔", "Наступного разу вийде! 🍀"],
            grades: { 6: "Відмінно (12)", 5: "Дуже добре (10-11)", 4: "Добре (7-9)", 3: "Задовільно (4-6)", 2: "Достатньо (3)", 1: "Початковий (1-2)" },
            sectionTitles: {
                multiple_choice: "Вибір відповіді",
                fill_blank: "Заповніть пропуски",
                matching: "Знайдіть пари",
                translation: "Перекладіть",
                true_false: "Правда чи хибно",
                correct_form: "Правильна форма слова",
                odd_one_out: "Що зайве?",
            },
        },
        ru: {
            examTitlePrefix: "Контрольная работа по словарю",
            defaultTitle: "Словарный квиз",
            name: "Фамилия и имя",
            class: "Класс / Группа",
            date: "Дата",
            tasks: "заданий",
            questions: "вопросов",
            maxPoints: "Макс. баллов",
            score: "Итоговый балл",
            grade: "Оценка",
            answerKey: "Ключ ответов",
            gradingScale: "Шкала оценок",
            pctPoints: "% баллов",
            goodLuck: "Удачи!",
            wordsCount: "слов",
            printBtn: "🖨️ Печать / Сохранить в PDF",
            checkAllBtn: "✅ Проверить всё",
            resetBtn: "🔄 Сбросить",
            answered: "Ответов",
            streak: "Серия",
            streakInRow: "подряд!",
            yourAnswerPlaceholder: "Ваш ответ… (Enter = проверить)",
            hint: "подсказка",
            trueLabel: "Правда",
            falseLabel: "Ложь",
            selectPlaceholder: "— выбрать —",
            correctLabel: "Правильный ответ",
            noAnswer: "Нет ответа",
            similarity: "сходство",
            passed: "зачтено",
            result: "Результат",
            pointsSuffix: "балл.",
            listenLabel: "Озвучить",
            praise: ["Отлично! 🎉", "Молодец! 👏", "Супер! ⭐", "Прекрасно! 🚀", "Так держать! 💪", "Идеально! ✨", "Замечательно! 🌟"],
            encourage: ["Почти! Попробуй ещё раз 💭", "Не сдавайся! 🙂", "Очень близко! 🔍", "Ой! 🤔", "В следующий раз получится! 🍀"],
            grades: { 6: "Отлично (5+)", 5: "Отлично (5)", 4: "Хорошо (4)", 3: "Удовлетворительно (3)", 2: "Неудовлетворительно (2)", 1: "Плохо (1)" },
            sectionTitles: {
                multiple_choice: "Тест с вариантами",
                fill_blank: "Вставьте пропущенное",
                matching: "Сопоставьте пары",
                translation: "Переведите",
                true_false: "Правда или ложь",
                correct_form: "Правильная форма слова",
                odd_one_out: "Найдите лишнее",
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
            praise: ["Uitstekend! 🎉", "Goed gedaan! 👏", "Super! ⭐", "Briljant! 🚀", "Ga zo door! 💪", "Vlekkeloos! ✨", "Geweldig! 🌟"],
            encourage: ["Bijna! Probeer nog eens 💭", "Niet opgeven! 🙂", "Heel dichtbij! 🔍", "Oeps! 🤔", "Volgende keer lukt het! 🍀"],
            grades: { 6: "Uitmuntend (10)", 5: "Zeer goed (9)", 4: "Goed (8)", 3: "Voldoende (6-7)", 2: "Matig (5)", 1: "Onvoldoende (<5)" },
            sectionTitles: {
                multiple_choice: "Meerkeuze",
                fill_blank: "Invuloefening",
                matching: "Koppel de paren",
                translation: "Vertalen",
                true_false: "Waar of Niet waar",
                correct_form: "Juiste woordvorm",
                odd_one_out: "Welk woord hoort er niet bij?",
            },
        },
        sv: {
            examTitlePrefix: "Ordförrådstest",
            defaultTitle: "Ordförrådsquiz",
            name: "Namn",
            class: "Klass / Grupp",
            date: "Datum",
            tasks: "delar",
            questions: "frågor",
            maxPoints: "Maxpoäng",
            score: "Slutresultat",
            grade: "Betyg",
            answerKey: "Facit",
            gradingScale: "Betygsskala",
            pctPoints: "% poäng",
            goodLuck: "Lycka till!",
            wordsCount: "ord",
            printBtn: "🖨️ Skriv ut / Spara som PDF",
            checkAllBtn: "✅ Kontrollera svar",
            resetBtn: "🔄 Börja om",
            answered: "Besvarade",
            streak: "Svit",
            streakInRow: "i rad!",
            yourAnswerPlaceholder: "Ditt svar… (Enter = kontrollera)",
            hint: "ledtråd",
            trueLabel: "Sant",
            falseLabel: "Falskt",
            selectPlaceholder: "— välj —",
            correctLabel: "Rätt svar",
            noAnswer: "Inget svar",
            similarity: "likhet",
            passed: "godkänd",
            result: "Resultat",
            pointsSuffix: "p",
            listenLabel: "Lyssna",
            praise: ["Utmärkt! 🎉", "Bra jobbat! 👏", "Fantastiskt! ⭐", "Strålande! 🚀", "Fortsätt så! 💪", "Perfekt! ✨", "Grymt! 🌟"],
            encourage: ["Nära! Försök igen 💭", "Ge inte upp! 🙂", "Mycket nära! 🔍", "Hoppsan! 🤔", "Du fixar det nästa gång! 🍀"],
            grades: { 6: "Utmärkt (A)", 5: "Mycket bra (B)", 4: "Bra (C)", 3: "Tillfredsställande (D)", 2: "Godkänd (E)", 1: "Underkänd (F)" },
            sectionTitles: {
                multiple_choice: "Flerval",
                fill_blank: "Fyll i luckorna",
                matching: "Para ihop",
                translation: "Översätt",
                true_false: "Sant eller Falskt",
                correct_form: "Rätt ordform",
                odd_one_out: "Vilket ord ska bort?",
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
            praise: ["Skvělé! 🎉", "Výborně! 👏", "Super! ⭐", "Paráda! 🚀", "Jen tak dál! 💪", "Perfektní! ✨", "Úžasné! 🌟"],
            encourage: ["Těsně! Zkus to ještě jednou 💭", "Nevzdávej to! 🙂", "Velmi blízko! 🔍", "Jejda! 🤔", "Příště to vyjde! 🍀"],
            grades: { 6: "Výborný (1)", 5: "Chvalitebný (2)", 4: "Dobrý (3)", 3: "Dostatečný (4)", 2: "Dostatečný (4-)", 1: "Nedostatečný (5)" },
            sectionTitles: {
                multiple_choice: "Výběr z možností",
                fill_blank: "Doplňte do textu",
                matching: "Spojte dvojice",
                translation: "Přeložte",
                true_false: "Pravda nebo Nepravda",
                correct_form: "Správný tvar slova",
                odd_one_out: "Které slovo nepatří?",
            },
        },
        tr: {
            examTitlePrefix: "Kelime Sınavı",
            defaultTitle: "Kelime Testi",
            name: "Adı Soyadı",
            class: "Sınıf / Grup",
            date: "Tarih",
            tasks: "bölüm",
            questions: "soru",
            maxPoints: "Maks. Puan",
            score: "Alınan Puan",
            grade: "Not",
            answerKey: "Cevap Anahtarı",
            gradingScale: "Puan Cetveli",
            pctPoints: "% Başarı",
            goodLuck: "Başarılar!",
            wordsCount: "kelime",
            printBtn: "🖨️ Yazdır / PDF Olarak Kaydet",
            checkAllBtn: "✅ Hepsini Kontrol Et",
            resetBtn: "🔄 Yeniden Başlat",
            answered: "Cevaplanan",
            streak: "Seri",
            streakInRow: "üst üste!",
            yourAnswerPlaceholder: "Cevabınız… (Enter = kontrol et)",
            hint: "ipucu",
            trueLabel: "Doğru",
            falseLabel: "Yanlış",
            selectPlaceholder: "— seçiniz —",
            correctLabel: "Doğru Cevap",
            noAnswer: "Cevaplanmadı",
            similarity: "benzerlik",
            passed: "geçti",
            result: "Sonuç",
            pointsSuffix: "puan",
            listenLabel: "Sesli Dinle",
            praise: ["Harika! 🎉", "Tebrikler! 👏", "Süper! ⭐", "Mükemmel! 🚀", "Aynen devam! 💪", "Kusursuz! ✨", "Şahane! 🌟"],
            encourage: ["Çok yaklaştın! Tekrar dene 💭", "Pes etme! 🙂", "Neredeyse doğru! 🔍", "Bir dahaki sefere başaracaksın! 🍀"],
            grades: { 6: "Pekiyi (5)", 5: "İyi (4)", 4: "Orta (3)", 3: "Geçer (2)", 2: "Şartlı Geçer (1)", 1: "Yetersiz (0)" },
            sectionTitles: {
                multiple_choice: "Çoktan Seçmeli",
                fill_blank: "Boşluk Doldurma",
                matching: "Eşleştirme",
                translation: "Çeviri",
                true_false: "Doğru mu Yanlış mı?",
                correct_form: "Doğru Kelime Hali",
                odd_one_out: "Farklı Olanı Bul",
            },
        },
        zh: {
            examTitlePrefix: "词汇测验",
            defaultTitle: "词汇测试",
            name: "姓名",
            class: "班级",
            date: "日期",
            tasks: "大题",
            questions: "题",
            maxPoints: "满分",
            score: "得分",
            grade: "评级",
            answerKey: "参考答案",
            gradingScale: "评分标准",
            pctPoints: "% 得分率",
            goodLuck: "祝你好运！",
            wordsCount: "个单词",
            printBtn: "🖨️ 打印 / 保存为PDF",
            checkAllBtn: "✅ 检查全部答案",
            resetBtn: "🔄 重新开始",
            answered: "已回答",
            streak: "连胜",
            streakInRow: "连对！",
            yourAnswerPlaceholder: "输入你的答案… (回车确认)",
            hint: "提示",
            trueLabel: "正确",
            falseLabel: "错误",
            selectPlaceholder: "— 请选择 —",
            correctLabel: "正确答案",
            noAnswer: "未作答",
            similarity: "匹配度",
            passed: "通过",
            result: "成绩",
            pointsSuffix: "分",
            listenLabel: "朗读发音",
            praise: ["太棒了！🎉", "做得好！👏", "非常出色！⭐", "完美！🚀", "继续保持！💪", "准确无误！✨", "太厉害了！🌟"],
            encourage: ["差一点点！再试一次 💭", "别放弃！🙂", "非常接近了！🔍", "下次一定行！🍀"],
            grades: { 6: "优秀 (A+)", 5: "优良 (A)", 4: "良好 (B)", 3: "及格 (C)", 2: "勉强及格 (D)", 1: "不及格 (F)" },
            sectionTitles: {
                multiple_choice: "单项选择题",
                fill_blank: "选词填空",
                matching: "连线匹配",
                translation: "句子翻译",
                true_false: "正误判断",
                correct_form: "词形填空",
                odd_one_out: "找出不同类项",
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
            praise: ["素晴らしい！🎉", "よくできました！👏", "すごい！⭐", "完璧です！🚀", "その調子！💪", "見事！✨", "最高！🌟"],
            encourage: ["惜しい！もう一度 💭", "諦めないで！🙂", "あと少し！🔍", "次はきっとできる！🍀"],
            grades: { 6: "秀 (S)", 5: "優 (A)", 4: "良 (B)", 3: "可 (C)", 2: "認 (D)", 1: "不可 (F)" },
            sectionTitles: {
                multiple_choice: "選択問題",
                fill_blank: "空欄補充",
                matching: "マッチング",
                translation: "翻訳問題",
                true_false: "正誤判定",
                correct_form: "適切な語形",
                odd_one_out: "仲間外れ探し",
            },
        },
    };

    function getI18n(langCode) {
        const raw = String(langCode || "en").toLowerCase().trim();
        const base = raw.split(/[-_]/)[0];
        const dict = QUIZ_I18N[raw] || QUIZ_I18N[base] || QUIZ_I18N.en;
        const fallback = QUIZ_I18N.en;
        return {
            ...fallback,
            ...dict,
            grades: { ...fallback.grades, ...(dict.grades || {}) },
            sectionTitles: { ...fallback.sectionTitles, ...(dict.sectionTitles || {}) },
            praise: (dict.praise && dict.praise.length) ? dict.praise : fallback.praise,
            encourage: (dict.encourage && dict.encourage.length) ? dict.encourage : fallback.encourage,
        };
    }

    function getExamTitle(srcLang, tgtLang) {
        const src = (srcLang || "en").toLowerCase();
        const tgt = (tgtLang || "pl").toLowerCase().split(/[-_]/)[0];
        const srcName = getLangName(src);

        if (tgt === "pl") {
            const adj = QUIZ_LANG_ADJ_PL[src];
            return adj ? `Sprawdzian z języka ${adj}` : `Sprawdzian ze słownictwa (${srcName})`;
        }
        if (tgt === "es") return `Examen de vocabulario (${srcName})`;
        if (tgt === "de") return `Wortschatzprüfung – ${srcName}`;
        if (tgt === "fr") return `Contrôle de vocabulaire (${srcName})`;
        if (tgt === "it") return `Verifica di vocabolario (${srcName})`;
        if (tgt === "pt") return `Exame de vocabulário (${srcName})`;
        if (tgt === "uk") return `Тест зі словникового запасу (${srcName})`;
        if (tgt === "ru") return `Тест по словарному запасу (${srcName})`;
        if (tgt === "nl") return `Woordenschattoets (${srcName})`;
        if (tgt === "sv") return `Ordförrådstest (${srcName})`;
        if (tgt === "cs") return `Test slovní zásoby (${srcName})`;
        if (tgt === "tr") return `Kelime Bilgisi Sınavı (${srcName})`;
        if (tgt === "zh") return `${srcName} 词汇测试`;
        if (tgt === "ja") return `${srcName} 単語テスト`;
        return `${srcName} Vocabulary Exam`;
    }

    const QUIZ_POINTS_PER_TYPE = {
        multiple_choice: 1,
        fill_blank: 1,
        matching: 1,
        translation: 2,
        true_false: 1,
        correct_form: 2,
        odd_one_out: 1,
    };

    function quizSectionQuestionCount(sec) {
        return sec.type === "matching"
            ? (sec.pairs || []).length
            : (sec.questions || []).length;
    }

    function quizSectionPoints(sec) {
        return quizSectionQuestionCount(sec) * (QUIZ_POINTS_PER_TYPE[sec.type] ?? 1);
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

    function pickQuizWords(sorted, count, source) {
        if (source !== "random") return sorted.slice(0, count);
        const excludeCount = Math.min(sorted.length, count);
        let pool = sorted.slice(excludeCount);
        if (pool.length < count) pool = sorted;
        return [...pool].sort(() => Math.random() - 0.5).slice(0, count);
    }

    function quizGradeFromPercent(pct, tgtLang) {
        const i18n = getI18n(tgtLang);
        if (pct >= 95) return { name: i18n.grades[6], num: 6 };
        if (pct >= 85) return { name: i18n.grades[5], num: 5 };
        if (pct >= 70) return { name: i18n.grades[4], num: 4 };
        if (pct >= 55) return { name: i18n.grades[3], num: 3 };
        if (pct >= 40) return { name: i18n.grades[2], num: 2 };
        return { name: i18n.grades[1], num: 1 };
    }

    // ── 1. Gemini AI Quiz Generator ─────────────────────────────────────
    async function generateQuizWithGemini(words, options = {}) {
        const srcLang = (words[0]?.srcLang || "en").toLowerCase();
        let tgtLang = options.tgtLang;
        if (!tgtLang) {
            const data = await new Promise((r) =>
                chrome.storage.local.get({ targetLang: "pl" }, r),
            );
            tgtLang = data.targetLang || words[0]?.tgtLang || "pl";
        }
        tgtLang = tgtLang.toLowerCase();

        const srcLangName = getLangName(srcLang);
        const tgtLangName = getLangName(tgtLang);

        const wordsPool = (words || []).slice(0, 25);
        const wordList = wordsPool
            .map((w, i) => {
                const orig = String(w.original || "").trim();
                const trans = String(w.translated || "").trim();
                const parts = [`${i + 1}. "${orig}" = "${trans}"`];
                if (w.sentence) {
                    const cleanSentence = String(w.sentence)
                        .replace(/\s+/g, " ")
                        .trim()
                        .slice(0, 80);
                    if (cleanSentence) {
                        parts.push(`(example: ${cleanSentence})`);
                    }
                }
                return parts.join(" ");
            })
            .join("\n");

        const nonce = Math.random().toString(36).slice(2, 10);
        const allTypes = [
            "multiple_choice",
            "fill_blank",
            "matching",
            "translation",
            "true_false",
            "correct_form",
            "odd_one_out",
        ];
        const shuffledTypes = [...allTypes].sort(() => Math.random() - 0.5);
        const sectionCount = Math.min(5 + Math.floor(Math.random() * 3), allTypes.length);
        const chosenTypes = shuffledTypes.slice(0, sectionCount);

        const prompt = AIPrompts.quiz({
            srcLang,
            tgtLang,
            srcLangName,
            tgtLangName,
            wordList,
            nonce,
            chosenTypes,
        });

        if (typeof GeminiProxy === "undefined") {
            throw new Error("GeminiProxy is unavailable – check extension configuration.");
        }

        const { text } = await GeminiProxy.request(prompt, {
            temperature: 0.7,
            maxOutputTokens: 8000,
        });

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("Gemini: invalid JSON response.");

        const knownWords = new Set(
            words
                .map((w) =>
                    (w.original || "")
                        .toString()
                        .trim()
                        .toLowerCase()
                        .replace(/[.,!?;:"'“”’]/g, ""),
                )
                .filter(Boolean),
        );

        return normalizeQuizData(JSON.parse(jsonMatch[0]), knownWords, tgtLang);
    }

    // ── 2. Data Normalization & Defensive Quality Filter ────────────────
    function cleanString(str) {
        return (str || "").toString().trim();
    }

    function isValidCorrectForm(sentence, options, answer) {
        if (!sentence || !Array.isArray(options) || options.length < 2 || !answer)
            return false;
        if (!sentence.includes("___")) return false;
        const norm = (s) => (s || "").toString().trim().toLowerCase();
        return options.some((o) => norm(o) === norm(answer));
    }

    function normalizeQuizData(quiz, knownWords, tgtLang) {
        if (!quiz || !Array.isArray(quiz.sections)) return quiz;
        const i18n = getI18n(tgtLang);

        quiz.sections = quiz.sections
            .map((sec) => {
                if (!sec || !sec.type) return null;
                const secType = sec.type.toLowerCase().trim();
                sec.type = secType;

                if (!sec.instructions) {
                    sec.instructions = i18n.sectionTitles[secType] || "";
                }

                if (secType === "matching") {
                    const rawPairs = sec.pairs || sec.questions || sec.matches || [];
                    const seen = new Set();
                    const pairs = rawPairs
                        .map((p) => ({
                            a: cleanString(p.a ?? p.source ?? p.word ?? p.original ?? p.left),
                            b: cleanString(p.b ?? p.translation ?? p.target ?? p.right),
                        }))
                        .filter((p) => {
                            if (!p.a || !p.b) return false;
                            const key = p.a.toLowerCase();
                            if (seen.has(key)) return false;
                            seen.add(key);
                            return true;
                        });
                    if (pairs.length < 2) return null;
                    sec.pairs = pairs;
                    return sec;
                }

                if (secType === "translation") {
                    const qs = (sec.questions || [])
                        .map((q) => {
                            let answer = cleanString(q.answer);
                            answer = answer.replace(/^["'“‘](.*)["'”’]$/, "$1").trim();
                            return {
                                prompt: cleanString(q.prompt ?? q.question ?? q.text ?? q.instruction),
                                answer,
                            };
                        })
                        .filter((q) => q.prompt && q.answer);
                    if (!qs.length) return null;
                    sec.questions = qs;
                    return sec;
                }

                if (secType === "fill_blank") {
                    const qs = (sec.questions || [])
                        .map((q) => {
                            let sentence = cleanString(q.sentence ?? q.text);
                            sentence = sentence.replace(/_{2,}/g, "___").replace(/\[\.\.\.\]/g, "___");
                            return {
                                sentence,
                                hint: cleanString(q.hint ?? q.translation ?? q.meaning),
                                answer: cleanString(q.answer),
                            };
                        })
                        .filter((q) => q.sentence && q.sentence.includes("___") && q.answer);
                    if (!qs.length) return null;
                    sec.questions = qs;
                    return sec;
                }

                if (secType === "true_false") {
                    const qs = (sec.questions || [])
                        .map((q) => {
                            let ans = q.answer;
                            if (typeof ans !== "boolean") {
                                ans = /^(true|prawda|yes|tak|1)$/i.test(String(ans ?? "").trim());
                            }
                            return {
                                statement: cleanString(q.statement ?? q.question),
                                answer: ans,
                            };
                        })
                        .filter((q) => q.statement);
                    if (!qs.length) return null;
                    sec.questions = qs;
                    return sec;
                }

                if (secType === "correct_form") {
                    const qs = (sec.questions || [])
                        .map((q) => {
                            let sentence = cleanString(q.sentence ?? q.text);
                            sentence = sentence.replace(/_{2,}/g, "___");
                            const rawOpts = Array.isArray(q.options)
                                ? q.options.map(cleanString).filter(Boolean)
                                : [];
                            const uniqueOpts = Array.from(new Set(rawOpts));
                            const answer = cleanString(q.answer);
                            return {
                                sentence,
                                options: uniqueOpts,
                                answer,
                            };
                        })
                        .filter((q) => isValidCorrectForm(q.sentence, q.options, q.answer));
                    if (!qs.length) return null;
                    sec.questions = qs;
                    return sec;
                }

                if (secType === "multiple_choice" || secType === "odd_one_out") {
                    const qs = (sec.questions || [])
                        .map((q) => {
                            const question = cleanString(q.question ?? q.prompt);
                            const rawOpts = Array.isArray(q.options)
                                ? q.options.map(cleanString).filter(Boolean)
                                : [];
                            const uniqueOpts = Array.from(new Set(rawOpts));
                            const answer = cleanString(q.answer);
                            const hasAnswer = uniqueOpts.some(
                                (o) => o.toLowerCase() === answer.toLowerCase(),
                            );
                            if (!hasAnswer && answer && uniqueOpts.length) {
                                uniqueOpts[0] = answer;
                            }
                            return {
                                question: secType === "multiple_choice" ? question : "",
                                options: uniqueOpts,
                                answer,
                            };
                        })
                        .filter(
                            (q) =>
                                q.options.length >= 2 &&
                                q.answer &&
                                (secType !== "multiple_choice" || q.question),
                        );
                    if (!qs.length) return null;
                    sec.questions = qs;
                    return sec;
                }

                return sec;
            })
            .filter(Boolean);

        return quiz;
    }

    // ── 3. Printable School Exam Renderer (PDF format) ──────────────────
    function buildQuizHtml(quiz, words, options = {}) {
        const { escapeHtml } = (typeof SharedUtils !== "undefined" ? SharedUtils : {
            escapeHtml: (s) => (s || "").toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
        });

        const srcLang = (words[0]?.srcLang || "en").toLowerCase();
        const tgtLang = (options.tgtLang || "pl").toLowerCase();
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

                if (sec.type === "multiple_choice" || sec.type === "odd_one_out") {
                    body = (sec.questions || [])
                        .map((q) => {
                            qNum++;
                            const qText = q.question ? `<p class="q-title"><b>${qNum}.</b> ${escapeHtml(q.question)}</p>` : `<p class="q-title"><b>${qNum}.</b></p>`;
                            const opts = (q.options || [])
                                .map(
                                    (o, i) =>
                                        `<div class="quiz-option"><span class="opt-letter">${String.fromCharCode(65 + i)}</span> <span>${escapeHtml(o)}</span></div>`,
                                )
                                .join("");
                            return `<div class="quiz-item">${qText}<div class="quiz-options-grid">${opts}</div></div>`;
                        })
                        .join("");
                } else if (sec.type === "fill_blank") {
                    body = (sec.questions || [])
                        .map((q) => {
                            qNum++;
                            const hint = q.hint
                                ? ` <span class="quiz-hint">(${i18n.hint}: ${escapeHtml(q.hint)})</span>`
                                : "";
                            return `<div class="quiz-item"><p class="q-title"><b>${qNum}.</b> ${escapeHtml(q.sentence)}${hint}</p></div>`;
                        })
                        .join("");
                } else if (sec.type === "matching") {
                    const aList = (sec.pairs || [])
                        .map((p, i) => `<li><b>${i + 1}.</b> ${escapeHtml(p.a)}</li>`)
                        .join("");
                    const bList = [...(sec.pairs || [])]
                        .sort(() => Math.random() - 0.5)
                        .map(
                            (p, i) =>
                                `<li><b>${String.fromCharCode(65 + i)}.</b> ${escapeHtml(p.b)}</li>`,
                        )
                        .join("");
                    body = `<div class="quiz-matching-box"><ol class="quiz-match-col">${aList}</ol><ol class="quiz-match-col" type="A">${bList}</ol></div>`;
                } else if (sec.type === "translation") {
                    body = (sec.questions || [])
                        .map((q) => {
                            qNum++;
                            return `<div class="quiz-item"><p class="q-title"><b>${qNum}.</b> ${escapeHtml(q.prompt)}</p><div class="write-line"></div></div>`;
                        })
                        .join("");
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
                    sec.type === "translation" ||
                    sec.type === "fill_blank" ||
                    sec.type === "correct_form" ||
                    sec.type === "odd_one_out"
                ) {
                    return (sec.questions || [])
                        .map((q) => `<li>${escapeHtml(q.answer)}</li>`)
                        .join("");
                }
                if (sec.type === "true_false") {
                    return (sec.questions || [])
                        .map((q) => `<li>${q.answer ? i18n.trueLabel : i18n.falseLabel}</li>`)
                        .join("");
                }
                if (sec.type === "matching") {
                    return (sec.pairs || [])
                        .map((p) => `<li>${escapeHtml(p.a)} → ${escapeHtml(p.b)}</li>`)
                        .join("");
                }
                return "";
            })
            .join("");

        const dateString = typeof SharedUtils !== "undefined" && SharedUtils.dateTag ? SharedUtils.dateTag() : new Date().toISOString().slice(0, 10);

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
        const { escapeHtml, escapeAttr } = (typeof SharedUtils !== "undefined" ? SharedUtils : {
            escapeHtml: (s) => (s || "").toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
            escapeAttr: (s) => (s || "").toString().replace(/"/g, "&quot;").replace(/'/g, "&#39;"),
        });

        const srcLang = (words[0]?.srcLang || "en").toLowerCase();
        const tgtLang = (options.tgtLang || "pl").toLowerCase();
        const i18n = getI18n(tgtLang);
        const title = escapeHtml(quiz.title || i18n.defaultTitle);
        const examTitle = escapeHtml(getExamTitle(srcLang, tgtLang));

        const totalPoints = quizTotalPoints(quiz);
        const totalQuestionsCount = quizTotalQuestions(quiz);

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
                                ? `<div class="q-text-row"><p class="q-text"><b>${qNum}.</b> ${escapeHtml(q.question)} <span class="pts-badge">${secPoints} ${escapeHtml(i18n.pointsSuffix)}</span></p>${ttsBtn(q.question, srcLang)}</div>`
                                : `<p class="q-text"><b>${qNum}.</b> <span class="pts-badge">${secPoints} ${escapeHtml(i18n.pointsSuffix)}</span></p>`;
                            const opts = (q.options || [])
                                .map(
                                    (o) =>
                                        `<span class="opt-row"><button type="button" class="opt" onclick="selectOpt(this)">${escapeHtml(o)}</button>${ttsBtn(o, srcLang)}</span>`,
                                )
                                .join("");
                            return `<div class="q" data-qtype="choice" data-qid="${qNum}" data-points="${secPoints}" data-answer="${escapeAttr(q.answer)}">
                                ${qText}
                                <div class="opts">${opts}</div>
                                <div class="q-feedback"></div>
                            </div>`;
                        })
                        .join("");
                } else if (sec.type === "fill_blank") {
                    body = (sec.questions || [])
                        .map((q) => {
                            qNum++;
                            const hint = q.hint
                                ? `<span class="hint-badge">💡 ${escapeHtml(q.hint)}</span>`
                                : "";
                            const alts = Array.isArray(q.acceptable_answers) && q.acceptable_answers.length
                                ? q.acceptable_answers
                                : (Array.isArray(q.alternatives) ? q.alternatives : []);
                            return `<div class="q" data-qtype="text" data-qid="${qNum}" data-points="${secPoints}" data-answer="${escapeAttr(q.answer)}" data-alternatives="${escapeAttr(JSON.stringify(alts))}">
                                <div class="q-text-row"><p class="q-text"><b>${qNum}.</b> ${escapeHtml(q.sentence)} ${hint} <span class="pts-badge">${secPoints} ${escapeHtml(i18n.pointsSuffix)}</span></p>${ttsBtn(q.sentence, srcLang)}</div>
                                <div class="input-row">
                                    <input type="text" class="q-input" placeholder="${escapeAttr(i18n.yourAnswerPlaceholder)}" onkeydown="if(event.key==='Enter'){event.preventDefault();gradeQuestion(this.closest('.q'));}">
                                    <button type="button" class="btn-mini" onclick="gradeQuestion(this.closest('.q'))">✓</button>
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
                                const shuffled = [...rightOptions].sort(
                                    () => Math.random() - 0.5,
                                );
                                const opts = shuffled
                                    .map(
                                        (b) =>
                                            `<option value="${escapeAttr(b)}">${escapeHtml(b)}</option>`,
                                    )
                                    .join("");
                                return `<div class="q match-card" data-qtype="select" data-qid="${qNum}" data-points="${secPoints}" data-answer="${escapeAttr(p.b)}">
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
                } else if (sec.type === "translation") {
                    body = (sec.questions || [])
                        .map((q) => {
                            qNum++;
                            const alts = Array.isArray(q.acceptable_answers) && q.acceptable_answers.length
                                ? q.acceptable_answers
                                : (Array.isArray(q.alternatives) ? q.alternatives : []);
                            return `<div class="q" data-qtype="text" data-qid="${qNum}" data-points="${secPoints}" data-answer="${escapeAttr(q.answer)}" data-alternatives="${escapeAttr(JSON.stringify(alts))}">
                                <div class="q-text-row"><p class="q-text"><b>${qNum}.</b> ${escapeHtml(q.prompt)} <span class="pts-badge">${secPoints} ${escapeHtml(i18n.pointsSuffix)}</span></p>${ttsBtn(q.prompt, tgtLang)}</div>
                                <div class="input-row">
                                    <input type="text" class="q-input" placeholder="${escapeAttr(i18n.yourAnswerPlaceholder)}" onkeydown="if(event.key==='Enter'){event.preventDefault();gradeQuestion(this.closest('.q'));}">
                                    <button type="button" class="btn-mini" onclick="gradeQuestion(this.closest('.q'))">✓</button>
                                </div>
                                <div class="q-match-bar"><div class="q-match-fill"></div><span class="q-match-label"></span></div>
                                <div class="q-feedback"></div>
                            </div>`;
                        })
                        .join("");
                } else if (sec.type === "true_false") {
                    body = (sec.questions || [])
                        .map((q) => {
                            qNum++;
                            const expectedText = q.answer ? i18n.trueLabel : i18n.falseLabel;
                            return `<div class="q" data-qtype="choice" data-qid="${qNum}" data-points="${secPoints}" data-answer="${escapeAttr(expectedText)}">
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
                            return `<div class="q" data-qtype="choice" data-qid="${qNum}" data-points="${secPoints}" data-answer="${escapeAttr(q.answer)}">
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
                        <span class="quiz-section-points">${secPoints} ${escapeHtml(i18n.pointsSuffix)}</span>
                    </div>
                    <p class="instructions">${escapeHtml(sec.instructions || "")}</p>
                    ${body}
                </section>`;
            })
            .join("");

        const dateString = typeof SharedUtils !== "undefined" && SharedUtils.dateTag ? SharedUtils.dateTag() : new Date().toISOString().slice(0, 10);

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
    ${sectionsHtml}
    <div class="actions">
        <button type="button" class="btn-check" onclick="checkAllAnswers()">${escapeHtml(i18n.checkAllBtn)}</button>
        <button type="button" class="btn-reset" onclick="resetQuiz()">${escapeHtml(i18n.resetBtn)}</button>
    </div>
    <div id="scoreBox" class="score-box" style="display:none;"></div>
    <script>
    var I18N = ${JSON.stringify(i18n)};
    var PASS_THRESHOLD = 85;

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
        return cleanForMatching(s);
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

    function matchPercent(userVal, answer, alternatives) {
        return matchPercentWithBest(userVal, answer, alternatives).pct;
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

    var totalQuestions = document.querySelectorAll('.q').length;
    var answeredIds = {};
    var currentStreak = 0;
    var liveScore = 0;
    var PRAISE = I18N.praise || ['Great! 🎉'];
    var ENCOURAGE = I18N.encourage || ['Try again! 💭'];

    function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

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
        if (!bar || !label || !totalQuestions) return;
        var answered = Object.keys(answeredIds).length;
        var pct = Math.round((answered / totalQuestions) * 100);
        bar.style.width = pct + '%';
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

    function gradeQuestion(q, silent) {
        if (!q) return false;
        var type = q.dataset.qtype;
        var answer = q.dataset.answer || '';
        var rawAlts = q.dataset.alternatives;
        var alternatives = [];
        if (rawAlts) {
            try { alternatives = JSON.parse(rawAlts); } catch (_) {}
        }
        if (answer && (answer.indexOf('/') !== -1 || answer.indexOf(';') !== -1)) {
            var splitAns = answer.split(/[\/;]/).map(function(s) { return s.trim(); }).filter(Boolean);
            for (var s = 0; s < splitAns.length; s++) {
                if (alternatives.indexOf(splitAns[s]) === -1) alternatives.push(splitAns[s]);
            }
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
        if (!userVal) return false;

        var pct = null;
        var isCorrect;
        var bestAnswer = answer;
        if (type === 'text') {
            var matchRes = matchPercentWithBest(userVal, answer, alternatives);
            pct = matchRes.pct;
            bestAnswer = matchRes.bestAnswer;
            isCorrect = pct >= PASS_THRESHOLD;
        } else {
            isCorrect = normalize(userVal) === normalize(answer);
            if (!isCorrect && alternatives.length > 0) {
                for (var aIdx = 0; aIdx < alternatives.length; aIdx++) {
                    if (normalize(userVal) === normalize(alternatives[aIdx])) {
                        isCorrect = true;
                        bestAnswer = alternatives[aIdx];
                        break;
                    }
                }
            }
        }

        var pts = parseFloat(q.dataset.points) || 1;
        var wasCorrect = q.dataset.wasCorrect === '1';
        q.classList.remove('correct', 'incorrect');
        q.classList.add(isCorrect ? 'correct' : 'incorrect');

        var fb = q.querySelector('.q-feedback');
        if (fb) {
            var pctSuffix = pct !== null ? (' (' + (I18N.similarity || 'similarity') + ': ' + pct + '%)') : '';
            if (type === 'text') {
                var diffHtml = diffAnswerHtml(userVal, bestAnswer);
                if (isCorrect) {
                    if (pct !== null && pct < 100) {
                        fb.innerHTML = '✓ ' + escapeHtmlClient(pick(PRAISE)) + pctSuffix +
                            '<br><span class="fb-answer-label">' + (I18N.correctLabel || 'Correct answer') + ':</span> <span class="fb-answer-diff">' + diffHtml + '</span>';
                    } else {
                        fb.innerHTML = '✓ ' + escapeHtmlClient(pick(PRAISE)) + pctSuffix;
                    }
                } else {
                    fb.innerHTML = '✗ ' + escapeHtmlClient(pick(ENCOURAGE)) + pctSuffix +
                        '<br><span class="fb-answer-label">' + (I18N.correctLabel || 'Correct answer') + ':</span> <span class="fb-answer-diff">' + diffHtml + '</span>';
                }
            } else {
                if (isCorrect) {
                    fb.innerHTML = '✓ ' + escapeHtmlClient(pick(PRAISE));
                } else {
                    fb.innerHTML = '✗ ' + escapeHtmlClient(pick(ENCOURAGE)) + ' — <span class="fb-answer-label">' + (I18N.correctLabel || 'Correct answer') + ':</span> ' + escapeHtmlClient(bestAnswer);
                }
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

        if (!silent) {
            playTone(isCorrect ? 880 : 220, isCorrect ? 0.16 : 0.28);
            updateStreak(isCorrect);
            if (isCorrect && !wasCorrect) {
                celebrateCorrect(q, pts);
            } else if (!isCorrect) {
                shakeWrong(q);
            }
        }

        if (isCorrect && !wasCorrect) {
            liveScore += pts;
            q.dataset.wasCorrect = '1';
        } else if (!isCorrect && wasCorrect) {
            liveScore -= pts;
            q.dataset.wasCorrect = '0';
        }

        updateHUD();
        return isCorrect;
    }

    function checkAllAnswers() {
        var qs = document.querySelectorAll('.q');
        var total = 0, correct = 0, totalPoints = 0, earnedPoints = 0;
        for (var i = 0; i < qs.length; i++) {
            total++;
            var pts = parseFloat(qs[i].dataset.points) || 1;
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
                continue;
            }
            if (gradeQuestion(qs[i], true)) { correct++; earnedPoints += pts; }
        }
        var box = document.getElementById('scoreBox');
        var pct = totalPoints ? Math.round((earnedPoints / totalPoints) * 100) : 0;
        var gradeName = I18N.grades[pct >= 95 ? 6 : pct >= 85 ? 5 : pct >= 70 ? 4 : pct >= 55 ? 3 : pct >= 40 ? 2 : 1];
        box.style.display = 'block';
        box.textContent = (I18N.result || 'Result') + ': ' + earnedPoints + ' / ' + totalPoints + ' ' + (I18N.pointsSuffix || 'pts') + ' (' + pct + '%) — ' + (I18N.grade || 'Grade') + ': ' + gradeName;
        box.className = 'score-box ' + (pct >= 70 ? 'good' : pct >= 40 ? 'mid' : 'bad');
        box.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (pct >= 70) launchConfetti();
    }

    function resetQuiz() {
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
            var fb = qs[m].querySelector('.q-feedback');
            if (fb) fb.textContent = '';
            var matchBar = qs[m].querySelector('.q-match-bar');
            if (matchBar) matchBar.style.display = 'none';
            var matchFill = qs[m].querySelector('.q-match-fill');
            if (matchFill) { matchFill.style.width = '0%'; matchFill.classList.remove('low'); }
            var matchLabel = qs[m].querySelector('.q-match-label');
            if (matchLabel) matchLabel.textContent = '';
        }
        document.getElementById('scoreBox').style.display = 'none';
        answeredIds = {};
        currentStreak = 0;
        liveScore = 0;
        updateHUD();
        var streakBadge = document.getElementById('streakBadge');
        if (streakBadge) streakBadge.classList.remove('show');
        updateProgress();
    }
    </script>
</body>
</html>`;
    }

    // ── 5. High-Level Export Orchestrator ──────────────────────────────
    async function runExport({ words, scope = "5", source = "recent", mode = "interactive", targetLang = "en" }) {
        if (!words || !words.length) {
            throw new Error("No words available to generate quiz.");
        }

        const sorted = [...words].sort(
            (a, b) => (b.timestamp || 0) - (a.timestamp || 0),
        );
        const count = scope === "all" ? 25 : Math.min(parseInt(scope, 10) || 5, 25);
        const quizWords = pickQuizWords(sorted, count, source);

        const quiz = await generateQuizWithGemini(quizWords, { tgtLang: targetLang });
        const html =
            mode === "interactive"
                ? buildInteractiveQuizHtml(quiz, quizWords, { tgtLang: targetLang })
                : buildQuizHtml(quiz, quizWords, { tgtLang: targetLang });

        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
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
