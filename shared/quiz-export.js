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
//   1. Quiz mode toggle (PDF vs. interactive) + the "Generuj quiz" click handler
//   2. generateQuizWithGemini()   – calls Gemini, returns normalized quiz JSON
//   3. normalizeQuizData()        – defensive cleanup of the model's JSON
//   4. buildQuizHtml()            – renders a print-ready "PDF" quiz page
//   5. buildInteractiveQuizHtml() – renders a self-graded interactive quiz page

// ── 1. Quiz mode toggle + export button ────────────────────────────
let quizOutputMode = "pdf";
const quizModePdfBtn = document.getElementById("quizModePdf");
const quizModeInteractiveBtn = document.getElementById("quizModeInteractive");
function setQuizMode(mode) {
    quizOutputMode = mode;
    quizModePdfBtn.classList.toggle("active", mode === "pdf");
    quizModeInteractiveBtn.classList.toggle("active", mode === "interactive");
}
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
    const sorted = [...words].sort(
        (a, b) => (b.timestamp || 0) - (a.timestamp || 0),
    );
    const quizWords =
        scope === "all"
            ? sorted.slice(0, 60)
            : sorted.slice(0, parseInt(scope, 10));

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
    const LANG_ADJ = {
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
    const srcLang = words[0]?.srcLang || "en";
    const srcLangAdj = LANG_ADJ[srcLang] || srcLang.toUpperCase();

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
        "word_order",
        "error_correction",
        "odd_one_out",
    ];
    const shuffledTypes = [...allTypes].sort(() => Math.random() - 0.5);
    const sectionCount = 5 + Math.floor(Math.random() * 3); // 5-7 sections
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
                generationConfig: { temperature: 1, maxOutputTokens: 4500 },
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
    return normalizeQuizData(JSON.parse(jsonMatch[0]));
}

// ── 3. Response cleanup ─────────────────────────────────────────────

/**
 * Defensive cleanup applied to whatever Gemini returns before it's rendered.
 * The model sometimes uses slightly different field names (or leaves a
 * section empty) — this maps common variants to the exact field names the
 * renderers expect and drops any section that ends up with no real content,
 * so the quiz never shows a blank question / an empty "dopasuj pary" list.
 */
