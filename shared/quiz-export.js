// quiz-export.js – "Export: AI-generated Quiz" feature (PDF-style printable
// quiz AND fully interactive, self-graded quiz), extracted out of popup.js
// so it can be read/extended on its own without scrolling through the rest
// of the popup logic.
//
// Loaded as a classic <script> (no bundler/modules), right after
// shared/ai-prompts.js and before popup.js — see popup.html.
//
// Depends on globals declared elsewhere:
//   • SharedUtils.escapeHtml / SharedUtils.escapeAttr  (shared/utils.js)
//   • AIPrompts.quiz(...)                              (shared/ai-prompts.js)
//   • filterWords(words), markAsDownloaded(...), dateTag()  (popup.js)
// These are only referenced *inside* event handlers / functions below, so
// it doesn't matter that popup.js is loaded after this file — by the time
// a user actually clicks "Generuj quiz" everything has already loaded.
//
// File layout:
//   0. Exam-style helpers (points per question, grading scale, language names)
//   1. Quiz mode toggle (PDF vs. interactive) + the "Generuj quiz" click handler
//   2. generateQuizWithGemini()   – calls Gemini, returns normalized quiz JSON
//   3. normalizeQuizData()        – defensive cleanup of the model's JSON
//   4. buildQuizHtml()            – renders a print-ready "PDF" quiz page, styled
//                                   like a real school exam paper (points, grades)
//   5. buildInteractiveQuizHtml() – renders a self-graded interactive quiz page,
//                                   also styled/scored like a school exam

// ── 0. Exam-style helpers ───────────────────────────────────────────
// Polish language adjective (instrumental case, e.g. "w języku angielskim")
// used both in the Gemini prompt and in the rendered quiz pages.
const QUIZ_LANG_ADJ = {
    en: "angielskim",
    es: "hiszpańskim",
    de: "niemieckim",
    fr: "francuskim",
    it: "włoskim",
    pt: "portugalskim",
    ru: "rosyjskim",
    pl: "polskim",
    uk: "ukraińskim",
    ja: "japońskim",
    ko: "koreańskim",
    zh: "chińskim",
    nl: "niderlandzkim",
    sv: "szwedzkim",
    tr: "tureckim",
};

/** Genitive form ("angielskim" -> "angielskiego"), used for the formal exam
 * title "Sprawdzian z języka ...". */
function quizLangGenitive(srcLangAdj) {
    return srcLangAdj.endsWith("m")
        ? srcLangAdj.slice(0, -1) + "ego"
        : srcLangAdj;
}

/** How many exam points each question of a given section type is worth —
 * mirrors how real school exams weigh trickier, production-style tasks
 * (translation, word order, error correction) higher than simple recognition
 * tasks (multiple choice, matching, true/false). */
const QUIZ_POINTS_PER_TYPE = {
    multiple_choice: 1,
    fill_blank: 1,
    matching: 1,
    translation: 2,
    true_false: 1,
    correct_form: 2,
    word_from_definition: 2,
    odd_one_out: 1,
};

function quizSectionQuestionCount(sec) {
    return sec.type === "matching"
        ? (sec.pairs || []).length
        : (sec.questions || []).length;
}

function quizSectionPoints(sec) {
    return (
        quizSectionQuestionCount(sec) * (QUIZ_POINTS_PER_TYPE[sec.type] ?? 1)
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

/** Suggested exam duration (minutes), loosely scaled with question count,
 * rounded to a "nice" 5-minute increment like a real exam sheet. */
function quizSuggestedMinutes(questionCount) {
    return Math.max(
        15,
        Math.min(60, Math.round((questionCount * 1.5) / 5) * 5),
    );
}

/**
 * Picks the words to quiz on, given a `sorted` list (newest first) and the
 * requested `count`.
 *   • source === "recent" — simply the newest `count` words (original behavior).
 *   • source === "random" — `count` words picked at random from the pool of
 *     words that are NOT among the newest `count` (i.e. "not from recent"),
 *     so the quiz targets older/previously-learned vocabulary instead of
 *     whatever was just added. Falls back to sampling from the full list if
 *     there aren't enough older words to fill the requested count.
 */
function pickQuizWords(sorted, count, source) {
    if (source !== "random") return sorted.slice(0, count);
    const excludeCount = Math.min(sorted.length, count);
    let pool = sorted.slice(excludeCount); // everything past the "recent" window
    if (pool.length < count) pool = sorted; // not enough older words — sample from all
    return [...pool].sort(() => Math.random() - 0.5).slice(0, count);
}

/** Polish school grading scale (1-6), used to turn a raw % score into a
 * report-card-style grade on both the printable and interactive quiz. */
function quizGradeFromPercent(pct) {
    if (pct >= 95) return { name: "celujący", num: 6 };
    if (pct >= 85) return { name: "bardzo dobry", num: 5 };
    if (pct >= 70) return { name: "dobry", num: 4 };
    if (pct >= 55) return { name: "dostateczny", num: 3 };
    if (pct >= 40) return { name: "dopuszczający", num: 2 };
    return { name: "niedostateczny", num: 1 };
}

// ── 1. Quiz mode toggle + export button ────────────────────────────
let quizOutputMode = "interactive";
const quizModePdfBtn = document.getElementById("quizModePdf");
const quizModeInteractiveBtn = document.getElementById("quizModeInteractive");
function setQuizMode(mode) {
    quizOutputMode = mode;
    quizModePdfBtn?.classList.toggle("active", mode === "pdf");
    quizModeInteractiveBtn?.classList.toggle("active", mode === "interactive");
}
setQuizMode(quizOutputMode); // sync button styling with the default on load
quizModePdfBtn?.addEventListener("click", () => setQuizMode("pdf"));
quizModeInteractiveBtn?.addEventListener("click", () =>
    setQuizMode("interactive"),
);

document.getElementById("exportQuiz").addEventListener("click", async () => {
    const btn = document.getElementById("exportQuiz");
    const origText = btn.innerHTML;

    const data = await new Promise((r) =>
        chrome.storage.local.get({ savedWords: [] }, r),
    );
    const words = filterWords(data.savedWords || []);
    if (words.length === 0) {
        alert("Brak słów do wygenerowania quizu.");
        return;
    }

    const { geminiApiKey } = await new Promise((r) =>
        chrome.storage.sync.get({ geminiApiKey: "" }, r),
    );
    if (!geminiApiKey) {
        alert(
            "Aby wygenerować quiz AI, wpisz najpierw klucz Gemini API w zakładce ⚙️ Ustawienia.",
        );
        return;
    }

    // Word scope: newest N, or all (respecting the active list filter above)
    const scope = document.getElementById("quizScope").value;
    const source = document.getElementById("quizSource")?.value || "recent";
    const sorted = [...words].sort(
        (a, b) => (b.timestamp || 0) - (a.timestamp || 0),
    );
    const count = scope === "all" ? 60 : parseInt(scope, 10);
    const quizWords = pickQuizWords(sorted, count, source);

    btn.disabled = true;
    btn.innerHTML = "⏳ Generuję quiz…";
    try {
        const quiz = await generateQuizWithGemini(quizWords, geminiApiKey);
        const html =
            quizOutputMode === "interactive"
                ? buildInteractiveQuizHtml(quiz, quizWords)
                : buildQuizHtml(quiz, quizWords);
        // A data: URL (not a blob: URL) so the page still loads even after
        // the extension popup closes (which happens as soon as the new tab gets focus).
        const dataUrl =
            "data:text/html;charset=utf-8," + encodeURIComponent(html);
        chrome.tabs.create({ url: dataUrl });
        markAsDownloaded(quizWords, data.savedWords);
    } catch (err) {
        console.error("Quiz export error:", err);
        alert("Błąd generowania quizu: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = origText;
    }
});

// ── 2. Gemini call ──────────────────────────────────────────────────

/** Ask Gemini to build a varied quiz (multiple choice, fill-in-the-blank,
 * matching, translation, true/false) from the saved word list. */
async function generateQuizWithGemini(words, geminiApiKey) {
    const srcLang = words[0]?.srcLang || "en";
    const srcLangAdj = QUIZ_LANG_ADJ[srcLang] || srcLang.toUpperCase();

    const wordList = words
        .map((w, i) => {
            const parts = [`${i + 1}. "${w.original}" = "${w.translated}"`];
            if (w.sentence) parts.push(`(przykład: ${w.sentence})`);
            return parts.join(" ");
        })
        .join("\n");

    // Random nonce + shuffled type order nudge the model toward a different mix
    // of section types/questions each time, even for the exact same word list.
    const nonce = Math.random().toString(36).slice(2, 10);
    const allTypes = [
        "multiple_choice",
        "fill_blank",
        "matching",
        "translation",
        "true_false",
        "correct_form",
        "word_from_definition",
        "odd_one_out",
    ];
    const shuffledTypes = [...allTypes].sort(() => Math.random() - 0.5);
    const sectionCount = 6 + Math.floor(Math.random() * 3); // 6-8 sections (comprehensive, exam-style)
    const chosenTypes = shuffledTypes.slice(
        0,
        Math.min(sectionCount, allTypes.length),
    );

    const prompt = AIPrompts.quiz({ srcLangAdj, wordList, nonce, chosenTypes });

    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 1, maxOutputTokens: 8000 },
            }),
        },
    );
    if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error?.message || `Gemini HTTP ${res.status}`);
    }
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Gemini: brak odpowiedzi JSON");
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
    return normalizeQuizData(JSON.parse(jsonMatch[0]), knownWords);
}

