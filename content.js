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
            const start =
                node === range.startContainer ? range.startOffset : 0;
            const end =
                node === range.endContainer
                    ? range.endOffset
                    : node.data.length;
            if (end <= start) continue;

            const block = node.parentElement?.closest(
                READING_BLOCK_SELECTOR,
            );
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
                    const rangeStart = getMappedPosition(segments, start, false);
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

    const PlayerAdapter = {
        get type() {
            if (window.location.hostname.includes("youtube.com"))
                return "youtube";
            if (window.location.hostname.includes("lookmovie"))
                return "lookmovie";
            return "unknown";
        },
        getVideo() {
            if (this.type === "youtube")
                return (
                    document.querySelector("#movie_player video") ||
                    document.querySelector(".html5-video-player video") ||
                    document.querySelector("video")
                );
            return document.querySelector("video");
        },
        getSubtitleContainer() {
            if (this.type === "youtube")
                return document.querySelector(".ytp-caption-window-container");
            if (this.type === "lookmovie")
                return document.querySelector(".vjs-text-track-display");
            return null;
        },
        getSubtitleElements() {
            if (this.type === "youtube")
                return Array.from(
                    document.querySelectorAll(
                        ".ytp-caption-window-container .ytp-caption-segment",
                    ),
                );
            if (this.type === "lookmovie")
                return Array.from(
                    document.querySelectorAll(".vjs-text-track-cue div"),
                ).filter(
                    (d) => d.textContent.trim() && !d.querySelector("div"),
                );
            // Fallback (Netflix etc)
            let els = document.querySelectorAll(
                ".player-timedtext-text-container span",
            );
            if (els.length > 0) return Array.from(els);
            return [];
        },
        getCurrentText() {
            const els = this.getSubtitleElements();
            if (els.length > 0)
                return els
                    .map((e) => e.textContent.trim())
                    .filter(Boolean)
                    .join(" ");
            // Fallback: textTracks API
            const video = this.getVideo();
            if (video?.textTracks) {
                for (let i = 0; i < video.textTracks.length; i++) {
                    const track = video.textTracks[i];
                    if (track.mode === "disabled" || !track.activeCues)
                        continue;
                    for (let j = 0; j < track.activeCues.length; j++) {
                        const t = track.activeCues[j].text;
                        if (t?.trim()) return t.trim();
                    }
                }
            }
            return null;
        },
    };

    function getAllCues(video) {
        if (!video?.textTracks) return [];
        const cues = [];
        for (let i = 0; i < video.textTracks.length; i++) {
            const track = video.textTracks[i];
            if (track.mode === "disabled" || !track.cues) continue;
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

    function makeSubtitlesInteractive() {
        const els = PlayerAdapter.getSubtitleElements();
        for (const el of els) {
            if (el.dataset[PREFIX + "bound"]) continue;
            if (!el.textContent.trim()) continue;
            // if already split, ignore
            if (
                el.querySelector(
                    `div:not(.${PREFIX}sub-word), span:not(.${PREFIX}sub-word)`,
                )
            )
                continue;
            el.dataset[PREFIX + "bound"] = "1";
            QT.splitIntoWordSpans(el, PREFIX + "sub-word");
        }
    }

    const subObserver = new MutationObserver(() => makeSubtitlesInteractive());
    subObserver.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
    });
    setInterval(makeSubtitlesInteractive, 500);

    function closeSubTooltip() {
        if (!isSubHovering) return;
        isSubHovering = false;
        subClickLocked = false;
        QT.hoverClickActive = false;
        clearTimeout(subCloseTimer);
        subTooltipAnchor = null;
        if (lastHoveredSubWord) {
            lastHoveredSubWord.classList.remove(`${PREFIX}word-hover`);
            lastHoveredSubWord = null;
        }
        QT.hideTooltip();
        if (subWasPlaying) {
            const video = PlayerAdapter.getVideo();
            if (video && video.paused) video.play();
        }
    }
    addDismissHandler(closeSubTooltip);

    // Delay closing so the cursor can travel from the word onto the tooltip
    // (which floats above/below it) without the video resuming prematurely.
    function scheduleCloseSubTooltip() {
        clearTimeout(subCloseTimer);
        subCloseTimer = setTimeout(() => {
            if (QT.getTooltipEl()?.matches(":hover")) return;
            if (subClickLocked) return;
            closeSubTooltip();
        }, 350);
    }

    document.addEventListener(
        "mousemove",
        (e) => {
            if (isReading) return;
            if (typeof eTranslateActive !== "undefined" && eTranslateActive)
                return;
            if (typeof wordCloudActive !== "undefined" && wordCloudActive)
                return;
            if (subClickLocked) return;

            // Cursor is over our own tooltip – keep it open, don't chase words.
            if (isOwnUI(e.target)) {
                clearTimeout(subCloseTimer);
                return;
            }

            const wordSpan = QT.findWordAtPoint(
                e.clientX,
                e.clientY,
                PREFIX + "sub-word",
            );

            if (wordSpan && wordSpan !== lastHoveredSubWord) {
                clearTimeout(subCloseTimer);
                if (lastHoveredSubWord)
                    lastHoveredSubWord.classList.remove(`${PREFIX}word-hover`);
                lastHoveredSubWord = wordSpan;
                wordSpan.classList.add(`${PREFIX}word-hover`);

                clearTimeout(subHoverTimer);
                subHoverTimer = setTimeout(async () => {
                    const text = wordSpan.textContent.trim();
                    if (!text) return;

                    isSubHovering = true;
                    subTooltipAnchor = wordSpan;
                    const video = PlayerAdapter.getVideo();
                    subWasPlaying = video ? !video.paused : false;
                    if (video && !video.paused) video.pause();

                    const rect = wordSpan.getBoundingClientRect();
                    QT.showLoading(rect, "top");
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
                        QT.showTooltip(html, rect, "top");
                        QT.attachTooltipHandlers();
                    } catch (err) {
                        if (isSubHovering)
                            QT.showTooltip(
                                `<div class="${PREFIX}error">⚠ ${QT.escapeHtml(err.message)}</div>`,
                                rect,
                                "top",
                            );
                    }
                }, 300);
            } else if (!wordSpan && lastHoveredSubWord) {
                clearTimeout(subHoverTimer);
                lastHoveredSubWord.classList.remove(`${PREFIX}word-hover`);
                lastHoveredSubWord = null;
                if (isSubHovering) scheduleCloseSubTooltip();
            }
        },
        true,
    );

    // Click: word translation + the full subtitle line it belongs to
    async function handleSubWordClick(wordSpan) {
        if (isReading) cleanupReading();
        clearTimeout(subHoverTimer);
        clearTimeout(subCloseTimer);
        subClickLocked = true;
        QT.hoverClickActive = true;
        isSubHovering = true;
        subTooltipAnchor = wordSpan;

        if (lastHoveredSubWord && lastHoveredSubWord !== wordSpan)
            lastHoveredSubWord.classList.remove(`${PREFIX}word-hover`);
        lastHoveredSubWord = wordSpan;
        wordSpan.classList.add(`${PREFIX}word-hover`);

        const video = PlayerAdapter.getVideo();
        subWasPlaying = video ? !video.paused : false;
        if (video && !video.paused) video.pause();

        const text = wordSpan.textContent.trim();
        if (!text) {
            closeSubTooltip();
            return;
        }

        const sentence = PlayerAdapter.getCurrentText() || text;
        const rect = wordSpan.getBoundingClientRect();
        QT.showLoading(rect, "top");
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
            QT.showTooltip(html, rect, "top");
            QT.attachTooltipHandlers();
            QT.speak(text, srcLang);
        } catch (err) {
            if (isSubHovering)
                QT.showTooltip(
                    `<div class="${PREFIX}error">⚠ ${QT.escapeHtml(err.message)}</div>`,
                    rect,
                    "top",
                );
        }
    }

    document.addEventListener(
        "click",
        (e) => {
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
            <span class="${PREFIX}ai-loader-orb">
                <span class="${PREFIX}ai-loader-ring"></span>
                <span class="${PREFIX}ai-loader-ring ${PREFIX}ai-loader-ring2"></span>
                <span class="${PREFIX}ai-loader-core">✨</span>
            </span>
            <span class="${PREFIX}ai-loader-label">AI analizuje</span>`;
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
            const screenshot = QT.captureVideoScreenshot() || "";
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
    let wordCloudWasPlaying = false;
    let subtitleUiTrackingFrame = null;
    const wordCloudCache = QT.createTranslateCache(300);
    const SIMPLE_WORDS = new Set([
        "a",
        "an",
        "and",
        "are",
        "as",
        "at",
        "be",
        "but",
        "by",
        "can",
        "could",
        "do",
        "does",
        "did",
        "for",
        "from",
        "had",
        "has",
        "have",
        "he",
        "her",
        "here",
        "his",
        "i",
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
        "would",
        "you",
        "your",
        "yours",
    ]);

    function shouldTranslateWord(rawText) {
        const text = (rawText || "").trim();
        if (!text) return false;
        if (/\d/.test(text)) return false;
        if (/^[^A-Za-z]+$/.test(text)) return false;
        const lettersOnly = text.replace(/[^A-Za-z]/g, "");
        if (!lettersOnly || lettersOnly.length <= 1) return false;
        return !SIMPLE_WORDS.has(lettersOnly.toLowerCase());
    }

    function removeWordClouds() {
        wordCloudEls.forEach(({ cloud }) => cloud.remove());
        wordCloudEls = [];
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
        const subEls = PlayerAdapter.getSubtitleElements();
        if (subEls.length === 0) return;
        const fullText = subEls
            .map((el) => el.textContent.trim())
            .filter(Boolean)
            .join(" ");
        if (!fullText) return;

        wordCloudWasPlaying = !video.paused;
        video.pause();
        wordCloudActive = true;

        const wordSpans = [];
        for (const el of subEls) {
            if (!el.textContent.trim()) continue;
            eOriginalContents.push({ el, html: el.innerHTML });
            QT.splitIntoWordSpans(el, PREFIX + "wc-word");
            el.querySelectorAll("." + PREFIX + "wc-word").forEach((span) => {
                wordSpans.push(span);
                if (shouldTranslateWord(span.textContent))
                    span.classList.add(PREFIX + "word-cloud-highlight");
                else span.classList.remove(PREFIX + "word-cloud-highlight");
            });
        }

        if (wordSpans.length === 0) {
            removeWordClouds();
            if (wordCloudWasPlaying) video.play();
            return;
        }

        const targetLang = await getTargetLang();
        let translatedFullText = fullText;
        try {
            const translated = await googleTranslate(fullText, targetLang);
            translatedFullText = translated?.translated || fullText;
            if (!opts.skipSpeech && translatedFullText?.trim()) {
                speak(translatedFullText, targetLang).catch(() => {});
            }
        } catch (err) {}

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

        const subFontSizePx =
            parseFloat(window.getComputedStyle(subEls[0]).fontSize) || 16;
        const cloudFontSize = Math.max(11, Math.min(22, subFontSizePx * 0.35));

        const parent =
            document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.body;
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
    function getSubtitleRect() {
        const els = PlayerAdapter.getSubtitleElements();
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

    function createOverlay() {
        removeOverlay();
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
    }

    function positionOverlay() {
        if (!translationOverlay) return;
        const rect = getSubtitleRect();
        if (!rect) return;
        const subEls = PlayerAdapter.getSubtitleElements();
        if (subEls.length > 0) {
            const cs = window.getComputedStyle(subEls[0]);
            translationOverlay.style.fontSize = cs.fontSize;
            translationOverlay.style.fontFamily = cs.fontFamily;
        }
        translationOverlay.style.position = "fixed";
        translationOverlay.style.left = rect.left + "px";
        translationOverlay.style.width = rect.width + "px";
        const overlayH = translationOverlay.offsetHeight || 40;
        translationOverlay.style.top = rect.top - overlayH - 26 + "px";
    }

    function showSubLoading() {
        const overlay = createOverlay();
        overlay.innerHTML = `<div class="${PREFIX}shimmer-bar"><div class="${PREFIX}shimmer-line"></div><div class="${PREFIX}shimmer-line ${PREFIX}shimmer-short"></div></div>`;
        positionOverlay();
    }

    function applyTranslation(translatedText) {
        const subEls = PlayerAdapter.getSubtitleElements();
        if (subEls.length === 0) {
            removeOverlay();
            return;
        }
        const overlay = translationOverlay || createOverlay();
        const words = translatedText.split(/\s+/).filter(Boolean);
        if (subEls.length <= 1) {
            overlay.textContent = words.join(" ");
        } else {
            const origLengths = subEls.map(
                (el) => el.textContent.trim().length || 1,
            );
            const totalOrigLen = origLengths.reduce((a, b) => a + b, 0);
            const totalWords = words.length;
            let wordIdx = 0;
            const lines = [];
            subEls.forEach((el, i) => {
                if (i === subEls.length - 1) {
                    lines.push(words.slice(wordIdx).join(" "));
                } else {
                    const share = Math.max(
                        1,
                        Math.round(
                            (origLengths[i] / totalOrigLen) * totalWords,
                        ),
                    );
                    lines.push(words.slice(wordIdx, wordIdx + share).join(" "));
                    wordIdx += share;
                }
            });
            overlay.innerHTML = lines
                .map((line) => `<div>${line}</div>`)
                .join("");
        }
        positionOverlay();
        eTranslateActive = true;
    }

    async function doSentenceTranslation(
        video,
        sourceText = null,
        options = {},
    ) {
        const text = sourceText || PlayerAdapter.getCurrentText();
        if (!text) return;
        showSubLoading();
        try {
            const targetLang = await getTargetLang();
            const { translated } = await googleTranslate(text, targetLang);
            const translatedText = translated || text;
            applyTranslation(translatedText);
            if (options.speakTranslated)
                await speak(translatedText, targetLang);
        } catch (err) {
            applyTranslation(text);
        }
    }

    function restoreOriginal() {
        removeOverlay();
        removeWordClouds();
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
            window.speechSynthesis.cancel();
            const audio = getElAudioEl();
            if (audio) {
                audio.pause();
                setElAudioEl(null);
            }
        }
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

        flashCapture();
        const screenshot = QT.captureVideoScreenshot() || "";
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

            if (eTranslateActive || wordCloudActive) {
                restoreOriginal();
                video.play();
                eWasPlaying = false;
                wordCloudWasPlaying = false;
                return;
            }

            if (
                key === "s" ||
                key === "S" ||
                key === "ArrowDown" ||
                key === "e" ||
                key === "E"
            ) {
                if (isReading) cleanupReading();
                const handleSubtitleAction = (data) => {
                    const text = PlayerAdapter.getCurrentText();
                    if (!text) return;
                    if (data.wordCloudMode && data.subtitleTTS) {
                        eWasPlaying = !video.paused;
                        if (eWasPlaying) video.pause();
                        showWordClouds(video, { skipSpeech: true }).catch(() =>
                            removeWordClouds(),
                        );
                        doSentenceTranslation(video, text, {
                            speakTranslated: true,
                        });
                    } else if (data.wordCloudMode) {
                        showWordClouds(video, { skipSpeech: false }).catch(
                            () => {
                                removeWordClouds();
                                if (wordCloudWasPlaying) video.play();
                            },
                        );
                    } else if (data.subtitleTTS) {
                        eWasPlaying = !video.paused;
                        if (eWasPlaying) video.pause();
                        doSentenceTranslation(video, text, {
                            speakTranslated: true,
                        });
                    } else {
                        doSentenceTranslation(video, text, {
                            speakTranslated: false,
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
                if (hasCues) {
                    const idx = getCurrentCueIndex(cues, video.currentTime);
                    video.currentTime =
                        video.currentTime - cues[idx].startTime > 1.5 &&
                        idx >= 0
                            ? cues[idx].startTime
                            : cues[Math.max(0, idx - 1)].startTime;
                } else {
                    video.currentTime = Math.max(
                        0,
                        video.currentTime - FALLBACK_SKIP,
                    );
                }
                if (video.paused) video.play();
                return;
            }

            if (key === "d" || key === "D" || key === "ArrowRight") {
                if (hasCues) {
                    const idx = getCurrentCueIndex(cues, video.currentTime);
                    video.currentTime =
                        cues[Math.min(cues.length - 1, idx + 1)].startTime;
                } else {
                    video.currentTime = Math.min(
                        video.duration || Infinity,
                        video.currentTime + FALLBACK_SKIP,
                    );
                }
                if (video.paused) video.play();
            }
        },
        true,
    );
})();
