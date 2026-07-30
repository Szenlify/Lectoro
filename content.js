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
    let readingHighlightEl = null;

    // Register cleanup handlers with core
    addCleanup(() => {
        if (iconEl) iconEl.classList.remove("visible");
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
        translateBtn.className = `${PREFIX}tb-btn ${PREFIX}tb-translate`;
        translateBtn.innerHTML = SVG.TRANSLATE;
        translateBtn.title = "Przetłumacz";
        translateBtn.addEventListener("click", onIconClick);

        const readBtn = document.createElement("button");
        readBtn.className = `${PREFIX}tb-btn ${PREFIX}tb-read`;
        readBtn.innerHTML = SVG.READ;
        readBtn.title = "Czytaj na głos";
        readBtn.addEventListener("click", onReadClick);

        iconEl.appendChild(translateBtn);
        iconEl.appendChild(readBtn);
        document.body.appendChild(iconEl);
        return iconEl;
    }

    function showIcon(rect) {
        const icon = getIcon();
        icon.classList.remove("visible");

        const scrollX = window.scrollX;
        const scrollY = window.scrollY;
        const ICON_W = 79,
            ICON_H = 42,
            GAP = 8;
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
        requestAnimationFrame(() => icon.classList.add("visible"));
    }

    function hideIcon() {
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
        hideIcon();
        showLoading(rect);

        try {
            const targetLang = await getTargetLang();
            const { translated, detectedLang } = await googleTranslate(
                text,
                targetLang,
            );
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
            console.error("[Quick Translator]", err);
            showTooltip(
                `<div class="${PREFIX}error">⚠ ${escapeHtml(err.message)}</div>`,
                rect,
            );
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  Read-Aloud – Sentence-by-Sentence Highlighting
    // ═══════════════════════════════════════════════════════════════

    function getTextNodesInRange(range) {
        const result = [];
        const ancestor = range.commonAncestorContainer;

        if (ancestor.nodeType === Node.TEXT_NODE) {
            return [
                {
                    node: ancestor,
                    start: range.startOffset,
                    end: range.endOffset,
                },
            ];
        }

        const walker = document.createTreeWalker(
            ancestor,
            NodeFilter.SHOW_TEXT,
        );
        let node;
        while ((node = walker.nextNode())) {
            if (!range.intersectsNode(node)) continue;
            if (!node.textContent.trim()) continue;
            let start = 0,
                end = node.textContent.length;
            if (node === range.startContainer) start = range.startOffset;
            if (node === range.endContainer) end = range.endOffset;
            if (end > start) result.push({ node, start, end });
        }
        return result;
    }

    function splitIntoSentencesWithOffsets(text) {
        const results = [];
        const regex = /[.!?]+[\s]*/g;
        let lastEnd = 0,
            match;
        while ((match = regex.exec(text))) {
            const end = match.index + match[0].length;
            if (end > lastEnd) {
                results.push({
                    text: text.substring(lastEnd, end),
                    start: lastEnd,
                    end,
                });
            }
            lastEnd = end;
        }
        if (lastEnd < text.length) {
            results.push({
                text: text.substring(lastEnd),
                start: lastEnd,
                end: text.length,
            });
        }
        if (results.length === 0) {
            results.push({ text, start: 0, end: text.length });
        }
        return results;
    }

    function buildSentenceRanges(textInfos, sentencesWithOffsets) {
        let totalOffset = 0;
        const charMap = [];
        textInfos.forEach((info, i) => {
            if (i > 0) totalOffset += 1;
            const len = info.end - info.start;
            charMap.push({
                node: info.node,
                nodeStart: info.start,
                globalStart: totalOffset,
                globalEnd: totalOffset + len,
            });
            totalOffset += len;
        });

        function findNodeOffset(charIdx) {
            for (const seg of charMap) {
                if (charIdx >= seg.globalStart && charIdx <= seg.globalEnd) {
                    return {
                        node: seg.node,
                        offset: seg.nodeStart + (charIdx - seg.globalStart),
                    };
                }
            }
            const last = charMap[charMap.length - 1];
            return {
                node: last.node,
                offset: last.nodeStart + (last.globalEnd - last.globalStart),
            };
        }

        const ranges = [];
        for (const sentence of sentencesWithOffsets) {
            try {
                const r = document.createRange();
                const s = findNodeOffset(sentence.start);
                const e = findNodeOffset(sentence.end);
                r.setStart(s.node, s.offset);
                r.setEnd(e.node, e.offset);
                ranges.push(r);
            } catch (err) {
                console.warn("[Lectoro] sentence range error:", err);
            }
        }
        return ranges;
    }

    function clearSentenceHighlight() {
        try {
            if (typeof CSS !== "undefined" && CSS.highlights)
                CSS.highlights.delete("qt-reading-sentence");
        } catch (_) {}
    }

    function cleanupReading() {
        window.speechSynthesis.cancel();
        const audio = getElAudioEl();
        if (audio) {
            audio.pause();
            setElAudioEl(null);
        }
        isReading = false;
        clearSentenceHighlight();

        if (readingHighlightEl) {
            const parent = readingHighlightEl.parentNode;
            if (parent) {
                while (readingHighlightEl.firstChild)
                    parent.insertBefore(
                        readingHighlightEl.firstChild,
                        readingHighlightEl,
                    );
                parent.removeChild(readingHighlightEl);
                parent.normalize();
            }
            readingHighlightEl = null;
        }

        if (iconEl) {
            const rb = iconEl.querySelector(`.${PREFIX}tb-read`);
            if (rb) rb.classList.remove("reading");
        }
    }

    function readSentenceBySentence(sentences, sentenceRanges, lang) {
        let idx = 0;

        function highlightSentence(i) {
            try {
                if (
                    typeof CSS !== "undefined" &&
                    CSS.highlights &&
                    sentenceRanges[i]
                ) {
                    CSS.highlights.set(
                        "qt-reading-sentence",
                        new Highlight(sentenceRanges[i]),
                    );
                }
            } catch (_) {}
        }

        function readNext() {
            if (!isReading || idx >= sentences.length) {
                clearSentenceHighlight();
                cleanupReading();
                return;
            }

            highlightSentence(idx);
            const text = cleanTextForTTS(sentences[idx].text);
            if (!text?.trim()) {
                idx++;
                readNext();
                return;
            }

            if (!chrome?.storage?.sync) {
                const utter = new SpeechSynthesisUtterance(text);
                utter.lang = lang;
                const voice = pickBestVoice("", lang);
                if (voice) utter.voice = voice;
                utter.rate = 0.95;
                utter.onend = () => {
                    idx++;
                    readNext();
                };
                utter.onerror = () => cleanupReading();
                window.speechSynthesis.speak(utter);
                return;
            }

            chrome.storage.sync.get(
                {
                    ttsMode: "browser",
                    elApiKey: "",
                    elVoiceId: "",
                    speechVoice: "",
                    speechRate: 0.95,
                    ttsVolume: 1,
                },
                async (data) => {
                    const vol =
                        data.ttsVolume !== undefined ? data.ttsVolume : 1;
                    if (
                        data.ttsMode === "elevenlabs" &&
                        data.elApiKey &&
                        data.elVoiceId
                    ) {
                        const audio = await QT.speak(text, lang);
                        if (audio instanceof HTMLAudioElement) {
                            audio.volume = vol;
                            audio.onended = () => {
                                idx++;
                                readNext();
                            };
                            audio.onerror = () => cleanupReading();
                        } else if (audio) {
                            audio.onend = () => {
                                idx++;
                                readNext();
                            };
                            audio.onerror = () => cleanupReading();
                        } else {
                            cleanupReading();
                        }
                    } else {
                        const utter = new SpeechSynthesisUtterance(text);
                        utter.lang = lang;
                        utter.rate = data.speechRate;
                        utter.volume = vol;
                        const voice = pickBestVoice(data.speechVoice, lang);
                        if (voice) utter.voice = voice;
                        utter.onend = () => {
                            idx++;
                            readNext();
                        };
                        utter.onerror = () => cleanupReading();
                        window.speechSynthesis.speak(utter);
                    }
                },
            );
        }
        readNext();
    }

    function onReadClick(e) {
        e.stopPropagation();
        e.preventDefault();

        if (isReading) {
            cleanupReading();
            return;
        }
        if (!currentText) return;

        isReading = true;
        hideIcon();

        if (iconEl) {
            const rb = iconEl.querySelector(`.${PREFIX}tb-read`);
            if (rb) rb.classList.add("reading");
        }

        const utterText = cleanTextForTTS(currentText);
        if (!utterText) {
            cleanupReading();
            return;
        }

        const pageLang =
            document.documentElement.lang || navigator.language || "en";

        // Try sentence-by-sentence reading with CSS Highlight API
        let started = false;
        if (currentRange && typeof CSS !== "undefined" && CSS.highlights) {
            try {
                const textInfos = getTextNodesInRange(currentRange);
                if (textInfos.length > 0) {
                    const fullText = textInfos
                        .map((i) =>
                            i.node.textContent.substring(i.start, i.end),
                        )
                        .join(" ");
                    const sents = splitIntoSentencesWithOffsets(fullText);
                    const ranges = buildSentenceRanges(textInfos, sents);
                    window.getSelection().removeAllRanges();
                    readSentenceBySentence(sents, ranges, pageLang);
                    started = true;
                }
            } catch (err) {
                console.warn("[Lectoro] Sentence highlight failed:", err);
            }
        }

        if (!started) window.getSelection().removeAllRanges();
        if (started) return;

        // Fallback: read entire text at once
        speak(utterText, pageLang).then((result) => {
            if (result && typeof result.onend !== "undefined") {
                result.onend = () => cleanupReading();
                result.onerror = () => cleanupReading();
            } else if (result instanceof HTMLAudioElement) {
                result.onended = () => cleanupReading();
                result.onerror = () => cleanupReading();
            }
        });
    }

    // ═══════════════════════════════════════════════════════════════
    //  Selection Listener
    // ═══════════════════════════════════════════════════════════════

    document.addEventListener("mouseup", (e) => {
        if (isOwnUI(e.target)) return;

        setTimeout(() => {
            // Skip if hover-translate module just handled a click
            if (QT.hoverClickActive) return;

            const selection = window.getSelection();
            const text = selection?.toString().trim();
            if (!text || text.length === 0 || text.length > 5000) {
                hideAll();
                return;
            }

            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;

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
        // Don't dismiss when hover-translate module is handling a word click
        if (QT.hoverClickActive) return;
        runDismiss();
        hideAll();
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            runDismiss();
            hideAll();
        }
    });

    // ═══════════════════════════════════════════════════════════════
    //  Keyboard Subtitle Navigation (all video sites)
    //  A/← = prev sentence, D/→ = next, W/↑ = play/pause,
    //  S/↓/E/Enter = translate subtitle in-place
    // ═══════════════════════════════════════════════════════════════

    (function setupSubtitleNavigation() {
        const FALLBACK_SKIP = 3;

        function getActiveVideo() {
            const videos = document.querySelectorAll("video");
            if (videos.length === 0) return null;
            if (videos.length === 1) return videos[0];
            for (const v of videos) {
                if (!v.paused && v.readyState >= 2) return v;
            }
            let best = videos[0],
                bestArea = 0;
            videos.forEach((v) => {
                const area =
                    v.videoWidth * v.videoHeight ||
                    v.clientWidth * v.clientHeight;
                if (area > bestArea) {
                    bestArea = area;
                    best = v;
                }
            });
            return best;
        }

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

        function getCurrentSubtitleText(video) {
            // YouTube
            const ytSegs = document.querySelectorAll(
                ".ytp-caption-window-container .ytp-caption-segment",
            );
            if (ytSegs.length > 0)
                return Array.from(ytSegs)
                    .map((s) => s.textContent.trim())
                    .filter(Boolean)
                    .join(" ");
            // Netflix
            const nfSpans = document.querySelectorAll(
                ".player-timedtext-text-container span",
            );
            if (nfSpans.length > 0)
                return Array.from(nfSpans)
                    .map((s) => s.textContent.trim())
                    .filter(Boolean)
                    .join(" ");
            // video.js / LookMovie
            const vjsCues = document.querySelectorAll(
                ".vjs-text-track-cue div",
            );
            if (vjsCues.length > 0)
                return Array.from(vjsCues)
                    .map((d) => d.textContent.trim())
                    .filter(Boolean)
                    .join(" ");
            // Fallback: textTracks API
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
        }

        // E-key subtitle translation state
        let eTranslateActive = false;
        let eOriginalContents = [];
        let eWasPlaying = false;

        // Word Cloud mode state
        let wordCloudActive = false;
        let wordCloudEls = [];
        let wordCloudWasPlaying = false;
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
            if (!lettersOnly) return false;
            if (lettersOnly.length <= 1) return false;

            return !SIMPLE_WORDS.has(lettersOnly.toLowerCase());
        }

        function removeWordClouds() {
            wordCloudEls.forEach((el) => el.remove());
            wordCloudEls = [];
            // Remove highlight class from subtitle words
            document
                .querySelectorAll("." + PREFIX + "word-cloud-highlight")
                .forEach((el) => {
                    el.classList.remove(PREFIX + "word-cloud-highlight");
                });
            wordCloudActive = false;
        }

        async function showWordClouds(video) {
            const subEls = getSubtitleElements();
            if (subEls.length === 0) return;

            // Collect all text from subtitle elements
            const fullText = subEls
                .map((el) => el.textContent.trim())
                .filter(Boolean)
                .join(" ");
            if (!fullText) return;

            wordCloudWasPlaying = !video.paused;
            video.pause();
            wordCloudActive = true;

            // Split each subtitle element into word spans
            const wordSpans = [];
            for (const el of subEls) {
                const text = el.textContent;
                if (!text.trim()) continue;

                // Save original content
                const originalHTML = el.innerHTML;
                eOriginalContents.push({ el, html: originalHTML });

                // Split into word spans
                QT.splitIntoWordSpans(el, PREFIX + "wc-word");

                // Collect created word spans and skip trivial words
                el.querySelectorAll("." + PREFIX + "wc-word").forEach(
                    (span) => {
                        wordSpans.push(span);
                        if (shouldTranslateWord(span.textContent)) {
                            span.classList.add(PREFIX + "word-cloud-highlight");
                        } else {
                            span.classList.remove(
                                PREFIX + "word-cloud-highlight",
                            );
                        }
                    },
                );
            }

            if (wordSpans.length === 0) {
                removeWordClouds();
                if (wordCloudWasPlaying) video.play();
                return;
            }

            // Get target language and translate the full sentence for TTS
            const targetLang = await getTargetLang();
            let translatedFullText = fullText;
            try {
                const translated = await googleTranslate(fullText, targetLang);
                translatedFullText = translated?.translated || fullText;
                if (translatedFullText?.trim()) {
                    speak(translatedFullText, targetLang).catch(() => {});
                }
            } catch (err) {
                console.warn(
                    "[QT] Subtitle TTS sentence translation failed:",
                    err,
                );
            }

            // Translate all eligible words in parallel
            const translatableSpans = wordSpans.filter((span) =>
                shouldTranslateWord(span.textContent),
            );

            const translations = await Promise.all(
                translatableSpans.map(async (span) => {
                    const word = span.textContent
                        .trim()
                        .replace(
                            /[.,!?;:"\u201C\u201D\u2018\u2019'()\[\]{}]/g,
                            "",
                        )
                        .trim();
                    if (!word || !shouldTranslateWord(word)) return null;
                    try {
                        const result = await wordCloudCache.get(
                            word,
                            targetLang,
                        );
                        return result.translated;
                    } catch {
                        return null;
                    }
                }),
            );

            // Fullscreen-aware parent
            const parent =
                document.fullscreenElement ||
                document.webkitFullscreenElement ||
                document.body;

            // Create cloud tooltip for each eligible word
            translatableSpans.forEach((span, i) => {
                const translated = translations[i];
                if (!translated) return;

                const rect = span.getBoundingClientRect();
                if (rect.width === 0 && rect.height === 0) return;

                const cloud = document.createElement("div");
                cloud.className = PREFIX + "word-cloud";
                cloud.textContent = translated;
                // Stagger animation
                cloud.style.animationDelay = i * 0.05 + "s";
                parent.appendChild(cloud);
                wordCloudEls.push(cloud);

                // Position: center above the word
                const cloudRect = cloud.getBoundingClientRect();
                let left = rect.left + (rect.width - cloudRect.width) / 2;
                let top = rect.top - cloudRect.height - 8;

                // Keep within viewport
                const vpW = window.innerWidth;
                left = Math.max(4, Math.min(left, vpW - cloudRect.width - 4));
                if (top < 4) top = rect.bottom + 4;

                cloud.style.left = left + "px";
                cloud.style.top = top + "px";
            });
        }

        function getSubtitleElements() {
            let els = document.querySelectorAll(
                ".ytp-caption-window-container .ytp-caption-segment",
            );
            if (els.length > 0) return Array.from(els);
            els = document.querySelectorAll(
                ".player-timedtext-text-container span",
            );
            if (els.length > 0) return Array.from(els);
            els = document.querySelectorAll(".vjs-text-track-cue div");
            if (els.length > 0)
                return Array.from(els).filter(
                    (d) => d.textContent.trim() && !d.querySelector("div"),
                );
            return [];
        }

        let translationOverlay = null;

        function getSubtitleRect() {
            const els = getSubtitleElements();
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
            // Use fullscreen-aware parent so overlay is visible in fullscreen
            const parent =
                document.fullscreenElement ||
                document.webkitFullscreenElement ||
                document.body;
            parent.appendChild(translationOverlay);
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

            // Match subtitle font size
            const subEls = getSubtitleElements();
            if (subEls.length > 0) {
                const cs = window.getComputedStyle(subEls[0]);
                translationOverlay.style.fontSize = cs.fontSize;
                translationOverlay.style.fontFamily = cs.fontFamily;
            }

            translationOverlay.style.position = "fixed";
            translationOverlay.style.left = rect.left + "px";
            translationOverlay.style.width = rect.width + "px";
            // Measure after content + font are set
            const overlayH = translationOverlay.offsetHeight || 40;
            translationOverlay.style.top = rect.top - overlayH - 4 + "px";
        }

        function showSubLoading() {
            const overlay = createOverlay();
            overlay.innerHTML =
                `<div class="${PREFIX}shimmer-bar">` +
                `<div class="${PREFIX}shimmer-line"></div>` +
                `<div class="${PREFIX}shimmer-line ${PREFIX}shimmer-short"></div>` +
                `</div>`;
            positionOverlay();
        }

        function clearSubLoading() {
            // overlay will be replaced by translation or removed
        }

        function applyTranslation(translatedText) {
            const subEls = getSubtitleElements();
            if (subEls.length === 0) {
                removeOverlay();
                return;
            }

            const overlay = translationOverlay || createOverlay();
            const words = translatedText.split(/\s+/).filter(Boolean);

            if (subEls.length <= 1) {
                overlay.textContent = words.join(" ");
            } else {
                // Distribute words proportionally across lines
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
                        lines.push(
                            words.slice(wordIdx, wordIdx + share).join(" "),
                        );
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
            const text = sourceText || getCurrentSubtitleText(video);
            if (!text) return;

            showSubLoading();
            try {
                const targetLang = await getTargetLang();
                const { translated } = await googleTranslate(text, targetLang);
                const translatedText = translated || text;
                applyTranslation(translatedText);
                if (options.speakTranslated) {
                    await speak(translatedText, targetLang);
                }
            } catch (err) {
                console.warn("[QT] Subtitle sentence translation failed:", err);
                applyTranslation(text);
            }
        }

        function restoreOriginal() {
            removeOverlay();
            removeWordClouds();
            // Restore original HTML of subtitle elements
            for (const item of eOriginalContents) {
                if (item.el && item.html !== undefined) {
                    item.el.innerHTML = item.html;
                }
            }
            eOriginalContents = [];
            eTranslateActive = false;
            // Stop any TTS that was reading the translated text
            window.speechSynthesis.cancel();
            const audio = getElAudioEl();
            if (audio) {
                audio.pause();
                setElAudioEl(null);
            }
        }

        // CSS-based control-bar suppression: add __qt_hide-controls to .video-js
        // so the control bar is hidden by CSS. Only mousemove temporarily removes it.
        let _controlBarTimer = null;
        function ensureControlsHidden() {
            const vjsEl = document.querySelector(".video-js");
            if (vjsEl && !vjsEl.classList.contains("__qt_hide-controls")) {
                vjsEl.classList.add("__qt_hide-controls");
            }
        }
        function initControlBarHide() {
            const vjsEl = document.querySelector(".video-js");
            if (!vjsEl || vjsEl.__qtMouseBound) return;
            vjsEl.__qtMouseBound = true;
            vjsEl.classList.add("__qt_hide-controls");
            vjsEl.addEventListener("mousemove", () => {
                vjsEl.classList.remove("__qt_hide-controls");
                clearTimeout(_controlBarTimer);
                _controlBarTimer = setTimeout(() => {
                    vjsEl.classList.add("__qt_hide-controls");
                }, 3000);
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
                ];
                if (!NAV_KEYS.includes(key)) return;

                // In YouTube Reels mode, let youtube.js handle translate keys
                if (
                    document.body.classList.contains("__qt_reels-active") &&
                    ["s", "S", "ArrowDown", "e", "E", "Enter"].includes(key)
                )
                    return;

                const video = getActiveVideo();
                if (!video) return;

                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                // Ensure control bar stays hidden on keyboard nav
                ensureControlsHidden();
                clearTimeout(_controlBarTimer);

                // If translation overlay or word cloud is active, ANY nav key dismisses it
                if (eTranslateActive || wordCloudActive) {
                    const shouldResume = wordCloudActive
                        ? wordCloudWasPlaying
                        : eWasPlaying;
                    restoreOriginal();
                    if (shouldResume) video.play();
                    eWasPlaying = false;
                    wordCloudWasPlaying = false;
                    return;
                }

                // S / ArrowDown / E / Enter = subtitle reading mode
                if (
                    key === "s" ||
                    key === "S" ||
                    key === "ArrowDown" ||
                    key === "e" ||
                    key === "E"
                ) {
                    const handleSubtitleAction = (data) => {
                        const text = getCurrentSubtitleText(video);
                        if (!text) return;

                        if (data.wordCloudMode) {
                            showWordClouds(video).catch(() => {
                                removeWordClouds();
                                if (wordCloudWasPlaying) video.play();
                            });
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

                    if (chrome?.storage?.sync) {
                        chrome.storage.sync.get(
                            { wordCloudMode: false, subtitleTTS: false },
                            (data) => {
                                handleSubtitleAction(data);
                            },
                        );
                    } else {
                        handleSubtitleAction({
                            wordCloudMode: false,
                            subtitleTTS: false,
                        });
                    }
                    return;
                }

                const cues = getAllCues(video);
                const hasCues = cues.length > 0;

                // W / ArrowUp = play/pause
                if (key === "w" || key === "W" || key === "ArrowUp") {
                    video.paused ? video.play() : video.pause();
                    return;
                }

                // A / ArrowLeft = previous
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

                // D / ArrowRight = next
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
})();
