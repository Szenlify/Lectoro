/**
 * Lectoro – Content Script Entry Point
 * Handles text selection, floating translation/AI toolbar, and read-aloud highlighting.
 * Video player caption adapters and hotkey navigation are modularized under adapters/ and video/.
 */
(() => {
    "use strict";

    const {
        PREFIX,
        ICON_ID,
        SVG,
        showTooltip,
        hideTooltip,
        hideAll,
        showLoading,
        getTargetLang,
        translate: googleTranslate,
        escapeHtml,
        escapeAttr,
        langTag,
        isOwnUI,
        buildTooltipHtml,
        attachTooltipHandlers,
        addCleanup,
        runDismiss,
        cleanTextForTTS,
        pickBestVoice,
        ensureVoices,
    } = QT;

    // ═══════════════════════════════════════════════════════════════
    //  State
    // ═══════════════════════════════════════════════════════════════

    let iconEl = null;
    let currentText = "";
    let currentRect = null;
    let currentRange = null;
    let isReading = false;
    let iconShowFrame = null;
    let selectionRevision = 0;
    let readingSession = 0;
    let readingSafetyTimer = null;
    let readingMonitorTimer = null;
    let readingStartTimer = null;
    let activeReadingUtterance = null;
    let lastSpeechCancelAt = 0;

    // Register cleanup handlers with core
    addCleanup(() => {
        selectionRevision += 1;
        currentText = "";
        currentRect = null;
        currentRange = null;
        hideIcon();
    });
    addCleanup(() => {
        if (isReading) cleanupReading();
    });

    // ═══════════════════════════════════════════════════════════════
    //  Icon – Create & Position
    // ═══════════════════════════════════════════════════════════════

    function getIcon() {
        if (iconEl) return iconEl;
        iconEl = document.createElement("div");
        iconEl.id = ICON_ID;

        const translateBtn = document.createElement("button");
        translateBtn.type = "button";
        translateBtn.className = `${PREFIX}tb-btn ${PREFIX}tb-translate`;
        translateBtn.innerHTML = SVG.TRANSLATE;
        translateBtn.title = "Translate";
        translateBtn.addEventListener("click", onIconClick);

        const readBtn = document.createElement("button");
        readBtn.type = "button";
        readBtn.className = `${PREFIX}tb-btn ${PREFIX}tb-read`;
        readBtn.innerHTML = SVG.READ;
        readBtn.title = "Read aloud";
        readBtn.setAttribute("aria-pressed", "false");
        readBtn.addEventListener("click", onReadClick);

        const aiBtn = document.createElement("button");
        aiBtn.type = "button";
        aiBtn.className = `${PREFIX}tb-btn ${PREFIX}tb-ai`;
        aiBtn.innerHTML = SVG.AI;
        aiBtn.title = "AI Translate";
        aiBtn.addEventListener("click", onAITranslateClick);

        iconEl.appendChild(translateBtn);
        iconEl.appendChild(readBtn);
        iconEl.appendChild(aiBtn);
        document.body.appendChild(iconEl);
        return iconEl;
    }

    function showIcon(rect) {
        const icon = getIcon();
        const parent = QT.getOverlayParent();
        const inFullscreen = parent !== document.body;
        if (icon.parentElement !== parent) parent.appendChild(icon);
        if (iconShowFrame !== null) cancelAnimationFrame(iconShowFrame);
        icon.classList.remove("visible");

        const scrollX = inFullscreen ? 0 : window.scrollX;
        const scrollY = inFullscreen ? 0 : window.scrollY;
        icon.style.position = inFullscreen ? "fixed" : "absolute";
        const { width: ICON_W, height: ICON_H } = icon.getBoundingClientRect();
        const GAP = 8;
        const vpW = document.documentElement.clientWidth;
        const vpH = document.documentElement.clientHeight;

        const { x: mx, y: my } = QT.getMousePos();
        const {
            top: selTop,
            bottom: selBottom,
            left: selLeft,
            right: selRight,
            height,
        } = rect;

        let bestX = mx + GAP;
        let bestY = my - ICON_H / 2;

        function overlapsSelection(ix, iy) {
            return !(
                ix > selRight ||
                ix + ICON_W < selLeft ||
                iy > selBottom ||
                iy + ICON_H < selTop
            );
        }

        if (bestX + ICON_W <= vpW && !overlapsSelection(bestX, bestY)) {
            // good – right of mouse
        } else if (
            mx - GAP - ICON_W >= 0 &&
            !overlapsSelection(mx - GAP - ICON_W, bestY)
        ) {
            bestX = mx - GAP - ICON_W;
        } else if (selBottom + GAP + ICON_H <= vpH) {
            bestX = Math.max(4, Math.min(mx - ICON_W / 2, vpW - ICON_W - 4));
            bestY = selBottom + GAP;
        } else if (selTop - GAP - ICON_H >= 0) {
            bestX = Math.max(4, Math.min(mx - ICON_W / 2, vpW - ICON_W - 4));
            bestY = selTop - GAP - ICON_H;
        } else {
            bestX = selRight + GAP;
            bestY = selTop + (height - ICON_H) / 2;
        }

        bestX = Math.max(4, Math.min(bestX, vpW - ICON_W - 4));
        bestY = Math.max(4, Math.min(bestY, vpH - ICON_H - 4));

        icon.style.left = `${bestX + scrollX}px`;
        icon.style.top = `${bestY + scrollY}px`;
        iconShowFrame = requestAnimationFrame(() => {
            iconShowFrame = null;
            if (currentText) icon.classList.add("visible");
        });
    }

    function hideIcon() {
        if (iconShowFrame !== null) {
            cancelAnimationFrame(iconShowFrame);
            iconShowFrame = null;
        }
        if (iconEl) iconEl.classList.remove("visible");
    }

    // ═══════════════════════════════════════════════════════════════
    //  Icon Click → Translate
    // ═══════════════════════════════════════════════════════════════

    async function onIconClick(e) {
        e.stopPropagation();
        e.preventDefault();
        if (!currentText || !currentRect) return;

        const text = currentText;
        const rect = currentRect;
        const anchorNode = currentRange?.commonAncestorContainer;
        const anchorEl = anchorNode
            ? anchorNode.nodeType === Node.ELEMENT_NODE
                ? anchorNode
                : anchorNode.parentElement
            : null;
        const revision = selectionRevision;
        if (isReading) cleanupReading();
        hideIcon();
        showLoading(rect, "top", anchorEl);

        try {
            const targetLang = await getTargetLang();
            const { translated, detectedLang } = await googleTranslate(
                text,
                targetLang,
            );
            if (revision !== selectionRevision) return;
            const srcLang =
                typeof detectedLang === "string" ? detectedLang : "auto";

            const html = buildTooltipHtml({
                srcLang,
                targetLang,
                original: text,
                translated,
            });
            showTooltip(html, rect, "top", anchorEl);
            attachTooltipHandlers();
        } catch (err) {
            if (revision !== selectionRevision) return;
            console.error("[Quick Translator]", err);
            showTooltip(
                `<div class="${PREFIX}error">⚠ ${escapeHtml(err.message)}</div>`,
                rect,
                "top",
                anchorEl,
            );
        }
    }

    async function onAITranslateClick(e) {
        e.stopPropagation();
        e.preventDefault();
        if (!currentText || !currentRect) return;

        const text = currentText;
        const rect = currentRect;
        const anchorNode = currentRange?.commonAncestorContainer;
        const anchorEl = anchorNode
            ? anchorNode.nodeType === Node.ELEMENT_NODE
                ? anchorNode
                : anchorNode.parentElement
            : null;
        const revision = selectionRevision;
        if (isReading) cleanupReading();
        hideIcon();
        showLoading(rect, "top", anchorEl);

        try {
            const targetLang = await getTargetLang();
            const [aiRes, googleRes] = await Promise.all([
                QT.geminiMovieTranslate(text, targetLang),
                googleTranslate(text, targetLang).catch(() => ({
                    detectedLang: "auto",
                })),
            ]);
            if (revision !== selectionRevision) return;

            const { translation, explanation } = aiRes;
            const srcLang =
                typeof googleRes.detectedLang === "string"
                    ? googleRes.detectedLang
                    : "auto";

            const saveDataAttrs =
                `data-src="${escapeAttr(text)}" ` +
                `data-translated="${escapeAttr(translation)}" ` +
                `data-src-lang="${escapeAttr(srcLang)}" ` +
                `data-tgt-lang="${escapeAttr(targetLang)}" ` +
                `data-sentence="" data-sentence-translated=""`;

            const formattedExplanation = (typeof QT !== "undefined" && typeof QT.formatSpeechMarkup === "function")
                ? QT.formatSpeechMarkup(explanation, targetLang, { sourceLang: srcLang, originalText: text, quoteClass: `${PREFIX}tts-original-quote` })
                : escapeHtml(explanation);
            const formattedTranslation = (typeof QT !== "undefined" && typeof QT.formatSpeechMarkup === "function")
                ? QT.formatSpeechMarkup(translation, targetLang, { sourceLang: srcLang, originalText: text, quoteClass: `${PREFIX}tts-original-quote` })
                : escapeHtml(translation);

            const html = `
                <div class="${PREFIX}header"><span>AI Translation</span></div>
                <div class="${PREFIX}body">
                    <div class="${PREFIX}row">
                        <span class="${PREFIX}label">${srcLang.toUpperCase()}</span>
                        <span class="${PREFIX}text ${PREFIX}original">${escapeHtml(text)}</span>
                        <button class="${PREFIX}speak" data-text="${escapeAttr(text)}" data-lang="${escapeAttr(srcLang)}" title="Play original">${SVG.SPEAKER}</button>
                    </div>
                    <div class="${PREFIX}row" style="margin-top:8px;">
                        <span class="${PREFIX}label">${langTag(targetLang)}</span>
                        <span class="${PREFIX}text ${PREFIX}translated">${formattedTranslation}</span>
                        <button class="${PREFIX}speak" data-text="${escapeAttr(translation)}" data-lang="${escapeAttr(targetLang)}" title="Play translation">${SVG.SPEAKER}</button>
                    </div>
                    <div class="${PREFIX}ai-result" style="margin-top:10px; display:block;">
                        <div class="${PREFIX}ai-label">✨ AI Explanation:</div>
                        <div class="${PREFIX}ai-text">${formattedExplanation}</div>
                        <button class="${PREFIX}speak" data-text="${escapeAttr(explanation)}" data-lang="${escapeAttr(targetLang)}" data-source-lang="${escapeAttr(srcLang)}" data-original-text="${escapeAttr(text)}" title="Play explanation" style="margin-top:6px;">${SVG.SPEAKER}</button>
                    </div>
                    <div class="${PREFIX}ai-result" id="${PREFIX}ai-result" style="display:none;"></div>
                </div>
                <div class="${PREFIX}save-footer">
                    <button class="${PREFIX}save-word-btn ${PREFIX}save-footer-btn" ${saveDataAttrs} title="Save word with AI translation for review">
                        ${SVG.SAVE} <span>Save</span>
                    </button>
                    <button class="${PREFIX}save-ai-btn ${PREFIX}save-footer-btn" ${saveDataAttrs} title="Save with smart AI sentence (Gemini)">
                        ${SVG.SAVE_AI} <span>AI</span>
                    </button>
                </div>`;
            showTooltip(html, rect, "top", anchorEl);
            attachTooltipHandlers();
            await QT.speak(explanation, targetLang, {
                sourceLang: srcLang,
                originalText: text,
                isCancelled: () => revision !== selectionRevision,
            });
        } catch (err) {
            if (revision !== selectionRevision) return;
            console.error("[Quick Translator AI]", err);
            const limitReached = typeof GeminiProxy !== "undefined" && GeminiProxy.isLimitError?.(err);
            if (limitReached) {
                hideTooltip();
            } else {
                showTooltip(
                    `<div class="${PREFIX}error">⚠ ${escapeHtml(err.message)}</div>`,
                    rect,
                    "top",
                    anchorEl,
                );
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  Read-Aloud – Fragmented Text with Synchronized Highlighting
    // ═══════════════════════════════════════════════════════════════

    const READING_BLOCK_SELECTOR =
        "p,div,li,blockquote,pre,td,th,h1,h2,h3,h4,h5,h6,article,section";

    function getSelectedTextSegments(range) {
        const nodes = [];
        if (range.commonAncestorContainer.nodeType === Node.TEXT_NODE) {
            nodes.push(range.commonAncestorContainer);
        } else {
            const walker = document.createTreeWalker(
                range.commonAncestorContainer,
                NodeFilter.SHOW_TEXT,
            );
            let node;
            while ((node = walker.nextNode())) {
                try {
                    if (range.intersectsNode(node)) nodes.push(node);
                } catch (_) { }
            }
        }

        const segments = [];
        let fullText = "";
        let previousBlock = null;

        for (const node of nodes) {
            const start = node === range.startContainer ? range.startOffset : 0;
            const end =
                node === range.endContainer
                    ? range.endOffset
                    : node.data.length;
            if (end <= start) continue;

            const block = node.parentElement?.closest(READING_BLOCK_SELECTOR);
            if (
                segments.length > 0 &&
                block &&
                previousBlock &&
                block !== previousBlock
            ) {
                fullText += "\n";
            }

            const text = node.data.slice(start, end);
            const globalStart = fullText.length;
            fullText += text;
            segments.push({
                node,
                nodeStart: start,
                globalStart,
                globalEnd: fullText.length,
            });
            previousBlock = block || previousBlock;
        }

        return { fullText, segments };
    }

    function splitReadingOffsets(text, maxLength = 240) {
        const rawParts = [];
        let start = 0;

        const pushPart = (rawStart, rawEnd) => {
            let partStart = rawStart;
            let partEnd = rawEnd;
            while (partStart < partEnd && /\s/.test(text[partStart])) {
                partStart += 1;
            }
            while (partEnd > partStart && /\s/.test(text[partEnd - 1])) {
                partEnd -= 1;
            }
            if (partEnd > partStart) rawParts.push([partStart, partEnd]);
        };

        for (let i = 0; i < text.length; i += 1) {
            if (!/[.!?;,:\n]/.test(text[i])) continue;
            let end = i + 1;
            while (end < text.length && /[.!?;,:]/.test(text[end])) end += 1;
            while (end < text.length && /[ \t]/.test(text[end])) end += 1;
            pushPart(start, end);
            start = end;
            i = end - 1;
        }
        pushPart(start, text.length);

        const parts = [];
        for (const [partStart, partEnd] of rawParts) {
            let cursor = partStart;
            while (partEnd - cursor > maxLength) {
                const target = cursor + maxLength;
                let splitAt = target;
                while (splitAt > cursor && !/\s/.test(text[splitAt])) {
                    splitAt -= 1;
                }
                if (splitAt === cursor) splitAt = target;
                parts.push([cursor, splitAt]);
                cursor = splitAt;
                while (cursor < partEnd && /\s/.test(text[cursor])) {
                    cursor += 1;
                }
            }
            if (partEnd > cursor) parts.push([cursor, partEnd]);
        }
        return parts;
    }

    function getMappedPosition(segments, offset, isEnd) {
        if (isEnd) {
            for (let i = segments.length - 1; i >= 0; i -= 1) {
                const segment = segments[i];
                if (offset > segment.globalStart) {
                    const local = Math.min(offset, segment.globalEnd);
                    return {
                        node: segment.node,
                        offset:
                            segment.nodeStart +
                            Math.max(0, local - segment.globalStart),
                    };
                }
            }
        } else {
            for (const segment of segments) {
                if (offset < segment.globalEnd) {
                    const local = Math.max(offset, segment.globalStart);
                    return {
                        node: segment.node,
                        offset:
                            segment.nodeStart +
                            Math.max(0, local - segment.globalStart),
                    };
                }
            }
        }
        return null;
    }

    function buildReadingFragments(range, fallbackText) {
        try {
            const { fullText, segments } = getSelectedTextSegments(range);
            if (!fullText.trim() || segments.length === 0) throw new Error();

            return splitReadingOffsets(fullText)
                .map(([start, end]) => {
                    const rangeStart = getMappedPosition(
                        segments,
                        start,
                        false,
                    );
                    const rangeEnd = getMappedPosition(segments, end, true);
                    if (!rangeStart || !rangeEnd) return null;

                    const fragmentRange = document.createRange();
                    fragmentRange.setStart(rangeStart.node, rangeStart.offset);
                    fragmentRange.setEnd(rangeEnd.node, rangeEnd.offset);
                    const text = cleanTextForTTS(fullText.slice(start, end));
                    return text ? { text, range: fragmentRange } : null;
                })
                .filter(Boolean);
        } catch (_) {
            return fallbackText
                ? [{ text: fallbackText, range: range.cloneRange() }]
                : [];
        }
    }

    function clearSentenceHighlight() {
        try {
            if (typeof CSS !== "undefined" && CSS.highlights)
                CSS.highlights.delete("qt-reading-sentence");
        } catch (_) { }
    }

    function cleanupReading(session = null, hideToolbar = false) {
        if (session !== null && session !== readingSession) return;

        readingSession += 1;
        clearTimeout(readingSafetyTimer);
        clearTimeout(readingStartTimer);
        clearInterval(readingMonitorTimer);
        readingSafetyTimer = null;
        readingStartTimer = null;
        readingMonitorTimer = null;
        activeReadingUtterance = null;
        isReading = false;

        clearSentenceHighlight();
        if (iconEl) {
            const rb = iconEl.querySelector(`.${PREFIX}tb-read`);
            if (rb) {
                rb.classList.remove("reading");
                rb.setAttribute("aria-pressed", "false");
                rb.title = "Read aloud";
            }
        }
        if (hideToolbar) hideIcon();

        try {
            window.speechSynthesis.cancel();
            lastSpeechCancelAt = Date.now();
        } catch (error) {
            console.warn("[Lectoro] Could not cancel speech:", error);
        }
    }
    globalThis.cleanupReading = cleanupReading;

    function getReadingSafetyTimeout(text, rate) {
        const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
        const estimatedMs =
            (wordCount / Math.max(0.75, Number(rate) * 1.5 || 1.5)) * 1000;
        return Math.min(300000, Math.max(6000, estimatedMs + 4000));
    }

    function speakSelectedText(text, lang, settings, session, onEnd) {
        if (!isReading || session !== readingSession) return;

        let utter;
        try {
            settings ||= {};
            utter = new SpeechSynthesisUtterance(text);
            utter.lang = lang;
            utter.rate = Math.max(
                0.1,
                Math.min(10, Number(settings.speechRate) || 1.1),
            );
            const volume =
                settings.ttsVolume !== undefined
                    ? Number(settings.ttsVolume)
                    : 1;
            utter.volume = Number.isFinite(volume)
                ? Math.max(0, Math.min(1, volume))
                : 1;
            const voice = pickBestVoice(settings.speechVoice || "", lang);
            if (voice) utter.voice = voice;
        } catch (error) {
            console.warn("[Lectoro] Could not prepare speech:", error);
            cleanupReading(session, true);
            return;
        }

        let finished = false;
        let hasStarted = false;
        let idleSince = 0;
        let safetyTimer = null;
        let startTimer = null;
        let monitorTimer = null;
        const queuedAt = Date.now();
        const finish = (failed = false) => {
            if (finished || session !== readingSession) return;
            finished = true;
            clearTimeout(safetyTimer);
            clearTimeout(startTimer);
            clearInterval(monitorTimer);
            if (readingSafetyTimer === safetyTimer) readingSafetyTimer = null;
            if (readingStartTimer === startTimer) readingStartTimer = null;
            if (readingMonitorTimer === monitorTimer)
                readingMonitorTimer = null;
            if (activeReadingUtterance === utter) {
                activeReadingUtterance = null;
            }
            if (failed) cleanupReading(session, true);
            else onEnd();
        };

        utter.onstart = () => {
            hasStarted = true;
            idleSince = 0;
        };
        utter.onboundary = () => {
            hasStarted = true;
            idleSince = 0;
        };
        utter.onend = () => finish(false);
        utter.onerror = () => finish(true);
        utter.addEventListener?.("end", () => finish(false), { once: true });
        utter.addEventListener?.("error", () => finish(true), { once: true });
        safetyTimer = setTimeout(
            () => finish(true),
            getReadingSafetyTimeout(text, utter.rate),
        );
        readingSafetyTimer = safetyTimer;
        monitorTimer = setInterval(() => {
            if (finished || session !== readingSession) {
                clearInterval(monitorTimer);
                if (readingMonitorTimer === monitorTimer)
                    readingMonitorTimer = null;
                return;
            }

            const synthesisSpeaking = window.speechSynthesis.speaking;
            if (
                synthesisSpeaking ||
                (!hasStarted && window.speechSynthesis.pending)
            ) {
                hasStarted = true;
                idleSince = 0;
                return;
            }

            if (!hasStarted && Date.now() - queuedAt > 5000) {
                finish(true);
                return;
            }
            if (hasStarted) {
                if (!idleSince) idleSince = Date.now();
                if (Date.now() - idleSince > 750) finish(false);
            }
        }, 250);
        readingMonitorTimer = monitorTimer;

        const cancelGap = 100;
        const startDelay = Math.max(
            0,
            cancelGap - (Date.now() - lastSpeechCancelAt),
        );
        const startSpeech = () => {
            if (readingStartTimer === startTimer) readingStartTimer = null;
            startTimer = null;
            if (finished || !isReading || session !== readingSession) return;
            try {
                activeReadingUtterance = utter;
                window.speechSynthesis.resume();
                window.speechSynthesis.speak(utter);
            } catch (error) {
                console.warn("[Lectoro] Speech synthesis failed:", error);
                finish(true);
            }
        };
        if (startDelay > 0) {
            startTimer = setTimeout(startSpeech, startDelay);
            readingStartTimer = startTimer;
        } else {
            startSpeech();
        }
    }

    async function startSelectedTextReading(fragments, lang, session) {
        if (!isReading || session !== readingSession) return;

        try {
            if (typeof ensureVoices === "function") {
                await ensureVoices();
            } else if (typeof SharedUtils !== "undefined" && SharedUtils.ensureVoices) {
                await SharedUtils.ensureVoices();
            }
        } catch (_) { }

        if (!isReading || session !== readingSession) return;

        const start = (settings) => {
            if (!isReading || session !== readingSession) return;
            let index = 0;

            const readNext = () => {
                if (!isReading || session !== readingSession) return;
                if (index >= fragments.length) {
                    cleanupReading(session, true);
                    return;
                }

                const fragment = fragments[index];
                clearSentenceHighlight();
                try {
                    if (
                        fragment.range &&
                        typeof CSS !== "undefined" &&
                        CSS.highlights
                    ) {
                        CSS.highlights.set(
                            "qt-reading-sentence",
                            new Highlight(fragment.range),
                        );
                    }
                } catch (error) {
                    console.warn("[Lectoro] Fragment highlight failed:", error);
                }

                speakSelectedText(
                    fragment.text,
                    lang,
                    settings,
                    session,
                    () => {
                        index += 1;
                        readNext();
                    },
                );
            };

            readNext();
        };

        if (!chrome?.storage?.local) {
            start({ speechVoice: "", speechRate: 1.1, ttsVolume: 1 });
            return;
        }

        chrome.storage.local.get(
            { speechVoice: "", speechRate: 1.1, ttsVolume: 1 },
            start,
        );
    }

    function onReadClick(e) {
        e.stopPropagation();
        e.preventDefault();

        if (isReading) {
            cleanupReading();
            return;
        }
        if (!currentText) return;

        readingSession += 1;
        isReading = true;
        const session = readingSession;

        if (iconEl) {
            const rb = iconEl.querySelector(`.${PREFIX}tb-read`);
            if (rb) {
                rb.classList.add("reading");
                rb.setAttribute("aria-pressed", "true");
                rb.title = "Zatrzymaj czytanie";
            }
        }

        const utterText = cleanTextForTTS(currentText);
        if (!utterText) {
            cleanupReading(null, true);
            return;
        }

        const pageLang =
            document.documentElement.lang || navigator.language || "en";
        const fragments = currentRange
            ? buildReadingFragments(currentRange, utterText)
            : [{ text: utterText, range: null }];
        if (fragments.length === 0) {
            cleanupReading(null, true);
            return;
        }

        hideIcon();
        window.getSelection()?.removeAllRanges();
        startSelectedTextReading(fragments, pageLang, session);
    }

    // ═══════════════════════════════════════════════════════════════
    //  Selection Listener
    // ═══════════════════════════════════════════════════════════════

    function getSelectionAnchorRect(range) {
        const rects = Array.from(range.getClientRects()).filter(
            (rect) => rect.width > 0 || rect.height > 0,
        );
        if (rects.length === 0) return range.getBoundingClientRect();

        const { x, y } = QT.getMousePos();
        const containingMouse = rects.find(
            (rect) =>
                x >= rect.left &&
                x <= rect.right &&
                y >= rect.top &&
                y <= rect.bottom,
        );
        if (containingMouse) return containingMouse;

        return rects.reduce((closest, rect) => {
            const rectX = Math.max(rect.left, Math.min(x, rect.right));
            const rectY = Math.max(rect.top, Math.min(y, rect.bottom));
            const distance = (rectX - x) ** 2 + (rectY - y) ** 2;
            return !closest || distance < closest.distance
                ? { rect, distance }
                : closest;
        }, null).rect;
    }

    document.addEventListener("mouseup", (e) => {
        if (isOwnUI(e.target)) return;

        setTimeout(() => {
            if (QT.hoverClickActive) return;

            const selection = window.getSelection();
            const text = selection?.toString().trim();
            if (
                !text ||
                text.length === 0 ||
                text.length > 5000 ||
                !selection.rangeCount
            ) {
                hideAll();
                return;
            }

            const range = selection.getRangeAt(0);
            const rect = getSelectionAnchorRect(range);
            if (rect.width === 0 && rect.height === 0) {
                hideAll();
                return;
            }

            selectionRevision += 1;
            if (isReading) cleanupReading();
            currentText = text;
            currentRect = rect;
            currentRange = range.cloneRange();

            const anchorNode = range.commonAncestorContainer;
            const anchorEl = anchorNode
                ? anchorNode.nodeType === Node.ELEMENT_NODE
                    ? anchorNode
                    : anchorNode.parentElement
                : null;
            if (typeof QT.rememberScreenshotContext === "function") {
                QT.rememberScreenshotContext(rect, anchorEl);
            }

            hideTooltip();
            showIcon(rect);
        }, 10);
    });

    // ═══════════════════════════════════════════════════════════════
    //  Dismiss Handlers (click-away + Escape)
    // ═══════════════════════════════════════════════════════════════

    document.addEventListener("mousedown", (e) => {
        if (isOwnUI(e.target)) return;
        runDismiss();
        hideAll();
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            runDismiss();
            hideAll();
            return;
        }

        if (e.key === "Enter" || e.key === "NumpadEnter") {
            const active = document.activeElement;
            if (
                active &&
                (active.tagName === "INPUT" ||
                    active.tagName === "TEXTAREA" ||
                    active.isContentEditable)
            ) {
                return;
            }
            if (iconEl?.classList.contains("visible")) {
                e.preventDefault();
                e.stopPropagation();
                onAITranslateClick(e);
            }
        }
    });
})();