function normalizeQuizData(quiz) {
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
            if (sec.type === "word_order") {
                const qs = (sec.questions || []).filter(
                    (q) =>
                        q &&
                        Array.isArray(q.words) &&
                        q.words.length &&
                        q.answer,
                );
                if (!qs.length) return null;
                sec.questions = qs;
                return sec;
            }
            if (sec.type === "error_correction") {
                const qs = (sec.questions || []).filter(
                    (q) => q && q.sentence && q.answer,
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
        word_order: "Ułóż zdanie",
        error_correction: "Znajdź i popraw błąd",
        odd_one_out: "Który wyraz nie pasuje?",
    };

    let qNum = 0;
    const sectionsHtml = (quiz.sections || [])
        .map((sec) => {
            const heading = sectionTitles[sec.type] || sec.type;
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
            } else if (sec.type === "word_order") {
                body = (sec.questions || [])
                    .map((q) => {
                        qNum++;
                        const shuffled = [...(q.words || [])].sort(
                            () => Math.random() - 0.5,
                        );
                        const tiles = shuffled
                            .map(
                                (w) =>
                                    `<span class="quiz-tile">${escapeHtml(w)}</span>`,
                            )
                            .join(" ");
                        return `<div class="quiz-question"><p><b>${qNum}.</b> ${tiles}</p><p class="quiz-answer-line">Odpowiedź: ______________________________________</p></div>`;
                    })
                    .join("");
            } else if (sec.type === "error_correction") {
                body = (sec.questions || [])
                    .map((q) => {
                        qNum++;
                        return `<div class="quiz-question"><p><b>${qNum}.</b> ${escapeHtml(q.sentence)}</p><p class="quiz-answer-line">Poprawka: ______________________________________</p></div>`;
                    })
                    .join("");
            }
            return `<section class="quiz-section"><h2>${escapeHtml(heading)}</h2><p class="quiz-instructions">${escapeHtml(sec.instructions || "")}</p>${body}</section>`;
        })
        .join("");

    // Answer key on its own printed page
    const answerKeyHtml = (quiz.sections || [])
        .map((sec) => {
            if (
                sec.type === "multiple_choice" ||
                sec.type === "translation" ||
                sec.type === "fill_blank" ||
                sec.type === "word_order" ||
                sec.type === "error_correction" ||
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
    body { font-family: Georgia, 'Times New Roman', serif; max-width: 800px; margin: 30px auto; padding: 0 24px; color: #1a1a1a; line-height: 1.5; }
    h1 { font-size: 24px; border-bottom: 3px solid #333; padding-bottom: 8px; }
    h2 { font-size: 17px; margin-top: 28px; color: #333; }
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
    .print-bar { text-align: center; margin: 20px 0; }
    .print-bar button { font-size: 14px; padding: 8px 16px; cursor: pointer; }
    @media print { .print-bar { display: none; } }
</style>
</head>
<body>
    <div class="print-bar"><button onclick="window.print()">🖨️ Drukuj / Zapisz jako PDF</button></div>
    <h1>${title}</h1>
    <p>${words.length} słówek • wygenerowano przez AI (Gemini) • ${dateTag()}</p>
    ${sectionsHtml}
    <section class="answer-key">
        <h2>Klucz odpowiedzi</h2>
        <ol>${answerKeyHtml}</ol>
    </section>
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
        word_order: "Ułóż zdanie",
        error_correction: "Znajdź i popraw błąd",
        odd_one_out: "Który wyraz nie pasuje?",
    };
    const srcLang = words[0]?.srcLang || "en";
    // Speak icon for on-page TTS (Google Translate voice) — only ever attached to visible text, never to data-answer.
    const ttsIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
    const ttsBtn = (text, lang) =>
        text
            ? `<button type="button" class="tts-btn" data-tts-text="${escapeAttr(text)}" data-tts-lang="${escapeAttr(lang)}" onclick="qtSpeak(this)" title="Odczytaj na głos">${ttsIcon}</button>`
            : "";

    let qNum = 0;
    const sectionsHtml = (quiz.sections || [])
        .map((sec) => {
            const heading = sectionTitles[sec.type] || sec.type;
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
                        return `<div class="q" data-qtype="choice" data-qid="${qNum}" data-answer="${escapeAttr(q.answer)}">
                            <p class="q-text"><b>${qNum}.</b> ${escapeHtml(q.question || "")}</p>
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
                        return `<div class="q" data-qtype="text" data-qid="${qNum}" data-answer="${escapeAttr(q.answer)}">
                            <div class="q-text-row"><p class="q-text"><b>${qNum}.</b> ${escapeHtml(q.sentence)} ${hint}</p>${ttsBtn(q.sentence, srcLang)}</div>
                            <div class="input-row">
                                <input type="text" class="q-input" placeholder="Twoja odpowiedź… (Enter = sprawdź)" onkeydown="if(event.key==='Enter'){event.preventDefault();gradeQuestion(this.closest('.q'));}">
                                <button type="button" class="btn-mini" onclick="gradeQuestion(this.closest('.q'))">✓</button>
                            </div>
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
                            return `<div class="q match-row" data-qtype="select" data-qid="${qNum}" data-answer="${escapeAttr(p.b)}">
                                <span class="match-left">${escapeHtml(p.a)}</span>${ttsBtn(p.a, srcLang)}
                                <select class="q-select" onchange="gradeQuestion(this.closest('.q'))"><option value="">— wybierz —</option>${opts}</select>
                                <span class="q-feedback"></span>
                            </div>`;
                        })
                        .join("") +
                    `</div>`;
            } else if (sec.type === "translation") {
                body = (sec.questions || [])
                    .map((q) => {
                        qNum++;
                        return `<div class="q" data-qtype="text" data-qid="${qNum}" data-answer="${escapeAttr(q.answer)}">
                            <div class="q-text-row"><p class="q-text"><b>${qNum}.</b> ${escapeHtml(q.prompt)}</p>${ttsBtn(q.prompt, "pl")}</div>
                            <div class="input-row">
                                <input type="text" class="q-input" placeholder="Twoja odpowiedź… (Enter = sprawdź)" onkeydown="if(event.key==='Enter'){event.preventDefault();gradeQuestion(this.closest('.q'));}">
                                <button type="button" class="btn-mini" onclick="gradeQuestion(this.closest('.q'))">✓</button>
                            </div>
                            <div class="q-feedback"></div>
                        </div>`;
                    })
                    .join("");
            } else if (sec.type === "true_false") {
                body = (sec.questions || [])
                    .map((q) => {
                        qNum++;
                        return `<div class="q" data-qtype="choice" data-qid="${qNum}" data-answer="${q.answer ? "Prawda" : "Fałsz"}">
                            <div class="q-text-row"><p class="q-text"><b>${qNum}.</b> ${escapeHtml(q.statement)}</p>${ttsBtn(q.statement, "pl")}</div>
                            <div class="opts">
                                <button type="button" class="opt" onclick="selectOpt(this)">Prawda</button>
                                <button type="button" class="opt" onclick="selectOpt(this)">Fałsz</button>
                            </div>
                            <div class="q-feedback"></div>
                        </div>`;
                    })
                    .join("");
            } else if (sec.type === "word_order") {
                body = (sec.questions || [])
                    .map((q) => {
                        qNum++;
                        const shuffled = [...(q.words || [])].sort(
                            () => Math.random() - 0.5,
                        );
                        const tiles = shuffled
                            .map(
                                (w) =>
                                    `<span class="tile">${escapeHtml(w)}</span>`,
                            )
                            .join(" ");
                        return `<div class="q" data-qtype="text" data-qid="${qNum}" data-answer="${escapeAttr(q.answer)}">
                            <div class="q-text-row"><p class="q-text"><b>${qNum}.</b> ${tiles}</p>${ttsBtn(shuffled.join(" "), srcLang)}</div>
                            <div class="input-row">
                                <input type="text" class="q-input" placeholder="Ułóż zdanie… (Enter = sprawdź)" onkeydown="if(event.key==='Enter'){event.preventDefault();gradeQuestion(this.closest('.q'));}">
                                <button type="button" class="btn-mini" onclick="gradeQuestion(this.closest('.q'))">✓</button>
                            </div>
                            <div class="q-feedback"></div>
                        </div>`;
                    })
                    .join("");
            } else if (sec.type === "error_correction") {
                body = (sec.questions || [])
                    .map((q) => {
                        qNum++;
                        return `<div class="q" data-qtype="text" data-qid="${qNum}" data-answer="${escapeAttr(q.answer)}">
                            <div class="q-text-row"><p class="q-text"><b>${qNum}.</b> ${escapeHtml(q.sentence)}</p>${ttsBtn(q.sentence, srcLang)}</div>
                            <div class="input-row">
                                <input type="text" class="q-input" placeholder="Popraw zdanie… (Enter = sprawdź)" onkeydown="if(event.key==='Enter'){event.preventDefault();gradeQuestion(this.closest('.q'));}">
                                <button type="button" class="btn-mini" onclick="gradeQuestion(this.closest('.q'))">✓</button>
                            </div>
                            <div class="q-feedback"></div>
                        </div>`;
                    })
                    .join("");
            }
            return `<section class="quiz-section"><h2>${escapeHtml(heading)}</h2><p class="instructions">${escapeHtml(sec.instructions || "")}</p>${body}</section>`;
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
    h1 { font-size: 24px; margin: 0 0 4px; }
    .subtitle { color: var(--muted); font-size: 13px; margin: 0 0 24px; }
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
</style>
</head>
<body>
    <h1>${title}</h1>
    <p class="subtitle">${words.length} słówek • quiz interaktywny AI (Gemini) • ${dateTag()}</p>
    <div class="progress-wrap"><div class="progress-bar" id="progressBar" style="width:0%"></div></div>
    <p class="progress-label" id="progressLabel">Odpowiedziano: 0 / ${qNum}</p>
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
    // ── Fun extras: sound, streak counter, progress bar, confetti ──────
    var totalQuestions = document.querySelectorAll('.q').length;
    var answeredIds = {};
    var currentStreak = 0;
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
    function updateStreak(isCorrect) {
        var badge = document.getElementById('streakBadge');
        if (!badge) return;
        if (isCorrect) {
            currentStreak++;
            if (currentStreak >= 3) {
                badge.classList.remove('show');
                void badge.offsetWidth; // restart pop animation
                badge.textContent = '🔥 Seria: ' + currentStreak + ' z rzędu!';
                badge.classList.add('show');
            }
        } else {
            currentStreak = 0;
            badge.classList.remove('show');
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
        var isCorrect = normalize(userVal) === normalize(answer);
        q.classList.remove('correct', 'incorrect');
        q.classList.add(isCorrect ? 'correct' : 'incorrect');
        var fb = q.querySelector('.q-feedback');
        if (fb) fb.textContent = isCorrect ? ('✓ ' + pick(PRAISE)) : ('✗ ' + pick(ENCOURAGE) + ' — Poprawna odpowiedź: ' + answer);
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
        return isCorrect;
    }
    function checkAllAnswers() {
        var qs = document.querySelectorAll('.q');
        var total = 0, correct = 0;
        for (var i = 0; i < qs.length; i++) {
            total++;
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
            if (gradeQuestion(qs[i])) correct++;
        }
        var box = document.getElementById('scoreBox');
        var pct = total ? Math.round((correct / total) * 100) : 0;
        box.style.display = 'block';
        box.textContent = 'Wynik: ' + correct + ' / ' + total + ' (' + pct + '%)';
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
            qs[m].classList.remove('correct', 'incorrect');
            qs[m].dataset.selected = '';
            var fb = qs[m].querySelector('.q-feedback');
            if (fb) fb.textContent = '';
        }
        document.getElementById('scoreBox').style.display = 'none';
        answeredIds = {};
        currentStreak = 0;
        var streakBadge = document.getElementById('streakBadge');
        if (streakBadge) streakBadge.classList.remove('show');
        updateProgress();
    }
    </script>
</body>
</html>`;
}