// ── 3. Response cleanup ─────────────────────────────────────────────

/**
 * Defensive cleanup applied to whatever Gemini returns before it's rendered.
 * The model sometimes uses slightly different field names (or leaves a
 * section empty) — this maps common variants to the exact field names the
 * renderers expect and drops any section that ends up with no real content,
 * so the quiz never shows a blank question / an empty "dopasuj pary" list.
 *
 * It also runs a content-quality check on "correct_form" and
 * "word_from_definition" questions (the two production-style types most
 * prone to the model inventing lazy/nonsensical content) and silently drops
 * any question that fails it, so a learner is never asked something they
 * had no fair way of answering — e.g. a "correct_form" question whose
 * options aren't actually different forms of the same base word, or a
 * "word_from_definition" answer that isn't one of the words being learned.
 */
function quizTokenize(str) {
    return (str || "")
        .toString()
        .toLowerCase()
        .replace(/[.,!?;:"'“”’]/g, "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}

/** True if `answer` is exactly one of the provided `options` (allowing for
 * minor case/whitespace differences) — guards against "correct_form"
 * questions whose stated answer doesn't actually match any option. */
function isValidCorrectForm(sentence, options, answer) {
    if (!sentence || !Array.isArray(options) || options.length < 2 || !answer)
        return false;
    if (!sentence.includes("___")) return false;
    const norm = (s) => (s || "").toString().trim().toLowerCase();
    return options.some((o) => norm(o) === norm(answer));
}

/** True if `answer` matches (as a whole word/phrase, case-insensitively)
 * one of the words the learner is actually studying — guards against
 * "word_from_definition" questions whose answer is an invented/unrelated
 * word the learner had no fair way of knowing. */
function isValidWordFromDefinition(definition, answer, knownWords) {
    if (!definition || !answer) return false;
    if (!knownWords || !knownWords.size) return true; // no reference list — can't validate, allow it
    const norm = (s) =>
        (s || "")
            .toString()
            .trim()
            .toLowerCase()
            .replace(/[.,!?;:"'“”’]/g, "");
    const normAnswer = norm(answer);
    if (knownWords.has(normAnswer)) return true;
    // Allow the answer to be a short phrase that contains a known word as a
    // whole token (e.g. answer "to go" for known word "go").
    const answerTokens = new Set(quizTokenize(answer));
    for (const w of knownWords) {
        if (answerTokens.has(w)) return true;
    }
    return false;
}

function normalizeQuizData(quiz, knownWords) {
    if (!quiz || !Array.isArray(quiz.sections)) return quiz;
    quiz.sections = quiz.sections
        .map((sec) => {
            if (!sec || !sec.type) return null;
            if (sec.type === "matching") {
                const rawPairs =
                    sec.pairs || sec.questions || sec.matches || [];
                const pairs = rawPairs
                    .map((p) => ({
                        a:
                            p.a ??
                            p.source ??
                            p.word ??
                            p.original ??
                            p.left ??
                            "",
                        b: p.b ?? p.translation ?? p.target ?? p.right ?? "",
                    }))
                    .filter((p) => p.a && p.b);
                if (!pairs.length) return null;
                sec.pairs = pairs;
                return sec;
            }
            if (sec.type === "translation") {
                const qs = (sec.questions || [])
                    .map((q) => ({
                        prompt:
                            q.prompt ??
                            q.question ??
                            q.text ??
                            q.instruction ??
                            "",
                        answer: q.answer ?? "",
                    }))
                    .filter((q) => q.prompt && q.answer);
                if (!qs.length) return null;
                sec.questions = qs;
                return sec;
            }
            if (sec.type === "fill_blank") {
                const qs = (sec.questions || [])
                    .map((q) => ({
                        sentence: q.sentence ?? q.text ?? "",
                        hint: q.hint ?? q.translation ?? q.meaning ?? "",
                        answer: q.answer ?? "",
                    }))
                    .filter((q) => q.sentence && q.answer);
                if (!qs.length) return null;
                sec.questions = qs;
                return sec;
            }
            if (sec.type === "true_false") {
                const qs = (sec.questions || [])
                    .map((q) => {
                        let ans = q.answer;
                        if (typeof ans !== "boolean") {
                            ans = /^(true|prawda)$/i.test(
                                String(ans ?? "").trim(),
                            );
                        }
                        return {
                            statement: q.statement ?? q.question ?? "",
                            answer: ans,
                        };
                    })
                    .filter((q) => q.statement);
                if (!qs.length) return null;
                sec.questions = qs;
                return sec;
            }
            if (sec.type === "correct_form") {
                const qs = (sec.questions || []).filter(
                    (q) =>
                        q &&
                        q.sentence &&
                        Array.isArray(q.options) &&
                        q.answer &&
                        isValidCorrectForm(q.sentence, q.options, q.answer),
                );
                if (!qs.length) return null;
                sec.questions = qs;
                return sec;
            }
            if (sec.type === "word_from_definition") {
                const qs = (sec.questions || [])
                    .map((q) => ({
                        definition: q.definition ?? q.question ?? q.hint ?? "",
                        answer: q.answer ?? "",
                    }))
                    .filter(
                        (q) =>
                            q.definition &&
                            q.answer &&
                            isValidWordFromDefinition(
                                q.definition,
                                q.answer,
                                knownWords,
                            ),
                    );
                if (!qs.length) return null;
                sec.questions = qs;
                return sec;
            }
            if (sec.type === "multiple_choice" || sec.type === "odd_one_out") {
                const qs = (sec.questions || []).filter(
                    (q) =>
                        q &&
                        Array.isArray(q.options) &&
                        q.options.length &&
                        q.answer,
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

// ── 4. Printable "PDF" quiz renderer ────────────────────────────────

/** Render the quiz JSON as a print-ready HTML document (questions, then answer key). */
function buildQuizHtml(quiz, words) {
    const { escapeHtml } = SharedUtils;
    const title = escapeHtml(quiz.title || "Quiz językowy");
    const sectionTitles = {
        multiple_choice: "Wielokrotny wybór",
        fill_blank: "Uzupełnij luki",
        matching: "Dopasuj pary",
        translation: "Przetłumacz",
        true_false: "Prawda czy fałsz",
        correct_form: "Popraw formę słowa",
        word_from_definition: "Zgadnij słowo",
        odd_one_out: "Który wyraz nie pasuje?",
    };

    const srcLang = words[0]?.srcLang || "en";
    const srcLangAdj = QUIZ_LANG_ADJ[srcLang] || srcLang.toUpperCase();
    const examTitle = `Sprawdzian z języka ${quizLangGenitive(srcLangAdj)}`;
    const totalPoints = quizTotalPoints(quiz);
    const totalQuestions = quizTotalQuestions(quiz);
    const suggestedMinutes = quizSuggestedMinutes(totalQuestions);

    let qNum = 0;
    let secNum = 0;
    const sectionsHtml = (quiz.sections || [])
        .map((sec) => {
            secNum++;
            const heading = sectionTitles[sec.type] || sec.type;
            const secPoints = quizSectionPoints(sec);
            let body = "";
            if (sec.type === "multiple_choice" || sec.type === "odd_one_out") {
                body = (sec.questions || [])
                    .map((q) => {
                        qNum++;
                        const opts = (q.options || [])
                            .map(
                                (o, i) =>
                                    `<div class="quiz-option">${String.fromCharCode(65 + i)}) ${escapeHtml(o)}</div>`,
                            )
                            .join("");
                        return `<div class="quiz-question"><p><b>${qNum}.</b> ${escapeHtml(q.question || "")}</p><div class="quiz-options">${opts}</div></div>`;
                    })
                    .join("");
            } else if (sec.type === "fill_blank") {
                body = (sec.questions || [])
                    .map((q) => {
                        qNum++;
                        const hint = q.hint
                            ? ` <span class="quiz-hint">(podpowiedź: ${escapeHtml(q.hint)})</span>`
                            : "";
                        return `<div class="quiz-question"><p><b>${qNum}.</b> ${escapeHtml(q.sentence)}${hint}</p></div>`;
                    })
                    .join("");
            } else if (sec.type === "matching") {
                const aList = (sec.pairs || [])
                    .map((p, i) => `<li>${i + 1}. ${escapeHtml(p.a)}</li>`)
                    .join("");
                const bList = [...(sec.pairs || [])]
                    .sort(() => Math.random() - 0.5)
                    .map(
                        (p, i) =>
                            `<li>${String.fromCharCode(65 + i)}. ${escapeHtml(p.b)}</li>`,
                    )
                    .join("");
                body = `<div class="quiz-matching"><ol class="quiz-match-col">${aList}</ol><ol class="quiz-match-col" type="A">${bList}</ol></div>`;
            } else if (sec.type === "translation") {
                body = (sec.questions || [])
                    .map((q) => {
                        qNum++;
                        return `<div class="quiz-question"><p><b>${qNum}.</b> ${escapeHtml(q.prompt)}</p></div>`;
                    })
                    .join("");
            } else if (sec.type === "true_false") {
                body = (sec.questions || [])
                    .map((q) => {
                        qNum++;
                        return `<div class="quiz-question"><p><b>${qNum}.</b> ${escapeHtml(q.statement)} <span class="quiz-tf">☐ Prawda &nbsp; ☐ Fałsz</span></p></div>`;
                    })
                    .join("");
            } else if (sec.type === "correct_form") {
                body = (sec.questions || [])
                    .map((q) => {
                        qNum++;
                        const opts = (q.options || [])
                            .map(
                                (o, i) =>
                                    `<div class="quiz-option">${String.fromCharCode(65 + i)}) ${escapeHtml(o)}</div>`,
                            )
                            .join("");
                        return `<div class="quiz-question"><p><b>${qNum}.</b> ${escapeHtml(q.sentence)}</p><div class="quiz-options">${opts}</div></div>`;
                    })
                    .join("");
            } else if (sec.type === "word_from_definition") {
                body = (sec.questions || [])
                    .map((q) => {
                        qNum++;
                        return `<div class="quiz-question"><p><b>${qNum}.</b> ${escapeHtml(q.definition)}</p><p class="quiz-answer-line">Odpowiedź: ______________________________________</p></div>`;
                    })
                    .join("");
            }
            return `<section class="quiz-section"><h2>Zadanie ${secNum}. ${escapeHtml(heading)} <span class="quiz-points-badge">(${secPoints} pkt)</span></h2><p class="quiz-instructions">${escapeHtml(sec.instructions || "")}</p>${body}</section>`;
        })
        .join("");

    // Answer key on its own printed page
    const answerKeyHtml = (quiz.sections || [])
        .map((sec) => {
            if (
                sec.type === "multiple_choice" ||
                sec.type === "translation" ||
                sec.type === "fill_blank" ||
                sec.type === "correct_form" ||
                sec.type === "word_from_definition" ||
                sec.type === "odd_one_out"
            ) {
                return (sec.questions || [])
                    .map((q) => `<li>${escapeHtml(q.answer)}</li>`)
                    .join("");
            }
            if (sec.type === "true_false") {
                return (sec.questions || [])
                    .map((q) => `<li>${q.answer ? "Prawda" : "Fałsz"}</li>`)
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

    return `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
    * { box-sizing: border-box; }
    body { font-family: Georgia, 'Times New Roman', serif; max-width: 800px; margin: 30px auto; padding: 0 24px; color: #1a1a1a; line-height: 1.5; }
    .exam-header-box { border: 1.5px solid #333; border-radius: 4px; padding: 12px 16px; margin-bottom: 18px; }
    .exam-header-row { display: flex; flex-wrap: wrap; gap: 10px 28px; font-size: 13.5px; }
    .exam-field { display: flex; align-items: baseline; gap: 6px; white-space: nowrap; }
    .exam-field-grow { flex: 1; min-width: 220px; }
    .exam-line { flex: 1; min-width: 60px; border-bottom: 1px solid #333; height: 1em; }
    h1 { font-size: 23px; text-align: center; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 4px; }
    .quiz-subtitle { text-align: center; color: #555; font-style: italic; margin: 0 0 14px; }
    .exam-meta { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px 22px; font-size: 13px; color: #333; margin-bottom: 10px; }
    .exam-score-box { border: 1.5px solid #333; border-radius: 4px; padding: 10px 16px; font-size: 14px; font-weight: bold; text-align: center; margin-bottom: 24px; }
    .exam-score-box .exam-line { display: inline-block; width: 60px; margin: 0 4px; }
    h2 { font-size: 17px; margin-top: 28px; color: #333; }
    .quiz-points-badge { font-size: 12px; font-weight: normal; color: #6d28d9; white-space: nowrap; }
    .quiz-instructions { font-style: italic; color: #555; margin-bottom: 12px; }
    .quiz-section { page-break-inside: avoid; }
    .quiz-question { margin: 10px 0 14px; }
    .quiz-options { margin-left: 18px; }
    .quiz-option { margin: 3px 0; }
    .quiz-matching { display: flex; gap: 60px; }
    .quiz-match-col { padding-left: 20px; }
    .quiz-tf { margin-left: 10px; white-space: nowrap; }
    .quiz-hint { color: #777; font-style: italic; font-size: 0.85em; }
    .quiz-tile { display: inline-block; border: 1px solid #999; border-radius: 6px; padding: 3px 9px; margin: 2px 3px; background: #f4f4f4; }
    .quiz-answer-line { color: #555; margin-top: 6px; }
    .answer-key { page-break-before: always; }
    .answer-key ol { padding-left: 20px; }
    .grading-scale { page-break-inside: avoid; margin-top: 30px; }
    .grade-table { border-collapse: collapse; font-size: 13.5px; margin-top: 8px; }
    .grade-table th, .grade-table td { border: 1px solid #999; padding: 5px 14px; text-align: center; }
    .grade-table th { background: #f0f0f0; }
    .exam-footer { text-align: center; font-style: italic; color: #777; margin-top: 30px; }
    .print-bar { text-align: center; margin: 20px 0; }
    .print-bar button { font-size: 14px; padding: 8px 16px; cursor: pointer; }
    @media print { .print-bar { display: none; } body { margin: 0 auto; } }
</style>
</head>
<body>
    <div class="print-bar"><button onclick="window.print()">🖨️ Drukuj / Zapisz jako PDF</button></div>
    <div class="exam-header-box">
        <div class="exam-header-row">
            <div class="exam-field exam-field-grow">Imię i nazwisko: <span class="exam-line"></span></div>
            <div class="exam-field">Klasa: <span class="exam-line" style="min-width:50px;"></span></div>
            <div class="exam-field">Data: <span class="exam-line" style="min-width:80px;"></span></div>
        </div>
    </div>
    <h1>${examTitle}</h1>
    <p class="quiz-subtitle">${title}</p>
    <div class="exam-meta">
        <span>📝 ${secNum} zadań • ${totalQuestions} pytań</span>
        <span>🏆 Maks. liczba punktów: ${totalPoints}</span>
        <span>⏱️ Sugerowany czas pracy: ${suggestedMinutes} min</span>
    </div>
    <div class="exam-score-box">Liczba punktów: <span class="exam-line"></span> / ${totalPoints} &nbsp;&nbsp;&nbsp; Ocena: <span class="exam-line"></span></div>
    ${sectionsHtml}
    <section class="answer-key">
        <h2>Klucz odpowiedzi</h2>
        <ol>${answerKeyHtml}</ol>
    </section>
    <section class="grading-scale">
        <h2>Skala ocen</h2>
        <table class="grade-table">
            <tr><th>% punktów</th><th>Ocena</th></tr>
            <tr><td>95–100%</td><td>celujący (6)</td></tr>
            <tr><td>85–94%</td><td>bardzo dobry (5)</td></tr>
            <tr><td>70–84%</td><td>dobry (4)</td></tr>
            <tr><td>55–69%</td><td>dostateczny (3)</td></tr>
            <tr><td>40–54%</td><td>dopuszczający (2)</td></tr>
            <tr><td>0–39%</td><td>niedostateczny (1)</td></tr>
        </table>
    </section>
    <p class="exam-footer">Powodzenia! • ${words.length} słówek • wygenerowano przez AI (Gemini) • ${dateTag()}</p>
</body>
</html>`;
}

// ── 5. Interactive, self-graded quiz renderer ───────────────────────

/** Render the quiz JSON as a self-contained interactive HTML page: the user
 * picks/types answers in the browser tab and clicks "Sprawdź" to grade them
 * on the spot (no printing needed). */
function buildInteractiveQuizHtml(quiz, words) {
    const { escapeHtml, escapeAttr } = SharedUtils;
    const title = escapeHtml(quiz.title || "Quiz językowy");
    const sectionTitles = {
        multiple_choice: "Wielokrotny wybór",
        fill_blank: "Uzupełnij luki",
        matching: "Dopasuj pary",
        translation: "Przetłumacz",
        true_false: "Prawda czy fałsz",
        correct_form: "Popraw formę słowa",
        word_from_definition: "Zgadnij słowo",
        odd_one_out: "Który wyraz nie pasuje?",
    };
    const srcLang = words[0]?.srcLang || "en";
    const srcLangAdj = QUIZ_LANG_ADJ[srcLang] || srcLang.toUpperCase();
    const examTitle = `Sprawdzian z języka ${quizLangGenitive(srcLangAdj)}`;
    const totalPoints = quizTotalPoints(quiz);
    const totalQuestionsCount = quizTotalQuestions(quiz);
    const suggestedMinutes = quizSuggestedMinutes(totalQuestionsCount);
    // Speak icon for on-page TTS (Google Translate voice) — only ever attached to visible text, never to data-answer.
    const ttsIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
    const ttsBtn = (text, lang) =>
        text
            ? `<button type="button" class="tts-btn" data-tts-text="${escapeAttr(text)}" data-tts-lang="${escapeAttr(lang)}" onclick="qtSpeak(this)" title="Odczytaj na głos">${ttsIcon}</button>`
            : "";

    let qNum = 0;
    let secNum = 0;
    const sectionsHtml = (quiz.sections || [])
        .map((sec) => {
            secNum++;
            const heading = sectionTitles[sec.type] || sec.type;
            const secPoints = QUIZ_POINTS_PER_TYPE[sec.type] ?? 1;
            let body = "";
            if (sec.type === "multiple_choice" || sec.type === "odd_one_out") {
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
                            <p class="q-text"><b>${qNum}.</b> ${escapeHtml(q.question || "")} <span class="pts-badge">${secPoints} pkt</span></p>
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
                        return `<div class="q" data-qtype="text" data-qid="${qNum}" data-points="${secPoints}" data-answer="${escapeAttr(q.answer)}">
                            <div class="q-text-row"><p class="q-text"><b>${qNum}.</b> ${escapeHtml(q.sentence)} ${hint} <span class="pts-badge">${secPoints} pkt</span></p>${ttsBtn(q.sentence, srcLang)}</div>
                            <div class="input-row">
                                <input type="text" class="q-input" placeholder="Twoja odpowiedź… (Enter = sprawdź)" onkeydown="if(event.key==='Enter'){event.preventDefault();gradeQuestion(this.closest('.q'));}">
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
                            return `<div class="q match-row" data-qtype="select" data-qid="${qNum}" data-points="${secPoints}" data-answer="${escapeAttr(p.b)}">
                                <span class="match-left">${escapeHtml(p.a)}</span>${ttsBtn(p.a, srcLang)}
                                <select class="q-select" onchange="gradeQuestion(this.closest('.q'))"><option value="">— wybierz —</option>${opts}</select>
                                <span class="pts-badge pts-badge-inline">${secPoints} pkt</span>
                                <span class="q-feedback"></span>
                            </div>`;
                        })
                        .join("") +
                    `</div>`;
            } else if (sec.type === "translation") {
                body = (sec.questions || [])
                    .map((q) => {
                        qNum++;
                        return `<div class="q" data-qtype="text" data-qid="${qNum}" data-points="${secPoints}" data-answer="${escapeAttr(q.answer)}">
                            <div class="q-text-row"><p class="q-text"><b>${qNum}.</b> ${escapeHtml(q.prompt)} <span class="pts-badge">${secPoints} pkt</span></p>${ttsBtn(q.prompt, "pl")}</div>
                            <div class="input-row">
                                <input type="text" class="q-input" placeholder="Twoja odpowiedź… (Enter = sprawdź)" onkeydown="if(event.key==='Enter'){event.preventDefault();gradeQuestion(this.closest('.q'));}">
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
                        return `<div class="q" data-qtype="choice" data-qid="${qNum}" data-points="${secPoints}" data-answer="${q.answer ? "Prawda" : "Fałsz"}">
                            <div class="q-text-row"><p class="q-text"><b>${qNum}.</b> ${escapeHtml(q.statement)} <span class="pts-badge">${secPoints} pkt</span></p>${ttsBtn(q.statement, "pl")}</div>
                            <div class="opts">
                                <button type="button" class="opt" onclick="selectOpt(this)">Prawda</button>
                                <button type="button" class="opt" onclick="selectOpt(this)">Fałsz</button>
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
                            <div class="q-text-row"><p class="q-text"><b>${qNum}.</b> ${escapeHtml(q.sentence)} <span class="pts-badge">${secPoints} pkt</span></p>${ttsBtn(q.sentence, srcLang)}</div>
                            <div class="opts">${opts}</div>
                            <div class="q-feedback"></div>
                        </div>`;
                    })
                    .join("");
            } else if (sec.type === "word_from_definition") {
                body = (sec.questions || [])
                    .map((q) => {
                        qNum++;
                        return `<div class="q" data-qtype="text" data-qid="${qNum}" data-points="${secPoints}" data-answer="${escapeAttr(q.answer)}">
                            <div class="q-text-row"><p class="q-text"><b>${qNum}.</b> ${escapeHtml(q.definition)} <span class="pts-badge">${secPoints} pkt</span></p></div>
                            <div class="input-row">
                                <input type="text" class="q-input" placeholder="Twoja odpowiedź… (Enter = sprawdź)" onkeydown="if(event.key==='Enter'){event.preventDefault();gradeQuestion(this.closest('.q'));}">
                                <button type="button" class="btn-mini" onclick="gradeQuestion(this.closest('.q'))">✓</button>
                            </div>
                            <div class="q-match-bar"><div class="q-match-fill"></div><span class="q-match-label"></span></div>
                            <div class="q-feedback"></div>
                        </div>`;
                    })
                    .join("");
            }
            return `<section class="quiz-section"><h2>Zadanie ${secNum}. ${escapeHtml(heading)} <span class="quiz-section-points">(${secPoints} pkt)</span></h2><p class="instructions">${escapeHtml(sec.instructions || "")}</p>${body}</section>`;
        })
        .join("");

    return `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
    :root { --bg: #f7f7f8; --card: #ffffff; --border: #e2e2e6; --text: #1f2126; --muted: #74767d; --accent: #6d28d9; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; max-width: 760px; margin: 0 auto; padding: 30px 20px 60px; background: var(--bg); color: var(--text); line-height: 1.5; }
    h1 { font-size: 24px; margin: 0 0 4px; text-align: center; text-transform: uppercase; letter-spacing: 0.5px; }
    .subtitle { color: var(--muted); font-size: 13px; margin: 0 0 16px; text-align: center; }
    .exam-meta-row { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px 20px; font-size: 12.5px; color: var(--muted); background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 10px 14px; margin-bottom: 22px; }
    .exam-meta-row b { color: var(--text); }
    .pts-badge { display: inline-block; background: rgba(109, 40, 217, 0.1); color: var(--accent); font-size: 11px; font-weight: 700; border-radius: 999px; padding: 2px 9px; vertical-align: middle; white-space: nowrap; }
    .pts-badge-inline { margin: 0 4px; }
    .quiz-section-points { font-size: 13px; font-weight: normal; color: var(--accent); }
    h2 { font-size: 16px; margin: 0 0 4px; color: var(--accent); }
    .instructions { font-style: italic; color: var(--muted); font-size: 13px; margin: 0 0 14px; }
    .quiz-section { margin-bottom: 28px; }
    .q { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; margin-bottom: 10px; transition: border-color .2s; box-shadow: 0 1px 2px rgba(0,0,0,0.03); }
    .q-text { margin: 0 0 10px; font-size: 14px; }
    .opts { display: flex; flex-wrap: wrap; gap: 8px; }
    .opt { background: #f1f1f4; border: 1px solid var(--border); color: var(--text); padding: 8px 14px; border-radius: 8px; cursor: pointer; font-size: 13px; font-family: inherit; transition: all .15s; }
    .opt:hover { border-color: var(--accent); }
    .opt.selected { background: rgba(109, 40, 217, 0.1); border-color: var(--accent); color: var(--accent); }
    .q-input, .q-select { width: 100%; padding: 9px 12px; border-radius: 8px; border: 1px solid var(--border); background: #f1f1f4; color: var(--text); font-size: 13px; font-family: inherit; }
    .match-row { display: flex; align-items: center; gap: 12px; }
    .match-left { flex: 1; font-size: 14px; }
    .match-row .q-select { flex: 1; }
    .tile { display: inline-block; border: 1px solid var(--border); border-radius: 6px; padding: 3px 9px; margin: 2px 3px; background: #f1f1f4; font-size: 13px; }
    .input-row { display: flex; gap: 8px; }
    .input-row .q-input { flex: 1; }
    .btn-mini { flex: 0 0 auto; background: var(--accent); color: #fff; border: none; border-radius: 8px; padding: 0 16px; font-size: 14px; font-weight: 700; cursor: pointer; }
    .opt.opt-correct { background: rgba(22, 163, 74, 0.15) !important; border-color: #16a34a !important; color: #16a34a !important; }
    .opt.opt-incorrect { background: rgba(220, 38, 38, 0.15) !important; border-color: #dc2626 !important; color: #dc2626 !important; }
    .q-feedback { margin-top: 8px; font-size: 12.5px; font-weight: 600; }
    .q.correct { border-color: #16a34a; }
    .q.correct .q-feedback { color: #16a34a; }
    .q.incorrect { border-color: #dc2626; }
    .q.incorrect .q-feedback { color: #dc2626; }
    .q-feedback .fb-answer-label { color: var(--muted) !important; font-weight: 700; }
    .q-feedback .fb-answer-diff { font-weight: 800; font-size: 13.5px; letter-spacing: .2px; display: inline-block; margin-top: 2px; }
    .q-feedback .diff-ok { color: #16a34a !important; }
    .q-feedback .diff-bad { color: #dc2626 !important; background: rgba(220,38,38,0.13); border-radius: 3px; padding: 0 1px; }
    .q-match-bar { position: relative; height: 18px; background: #ececf1; border-radius: 999px; margin-top: 8px; overflow: hidden; display: none; }
    .q-match-fill { height: 100%; width: 0%; background: linear-gradient(90deg, #16a34a, #4ade80); transition: width .35s ease; border-radius: 999px; }
    .q-match-fill.low { background: linear-gradient(90deg, #dc2626, #f87171); }
    .q-match-label { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 10.5px; font-weight: 800; color: #1f2126; text-shadow: 0 1px 0 rgba(255,255,255,.5); }
    .actions { display: flex; gap: 10px; margin: 24px 0; }
    .actions button { font-size: 14px; font-weight: 700; padding: 12px 22px; border-radius: 10px; border: none; cursor: pointer; font-family: inherit; }
    .btn-check { background: var(--accent); color: #ffffff; }
    .btn-reset { background: #ffffff; color: var(--text); border: 1px solid var(--border) !important; }
    .score-box { padding: 16px; border-radius: 12px; font-size: 16px; font-weight: 700; text-align: center; }
    .score-box.good { background: rgba(22, 163, 74, 0.1); color: #16a34a; }
    .score-box.mid { background: rgba(217, 119, 6, 0.1); color: #d97706; }
    .score-box.bad { background: rgba(220, 38, 38, 0.1); color: #dc2626; }
    .q-text-row { display: flex; align-items: flex-start; gap: 6px; }
    .q-text-row .q-text { flex: 1; }
    .opt-row { display: inline-flex; align-items: center; gap: 2px; }
    .tts-btn { flex: 0 0 auto; background: none; border: none; color: var(--accent); cursor: pointer; padding: 4px; border-radius: 6px; display: inline-flex; align-items: center; opacity: .75; }
    .tts-btn svg { width: 16px; height: 16px; }
    .tts-btn:hover { opacity: 1; background: rgba(109, 40, 217, 0.1); }
    .tts-btn.tts-loading { opacity: 1; animation: tts-pulse 1s ease-in-out infinite; }
    @keyframes tts-pulse { 0%, 100% { opacity: .4; } 50% { opacity: 1; } }
    .hint-badge { display: inline-block; background: rgba(109, 40, 217, 0.08); color: var(--accent); border-radius: 999px; padding: 2px 9px; font-size: 11.5px; font-weight: 600; white-space: nowrap; vertical-align: middle; }
    .progress-wrap { background: #ececf1; border-radius: 999px; height: 10px; overflow: hidden; margin-bottom: 6px; }
    .progress-bar { height: 100%; width: 0%; background: linear-gradient(90deg, var(--accent), #a78bfa); transition: width .3s ease; border-radius: 999px; }
    .progress-label { font-size: 12px; color: var(--muted); margin: 0 0 10px; }
    .streak-badge { display: none; background: rgba(217, 119, 6, 0.12); color: #d97706; font-weight: 700; font-size: 12.5px; padding: 5px 12px; border-radius: 999px; margin: 0 0 18px; }
    .streak-badge.show { display: inline-block; animation: streak-pop .3s ease; }
    @keyframes streak-pop { 0% { transform: scale(0.6); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
    .confetti-piece { position: fixed; top: -12px; width: 8px; height: 14px; z-index: 9999; pointer-events: none; animation: confetti-fall linear forwards; border-radius: 2px; }
    @keyframes confetti-fall { to { transform: translateY(110vh) rotate(360deg); opacity: 0.85; } }
    .hud { position: sticky; top: 0; z-index: 600; background: linear-gradient(135deg, #ffffff, #f3f0ff); border: 1px solid var(--border); border-radius: 14px; padding: 12px 16px; margin-bottom: 18px; box-shadow: 0 2px 10px rgba(109,40,217,0.08); display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
    .hud-score { font-size: 15px; font-weight: 800; color: var(--accent); display: flex; align-items: center; gap: 6px; white-space: nowrap; }
    .hud-score .hud-score-num { font-size: 20px; display: inline-block; transition: transform .2s ease; }
    .hud-score.bump .hud-score-num { animation: score-bump .4s ease; }
    @keyframes score-bump { 0% { transform: scale(1); } 40% { transform: scale(1.35); color: #16a34a; } 100% { transform: scale(1); } }
    .hud-progress { flex: 1; min-width: 140px; }
    .hud-progress .progress-wrap, .hud-progress .progress-label { margin: 0; }
    .hud-streak { font-size: 13px; font-weight: 700; color: #d97706; background: rgba(217,119,6,0.12); border-radius: 999px; padding: 5px 12px; white-space: nowrap; opacity: 0; transform: scale(0.7); transition: all .25s ease; }
    .hud-streak.show { opacity: 1; transform: scale(1); }
    .particle { position: fixed; z-index: 9999; pointer-events: none; font-size: 20px; will-change: transform, opacity; animation: particle-burst .9s cubic-bezier(.2,.7,.3,1) forwards; }
    @keyframes particle-burst { 0% { transform: translate(0,0) scale(1) rotate(0deg); opacity: 1; } 100% { transform: translate(var(--dx), var(--dy)) scale(0.3) rotate(var(--rot)); opacity: 0; } }
    .point-popup { position: fixed; z-index: 9999; pointer-events: none; font-weight: 900; font-size: 18px; color: #16a34a; text-shadow: 0 1px 0 rgba(255,255,255,.6); animation: point-float 1s ease-out forwards; }
    @keyframes point-float { 0% { transform: translateY(0) scale(0.8); opacity: 0; } 15% { opacity: 1; transform: translateY(-6px) scale(1.15); } 100% { transform: translateY(-70px) scale(1); opacity: 0; } }
    .q.pop-correct { animation: pop-glow .55s ease; }
    @keyframes pop-glow { 0% { box-shadow: 0 0 0 rgba(22,163,74,0); } 35% { box-shadow: 0 0 26px rgba(22,163,74,0.5); } 100% { box-shadow: 0 0 0 rgba(22,163,74,0); } }
    .q.shake-wrong { animation: shake-anim .4s ease; }
    @keyframes shake-anim { 10%, 90% { transform: translateX(-2px); } 20%, 80% { transform: translateX(4px); } 30%, 50%, 70% { transform: translateX(-7px); } 40%, 60% { transform: translateX(7px); } }
    .combo-banner { position: fixed; top: 38%; left: 50%; z-index: 10000; pointer-events: none; font-size: 34px; font-weight: 900; color: #fff; text-align: center; text-shadow: 0 4px 16px rgba(0,0,0,.3); background: linear-gradient(135deg, var(--accent), #a78bfa); padding: 16px 30px; border-radius: 18px; opacity: 0; animation: combo-pop 1.2s ease forwards; }
    @keyframes combo-pop { 0% { opacity: 0; transform: translate(-50%,-50%) scale(0.3) rotate(-6deg); } 18% { opacity: 1; transform: translate(-50%,-50%) scale(1.15) rotate(2deg); } 32% { transform: translate(-50%,-50%) scale(1) rotate(0deg); } 78% { opacity: 1; transform: translate(-50%,-50%) scale(1); } 100% { opacity: 0; transform: translate(-50%,-62%) scale(1.05); } }
</style>
</head>
<body>
    <h1>${examTitle}</h1>
    <p class="subtitle">${title}</p>
    <div class="exam-meta-row">
        <span>📝 <b>${secNum}</b> zadań • <b>${qNum}</b> pytań</span>
        <span>🏆 Maks. liczba punktów: <b>${totalPoints}</b></span>
        <span>⏱️ Sugerowany czas pracy: <b>${suggestedMinutes} min</b></span>
        <span>${words.length} słówek • AI (Gemini) • ${dateTag()}</span>
    </div>
    <div class="hud">
        <div class="hud-score" id="hudScore">🏆 <span class="hud-score-num" id="hudScoreNum">0</span>&nbsp;/&nbsp;${totalPoints} pkt</div>
        <div class="hud-progress">
            <div class="progress-wrap"><div class="progress-bar" id="progressBar" style="width:0%"></div></div>
            <p class="progress-label" id="progressLabel">Odpowiedziano: 0 / ${qNum}</p>
        </div>
        <span class="hud-streak" id="hudStreak">🔥 Seria: 0</span>
    </div>
    <span class="streak-badge" id="streakBadge"></span>
    ${sectionsHtml}
    <div class="actions">
        <button type="button" class="btn-check" onclick="checkAllAnswers()">✅ Sprawdź wszystko i pokaż wynik</button>
        <button type="button" class="btn-reset" onclick="resetQuiz()">🔄 Zacznij od nowa</button>
    </div>
    <div id="scoreBox" class="score-box" style="display:none;"></div>
    <script>
    function selectOpt(btn) {
        var q = btn.closest('.q');
        var opts = q.querySelectorAll('.opt');
        for (var i = 0; i < opts.length; i++) { opts[i].classList.remove('selected'); }
        btn.classList.add('selected');
        q.dataset.selected = btn.textContent.trim();
        gradeQuestion(q); // instant feedback the moment an option is picked
    }
    function qtSpeak(btn) {
        var text = btn.getAttribute('data-tts-text');
        var lang = btn.getAttribute('data-tts-lang') || 'en';
        if (!text) return;
        btn.classList.add('tts-loading');
        var url = 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=' + encodeURIComponent(lang) + '&q=' + encodeURIComponent(text);
        var audio = new Audio(url);
        var stop = function () { btn.classList.remove('tts-loading'); };
        audio.addEventListener('ended', stop);
        audio.addEventListener('error', stop);
        audio.play().catch(stop);
    }
    function normalize(s) {
        return (s || '').toString().trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,!?;:]+$/, '');
    }
    function escapeHtmlClient(s) {
        return (s || '').toString()
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    // Full Levenshtein DP matrix (not just the distance) so we can backtrack
    // and figure out, character by character, which parts of the correct
    // answer the user actually got right vs. wrong/missing.
    function levenshteinMatrix(a, b) {
        var m = a.length, n = b.length;
        var d = [];
        for (var i = 0; i <= m; i++) d[i] = [i];
        for (var j = 0; j <= n; j++) d[0][j] = j;
        for (var i2 = 1; i2 <= m; i2++) {
            for (var j2 = 1; j2 <= n; j2++) {
                var cost = a[i2 - 1] === b[j2 - 1] ? 0 : 1;
                d[i2][j2] = Math.min(
                    d[i2 - 1][j2] + 1,        // deletion
                    d[i2][j2 - 1] + 1,        // insertion
                    d[i2 - 1][j2 - 1] + cost  // substitution / match
                );
            }
        }
        return d;
    }
    // Returns how similar the user's answer is to the expected answer, as a
    // 0-100 percentage (100 = identical after normalization).
    function matchPercent(userVal, answer) {
        var a = normalize(userVal), b = normalize(answer);
        if (a === b) return 100;
        var maxLen = Math.max(a.length, b.length);
        if (maxLen === 0) return 100;
        var d = levenshteinMatrix(a, b);
        var dist = d[a.length][b.length];
        return Math.max(0, Math.round((1 - dist / maxLen) * 100));
    }
    // Renders the correct answer as HTML where each character is colored
    // green if the user typed it correctly (right letter, right place) or
    // red if it's wrong/missing — so a typo jumps out immediately instead of
    // making the whole answer red. Comparison is case-insensitive but the
    // original casing/punctuation of the answer is what gets displayed.
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
                marks.push({ ch: b[j - 1], ok: false }); i--; j--; // substitution
            } else if (j > 0 && d[i][j] === d[i][j - 1] + 1) {
                marks.push({ ch: b[j - 1], ok: false }); j--; // missing char
            } else {
                i--; // extra char the user typed, not part of the answer
            }
        }
        marks.reverse();
        var html = '';
        for (var k = 0; k < marks.length; k++) {
            html += '<span class="' + (marks[k].ok ? 'diff-ok' : 'diff-bad') + '">' + escapeHtmlClient(marks[k].ch) + '</span>';
        }
        return html;
    }
    var PASS_THRESHOLD = 90; // % match at/above which a typed answer counts as correct
    // ── Fun extras: sound, streak counter, progress bar, confetti, explosions ──────
    var totalQuestions = document.querySelectorAll('.q').length;
    var answeredIds = {};
    var currentStreak = 0;
    var liveScore = 0;
    var PRAISE = ['Świetnie! 🎉', 'Brawo! 👏', 'Super! ⭐', 'Rewelacja! 🚀', 'Tak trzymaj! 💪', 'Perfekcyjnie! ✨', 'Ekstra! 🌟'];
    var ENCOURAGE = ['Prawie! Spróbuj jeszcze raz 💭', 'Nie poddawaj się! 🙂', 'Blisko! Sprawdź jeszcze raz 🔍', 'Ups! 🤔', 'Kolejnym razem się uda! 🍀'];
    function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
    function playTone(freq, duration) {
        try {
            var ctx = playTone._ctx || (playTone._ctx = new (window.AudioContext || window.webkitAudioContext)());
            var osc = ctx.createOscillator();
            var gain = ctx.createGain();
            osc.frequency.value = freq;
            osc.type = 'sine';
            gain.gain.setValueAtTime(0.16, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + duration);
        } catch (e) { /* audio not available — fail silently */ }
    }
    function updateProgress(qid) {
        if (qid) answeredIds[qid] = true;
        var bar = document.getElementById('progressBar');
        var label = document.getElementById('progressLabel');
        if (!bar || !label || !totalQuestions) return;
        var answered = Object.keys(answeredIds).length;
        var pct = Math.round((answered / totalQuestions) * 100);
        bar.style.width = pct + '%';
        label.textContent = 'Odpowiedziano: ' + answered + ' / ' + totalQuestions;
    }
    function updateHUD() {
        var numEl = document.getElementById('hudScoreNum');
        var wrap = document.getElementById('hudScore');
        if (numEl) numEl.textContent = liveScore;
        if (wrap) { wrap.classList.remove('bump'); void wrap.offsetWidth; wrap.classList.add('bump'); }
        var streakEl = document.getElementById('hudStreak');
        if (streakEl) {
            if (currentStreak >= 1) { streakEl.textContent = '🔥 Seria: ' + currentStreak; streakEl.classList.add('show'); }
            else { streakEl.classList.remove('show'); }
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
        el.textContent = '+' + pts + ' pkt';
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
        var y = rect.top + Math.min(30, rect.height / 2);
        spawnParticles(x, y, 16);
        floatPoints(x, rect.top, pts);
        q.classList.remove('pop-correct');
        void q.offsetWidth; // restart animation
        q.classList.add('pop-correct');
    }
    function shakeWrong(q) {
        q.classList.remove('shake-wrong');
        void q.offsetWidth; // restart animation
        q.classList.add('shake-wrong');
    }
    function updateStreak(isCorrect) {
        var badge = document.getElementById('streakBadge');
        if (isCorrect) {
            currentStreak++;
            if (badge && currentStreak >= 3) {
                badge.classList.remove('show');
                void badge.offsetWidth; // restart pop animation
                badge.textContent = '🔥 Seria: ' + currentStreak + ' z rzędu!';
                badge.classList.add('show');
            }
            var isMilestone = currentStreak === 3 || (currentStreak >= 5 && currentStreak % 5 === 0);
            if (isMilestone) {
                showComboBanner('🔥 COMBO x' + currentStreak + '! 🔥');
                spawnParticles(window.innerWidth / 2, window.innerHeight / 2, 28);
                playTone(1200, 0.22);
            }
        } else {
            currentStreak = 0;
            if (badge) badge.classList.remove('show');
        }
    }
    function launchConfetti() {
        var colors = ['#6d28d9', '#16a34a', '#d97706', '#dc2626', '#2563eb', '#a78bfa'];
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
    // Grades a single .q element on the spot (called from per-question
    // Enter/✓-button/auto-select triggers as well as the global "check all").
    function gradeQuestion(q) {
        if (!q) return false;
        var type = q.dataset.qtype;
        var answer = q.dataset.answer;
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
        if (!userVal) return false; // nothing entered yet — don't grade/count as answered
        var pct = null;
        var isCorrect;
        if (type === 'text') {
            // Free-text answers are graded by similarity, not exact equality:
            // a typed word/sentence that's ≥90% the same as the expected
            // answer (typos, small differences) still counts as correct.
            pct = matchPercent(userVal, answer);
            isCorrect = pct >= PASS_THRESHOLD;
        } else {
            isCorrect = normalize(userVal) === normalize(answer);
        }
        var pts = parseFloat(q.dataset.points) || 1;
        var wasCorrect = q.dataset.wasCorrect === '1';
        q.classList.remove('correct', 'incorrect');
        q.classList.add(isCorrect ? 'correct' : 'incorrect');
        var fb = q.querySelector('.q-feedback');
        if (fb) {
            var pctSuffix = pct !== null ? (' (zgodność: ' + pct + '%)') : '';
            if (isCorrect) {
                fb.innerHTML = '✓ ' + escapeHtmlClient(pick(PRAISE)) + pctSuffix;
            } else if (type === 'text') {
                // Show the correct answer with per-letter diff highlighting so
                // the user can instantly spot exactly where the typo is.
                var diffHtml = diffAnswerHtml(userVal, answer);
                fb.innerHTML = '✗ ' + escapeHtmlClient(pick(ENCOURAGE)) + pctSuffix +
                    '<br><span class="fb-answer-label">Poprawna odpowiedź:</span> <span class="fb-answer-diff">' + diffHtml + '</span>';
            } else {
                fb.innerHTML = '✗ ' + escapeHtmlClient(pick(ENCOURAGE)) + ' — <span class="fb-answer-label">Poprawna odpowiedź:</span> ' + escapeHtmlClient(answer);
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
                matchLabel.textContent = pct + '% zgodności' + (isCorrect ? ' ✓ zaliczone' : '');
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
        playTone(isCorrect ? 880 : 220, isCorrect ? 0.16 : 0.28);
        updateStreak(isCorrect);
        updateProgress(q.dataset.qid);
        if (isCorrect && !wasCorrect) {
            liveScore += pts;
            q.dataset.wasCorrect = '1';
            celebrateCorrect(q, pts);
        } else if (!isCorrect) {
            if (wasCorrect) liveScore -= pts;
            q.dataset.wasCorrect = '0';
            shakeWrong(q);
        }
        updateHUD();
        return isCorrect;
    }
    function gradeLabel(pct) {
        if (pct >= 95) return { name: 'celujący', num: 6 };
        if (pct >= 85) return { name: 'bardzo dobry', num: 5 };
        if (pct >= 70) return { name: 'dobry', num: 4 };
        if (pct >= 55) return { name: 'dostateczny', num: 3 };
        if (pct >= 40) return { name: 'dopuszczający', num: 2 };
        return { name: 'niedostateczny', num: 1 };
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
                // Still show the correct answer for anything left blank.
                qs[i].classList.remove('correct');
                qs[i].classList.add('incorrect');
                var fb2 = qs[i].querySelector('.q-feedback');
                if (fb2) fb2.textContent = '✗ Brak odpowiedzi — Poprawna odpowiedź: ' + qs[i].dataset.answer;
                continue;
            }
            if (gradeQuestion(qs[i])) { correct++; earnedPoints += pts; }
        }
        var box = document.getElementById('scoreBox');
        var pct = totalPoints ? Math.round((earnedPoints / totalPoints) * 100) : 0;
        var grade = gradeLabel(pct);
        box.style.display = 'block';
        box.textContent = 'Wynik: ' + earnedPoints + ' / ' + totalPoints + ' pkt (' + pct + '%) — Ocena: ' + grade.name + ' (' + grade.num + ')';
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
