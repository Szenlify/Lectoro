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
        speak,
        getTargetLang,
        translate: googleTranslate,
        escapeHtml,
        escapeAttr,
        langTag,
        isOwnUI,
        saveWord,
        buildTooltipHtml,
        attachTooltipHandlers,
        addCleanup,
        addDismissHandler,
        runDismiss,
        cleanTextForTTS,
        pickBestVoice,
        getElAudioEl,
        setElAudioEl,
    } = QT;
    const Netflix = globalThis.LectoroNetflix || null;

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
        translateBtn.title = "Przetłumacz";
        translateBtn.addEventListener("click", onIconClick);

        const readBtn = document.createElement("button");
        readBtn.type = "button";
        readBtn.className = `${PREFIX}tb-btn ${PREFIX}tb-read`;
        readBtn.innerHTML = SVG.READ;
        readBtn.title = "Czytaj na głos";
        readBtn.setAttribute("aria-pressed", "false");
        readBtn.addEventListener("click", onReadClick);

        const aiBtn = document.createElement("button");
        aiBtn.type = "button";
        aiBtn.className = `${PREFIX}tb-btn ${PREFIX}tb-ai`;
        aiBtn.innerHTML = SVG.AI;
        aiBtn.title = "Tłumacz AI";
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

    function extractCueText(node) {
        const parts = [];

        function walk(current) {
            if (current.nodeType === Node.TEXT_NODE) {
                parts.push(current.nodeValue || "");
                return;
            }

            if (current.nodeType !== Node.ELEMENT_NODE) return;

            if (current.localName?.toLowerCase() === "br") {
                parts.push(" ");
                return;
            }

            const children = Array.from(current.childNodes);

            for (let i = 0; i < children.length; i += 1) {
                walk(children[i]);

                if (i < children.length - 1) {
                    const currentNode = children[i];
                    const nextNode = children[i + 1];

                    const left = currentNode.textContent || "";
                    const right = nextNode.textContent || "";

                    if (
                        left &&
                        right &&
                        !/\s$/.test(left) &&
                        !/^\s/.test(right) &&
                        /[\p{L}\p{N}]$/u.test(left) &&
                        /^[\p{L}\p{N}]/u.test(right)
                    ) {
                        parts.push(" ");
                    }
                }
            }
        }

        walk(node);

        return parts.join("").replace(/\s+/g, " ").trim();
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
        const revision = selectionRevision;
        if (isReading) cleanupReading();
        hideIcon();
        showLoading(rect);

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
            showTooltip(html, rect);
            attachTooltipHandlers();
        } catch (err) {
            if (revision !== selectionRevision) return;
            console.error("[Quick Translator]", err);
            showTooltip(
                `<div class="${PREFIX}error">⚠ ${escapeHtml(err.message)}</div>`,
                rect,
            );
        }
    }

    async function onAITranslateClick(e) {
        e.stopPropagation();
        e.preventDefault();
        if (!currentText || !currentRect) return;

        const text = currentText;
        const rect = currentRect;
        const revision = selectionRevision;
        if (isReading) cleanupReading();
        hideIcon();
        showLoading(rect);

        try {
            const targetLang = await getTargetLang();
            // Pobieramy tłumaczenie AI oraz równolegle detekcję języka z Google Translate
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
            // Reuse the same save-button contract as the regular translation
            // tooltip. The saved card keeps Gemini's translation, while the
            // AI option can additionally generate a memorable example sentence.
            const saveDataAttrs =
                `data-src="${escapeAttr(text)}" ` +
                `data-translated="${escapeAttr(translation)}" ` +
                `data-src-lang="${escapeAttr(srcLang)}" ` +
                `data-tgt-lang="${escapeAttr(targetLang)}" ` +
                `data-sentence="" data-sentence-translated=""`;
            const html = `
                <div class="${PREFIX}header"><span>AI Tłumaczenie</span></div>
                <div class="${PREFIX}body">
                    <div class="${PREFIX}row">
                        <span class="${PREFIX}label">${srcLang.toUpperCase()}</span>
                        <span class="${PREFIX}text ${PREFIX}original">${escapeHtml(text)}</span>
                        <button class="${PREFIX}speak" data-text="${escapeAttr(text)}" data-lang="${escapeAttr(srcLang)}" title="Odczytaj oryginał">${SVG.SPEAKER}</button>
                    </div>
                    <div class="${PREFIX}row" style="margin-top:8px;">
                        <span class="${PREFIX}label">${langTag(targetLang)}</span>
                        <span class="${PREFIX}text ${PREFIX}translated">${escapeHtml(translation)}</span>
                        <button class="${PREFIX}speak" data-text="${escapeAttr(translation)}" data-lang="${escapeAttr(targetLang)}" title="Odczytaj tłumaczenie">${SVG.SPEAKER}</button>
                    </div>
                    <div class="${PREFIX}ai-result" style="margin-top:10px; display:block;">
                        <div class="${PREFIX}ai-label">Wyjaśnienie</div>
                        <div class="${PREFIX}ai-text">${escapeHtml(explanation)}</div>
                        <button class="${PREFIX}speak" data-text="${escapeAttr(explanation)}" data-lang="${escapeAttr(targetLang)}" title="Odczytaj wyjaśnienie" style="margin-top:6px;">${SVG.SPEAKER}</button>
                    </div>
                    <div class="${PREFIX}ai-result" id="${PREFIX}ai-result" style="display:none;"></div>
                </div>
                <div class="${PREFIX}save-footer">
                    <button class="${PREFIX}save-word-btn ${PREFIX}save-footer-btn" ${saveDataAttrs} title="Zapisz słowo z tłumaczeniem wygenerowanym przez AI do powtórek">
                        ${SVG.SAVE} <span>Słowo</span>
                    </button>
                    <button class="${PREFIX}save-ai-btn ${PREFIX}save-footer-btn" ${saveDataAttrs} title="Zapisz z mądrym zdaniem AI (Gemini)">
                        ${SVG.SAVE_AI} <span>AI</span>
                    </button>
                </div>`;
            showTooltip(html, rect);
            attachTooltipHandlers();
            await QT.speak(explanation, targetLang, {
                isCancelled: () => revision !== selectionRevision,
            });
        } catch (err) {
            if (revision !== selectionRevision) return;
            console.error("[Quick Translator AI]", err);
            const limitReached = GeminiProxy?.isLimitError?.(err);
            if (limitReached) {
                hideTooltip();
            } else {
                showTooltip(
                    `<div class="${PREFIX}error">⚠ ${escapeHtml(err.message)}</div>`,
                    rect,
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
                } catch (_) {}
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
        } catch (_) {}
    }

    function cleanupReading(session = null, hideToolbar = false) {
        if (session !== null && session !== readingSession) return;

        // Invalidate callbacks from the utterance that is being cancelled.
        readingSession += 1;
        clearTimeout(readingSafetyTimer);
        clearTimeout(readingStartTimer);
        clearInterval(readingMonitorTimer);
        readingSafetyTimer = null;
        readingStartTimer = null;
        readingMonitorTimer = null;
        activeReadingUtterance = null;
        isReading = false;

        // Reset the DOM first. Browser/media APIs can occasionally throw
        // during teardown; that must never leave the visual state stuck.
        clearSentenceHighlight();
        if (iconEl) {
            const rb = iconEl.querySelector(`.${PREFIX}tb-read`);
            if (rb) {
                rb.classList.remove("reading");
                rb.setAttribute("aria-pressed", "false");
                rb.title = "Czytaj na głos";
            }
        }
        if (hideToolbar) hideIcon();

        try {
            window.speechSynthesis.cancel();
            lastSpeechCancelAt = Date.now();
        } catch (error) {
            console.warn("[Lectoro] Could not cancel speech:", error);
        }

        try {
            const audio = getElAudioEl();
            if (audio) {
                audio.pause();
                setElAudioEl(null);
            }
        } catch (error) {
            console.warn("[Lectoro] Could not stop audio:", error);
        }
    }

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
                Math.min(10, Number(settings.speechRate) || 1.3),
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

            // `pending` may stay true after an utterance has audibly ended on
            // some Chromium/Windows voice combinations. Once our utterance
            // has started, `speaking` is the reliable completion signal.
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

        // Chromium can report a fresh utterance as "interrupted" when it is
        // queued in the same tick as speechSynthesis.cancel(). Keep a short
        // gap and retain the utterance until it finishes (also avoids a known
        // Chromium garbage-collection issue with local utterance objects).
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

    function startSelectedTextReading(fragments, lang, session) {
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
            start({ speechVoice: "", speechRate: 1.3, ttsVolume: 1 });
            return;
        }

        chrome.storage.local.get(
            { speechVoice: "", speechRate: 1.3, ttsVolume: 1 },
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

        // Do not call cleanupReading() here. It invokes
        // speechSynthesis.cancel(), and Chromium may then reject the new
        // utterance started by the same click as "interrupted". At this point
        // isReading is false, so there is no toolbar reading session to clean.
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

        // Reading continues independently; the selection toolbar should no
        // longer cover the page once its action has been chosen.
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
            // Skip if hover-translate module just handled a click
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

            hideTooltip();
            showIcon(rect);
        }, 10);
    });

    // ═══════════════════════════════════════════════════════════════
    //  Dismiss Handlers (click-away + Escape)
    // ═══════════════════════════════════════════════════════════════

    document.addEventListener("mousedown", (e) => {
        if (isOwnUI(e.target)) return;
        // A click-locked subtitle tooltip must still close when the next
        // interaction starts elsewhere. subClickLocked protects only the
        // tooltip itself; keeping hoverClickActive here made every later text
        // selection get ignored until Escape was pressed.
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

    // ═══════════════════════════════════════════════════════════════
    //  PlayerAdapter & Unified Video/Subtitle Logic
    // ═══════════════════════════════════════════════════════════════

    const CAPTION_FALLBACK_MS = 300;

    // Detect the player technology instead of hard-coding hostnames. An
    // adapter therefore works on every site which embeds the same player.
    const DOM_CAPTION_ADAPTERS = [
        {
            id: "youtube",
            playerSelector: "#movie_player, .html5-video-player",
            containerSelector: ".ytp-caption-window-container",
            cueSelector: ".ytp-caption-segment",
        },
        {
            id: "videojs",
            playerSelector: ".video-js",
            containerSelector: ".vjs-text-track-display",
            cueSelector: ".vjs-text-track-cue div",
            leafOnly: true,
        },
        ...(Netflix?.captionAdapter ? [Netflix.captionAdapter] : []),
        {
            id: "shaka",
            playerSelector: ".shaka-video-container",
            containerSelector: ".shaka-text-container",
            cueSelector: ".shaka-text-container span",
            leafOnly: true,
        },
        {
            id: "jwplayer",
            playerSelector: ".jwplayer",
            containerSelector: ".jw-captions",
            cueSelector: ".jw-text-track-cue",
        },
        {
            id: "plyr",
            playerSelector: ".plyr",
            containerSelector: ".plyr__captions",
            cueSelector: ".plyr__caption",
        },
        {
            id: "clappr",
            playerSelector: ".clappr-container",
            containerSelector: ".clappr-subtitle, .cc-line",
            cueSelector: ".cc-line, .clappr-subtitle",
        },
    ];

    const videoSessions = new WeakMap();
    const liveVideoSessions = new Set();
    let activeVideo = null;
    let videoSweepTimer = null;

    function visibleVideoArea(video) {
        const rect = video.getBoundingClientRect();
        const width = Math.max(
            0,
            Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0),
        );
        const height = Math.max(
            0,
            Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0),
        );
        return width * height;
    }

    function selectBestVideo() {
        let best = null;
        let bestScore = -1;
        for (const session of liveVideoSessions) {
            const video = session.video;
            if (!video.isConnected) continue;
            const score =
                visibleVideoArea(video) +
                (!video.paused && !video.ended ? 1_000_000_000 : 0);
            if (score > bestScore) {
                best = video;
                bestScore = score;
            }
        }
        return best;
    }

    function getAdapterElements(binding) {
        if (!binding?.container?.isConnected) return [];
        const isLectoroElement = (element) =>
            Array.from(element?.classList || []).some((className) =>
                className.startsWith(PREFIX),
            );
        const candidates = Array.from(
            new Set([
                ...(binding.container.matches(binding.adapter.cueSelector)
                    ? [binding.container]
                    : []),
                ...binding.container.querySelectorAll(
                    binding.adapter.cueSelector,
                ),
            ]),
        );
        return candidates.filter((element) => {
            if (
                isOwnUI(element) ||
                isLectoroElement(element) ||
                !element.textContent?.trim()
            )
                return false;
            const hasPlayerOwnedChildCue = Array.from(
                element.querySelectorAll(binding.adapter.cueSelector),
            ).some((child) => !isOwnUI(child) && !isLectoroElement(child));
            return !binding.adapter.leafOnly || !hasPlayerOwnedChildCue;
        });
    }

    function findCaptionBinding(video) {
        if (!video?.isConnected) return null;

        for (const adapter of DOM_CAPTION_ADAPTERS) {
            const roots = [];
            const player = adapter.playerSelector
                ? video.closest(adapter.playerSelector)
                : null;
            if (player) roots.push(player);
            if (adapter.documentFallback) roots.push(document);
            if (roots.length === 0) continue;

            for (const root of roots) {
                const container = root.querySelector(adapter.containerSelector);
                if (container && !isOwnUI(container)) {
                    return { adapter, container };
                }
            }
        }
        return null;
    }

    function cueText(cue) {
        const raw = typeof cue?.text === "string" ? cue.text.trim() : "";
        if (!raw) return "";
        if (!raw.includes("<")) return raw;

        const holder = document.createElement("div");
        holder.innerHTML = raw;

        return extractCueText(holder);
    }

    function getNativeCueText(video) {
        if (!video?.textTracks) return "";
        const showing = [];
        const hidden = [];

        for (let i = 0; i < video.textTracks.length; i += 1) {
            const track = video.textTracks[i];
            if (
                !["subtitles", "captions"].includes(track.kind) ||
                track.mode === "disabled" ||
                !track.activeCues
            ) {
                continue;
            }
            const texts = Array.from(track.activeCues)
                .map(cueText)
                .filter(Boolean);
            if (texts.length === 0) continue;
            (track.mode === "showing" ? showing : hidden).push(...texts);
        }

        return Array.from(new Set(showing.length > 0 ? showing : hidden)).join(
            " ",
        );
    }

    function hasEnabledNativeCaptionTrack(video) {
        if (!video?.textTracks) return false;
        for (let i = 0; i < video.textTracks.length; i += 1) {
            const track = video.textTracks[i];
            if (
                ["subtitles", "captions"].includes(track.kind) &&
                track.mode !== "disabled"
            ) {
                return true;
            }
        }
        return false;
    }

    function queueSubtitleDomScan(session) {
        if (
            session !== videoSessions.get(session.video) ||
            session !== videoSessions.get(activeVideo) ||
            document.hidden ||
            session.domFrame !== null
        ) {
            return;
        }

        session.domFrame = requestAnimationFrame(() => {
            session.domFrame = null;
            if (session !== videoSessions.get(activeVideo)) return;
            makeSubtitlesInteractive(getAdapterElements(session.binding));
        });
    }

    function disconnectCaptionObserver(session) {
        session.domObserver?.disconnect();
        session.domObserver = null;
        if (session.domFrame !== null) cancelAnimationFrame(session.domFrame);
        session.domFrame = null;
    }

    function refreshCaptionBinding(session, forceScan = false) {
        if (
            session !== videoSessions.get(activeVideo) ||
            document.hidden ||
            !session.video.isConnected
        ) {
            return;
        }

        const current = session.binding;
        if (!current?.container?.isConnected) {
            disconnectCaptionObserver(session);
            session.binding = findCaptionBinding(session.video);
        }

        if (session.binding && !session.domObserver) {
            session.domObserver = new MutationObserver(() =>
                queueSubtitleDomScan(session),
            );
            session.domObserver.observe(session.binding.container, {
                childList: true,
                subtree: true,
                characterData: true,
            });
            forceScan = true;
        }

        if (forceScan) queueSubtitleDomScan(session);
    }

    function refreshNativeTracks(session) {
        const tracks = session.video.textTracks;
        if (!tracks) return;

        for (let i = 0; i < tracks.length; i += 1) {
            const track = tracks[i];
            if (!["subtitles", "captions"].includes(track.kind)) continue;
            if (session.tracks.has(track)) continue;
            session.tracks.add(track);
            track.addEventListener(
                "cuechange",
                () => {
                    session.nativeText = getNativeCueText(session.video);
                },
                { signal: session.controller.signal },
            );
        }
        session.nativeText = getNativeCueText(session.video);
    }

    function activateVideo(video) {
        const session = registerVideo(video);
        if (!session) return;

        if (activeVideo !== video) {
            const previous = videoSessions.get(activeVideo);
            if (previous) disconnectCaptionObserver(previous);
            activeVideo = video;
        }

        refreshNativeTracks(session);
        refreshCaptionBinding(session, true);
        if (typeof initControlBarHide === "function") initControlBarHide();
    }

    function teardownVideoSession(session) {
        if (!session || session !== videoSessions.get(session.video)) return;
        disconnectCaptionObserver(session);
        session.controller.abort();
        videoSessions.delete(session.video);
        liveVideoSessions.delete(session);
        if (activeVideo === session.video) activeVideo = null;
    }

    function scheduleVideoSweep() {
        if (videoSweepTimer !== null || liveVideoSessions.size === 0) return;
        videoSweepTimer = setTimeout(() => {
            videoSweepTimer = null;
            for (const session of Array.from(liveVideoSessions)) {
                if (!session.video.isConnected) teardownVideoSession(session);
            }
            if (!activeVideo) {
                const next = selectBestVideo();
                if (next) activateVideo(next);
            }
            scheduleVideoSweep();
        }, 10_000);
    }

    function registerVideo(video) {
        if (!(video instanceof HTMLVideoElement)) return null;
        const existing = videoSessions.get(video);
        if (existing) return existing;

        const controller = new AbortController();
        const session = {
            video,
            controller,
            tracks: new WeakSet(),
            nativeText: "",
            binding: null,
            domObserver: null,
            domFrame: null,
            lastFallbackAt: 0,
        };
        const signal = controller.signal;

        videoSessions.set(video, session);
        liveVideoSessions.add(session);
        refreshNativeTracks(session);

        video.addEventListener("play", () => activateVideo(video), { signal });
        video.addEventListener("loadedmetadata", () => activateVideo(video), {
            signal,
        });
        video.addEventListener(
            "emptied",
            () => {
                session.nativeText = "";
                session.binding = null;
                disconnectCaptionObserver(session);
            },
            { signal },
        );
        video.addEventListener(
            "timeupdate",
            () => {
                if (
                    activeVideo !== video ||
                    video.paused ||
                    video.ended ||
                    document.hidden
                ) {
                    return;
                }
                const now = performance.now();
                if (now - session.lastFallbackAt < CAPTION_FALLBACK_MS) return;
                session.lastFallbackAt = now;
                session.nativeText = getNativeCueText(video);
                if (hasEnabledNativeCaptionTrack(video)) return;
                refreshCaptionBinding(session, !session.binding);
            },
            { signal },
        );

        if (video.textTracks?.addEventListener) {
            const refresh = () => {
                refreshNativeTracks(session);
                if (activeVideo === video) refreshCaptionBinding(session, true);
            };
            video.textTracks.addEventListener("addtrack", refresh, { signal });
            video.textTracks.addEventListener("removetrack", refresh, {
                signal,
            });
            video.textTracks.addEventListener("change", refresh, { signal });
        }

        scheduleVideoSweep();
        return session;
    }

    const PlayerAdapter = {
        get type() {
            const session = videoSessions.get(this.getVideo());
            return session?.binding?.adapter?.id || "native";
        },
        getVideo() {
            if (activeVideo?.isConnected) return activeVideo;
            const best = selectBestVideo();
            if (best) {
                activateVideo(best);
                return best;
            }
            const first = document.querySelector("video");
            if (first) activateVideo(first);
            return first;
        },
        getSubtitleContainer() {
            const video = this.getVideo();
            if (!video) return null;
            const session = videoSessions.get(video);
            if (session && !session.binding?.container?.isConnected) {
                refreshCaptionBinding(session);
            }
            return session?.binding?.container || null;
        },
        getSubtitleElements() {
            const video = this.getVideo();
            if (!video) return [];
            const session = videoSessions.get(video);
            if (session && !session.binding?.container?.isConnected) {
                refreshCaptionBinding(session);
            }
            return getAdapterElements(session?.binding);
        },
        getCurrentText() {
            const video = this.getVideo();
            if (!video) return null;

            // Netflix:
            // najpierw próbujemy odczytać faktycznie wyrenderowane słowa.
            // captureRenderedLines() wykorzystuje pozycje tekstu na ekranie
            // i może odtworzyć brakujące spacje między osobnymi elementami.
            if (isNetflixPage() && Netflix?.captureRenderedLines) {
                const elements = this.getSubtitleElements();
                const renderedLines = Netflix.captureRenderedLines(elements);

                const renderedText = renderedLines
                    .map((line) => line.text)
                    .filter(Boolean)
                    .join(" ")
                    .replace(/\s+/g, " ")
                    .trim();

                if (renderedText) {
                    return renderedText;
                }
            }

            // Fallback dla innych playerów.
            const nativeText = getNativeCueText(video);
            if (nativeText) return nativeText;

            const text = this.getSubtitleElements()
                .map((element) => element.textContent.trim())
                .filter(Boolean)
                .join(" ");

            return text || null;
        },
    };

    function handleVideoLifecycleEvent(event) {
        if (!(event.target instanceof HTMLVideoElement)) return;
        registerVideo(event.target);
        if (event.type === "play" || event.type === "loadedmetadata") {
            activateVideo(event.target);
        }
    }

    document.addEventListener("play", handleVideoLifecycleEvent, true);
    document.addEventListener(
        "loadedmetadata",
        handleVideoLifecycleEvent,
        true,
    );
    document.addEventListener("visibilitychange", () => {
        const session = videoSessions.get(activeVideo);
        if (!session) return;
        if (document.hidden) disconnectCaptionObserver(session);
        else refreshCaptionBinding(session, true);
    });
    window.addEventListener("pagehide", () => {
        for (const session of Array.from(liveVideoSessions)) {
            teardownVideoSession(session);
        }
        clearTimeout(videoSweepTimer);
        videoSweepTimer = null;
    });

    const initialVideos = Array.from(document.querySelectorAll("video"));
    initialVideos.forEach(registerVideo);
    const initialVideo = selectBestVideo();
    if (initialVideo) activateVideo(initialVideo);

    function getAllCues(video) {
        if (!video?.textTracks) return [];
        const cues = [];
        for (let i = 0; i < video.textTracks.length; i++) {
            const track = video.textTracks[i];
            if (
                !["subtitles", "captions"].includes(track.kind) ||
                track.mode === "disabled" ||
                !track.cues
            ) {
                continue;
            }
            for (let j = 0; j < track.cues.length; j++)
                cues.push(track.cues[j]);
        }
        const seen = new Set();
        return cues
            .filter((c) => {
                const key = `${c.startTime.toFixed(3)}-${c.endTime.toFixed(3)}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .sort((a, b) => a.startTime - b.startTime);
    }

    function getCurrentCueIndex(cues, time) {
        let idx = 0;
        for (let i = cues.length - 1; i >= 0; i--) {
            if (time >= cues[i].startTime - 0.05) {
                idx = i;
                break;
            }
        }
        return idx;
    }

    function isNetflixPage() {
        return !!Netflix?.isPage?.();
    }

    function requestNetflixSeek(targetSeconds) {
        Netflix?.requestSeek?.(targetSeconds);
    }

    let netflixSubtitleNavigationPending = false;

    function getAdjacentCueTime(cues, currentTime, direction) {
        if (!Array.isArray(cues) || cues.length === 0) return null;
        if (direction > 0) {
            const next = cues.find((cue) => cue.startTime > currentTime + 0.08);
            return next?.startTime ?? null;
        }

        let previousIndex = -1;
        for (let index = cues.length - 1; index >= 0; index -= 1) {
            if (cues[index].startTime <= currentTime + 0.08) {
                previousIndex = index;
                break;
            }
        }
        if (previousIndex < 0) return null;
        const currentCue = cues[previousIndex];
        const isInsideCurrentCue =
            currentTime >= currentCue.startTime - 0.08 &&
            currentTime <= currentCue.endTime + 0.15;
        const targetIndex = isInsideCurrentCue
            ? previousIndex - 1
            : previousIndex;
        return targetIndex >= 0 ? cues[targetIndex].startTime : null;
    }

    async function navigateNetflixSubtitle(video, direction) {
        if (netflixSubtitleNavigationPending) return;
        netflixSubtitleNavigationPending = true;
        const wasPlaying = !video.paused;
        try {
            const nativeCues = getAllCues(video);
            let targetTime = getAdjacentCueTime(
                nativeCues,
                video.currentTime,
                direction,
            );
            if (targetTime === null) {
                if (wasPlaying) video.pause();
                QT.createHint("").show("Indeksuję napisy Netflixa…", 1200);
                targetTime = await Netflix?.getAdjacentSubtitleTime?.(
                    video.currentTime,
                    direction,
                );
            }
            if (!Number.isFinite(targetTime)) {
                QT.createHint("").show(
                    direction < 0
                        ? "Brak wcześniejszego zdania w napisach"
                        : "Brak następnego zdania w napisach",
                    2200,
                );
                if (wasPlaying && video.paused) video.play().catch(() => {});
                return;
            }
            requestNetflixSeek(targetTime);
        } catch (error) {
            console.warn(
                "[Lectoro] Netflix subtitle navigation failed:",
                error,
            );
            QT.createHint("").show(
                "Nie udało się załadować osi napisów Netflixa",
                2400,
            );
            if (wasPlaying && video.paused) video.play().catch(() => {});
        } finally {
            netflixSubtitleNavigationPending = false;
        }
    }

    async function captureVideoReviewScreenshot(video) {
        if (isNetflixPage())
            return (await Netflix.captureReviewImage(video)) || "";
        return QT.captureVideoScreenshot(video) || "";
    }

    // ═══════════════════════════════════════════════════════════════
    //  Subtitle Word Interactivity (Hover / Click)
    // ═══════════════════════════════════════════════════════════════
    const subCache = QT.createTranslateCache(300);
    let subHoverTimer = null;
    let isSubHovering = false;
    let subWasPlaying = false;
    let subClickLocked = false;
    let lastHoveredSubWord = null;
    let subTooltipAnchor = null;
    let subCloseTimer = null;
    // Netflix owns the subtitle DOM and its layout is sensitive to wrappers.
    // Keep the native subtitle nodes untouched and put transparent word hitboxes
    // over their actual rendered word rectangles instead.
    let netflixSubtitleHitLayer = null;
    let netflixSubtitleHitboxes = [];
    let netflixSubtitleSourceEls = new Set();

    function ensureNetflixSubtitleHitLayer() {
        const parent =
            document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.body;

        if (netflixSubtitleHitLayer?.isConnected) {
            if (netflixSubtitleHitLayer.parentElement !== parent) {
                parent.appendChild(netflixSubtitleHitLayer);
            }
            return netflixSubtitleHitLayer;
        }

        netflixSubtitleHitLayer = document.createElement("div");
        netflixSubtitleHitLayer.className =
            PREFIX + "netflix-subtitle-hit-layer";

        Object.assign(netflixSubtitleHitLayer.style, {
            position: "fixed",
            inset: "0px",
            width: "100vw",
            height: "100vh",
            pointerEvents: "none",
            zIndex: "2147483000",
        });

        parent.appendChild(netflixSubtitleHitLayer);
        return netflixSubtitleHitLayer;
    }

    function clearNetflixSubtitleHitboxes() {
        for (const hitbox of netflixSubtitleHitboxes) {
            hitbox.remove();
        }

        netflixSubtitleHitboxes = [];
        netflixSubtitleSourceEls.clear();
    }

    function createNetflixSubtitleHitboxes(el) {
        const layer = ensureNetflixSubtitleHitLayer();

        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);

        let textNode;

        while ((textNode = walker.nextNode())) {
            const text = textNode.nodeValue || "";

            for (const match of text.matchAll(/\S+/g)) {
                const start = match.index ?? 0;
                const end = start + match[0].length;

                const range = document.createRange();

                try {
                    range.setStart(textNode, start);
                    range.setEnd(textNode, end);
                } catch (_) {
                    range.detach?.();
                    continue;
                }

                const rects = Array.from(range.getClientRects()).filter(
                    (rect) => rect.width > 0 && rect.height > 0,
                );

                range.detach?.();

                for (const rect of rects) {
                    const hitbox = document.createElement("span");

                    hitbox.className = PREFIX + "sub-word";
                    hitbox.textContent = match[0];
                    hitbox.dataset[PREFIX + "netflixHitbox"] = "1";

                    Object.assign(hitbox.style, {
                        position: "fixed",
                        left: `${rect.left}px`,
                        top: `${rect.top}px`,
                        width: `${rect.width}px`,
                        height: `${rect.height}px`,
                        margin: "0",
                        padding: "0",
                        border: "0",
                        background: "transparent",
                        color: "transparent",
                        textShadow: "none",
                        lineHeight: "0",
                        pointerEvents: "auto",
                        cursor: "pointer",
                        fontSize: "0px",
                    });

                    layer.appendChild(hitbox);
                    netflixSubtitleHitboxes.push(hitbox);
                }
            }
        }

        netflixSubtitleSourceEls.add(el);
    }

    function refreshNetflixSubtitleHitboxes(els) {
        if (!isNetflixPage()) return false;

        const sourceElements = new Set(
            els.filter((el) => el?.textContent?.trim()),
        );

        clearNetflixSubtitleHitboxes();
        ensureNetflixSubtitleHitLayer();

        for (const el of sourceElements) {
            createNetflixSubtitleHitboxes(el);
        }

        return true;
    }

    function destroyNetflixSubtitleHitLayer() {
        clearNetflixSubtitleHitboxes();
        netflixSubtitleHitLayer?.remove();
        netflixSubtitleHitLayer = null;
    }

    function makeSubtitlesInteractive(
        els = PlayerAdapter.getSubtitleElements(),
    ) {
        if (isNetflixPage()) {
            refreshNetflixSubtitleHitboxes(els);
            return;
        }

        // Remove the Netflix hit layer when the active player changes.
        if (netflixSubtitleHitLayer) destroyNetflixSubtitleHitLayer();

        // On non-Netflix players it is safe to keep the existing approach and
        // split the subtitle element itself into word spans.
        for (const el of els) {
            const sourceText = el.textContent.trim();
            if (!sourceText) continue;

            if (
                el.dataset[PREFIX + "bound"] &&
                el.dataset[PREFIX + "source"] === sourceText &&
                el.querySelector(`.${PREFIX}sub-word`)
            ) {
                continue;
            }

            if (
                el.querySelector(
                    `div:not(.${PREFIX}sub-word), span:not(.${PREFIX}sub-word)`,
                )
            ) {
                continue;
            }

            el.dataset[PREFIX + "bound"] = "1";
            el.dataset[PREFIX + "source"] = sourceText;

            QT.splitIntoWordSpans(el, PREFIX + "sub-word");
        }
    }

    function closeSubTooltip() {
        if (!isSubHovering) return;

        const shouldResumeVideo = subWasPlaying;

        isSubHovering = false;
        subWasPlaying = false;
        subClickLocked = false;
        QT.hoverClickActive = false;

        clearTimeout(subHoverTimer);
        clearTimeout(subCloseTimer);

        subHoverTimer = null;
        subCloseTimer = null;

        subTooltipAnchor = null;

        if (lastHoveredSubWord) {
            lastHoveredSubWord.classList.remove(`${PREFIX}word-hover`);
            lastHoveredSubWord = null;
        }

        QT.hideTooltip();

        if (shouldResumeVideo) {
            const video = PlayerAdapter.getVideo();

            if (video && video.paused) {
                try {
                    const promise = video.play();
                    if (promise?.catch) {
                        promise.catch(() => {});
                    }
                } catch (_) {}
            }
        }
    }
    addDismissHandler(closeSubTooltip);

    // Delay closing so the cursor can travel from the word onto the tooltip
    // (which floats above/below it) without the video resuming prematurely.
    function scheduleCloseSubTooltip() {
        if (subCloseTimer !== null) return;

        subCloseTimer = setTimeout(() => {
            subCloseTimer = null;

            const tooltip = QT.getTooltipEl();

            if (tooltip?.matches(":hover")) {
                return;
            }

            if (subClickLocked) return;

            closeSubTooltip();
        }, 350);
    }

    document.addEventListener(
        "mousemove",
        (e) => {
            if (!activeVideo?.isConnected) {
                if (isSubHovering && !subClickLocked) closeSubTooltip();
                return;
            }
            if (
                isReading ||
                (typeof eTranslateActive !== "undefined" && eTranslateActive) ||
                (typeof wordCloudActive !== "undefined" && wordCloudActive)
            ) {
                if (isSubHovering && !subClickLocked) {
                    closeSubTooltip();
                }
                return;
            }

            if (subClickLocked) return;

            // Keep the subtitle tooltip open only while the cursor is over the
            // tooltip itself. Other extension UI must not pin it open.
            const tooltip = QT.getTooltipEl();

            if (tooltip && tooltip.contains(e.target)) {
                clearTimeout(subHoverTimer);
                clearTimeout(subCloseTimer);
                subHoverTimer = null;
                subCloseTimer = null;
                return;
            }

            const wordSpan = isOwnUI(e.target)
                ? null
                : QT.findWordAtPoint(e.clientX, e.clientY, PREFIX + "sub-word");

            if (wordSpan && wordSpan !== lastHoveredSubWord) {
                clearTimeout(subCloseTimer);
                subCloseTimer = null;
                if (lastHoveredSubWord)
                    lastHoveredSubWord.classList.remove(`${PREFIX}word-hover`);
                lastHoveredSubWord = wordSpan;
                wordSpan.classList.add(`${PREFIX}word-hover`);

                clearTimeout(subHoverTimer);
                const video = PlayerAdapter.getVideo();

                if (!isSubHovering) {
                    subWasPlaying = video ? !video.paused : false;
                }

                isSubHovering = true;
                subTooltipAnchor = wordSpan;

                // Pauza od razu po wejściu na słowo
                if (video && !video.paused) {
                    try {
                        video.pause();
                    } catch (_) {}
                }

                clearTimeout(subHoverTimer);

                subHoverTimer = setTimeout(async () => {
                    if (lastHoveredSubWord !== wordSpan) return;

                    const text = wordSpan.textContent.trim();
                    if (!text) return;

                    const rect = wordSpan.getBoundingClientRect();
                    const subtitleTooltipPlacement = isNetflixPage()
                        ? "bottom"
                        : "top";

                    QT.showLoading(rect, subtitleTooltipPlacement);
                    ensureSubtitleUiTracking();

                    try {
                        const targetLang = await QT.getTargetLang();
                        const res = await subCache.get(text, targetLang);

                        if (!isSubHovering || lastHoveredSubWord !== wordSpan)
                            return;

                        const html = QT.buildTooltipHtml({
                            srcLang: res.detectedLang,
                            targetLang,
                            original: text,
                            translated: res.translated,
                        });

                        QT.showTooltip(html, rect, subtitleTooltipPlacement);

                        QT.attachTooltipHandlers();
                    } catch (err) {
                        if (isSubHovering && lastHoveredSubWord === wordSpan) {
                            QT.showTooltip(
                                `<div class="${PREFIX}error">⚠ ${QT.escapeHtml(err.message)}</div>`,
                                rect,
                                subtitleTooltipPlacement,
                            );
                        }
                    }
                }, 0);
            } else if (!wordSpan) {
                clearTimeout(subHoverTimer);
                if (lastHoveredSubWord) {
                    lastHoveredSubWord.classList.remove(`${PREFIX}word-hover`);
                    lastHoveredSubWord = null;
                }
                // This also runs when leaving the tooltip after the word was
                // already cleared. That transition used to leave the tooltip
                // open and the video paused indefinitely.
                if (isSubHovering) scheduleCloseSubTooltip();
            } else {
                clearTimeout(subCloseTimer);
                subCloseTimer = null;
            }
        },
        true,
    );

    // A cursor leaving the document produces no further mousemove events in
    // the page, so close immediately instead of leaving playback paused.
    document.documentElement.addEventListener("mouseleave", () => {
        if (isSubHovering && !subClickLocked) closeSubTooltip();
    });

    // Click: word translation + the full subtitle line it belongs to
    async function handleSubWordClick(wordSpan) {
        if (isReading) cleanupReading();
        clearTimeout(subHoverTimer);
        clearTimeout(subCloseTimer);
        subCloseTimer = null;
        const wasAlreadyHovering = isSubHovering;
        subClickLocked = true;
        QT.hoverClickActive = true;
        isSubHovering = true;
        subTooltipAnchor = wordSpan;

        if (lastHoveredSubWord && lastHoveredSubWord !== wordSpan)
            lastHoveredSubWord.classList.remove(`${PREFIX}word-hover`);
        lastHoveredSubWord = wordSpan;
        wordSpan.classList.add(`${PREFIX}word-hover`);

        const video = PlayerAdapter.getVideo();
        if (!wasAlreadyHovering) subWasPlaying = video ? !video.paused : false;
        if (video && !video.paused) video.pause();

        const text = wordSpan.textContent.trim();
        if (!text) {
            closeSubTooltip();
            return;
        }

        const sentence = PlayerAdapter.getCurrentText() || text;
        const rect = wordSpan.getBoundingClientRect();
        const subtitleTooltipPlacement = isNetflixPage() ? "bottom" : "top";
        QT.showLoading(rect, subtitleTooltipPlacement);
        ensureSubtitleUiTracking();

        try {
            const targetLang = await QT.getTargetLang();
            const wordRes = await subCache.get(text, targetLang);
            const srcLang =
                typeof wordRes.detectedLang === "string"
                    ? wordRes.detectedLang
                    : "auto";

            const showFullLine = sentence && sentence !== text;
            let fullTranslated = null;
            if (showFullLine) {
                fullTranslated = (await subCache.get(sentence, targetLang))
                    .translated;
            }

            if (!isSubHovering || lastHoveredSubWord !== wordSpan) return;

            const html = QT.buildTooltipHtml({
                srcLang,
                targetLang,
                original: text,
                translated: wordRes.translated,
                fullLine: showFullLine ? sentence : null,
                fullTranslated,
                speakFullLine: true,
            });
            QT.showTooltip(html, rect, subtitleTooltipPlacement);
            QT.attachTooltipHandlers();
            QT.speak(text, srcLang);
        } catch (err) {
            if (isSubHovering)
                QT.showTooltip(
                    `<div class="${PREFIX}error">⚠ ${QT.escapeHtml(err.message)}</div>`,
                    rect,
                    subtitleTooltipPlacement,
                );
        }
    }

    document.addEventListener(
        "click",
        (e) => {
            if (!activeVideo?.isConnected) return;
            if (isOwnUI(e.target)) return;
            const wordSpan = QT.findWordAtPoint(
                e.clientX,
                e.clientY,
                PREFIX + "sub-word",
            );
            if (wordSpan) {
                e.preventDefault();
                e.stopPropagation();
                handleSubWordClick(wordSpan);
            }
        },
        true,
    );

    // ═══════════════════════════════════════════════════════════════
    //  AI Explanations & Reels Mode
    // ═══════════════════════════════════════════════════════════════

    let aiTooltipActive = false;
    let aiWasPlaying = false;
    let aiShimmerEl = null;
    let aiExplainKeydownHandler = null;

    /** "AI thinking" loader placed exactly above the current subtitle
     *  line(s) — a pulsing orbiting orb + bouncing dots make it obvious a
     *  click registered and the AI response is on its way, without
     *  covering/altering the subtitle text itself. */
    function showAiShimmer(rect) {
        removeAiShimmer();

        const parent =
            document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.body;

        aiShimmerEl = document.createElement("div");
        aiShimmerEl.className = `${PREFIX}ai-loader`;

        aiShimmerEl.innerHTML = `
        <span class="${PREFIX}ai-loader-label">Analizuje...</span>
    `;

        parent.appendChild(aiShimmerEl);

        positionAiShimmer(rect);
        ensureSubtitleUiTracking();
    }

    function positionAiShimmer(rect) {
        if (!aiShimmerEl || !rect) return;
        const loaderRect = aiShimmerEl.getBoundingClientRect();
        let left = rect.left + (rect.width - loaderRect.width) / 2;
        left = Math.max(
            4,
            Math.min(left, window.innerWidth - loaderRect.width - 4),
        );
        aiShimmerEl.style.left = left + "px";
        aiShimmerEl.style.top = rect.top - loaderRect.height - 10 + "px";
    }
    function removeAiShimmer() {
        if (aiShimmerEl) {
            aiShimmerEl.remove();
            aiShimmerEl = null;
        }
    }
    addCleanup(removeAiShimmer);

    function closeAiTooltip() {
        if (aiExplainKeydownHandler) {
            window.removeEventListener("keydown", aiExplainKeydownHandler);
            aiExplainKeydownHandler = null;
        }
        if (!aiTooltipActive) return;
        aiTooltipActive = false;
        hideTooltip();
        removeAiShimmer();
        if (aiWasPlaying) {
            aiWasPlaying = false;
            const video = PlayerAdapter.getVideo();
            if (video && video.paused) video.play();
        }
    }
    addDismissHandler(closeAiTooltip);

    /** Wire the "save to review" button inside the AI-explain tooltip:
     *  stores the original + translated sentence together with a video
     *  screenshot in the spaced-repetition deck. */
    function wireAiExplainSaveButton(
        text,
        translation,
        explanation,
        targetLang,
    ) {
        const tooltipNode = document.getElementById(PREFIX + "tooltip");
        const saveBtn = tooltipNode?.querySelector(
            `.${PREFIX}ai-explain-save-btn`,
        );
        if (!saveBtn) return;

        // 1. UI: Dodanie plakietki z klawiszem "1" do przycisku (jeśli jeszcze nie istnieje)
        if (!saveBtn.querySelector(`.${PREFIX}key-hint`)) {
            const hintNode = document.createElement("kbd");
            hintNode.className = `${PREFIX}key-hint`;
            hintNode.textContent = "PageDown";
            saveBtn.appendChild(hintNode);
        }

        // 2. Obsługa zdarzenia kliknięcia
        saveBtn.addEventListener("click", async (ev) => {
            ev.stopPropagation();
            if (saveBtn.classList.contains("saved")) return;
            const screenshot = await captureVideoReviewScreenshot(
                PlayerAdapter.getVideo(),
            );
            try {
                await saveWord({
                    original: text,
                    translated: translation || text,
                    srcLang: "en",
                    tgtLang: targetLang,
                    sentence: "",
                    sentenceTranslated: "",
                    aiSentence: explanation || "",
                    aiSentenceTranslated: "",
                    screenshot,
                    url: window.location.href,
                    timestamp: Date.now(),
                    downloaded: false,
                });
                saveBtn.innerHTML = `${SVG.SAVE_SENTENCE_CHECK} <span>Zapisano!</span>`;
                saveBtn.classList.add("saved");
            } catch (error) {
                saveBtn.innerHTML = `${SVG.SAVE_SENTENCE} <span>Limit planu</span>`;
                saveBtn.title = error.message;
            }
        });

        // 3. Obsługa skrótu klawiszowego "PageDown"
        if (aiExplainKeydownHandler) {
            window.removeEventListener("keydown", aiExplainKeydownHandler);
        }
        aiExplainKeydownHandler = (ev) => {
            // Ignoruj wciśnięcie, jeśli użytkownik pisze w jakimś polu tekstowym
            const isTyping =
                ["INPUT", "TEXTAREA"].includes(ev.target?.tagName) ||
                ev.target?.isContentEditable;
            if (isTyping) return;

            if (ev.key === "PageDown") {
                // Jeśli przycisk nadal istnieje w DOM, wywołaj kliknięcie
                if (document.contains(saveBtn)) {
                    ev.preventDefault();
                    saveBtn.click();
                } else {
                    window.removeEventListener(
                        "keydown",
                        aiExplainKeydownHandler,
                    );
                    aiExplainKeydownHandler = null;
                }
            }
        };

        window.addEventListener("keydown", aiExplainKeydownHandler);
    }

    async function handleAIExplain(video) {
        const text = PlayerAdapter.getCurrentText();
        if (!text) return;
        if (isReading) cleanupReading();

        // Exit any active in-place translation/word-cloud mode first so it
        // doesn't fight over the same subtitle DOM.
        if (eTranslateActive || wordCloudActive) {
            restoreOriginal();
        }

        aiTooltipActive = true;
        aiWasPlaying = !video.paused;
        if (aiWasPlaying) video.pause();

        // Prefer the exact rect of the currently rendered subtitle text so the
        // shimmer + tooltip always line up with what's actually on screen —
        // above the subtitles, not pinned to the top of the page — no matter
        // the site/player or window width.
        const rect =
            getSubtitleRect() ||
            (() => {
                const container = PlayerAdapter.getSubtitleContainer();
                return container
                    ? container.getBoundingClientRect()
                    : {
                          left: window.innerWidth / 2 - 100,
                          top: window.innerHeight - 150,
                          width: 200,
                          height: 50,
                      };
            })();

        showAiShimmer(rect);
        try {
            const targetLang = await getTargetLang();
            const res = await QT.geminiExplainSentence(text, targetLang);
            if (!aiTooltipActive) return;
            removeAiShimmer();

            const translation = res.translation || "";
            const explanation = res.explanation || res;
            const aiSpeechText = [translation, explanation]
                .filter(Boolean)
                .join(". ");

            const html = `
                <div class="${PREFIX}header"><span>✨ AI Wyjaśnia</span></div>
                <div class="${PREFIX}body">
                    <div class="${PREFIX}row">
                        <span class="${PREFIX}label">EN</span>
                        <span class="${PREFIX}text ${PREFIX}original">${escapeHtml(text)}</span>
                    </div>
                    <div class="${PREFIX}row">
                        <span class="${PREFIX}label">PL</span>
                        <span class="${PREFIX}text ${PREFIX}translated" >${escapeHtml(translation)}</span>
                        <button class="${PREFIX}speak" data-text="${escapeAttr(aiSpeechText)}" data-lang="pl" title="Odczytaj tłumaczenie i wyjaśnienie">${SVG.SPEAKER}</button>
                    </div>
                    <div class="${PREFIX}ai-result" style="margin-top:10px;">
                        <div class="${PREFIX}ai-label">Wyjaśnienie:</div>
                        <div class="${PREFIX}ai-text">${escapeHtml(explanation)}</div>
                    </div>
                </div>
                <div class="${PREFIX}save-footer">
                    <button class="${PREFIX}ai-explain-save-btn ${PREFIX}save-footer-btn" title="Zapisz zdanie razem ze zdjęciem do powtórek">
                        ${SVG.SAVE_SENTENCE} <span>Zapisz do powtórek</span>
                    </button>
                </div>`;
            showTooltip(html, rect, "top");
            attachTooltipHandlers();
            wireAiExplainSaveButton(text, translation, explanation, targetLang);

            // One utterance preserves the intended order. Starting two
            // separate QT.speak() calls would make the second cancel the first.
            if (aiTooltipActive) {
                await speak(aiSpeechText, "pl", {
                    isCancelled: () => !aiTooltipActive,
                });
            }
        } catch (err) {
            removeAiShimmer();
            if (aiTooltipActive) {
                const limitReached = GeminiProxy?.isLimitError?.(err);
                if (limitReached) {
                    closeAiTooltip();
                } else {
                    showTooltip(
                        `<div class="${PREFIX}error">⚠ ${escapeHtml(err.message)}</div>`,
                        rect,
                        "top",
                    );
                }
            }
        }
    }

    // Reels Mode only restyles the existing subtitles (no separate overlay):
    // moves them ~30% above the bottom edge and makes them white with a
    // black outline on a transparent background, so they stay readable
    // over bright video backgrounds.
    let reelsMode = false;

    function setReelsMode(on) {
        reelsMode = on;
        if (on) {
            document.body.classList.add(`${PREFIX}reels-active`);
            QT.createHint("").show("Reels ON 🎬", 2500);
        } else {
            document.body.classList.remove(`${PREFIX}reels-active`);
            QT.createHint("").show("Reels OFF", 2000);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  Speed Overlay
    // ═══════════════════════════════════════════════════════════════
    let speedOverlayEl = null;
    let speedOverlayTimer = null;
    function showSpeedOverlay(speed) {
        if (!speedOverlayEl) {
            speedOverlayEl = document.createElement("div");
            speedOverlayEl.style.cssText =
                "position:fixed; top:40px; right:40px; background:rgba(0,0,0,0.8); color:#fff; padding:10px 16px; border-radius:8px; font-family:sans-serif; font-size:16px; font-weight:bold; z-index:2147483647; opacity:0; transition:opacity 0.2s ease; pointer-events:none;";
            document.body.appendChild(speedOverlayEl);
        }
        speedOverlayEl.textContent = `Prędkość: ${speed.toFixed(2)}x`;
        speedOverlayEl.style.opacity = "1";
        clearTimeout(speedOverlayTimer);
        speedOverlayTimer = setTimeout(
            () => (speedOverlayEl.style.opacity = "0"),
            2000,
        );
    }

    // ═══════════════════════════════════════════════════════════════
    //  Keyboard Subtitle Navigation (all video sites)
    // ═══════════════════════════════════════════════════════════════

    let eTranslateActive = false;
    let eOriginalContents = [];
    let eWasPlaying = false;
    let wordCloudActive = false;
    let wordCloudEls = [];
    let wordCloudSourceLayers = [];
    let wordCloudWasPlaying = false;
    let subtitleModeRevision = 0;
    let subtitleModeStarting = false;
    let subtitleResumeRevision = 0;
    let subtitleUiTrackingFrame = null;
    const wordCloudCache = QT.createTranslateCache(300);
    const SIMPLE_WORDS = new Set([
        "an",
        "and",
        "are",
        "as",
        "at",
        "be",
        "but",
        "by",
        "can",
        "can't",
        "could",
        "did",
        "do",
        "does",
        "for",
        "from",
        "had",
        "has",
        "have",
        "he",
        "her",
        "here",
        "his",
        "if",
        "in",
        "into",
        "is",
        "it",
        "its",
        "me",
        "my",
        "not",
        "of",
        "on",
        "or",
        "our",
        "she",
        "should",
        "so",
        "some",
        "that",
        "the",
        "their",
        "them",
        "there",
        "they",
        "this",
        "to",
        "too",
        "us",
        "was",
        "we",
        "were",
        "what",
        "when",
        "where",
        "which",
        "who",
        "why",
        "will",
        "with",
        "won't",
        "would",
        "you",
        "your",
        "yours",
    ]);

    function shouldTranslateWord(rawText) {
        const text = (rawText || "").trim();
        if (!text) return false;

        // Pomijamy słowa zawierające cyfry
        if (/\d/.test(text)) return false;

        // Pomijamy, jeśli nie ma żadnych liter (np. same znaki zapytania)
        if (/^[^A-Za-z]+$/.test(text)) return false;

        // Zostawiamy tylko litery i apostrofy, zamieniamy na małe litery
        const cleanWord = text.replace(/[^A-Za-z']/g, "").toLowerCase();

        // 1. Sprawdzamy pojedyncze litery (np. "a", "i", "w", "z").
        // Jeśli długość to 1 lub 0, NIE tłumaczymy.
        if (cleanWord.length <= 1) return false;

        // 2. Jeśli całe słowo (np. "he", "can't", "won't") jest na liście, NIE tłumaczymy
        if (SIMPLE_WORDS.has(cleanWord)) return false;

        // 3. Usuwamy najpopularniejsze angielskie końcówki skrótowe
        const baseWord = cleanWord.replace(/(n't|'s|'ll|'d|'re|'ve|'m)$/, "");

        // 4. Jeśli po odcięciu końcówki (np. z "I'm" zostało "i") jest to 1 litera, NIE tłumaczymy
        if (baseWord.length <= 1) return false;

        // 5. Ostateczne sprawdzenie: czy rdzeń słowa (np. "he" z "he's") jest na liście?
        return !SIMPLE_WORDS.has(baseWord);
    }

    function removeWordClouds() {
        wordCloudEls.forEach(({ cloud }) => cloud.remove());
        wordCloudEls = [];
        wordCloudSourceLayers.forEach(({ layer }) => layer.remove());
        wordCloudSourceLayers = [];
        document
            .querySelectorAll("." + PREFIX + "word-cloud-highlight")
            .forEach((el) => {
                el.classList.remove(PREFIX + "word-cloud-highlight");
            });
        wordCloudActive = false;
    }

    function positionWordCloud(cloud, span) {
        if (!cloud?.isConnected || !span?.isConnected) return;
        const rect = span.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;
        const cloudRect = cloud.getBoundingClientRect();
        let left = rect.left + (rect.width - cloudRect.width) / 2;
        let top = rect.top - cloudRect.height + 8;
        left = Math.max(
            4,
            Math.min(left, window.innerWidth - cloudRect.width - 4),
        );
        if (top < 4) top = rect.bottom + 4;
        cloud.style.left = left + "px";
        cloud.style.top = top + "px";
    }

    function ensureSubtitleUiTracking() {
        if (subtitleUiTrackingFrame !== null) return;
        subtitleUiTrackingFrame = requestAnimationFrame(trackSubtitleUi);
    }

    function trackSubtitleUi() {
        subtitleUiTrackingFrame = null;

        if (translationOverlay?.isConnected) positionOverlay();

        for (const { cloud, span } of wordCloudEls) {
            positionWordCloud(cloud, span);
        }

        if (isSubHovering && subTooltipAnchor) {
            if (subTooltipAnchor.isConnected) {
                QT.positionTooltip(
                    subTooltipAnchor.getBoundingClientRect(),
                    "top",
                );
            } else {
                closeSubTooltip();
            }
        }

        if (aiTooltipActive) {
            const rect = getSubtitleRect();
            if (rect) {
                positionAiShimmer(rect);
                if (QT.getTooltipEl()?.classList.contains("visible")) {
                    QT.positionTooltip(rect, "top");
                }
            }
        }

        if (
            translationOverlay?.isConnected ||
            wordCloudEls.length > 0 ||
            isSubHovering ||
            aiTooltipActive
        ) {
            subtitleUiTrackingFrame = requestAnimationFrame(trackSubtitleUi);
        }
    }

    async function showWordClouds(video, opts = { skipSpeech: false }) {
        const modeRevision = opts.revision ?? subtitleModeRevision;
        if (modeRevision !== subtitleModeRevision) return;
        const subEls =
            opts.sourceElements || PlayerAdapter.getSubtitleElements();
        if (subEls.length === 0) return;
        const fullText =
            opts.sourceText ||
            subEls
                .map((el) => el.textContent.trim())
                .filter(Boolean)
                .join(" ");
        if (!fullText) return;

        wordCloudWasPlaying = !video.paused;
        wordCloudActive = true;

        const wordSpans = [];
        const parent =
            document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.body;
        const detachedSourceLayers = isNetflixPage();
        for (const sourceEl of subEls) {
            if (!sourceEl.textContent.trim()) continue;
            let wordContainer = sourceEl;
            if (detachedSourceLayers) {
                wordContainer = Netflix?.createWordCloudSourceLayer?.({
                    source: sourceEl,
                    parent,
                    prefix: PREFIX,
                    splitIntoWordSpans: QT.splitIntoWordSpans,
                });
                if (!wordContainer) continue;
                wordCloudSourceLayers.push({ layer: wordContainer });
            } else {
                eOriginalContents.push({
                    el: sourceEl,
                    html: sourceEl.innerHTML,
                });
                QT.splitIntoWordSpans(sourceEl, PREFIX + "wc-word");
            }
            wordContainer
                .querySelectorAll("." + PREFIX + "wc-word")
                .forEach((span) => {
                    wordSpans.push(span);
                    if (shouldTranslateWord(span.textContent))
                        span.classList.add(PREFIX + "word-cloud-highlight");
                    else span.classList.remove(PREFIX + "word-cloud-highlight");
                });
        }

        video.pause();

        if (wordSpans.length === 0) {
            removeWordClouds();
            if (!opts.keepOriginalHidden)
                Netflix?.setOriginalSubtitlesHidden?.(false);
            if (wordCloudWasPlaying) resumeVideoAfterSubtitleClose(video);
            return;
        }

        const translation = await (opts.translationTask ||
            createSubtitleTranslationTask(fullText, modeRevision));
        if (!translation || modeRevision !== subtitleModeRevision) return;
        const { targetLang, translatedText: translatedFullText } = translation;
        if (!opts.skipSpeech && translatedFullText?.trim()) {
            speak(translatedFullText, targetLang, {
                isCancelled: () => modeRevision !== subtitleModeRevision,
            }).catch(() => {});
        }

        const translatableSpans = wordSpans.filter((span) =>
            shouldTranslateWord(span.textContent),
        );
        const translations = await Promise.all(
            translatableSpans.map(async (span) => {
                const word = span.textContent
                    .trim()
                    .replace(/[.,!?;:"\u201C\u201D\u2018\u2019'()\[\]{}]/g, "")
                    .trim();
                if (!word || !shouldTranslateWord(word)) return null;
                try {
                    const result = await wordCloudCache.get(word, targetLang);
                    return result.translated;
                } catch {
                    return null;
                }
            }),
        );
        if (modeRevision !== subtitleModeRevision) return;

        const subFontSizePx =
            parseFloat(
                window.getComputedStyle(
                    wordCloudSourceLayers[0]?.layer || subEls[0],
                ).fontSize,
            ) || 16;
        const cloudFontSize = Math.max(11, Math.min(22, subFontSizePx * 0.35));

        translatableSpans.forEach((span, i) => {
            const translated = translations[i];
            if (!translated) return;
            const rect = span.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;
            const cloud = document.createElement("div");
            cloud.className = PREFIX + "word-cloud";
            cloud.textContent = translated;
            cloud.style.fontSize = cloudFontSize + "px";
            cloud.style.animationDelay = i * 0.02 + "s";
            parent.appendChild(cloud);
            wordCloudEls.push({ cloud, span });
            positionWordCloud(cloud, span);
        });
        ensureSubtitleUiTracking();
    }

    let translationOverlay = null;
    let translationAnchorLayout = null;
    function captureSubtitleLayout(elements = null) {
        const els = elements || PlayerAdapter.getSubtitleElements();
        if (els.length === 0) return null;
        const rect = getSubtitleRect(els);
        if (!rect) return null;
        const cs = window.getComputedStyle(els[0]);
        const renderedLines = isNetflixPage()
            ? Netflix?.captureRenderedLines?.(els) || []
            : [];
        const lineTexts =
            renderedLines.length > 0
                ? renderedLines.map((line) => line.text)
                : els.map((el) => el.textContent.trim()).filter(Boolean);
        return {
            rect,
            fontSize: cs.fontSize,
            fontFamily: cs.fontFamily,
            fontStyle: cs.fontStyle,
            fontWeight: cs.fontWeight,
            lineHeight: cs.lineHeight,
            letterSpacing: cs.letterSpacing,
            wordSpacing: cs.wordSpacing,
            textAlign: cs.textAlign,
            lineTexts,
            lineLengths: lineTexts.map((line) => line.length || 1),
            lineWidths: renderedLines.map((line) => line.width),
        };
    }

    function captureSubtitleSnapshot() {
        const elements = PlayerAdapter.getSubtitleElements();

        let domText = "";

        if (isNetflixPage() && Netflix?.captureRenderedLines) {
            domText = Netflix.captureRenderedLines(elements)
                .map((line) => line.text)
                .filter(Boolean)
                .join(" ")
                .replace(/\s+/g, " ")
                .trim();
        } else {
            domText = elements
                .map((element) => element.textContent.trim())
                .filter(Boolean)
                .join(" ");
        }

        return {
            elements,
            text: domText || PlayerAdapter.getCurrentText(),
            layout: captureSubtitleLayout(elements),
        };
    }

    async function createSubtitleTranslationTask(text, modeRevision) {
        const targetLang = await getTargetLang();
        if (modeRevision !== subtitleModeRevision) return null;
        try {
            const { translated } = await googleTranslate(text, targetLang);
            if (modeRevision !== subtitleModeRevision) return null;
            return { targetLang, translatedText: translated || text };
        } catch (_) {
            if (modeRevision !== subtitleModeRevision) return null;
            return { targetLang, translatedText: text };
        }
    }

    function getSubtitleRect(elements = null) {
        const els = elements || PlayerAdapter.getSubtitleElements();
        if (els.length === 0) return null;
        let top = Infinity,
            bottom = -Infinity,
            left = Infinity,
            right = -Infinity;
        for (const el of els) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            top = Math.min(top, r.top);
            bottom = Math.max(bottom, r.bottom);
            left = Math.min(left, r.left);
            right = Math.max(right, r.right);
        }
        if (top === Infinity) return null;
        return { top, bottom, left, right, width: right - left };
    }

    function createOverlay(layout = null) {
        removeOverlay();
        translationAnchorLayout = layout;
        translationOverlay = document.createElement("div");
        translationOverlay.className = PREFIX + "sub-overlay";
        const parent =
            document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.body;
        parent.appendChild(translationOverlay);
        ensureSubtitleUiTracking();
        return translationOverlay;
    }

    function removeOverlay() {
        if (translationOverlay) {
            translationOverlay.remove();
            translationOverlay = null;
        }
        translationAnchorLayout = null;
    }

    function positionOverlay(layout = translationAnchorLayout) {
        if (!translationOverlay) return;
        const liveEls = PlayerAdapter.getSubtitleElements();
        const liveRect = getSubtitleRect(liveEls);
        const rect = liveRect || layout?.rect;
        if (!rect) return;
        if (liveEls.length > 0) {
            const cs = window.getComputedStyle(liveEls[0]);
            translationOverlay.style.setProperty(
                "font-size",
                parseFloat(cs.fontSize) / 1.3 + "px",
                "important",
            );
            translationOverlay.style.fontFamily = cs.fontFamily;
            translationOverlay.style.fontStyle = cs.fontStyle;
            translationOverlay.style.fontWeight = cs.fontWeight;
            translationOverlay.style.lineHeight = cs.lineHeight;
            translationOverlay.style.letterSpacing = cs.letterSpacing;
            translationOverlay.style.wordSpacing = cs.wordSpacing;
            translationOverlay.style.setProperty(
                "text-align",
                cs.textAlign,
                "important",
            );
        } else if (layout) {
            translationOverlay.style.setProperty(
                "font-size",
                layout.fontSize,
                "important",
            );
            translationOverlay.style.fontFamily = layout.fontFamily;
            translationOverlay.style.fontStyle = layout.fontStyle;
            translationOverlay.style.fontWeight = layout.fontWeight;
            translationOverlay.style.lineHeight = layout.lineHeight;
            translationOverlay.style.letterSpacing = layout.letterSpacing;
            translationOverlay.style.wordSpacing = layout.wordSpacing;
            translationOverlay.style.setProperty(
                "text-align",
                layout.textAlign,
                "important",
            );
        }
        translationOverlay.style.position = "fixed";
        translationOverlay.style.left = rect.left + "px";
        translationOverlay.style.width = rect.width + "px";
        const replacesNetflixSubtitles =
            isNetflixPage() &&
            document.documentElement.classList.contains(
                "__qt_netflix-subtitles-hidden",
            ) &&
            !wordCloudActive;
        // Netflix's native text box has no Lectoro padding. Removing it here
        // keeps the copied line box at the same width and height.
        translationOverlay.style.padding = replacesNetflixSubtitles
            ? "0px"
            : "8px";
        const overlayH = translationOverlay.offsetHeight || 40;
        translationOverlay.style.top = replacesNetflixSubtitles
            ? rect.top +
              Math.max(0, (rect.bottom - rect.top - overlayH) / 2) +
              "px"
            : rect.top - overlayH - 36 + "px";
    }

    function showSubLoading(layout = null) {
        const overlay = createOverlay(layout);
        overlay.innerHTML = `<div class="${PREFIX}shimmer-bar"><div class="${PREFIX}shimmer-line"></div><div class="${PREFIX}shimmer-line ${PREFIX}shimmer-short"></div></div>`;
        positionOverlay();
    }

    function applyTranslation(
        translatedText,
        layout = translationAnchorLayout,
    ) {
        const subEls = PlayerAdapter.getSubtitleElements();
        const liveLayout =
            subEls.length > 0 ? captureSubtitleLayout(subEls) : null;
        const lineLengths =
            liveLayout?.lineLengths || layout?.lineLengths || [];
        if (lineLengths.length === 0) {
            removeOverlay();
            return;
        }
        const overlay = translationOverlay || createOverlay(layout);
        const words = translatedText.split(/\s+/).filter(Boolean);
        if (lineLengths.length <= 1) {
            const line = document.createElement("div");
            line.className = PREFIX + "sub-overlay-line";
            line.textContent = words.join(" ");
            overlay.replaceChildren(line);
        } else {
            const totalOrigLen = lineLengths.reduce((a, b) => a + b, 0);
            const totalWords = words.length;
            let wordIdx = 0;
            const lines = [];
            lineLengths.forEach((lineLength, i) => {
                if (i === lineLengths.length - 1) {
                    lines.push(words.slice(wordIdx).join(" "));
                } else {
                    const remainingLines = lineLengths.length - i;
                    const remainingWords = totalWords - wordIdx;
                    const proportionalShare = Math.round(
                        (lineLength / totalOrigLen) * totalWords,
                    );
                    const share = Math.max(
                        1,
                        Math.min(
                            proportionalShare,
                            remainingWords - (remainingLines - 1),
                        ),
                    );
                    lines.push(words.slice(wordIdx, wordIdx + share).join(" "));
                    wordIdx += share;
                }
            });
            overlay.replaceChildren(
                ...lines.map((text) => {
                    const line = document.createElement("div");
                    line.className = PREFIX + "sub-overlay-line";
                    line.textContent = text;
                    return line;
                }),
            );
        }
        positionOverlay(layout);
        eTranslateActive = true;
    }

    async function doSentenceTranslation(
        video,
        sourceText = null,
        options = {},
    ) {
        const modeRevision = options.revision ?? subtitleModeRevision;
        if (modeRevision !== subtitleModeRevision) return;
        const text = sourceText || PlayerAdapter.getCurrentText();
        if (!text) return;
        const layout = options.layout || captureSubtitleLayout();
        showSubLoading(layout);
        const translation = await (options.translationTask ||
            createSubtitleTranslationTask(text, modeRevision));
        if (!translation || modeRevision !== subtitleModeRevision) return;
        applyTranslation(translation.translatedText, layout);
        if (options.speakTranslated)
            await speak(translation.translatedText, translation.targetLang, {
                isCancelled: () => modeRevision !== subtitleModeRevision,
            });
    }

    function restoreOriginal() {
        subtitleModeRevision += 1;
        subtitleModeStarting = false;
        removeOverlay();
        removeWordClouds();
        Netflix?.setOriginalSubtitlesHidden?.(false);
        for (const item of eOriginalContents) {
            if (item.el && item.html !== undefined)
                item.el.innerHTML = item.html;
        }
        eOriginalContents = [];
        eTranslateActive = false;
        wordCloudActive = false;
        if (isReading) {
            cleanupReading();
        } else {
            try {
                window.speechSynthesis?.cancel();
            } catch (_) {}
            try {
                const audio = getElAudioEl();
                if (audio) {
                    audio.pause();
                    setElAudioEl(null);
                }
            } catch (_) {}
        }
    }

    function resumeVideoAfterSubtitleClose(preferredVideo) {
        const resumeRevision = ++subtitleResumeRevision;

        const tryResume = () => {
            if (resumeRevision !== subtitleResumeRevision) return;
            const video = preferredVideo?.isConnected
                ? preferredVideo
                : PlayerAdapter.getVideo();
            if (!video || video.ended || !video.paused) return;
            try {
                const playResult = video.play();
                playResult?.catch(() => {});
            } catch (_) {}
        };

        // Plex and some React players can restore their stale paused state
        // after the key event. Retry briefly after their handlers have run.
        tryResume();
        requestAnimationFrame(tryResume);
        setTimeout(tryResume, 120);
        setTimeout(tryResume, 400);
    }

    // ═══════════════════════════════════════════════════════════════
    //  Save Current Sentence to Review System ("Z" hotkey)
    //  Rich, fullscreen-safe feedback: a camera-style flash confirms the
    //  screenshot capture, a saving → success/error toast shows exactly
    //  what was saved (text, translation, thumbnail), and the video is
    //  auto-paused for the duration so nothing is missed, then resumed.
    // ═══════════════════════════════════════════════════════════════

    let savingSentence = false;
    let saveToastEl = null;
    let saveToastHideTimer = null;
    let saveResumeTimer = null;
    let pausedForSave = false;
    let wasPlayingBeforeSave = false;

    function flashCapture() {
        const parent = QT.getOverlayParent();
        const flash = document.createElement("div");
        flash.className = "__qt_capture_flash";
        parent.appendChild(flash);
        requestAnimationFrame(() => {
            flash.style.opacity = "0.35";
            setTimeout(() => (flash.style.opacity = "0"), 90);
        });
        setTimeout(() => flash.remove(), 500);
    }

    function getSaveToastEl() {
        const parent = QT.getOverlayParent();
        if (!saveToastEl) {
            saveToastEl = document.createElement("div");
            saveToastEl.id = "__qt_save_toast";
            saveToastEl.title = "Kliknij, aby zamknąć i wznowić odtwarzanie";
            saveToastEl.addEventListener("click", dismissSaveToastNow);
            parent.appendChild(saveToastEl);
        } else if (saveToastEl.parentElement !== parent) {
            parent.appendChild(saveToastEl);
        }
        return saveToastEl;
    }

    function hideSaveToast() {
        clearTimeout(saveToastHideTimer);
        if (saveToastEl) saveToastEl.classList.remove("visible");
    }

    function showSaveToast(
        state,
        { text = "", translated = "", thumb = "", duration = 2400 } = {},
    ) {
        const el = getSaveToastEl();
        clearTimeout(saveToastHideTimer);
        el.className = `__qt_${state}`;

        let iconHtml;
        let title;
        let bodyHtml;
        let thumbHtml = "";

        if (state === "saving") {
            iconHtml = `<div class="__qt_spinner"></div>`;
            title = "Zapisywanie zdania…";
            bodyHtml = `<div class="__qt_save_toast_text">${escapeHtml(text)}</div>`;
        } else if (state === "success") {
            iconHtml = `<div class="__qt_check_pop">${SVG.SAVE_SENTENCE_CHECK}</div>`;
            title = "✔ Zapisano do powtórek";
            bodyHtml = `
                <div class="__qt_save_toast_text">${escapeHtml(text)}</div>
                ${
                    translated && translated !== text
                        ? `<div class="__qt_save_toast_sub">${escapeHtml(translated)}</div>`
                        : ""
                }
            `;
            if (thumb)
                thumbHtml = `<img class="__qt_save_toast_thumb" src="${thumb}" alt="" />`;
        } else {
            iconHtml = `<div class="__qt_error_mark">!</div>`;
            title = "⚠ Nie udało się zapisać";
            bodyHtml = `<div class="__qt_save_toast_text">${escapeHtml(text)}</div>`;
        }

        el.innerHTML = `
            <div class="__qt_save_toast_icon">${iconHtml}</div>
            <div class="__qt_save_toast_body">
                <div class="__qt_save_toast_title">${title}</div>
                ${bodyHtml}
            </div>
            ${thumbHtml}
            <div class="__qt_save_toast_bar" style="animation-duration:${duration}ms"></div>
        `;

        requestAnimationFrame(() => el.classList.add("visible"));
        saveToastHideTimer = setTimeout(hideSaveToast, duration);
    }

    function resumeAfterSave() {
        pausedForSave = false;
        if (wasPlayingBeforeSave) {
            const video = PlayerAdapter.getVideo();
            if (video && video.paused) video.play().catch(() => {});
        }
    }

    function dismissSaveToastNow() {
        clearTimeout(saveResumeTimer);
        hideSaveToast();
        if (pausedForSave) resumeAfterSave();
    }

    async function saveCurrentSentenceToReview() {
        if (savingSentence) return;
        const text = PlayerAdapter.getCurrentText();
        if (!text) {
            QT.createHint("__qt_yt-sub-hint").show(
                "Brak napisów do zapisania",
                2000,
            );
            return;
        }

        savingSentence = true;
        clearTimeout(saveResumeTimer);

        // Pause the video for a moment so the user clearly sees what got
        // saved, even in fullscreen. The original play state is remembered
        // so playback resumes automatically once the toast disappears.
        const video = PlayerAdapter.getVideo();
        if (!pausedForSave) {
            wasPlayingBeforeSave = !!(video && !video.paused);
            if (wasPlayingBeforeSave) video.pause();
            pausedForSave = true;
        }

        const screenshot = await captureVideoReviewScreenshot(video);
        flashCapture();
        showSaveToast("saving", { text });

        try {
            const targetLang = await getTargetLang();
            const { translated, detectedLang } = await googleTranslate(
                text,
                targetLang,
            );
            const srcLang =
                typeof detectedLang === "string" ? detectedLang : "auto";

            // No separate sentence fields: original/translated already hold the
            // full sentence, avoids showing it twice in the review card.
            await saveWord({
                original: text,
                translated: translated || text,
                srcLang,
                tgtLang: targetLang,
                sentence: "",
                sentenceTranslated: "",
                aiSentence: "",
                aiSentenceTranslated: "",
                screenshot,
                url: window.location.href,
                timestamp: Date.now(),
                downloaded: false,
            });

            const duration = 2800;
            showSaveToast("success", {
                text,
                translated: translated || text,
                thumb: screenshot,
                duration,
            });
            saveResumeTimer = setTimeout(resumeAfterSave, duration);
        } catch (err) {
            console.error("[Lectoro] saveCurrentSentence error:", err);
            const duration = 2200;
            showSaveToast("error", {
                text: "Nie udało się zapisać zdania",
                duration,
            });
            saveResumeTimer = setTimeout(resumeAfterSave, duration);
        } finally {
            savingSentence = false;
        }
    }

    let _controlBarTimer = null;
    function ensureControlsHidden() {
        const vjsEl = document.querySelector(".video-js");
        if (vjsEl && !vjsEl.classList.contains("__qt_hide-controls"))
            vjsEl.classList.add("__qt_hide-controls");
    }
    function initControlBarHide() {
        const vjsEl = document.querySelector(".video-js");
        if (!vjsEl || vjsEl.__qtMouseBound) return;
        vjsEl.__qtMouseBound = true;
        vjsEl.classList.add("__qt_hide-controls");
        vjsEl.addEventListener("mousemove", () => {
            vjsEl.classList.remove("__qt_hide-controls");
            clearTimeout(_controlBarTimer);
            _controlBarTimer = setTimeout(
                () => vjsEl.classList.add("__qt_hide-controls"),
                3000,
            );
        });
        vjsEl.addEventListener("mouseleave", () => {
            clearTimeout(_controlBarTimer);
            vjsEl.classList.add("__qt_hide-controls");
        });
    }
    initControlBarHide();
    document.addEventListener("fullscreenchange", () =>
        setTimeout(initControlBarHide, 200),
    );
    document.addEventListener("webkitfullscreenchange", () =>
        setTimeout(initControlBarHide, 200),
    );

    document.addEventListener(
        "keydown",
        (e) => {
            const tag = e.target.tagName;
            if (
                tag === "INPUT" ||
                tag === "TEXTAREA" ||
                tag === "SELECT" ||
                e.target.isContentEditable
            )
                return;

            const key = e.key;
            const NAV_KEYS = [
                "a",
                "A",
                "ArrowLeft",
                "d",
                "D",
                "ArrowRight",
                "w",
                "W",
                "ArrowUp",
                "s",
                "S",
                "ArrowDown",
                "e",
                "E",
                "Enter",
                "q",
                "Q",
                "r",
                "R",
                "z",
                "Z",
                "[",
                "{",
                "]",
                "}",
                "Home",
                "PageUp",
            ];
            if (!NAV_KEYS.includes(key)) return;

            const video = PlayerAdapter.getVideo();
            if (!video) return;

            const subtitleUiOpen =
                eTranslateActive ||
                wordCloudActive ||
                subtitleModeStarting ||
                translationOverlay?.isConnected;
            const isHorizontalSubtitleNavigation = [
                "a",
                "A",
                "ArrowLeft",
                "d",
                "D",
                "ArrowRight",
            ].includes(key);

            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            // Speed Control
            if (["[", "{", "]", "}"].includes(key)) {
                let currentRate = video.playbackRate;
                if (key === "[" || key === "{")
                    currentRate = Math.max(0.25, currentRate - 0.05);
                else currentRate = Math.min(2.0, currentRate + 0.05);
                currentRate = Math.round(currentRate * 100) / 100;
                video.playbackRate = currentRate;
                showSpeedOverlay(currentRate);
                return;
            }

            // Reels Mode Toggle
            if (key === "r" || key === "R") {
                setReelsMode(!reelsMode);
                return;
            }

            // AI Explanation
            if (key === "Enter" || key === "q" || key === "Q") {
                if (aiTooltipActive) closeAiTooltip();
                else handleAIExplain(video);
                return;
            }

            // Save current subtitle sentence to spaced-repetition review
            if (
                key === "z" ||
                key === "Z" ||
                key === "Home" ||
                key === "PageUp"
            ) {
                saveCurrentSentenceToReview();
                return;
            }

            ensureControlsHidden();
            clearTimeout(_controlBarTimer);

            if (subtitleUiOpen) {
                try {
                    restoreOriginal();
                } finally {
                    // Resuming playback is the invariant of closing subtitle
                    // mode, even if a player-owned DOM node rejects cleanup.
                    resumeVideoAfterSubtitleClose(video);
                    eWasPlaying = false;
                    wordCloudWasPlaying = false;
                }
                // A horizontal key should close the translation overlays and
                // navigate during the same press. Previously the first press
                // only closed the UI, which looked like broken seeking.
                if (!isHorizontalSubtitleNavigation) return;
            }

            if (
                key === "s" ||
                key === "S" ||
                key === "ArrowDown" ||
                key === "e" ||
                key === "E"
            ) {
                if (isReading) cleanupReading();
                subtitleResumeRevision += 1;
                subtitleModeStarting = true;
                const modeRevision = ++subtitleModeRevision;
                const handleSubtitleAction = (data) => {
                    if (modeRevision !== subtitleModeRevision) return;
                    subtitleModeStarting = false;
                    const snapshot = captureSubtitleSnapshot();
                    const { text, elements, layout } = snapshot;
                    if (!text) return;
                    const translationTask = createSubtitleTranslationTask(
                        text,
                        modeRevision,
                    );
                    if (isNetflixPage())
                        Netflix.setOriginalSubtitlesHidden(true);
                    if (data.wordCloudMode && data.subtitleTTS) {
                        eWasPlaying = !video.paused;
                        showWordClouds(video, {
                            skipSpeech: true,
                            revision: modeRevision,
                            sourceText: text,
                            sourceElements: elements,
                            translationTask,
                            keepOriginalHidden: true,
                        }).catch((error) => {
                            console.warn(
                                "[Lectoro] Word cloud mode failed:",
                                error,
                            );
                            removeWordClouds();
                        });
                        doSentenceTranslation(video, text, {
                            speakTranslated: true,
                            revision: modeRevision,
                            layout,
                            translationTask,
                        });
                    } else if (data.wordCloudMode) {
                        showWordClouds(video, {
                            skipSpeech: false,
                            revision: modeRevision,
                            sourceText: text,
                            sourceElements: elements,
                            translationTask,
                            keepOriginalHidden: false,
                        }).catch((error) => {
                            console.warn(
                                "[Lectoro] Word cloud mode failed:",
                                error,
                            );
                            if (modeRevision !== subtitleModeRevision) return;
                            removeWordClouds();
                            Netflix?.setOriginalSubtitlesHidden?.(false);
                            if (wordCloudWasPlaying)
                                resumeVideoAfterSubtitleClose(video);
                        });
                    } else if (data.subtitleTTS) {
                        eWasPlaying = !video.paused;
                        if (eWasPlaying) video.pause();
                        doSentenceTranslation(video, text, {
                            speakTranslated: true,
                            revision: modeRevision,
                            layout,
                            translationTask,
                        });
                    } else {
                        doSentenceTranslation(video, text, {
                            speakTranslated: false,
                            revision: modeRevision,
                            layout,
                            translationTask,
                        });
                    }
                };
                if (chrome?.storage?.local) {
                    chrome.storage.local.get(
                        { wordCloudMode: true, subtitleTTS: false },
                        handleSubtitleAction,
                    );
                } else {
                    handleSubtitleAction({
                        wordCloudMode: true,
                        subtitleTTS: false,
                    });
                }
                return;
            }

            const cues = getAllCues(video);
            const hasCues = cues.length > 0;
            const FALLBACK_SKIP = 3;

            if (key === "w" || key === "W" || key === "ArrowUp") {
                video.paused ? video.play() : video.pause();
                return;
            }

            if (key === "a" || key === "A" || key === "ArrowLeft") {
                if (isNetflixPage()) {
                    navigateNetflixSubtitle(video, -1);
                    return;
                }
                let targetTime;
                if (hasCues) {
                    const idx = getCurrentCueIndex(cues, video.currentTime);
                    targetTime =
                        video.currentTime - cues[idx].startTime > 1.5 &&
                        idx >= 0
                            ? cues[idx].startTime
                            : cues[Math.max(0, idx - 1)].startTime;
                } else {
                    targetTime = Math.max(0, video.currentTime - FALLBACK_SKIP);
                }
                video.currentTime = targetTime;
                if (video.paused) video.play();
                return;
            }

            if (key === "d" || key === "D" || key === "ArrowRight") {
                if (isNetflixPage()) {
                    navigateNetflixSubtitle(video, 1);
                    return;
                }
                let targetTime;
                if (hasCues) {
                    const idx = getCurrentCueIndex(cues, video.currentTime);
                    targetTime =
                        cues[Math.min(cues.length - 1, idx + 1)].startTime;
                } else {
                    targetTime = Math.min(
                        video.duration || Infinity,
                        video.currentTime + FALLBACK_SKIP,
                    );
                }
                video.currentTime = targetTime;
                if (video.paused) video.play();
            }
        },
        true,
    );
})();
