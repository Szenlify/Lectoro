/**
 * Quick Translator – Hover Translate Module
 * Enables word-level hover translation on any website.
 * Hover = quick translation tooltip, Click = pronunciation + full sentence.
 * Toggle on/off from extension popup settings.
 *
 * Depends on: core.js (window.QT)
 */
(() => {
    "use strict";

    const {
        PREFIX,
        showTooltip,
        hideTooltip,
        showLoading,
        speak,
        getTargetLang,
        escapeHtml,
        buildTooltipHtml,
        attachTooltipHandlers,
        createTranslateCache,
        addDismissHandler,
        isOwnUI,
    } = QT;

    const LOG = "[Lectoro Hover]";
    const cache = createTranslateCache(300);

    // ── State ──────────────────────────────────────────────────────
    let enabled = false;
    let hoverTimer = null;
    let isHovering = false;
    let clickLocked = false;
    let lastWord = null;
    let pendingWordClick = null;

    // ── Setting ────────────────────────────────────────────────────

    function loadSetting() {
        if (chrome?.storage?.sync) {
            chrome.storage.sync.get({ hoverTranslate: false }, (d) => {
                enabled = d.hoverTranslate;
            });
        }
    }
    loadSetting();

    chrome.storage?.onChanged?.addListener((changes) => {
        if (changes.hoverTranslate) {
            enabled = changes.hoverTranslate.newValue;
            if (!enabled) cleanup();
        }
    });

    // ── Dismiss ────────────────────────────────────────────────────

    function dismiss() {
        if (!clickLocked) return;
        clickLocked = false;
        QT.hoverClickActive = false;
        hideTooltip();
        clearHighlight();
    }
    addDismissHandler(dismiss);

    function cleanup() {
        clearHighlight();
        isHovering = false;
        clearTimeout(hoverTimer);
        lastWord = null;
        clickLocked = false;
    }

    // ═══════════════════════════════════════════════════════════════
    //  Word Detection via caretRangeFromPoint
    // ═══════════════════════════════════════════════════════════════

    function getWordAtPoint(x, y) {
        const el = document.elementFromPoint(x, y);
        if (!el || isOwnUI(el)) return null;

        // Skip elements already handled by site-specific modules
        if (
            el.matches?.(
                `[class*="${PREFIX}yt-word"], [class*="${PREFIX}lm-word"], [class*="${PREFIX}reels-"]`,
            )
        )
            return null;
        // Skip anything inside reels overlay container
        if (el.closest?.(`.${PREFIX}reels-container`)) return null;

        // Skip form / interactive elements
        const tag = el.tagName;
        if (
            tag === "INPUT" ||
            tag === "TEXTAREA" ||
            tag === "SELECT" ||
            el.isContentEditable
        )
            return null;
        if (el.closest("a[href], button, [role='button']")) return null;

        // Get caret position from mouse coordinates
        let range;
        if (document.caretRangeFromPoint) {
            range = document.caretRangeFromPoint(x, y);
        } else if (document.caretPositionFromPoint) {
            const pos = document.caretPositionFromPoint(x, y);
            if (pos && pos.offsetNode) {
                range = document.createRange();
                range.setStart(pos.offsetNode, pos.offset);
                range.collapse(true);
            }
        }

        if (!range || range.startContainer.nodeType !== Node.TEXT_NODE)
            return null;

        const textNode = range.startContainer;
        const offset = range.startOffset;
        const text = textNode.textContent;

        if (!text || offset >= text.length) return null;

        // Find the word that contains the offset
        const wordRegex = /[\p{L}\p{N}''\u2019-]+/gu;
        let match;
        while ((match = wordRegex.exec(text)) !== null) {
            const start = match.index;
            const end = start + match[0].length;
            if (offset >= start && offset < end) {
                const word = match[0];
                const wordRange = document.createRange();
                wordRange.setStart(textNode, start);
                wordRange.setEnd(textNode, end);
                return { word, range: wordRange, textNode, start, end };
            }
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════════
    //  Sentence Extraction
    // ═══════════════════════════════════════════════════════════════

    function getSentenceAroundWord(textNode, wordStart, wordEnd) {
        let container = textNode.parentElement;
        const blockTags = new Set([
            "P",
            "DIV",
            "LI",
            "TD",
            "TH",
            "BLOCKQUOTE",
            "ARTICLE",
            "SECTION",
            "H1",
            "H2",
            "H3",
            "H4",
            "H5",
            "H6",
            "DD",
            "DT",
            "FIGCAPTION",
            "CAPTION",
        ]);
        while (
            container &&
            !blockTags.has(container.tagName) &&
            container !== document.body
        ) {
            container = container.parentElement;
        }
        if (!container || container === document.body)
            container = textNode.parentElement;

        const fullText = (
            container.innerText ||
            container.textContent ||
            ""
        ).trim();
        const word = textNode.textContent.substring(wordStart, wordEnd);

        const idx = fullText.lastIndexOf(word);
        if (idx === -1) return fullText;

        const enders = /[.!?…\n]/;
        let start = 0;
        for (let i = idx - 1; i >= 0; i--) {
            if (enders.test(fullText[i])) {
                start = i + 1;
                break;
            }
        }
        let end = fullText.length;
        for (let i = idx + word.length; i < fullText.length; i++) {
            if (enders.test(fullText[i])) {
                end = i + 1;
                break;
            }
        }

        const sentence = fullText.substring(start, end).trim();
        return sentence.length > word.length + 2 ? sentence : fullText;
    }

    // ═══════════════════════════════════════════════════════════════
    //  CSS Highlight API – hover word highlight
    // ═══════════════════════════════════════════════════════════════

    function highlightWord(range) {
        clearHighlight();
        try {
            if (typeof CSS !== "undefined" && CSS.highlights) {
                CSS.highlights.set("qt-hover-word", new Highlight(range));
            }
        } catch (_) {}
    }

    function clearHighlight() {
        try {
            if (typeof CSS !== "undefined" && CSS.highlights) {
                CSS.highlights.delete("qt-hover-word");
            }
        } catch (_) {}
    }

    // ═══════════════════════════════════════════════════════════════
    //  Hover Handler
    // ═══════════════════════════════════════════════════════════════

    async function handleHover(wordInfo) {
        if (clickLocked) return;
        isHovering = true;
        clearTimeout(hoverTimer);

        const { word, range } = wordInfo;
        if (!word || word.length > 60 || word.length < 2) return;

        highlightWord(range);

        hoverTimer = setTimeout(async () => {
            if (!isHovering || clickLocked) return;

            const rect = range.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;

            showLoading(rect);

            try {
                const targetLang = await getTargetLang();
                const { translated, detectedLang } = await cache.get(
                    word,
                    targetLang,
                );
                const srcLang =
                    typeof detectedLang === "string" ? detectedLang : "auto";

                if (!isHovering || clickLocked) return;

                showTooltip(
                    buildTooltipHtml({
                        srcLang,
                        targetLang,
                        original: word,
                        translated,
                    }),
                    rect,
                );
                attachTooltipHandlers();
            } catch (err) {
                console.error(LOG, err);
                showTooltip(
                    `<div class="${PREFIX}error">⚠ ${escapeHtml(err.message)}</div>`,
                    rect,
                );
            }
        }, 400);
    }

    function handleLeave() {
        isHovering = false;
        clearTimeout(hoverTimer);
        if (clickLocked) return;

        setTimeout(() => {
            if (
                !isHovering &&
                !clickLocked &&
                !QT.getTooltipEl()?.matches(":hover")
            ) {
                hideTooltip();
                clearHighlight();
            }
        }, 400);
    }

    // ═══════════════════════════════════════════════════════════════
    //  Click Handler – pronunciation + full sentence
    // ═══════════════════════════════════════════════════════════════

    async function handleClick(wordInfo) {
        // clickLocked & hoverClickActive already set in mousedown
        clearTimeout(hoverTimer);
        isHovering = false;

        const { word, range, textNode, start, end } = wordInfo;
        if (!word) {
            clickLocked = false;
            QT.hoverClickActive = false;
            return;
        }

        highlightWord(range);

        const sentence = getSentenceAroundWord(textNode, start, end);
        const rect = range.getBoundingClientRect();
        showLoading(rect);

        try {
            const targetLang = await getTargetLang();
            const { translated: wordTranslated, detectedLang } =
                await cache.get(word, targetLang);
            const srcLang =
                typeof detectedLang === "string" ? detectedLang : "auto";

            speak(word, srcLang);

            let fullTranslated = null;
            const showFullLine = sentence && sentence !== word;
            if (showFullLine) {
                fullTranslated = (await cache.get(sentence, targetLang))
                    .translated;
            }

            showTooltip(
                buildTooltipHtml({
                    srcLang,
                    targetLang,
                    original: word,
                    translated: wordTranslated,
                    fullLine: showFullLine ? sentence : null,
                    fullTranslated,
                    speakFullLine: true,
                }),
                rect,
            );
            attachTooltipHandlers();
        } catch (err) {
            console.error(LOG, err);
            showTooltip(
                `<div class="${PREFIX}error">⚠ ${escapeHtml(err.message)}</div>`,
                rect,
            );
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  Event Listeners
    // ═══════════════════════════════════════════════════════════════

    // Hover: detect word under cursor
    document.addEventListener("mousemove", (e) => {
        if (!enabled || clickLocked) return;

        // Don't hover while mouse button pressed (drag-select)
        if (e.buttons !== 0) return;

        // Don't hover when text is already selected
        const sel = window.getSelection();
        if (sel && sel.toString().trim().length > 0) return;

        const wordInfo = getWordAtPoint(e.clientX, e.clientY);

        if (wordInfo) {
            if (wordInfo.word !== lastWord) {
                lastWord = wordInfo.word;
                handleHover(wordInfo);
            }
        } else {
            if (lastWord) {
                lastWord = null;
                handleLeave();
            }
        }
    });

    // Click: mousedown – IMMEDIATELY lock state so content.js dismiss
    // (which also fires on mousedown) does not kill our tooltip.
    document.addEventListener(
        "mousedown",
        (e) => {
            if (!enabled || isOwnUI(e.target)) {
                pendingWordClick = null;
                return;
            }

            // If already showing a click-locked tooltip, dismiss it
            if (clickLocked) {
                pendingWordClick = null;
                dismiss();
                return;
            }

            // Skip interactive elements
            if (
                e.target.closest?.(
                    "a[href], button, input, textarea, select, [role='button']",
                )
            ) {
                pendingWordClick = null;
                return;
            }

            const wordInfo = getWordAtPoint(e.clientX, e.clientY);
            if (wordInfo && wordInfo.word.length >= 2) {
                // Lock immediately – prevents content.js dismiss from firing
                clickLocked = true;
                QT.hoverClickActive = true;
                isHovering = false;
                clearTimeout(hoverTimer);
                lastWord = null;
                pendingWordClick = {
                    wordInfo,
                    x: e.clientX,
                    y: e.clientY,
                };
            } else {
                pendingWordClick = null;
            }
        },
        true,
    ); // capture phase – fires before content.js

    // Click: mouseup confirms the click (no drag, no selection)
    document.addEventListener("mouseup", (e) => {
        if (!enabled || !pendingWordClick) {
            return;
        }
        if (isOwnUI(e.target)) {
            // Clicked on our own UI – abort word click but keep tooltip
            pendingWordClick = null;
            return;
        }

        // Ignore if user dragged (selection attempt)
        const dx = e.clientX - pendingWordClick.x;
        const dy = e.clientY - pendingWordClick.y;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
            pendingWordClick = null;
            clickLocked = false;
            QT.hoverClickActive = false;
            return;
        }

        // Ignore if text was selected
        const sel = window.getSelection();
        if (sel && sel.toString().trim().length > 0) {
            pendingWordClick = null;
            clickLocked = false;
            QT.hoverClickActive = false;
            return;
        }

        const wordInfo = pendingWordClick.wordInfo;
        pendingWordClick = null;
        handleClick(wordInfo);
    });
})();
