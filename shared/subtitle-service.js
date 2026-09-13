/**
 * Lectoro – Universal Subtitle Service & Parser (Single Source of Truth)
 * Handles parsing (WebVTT, TTML/XML/DFXP, SRT), cue normalization, binary search indexing,
 * and precise subtitle timeline navigation (A/D keys) for all video platforms.
 */
(function initSubtitleService(root, factory) {
    const isNode = typeof module !== "undefined" && !!module.exports;
    const utils =
        (root && root.SharedUtils) || (isNode ? require("./utils") : null);
    const api = factory(utils);
    if (isNode) module.exports = api;
    if (root) root.SharedSubtitleService = api;
})(
    typeof globalThis !== "undefined" ? globalThis : this,
    function createSubtitleService(Utils) {
        "use strict";

        function cleanCueText(rawText, { preserveNewlines = false } = {}) {
            if (!rawText) return "";
            let text = String(rawText);

            // Decode basic HTML entities for angle brackets if present
            text = text
                .replace(/&gt;/gi, ">")
                .replace(/&lt;/gi, "<")
                .replace(/&amp;/gi, "&");

            if (typeof DOMParser !== "undefined") {
                try {
                    // Quick check if contains HTML/XML tags
                    if (text.includes("<") && text.includes(">")) {
                        const cleanHtml = text
                            .replace(
                                /<br\s*\/?>/gi,
                                preserveNewlines ? "\n" : " ",
                            )
                            .replace(
                                preserveNewlines ? /[^\S\r\n]+/g : /\s+/g,
                                " ",
                            );
                        const doc = new DOMParser().parseFromString(
                            cleanHtml,
                            "text/html",
                        );
                        text =
                            typeof Utils?.extractSubtitleText === "function"
                                ? Utils.extractSubtitleText(doc.body, {
                                      preserveNewlines,
                                  })
                                : doc.body.textContent || "";
                    }
                } catch (_) {
                    // Fallback tag stripper
                    text = text
                        .replace(/<br\s*\/?>/gi, preserveNewlines ? "\n" : " ")
                        .replace(/<[^>]+>/g, " ");
                }
            } else {
                text = text
                    .replace(/<br\s*\/?>/gi, preserveNewlines ? "\n" : " ")
                    .replace(/<[^>]+>/g, " ");
            }

            text = text
                .replace(/\[[^\]]*\]/g, " ") // Strip [Music], [Muzyka], [Applause], [Śmiech], etc.
                .replace(/[♪♫♬♩♭♮♯]/g, " ") // Strip musical notes
                .replace(
                    /\((?:music|applause|laughter|screaming|coughing|sighs|footsteps|sound|snorts|groans|chuckles|giggles|cheering|whispering|gasping|singing|sobbing|crying|instrumental|upbeat music|dramatic music|soft music|ambient sound|muzyka|śmiech|brawa|oklaski)[^)]*\)/gi,
                    " ",
                )
                .replace(/\{[^}]+\}/g, "") // Remove ASS/SSA style tags
                .replace(/(?:^|\s)(?:>>+|<<+|»+|«+|››+)(?:\s|$)/g, " ") // Strip speaker change markers >>, >>>, <<, », «
                .replace(/[—–―‒]+/g, " "); // Strip em-dash, en-dash, horizontal bar dashes

            if (preserveNewlines) {
                return text
                    .split(/\r?\n/)
                    .map((line) =>
                        line
                            .replace(/^[>»›<«\s—–-]+/, "") // Strip leading markers/arrows
                            .replace(/(?:^|\s)[>»›](?=\s)/g, " ") // Strip isolated single > markers
                            .replace(/\s+([,.:;!?])/g, "$1") // Strip space before punctuation
                            .replace(/,\s*,+/g, ",") // Collapse duplicate commas
                            .replace(/([,;:])\s*\1+/g, "$1") // Collapse duplicate semicolons/colons
                            .replace(/([.!?])\s*,\s*/g, "$1 ") // Strip comma after terminal punct
                            .replace(/,\s*([.!?])/g, "$1") // Strip comma before terminal punct
                            .replace(/\(\s*\)/g, " ") // Remove empty parens
                            .replace(/\[\s*\]/g, " ") // Remove empty brackets
                            .replace(/-{2,}/g, " ")
                            .replace(/[^\S\r\n]+/g, " ")
                            .trim(),
                    )
                    .filter(Boolean)
                    .join("\n");
            }

            return text
                .replace(/^[>»›<«\s—–-]+/, "") // Strip leading markers/arrows
                .replace(/(?:^|\s)[>»›](?=\s)/g, " ") // Strip isolated single > markers
                .replace(/\s+([,.:;!?])/g, "$1") // Strip space before punctuation
                .replace(/,\s*,+/g, ",") // Collapse duplicate commas: ", ," -> ","
                .replace(/([,;:])\s*\1+/g, "$1") // Collapse duplicate semicolons/colons
                .replace(/([.!?])\s*,\s*/g, "$1 ") // Strip comma after terminal punct
                .replace(/,\s*([.!?])/g, "$1") // Strip comma before terminal punct
                .replace(/\(\s*\)/g, " ") // Remove empty parens
                .replace(/\[\s*\]/g, " ") // Remove empty brackets
                .replace(/-{2,}/g, " ")
                .replace(/\s+/g, " ")
                .trim();
        }

        function parseWebVttTimestamp(raw) {
            const parts = String(raw || "")
                .trim()
                .replace(",", ".")
                .split(":");
            if (parts.length < 2 || parts.length > 3) return null;
            const seconds = Number(parts.pop());
            const minutes = Number(parts.pop());
            const hours = parts.length ? Number(parts.pop()) : 0;
            if (![hours, minutes, seconds].every(Number.isFinite)) return null;
            return hours * 3600 + minutes * 60 + seconds;
        }

        function parseTtmlTime(raw, frameRate = 30, tickRate = 10_000_000) {
            const value = String(raw || "").trim();
            if (!value) return null;

            const offset = value.match(/^([\d.]+)(h|m|s|ms|f|t)$/i);
            if (offset) {
                const amount = Number(offset[1]);
                const unit = offset[2].toLowerCase();
                if (!Number.isFinite(amount)) return null;
                if (unit === "h") return amount * 3600;
                if (unit === "m") return amount * 60;
                if (unit === "s") return amount;
                if (unit === "ms") return amount / 1000;
                if (unit === "f") return amount / frameRate;
                if (unit === "t") return amount / tickRate;
            }

            const clock = value.match(
                /^(\d+):(\d{2}):(\d{2})(?:[.,](\d+)|:(\d+))?$/,
            );
            if (!clock) return null;

            const fraction = clock[4]
                ? Number(`0.${clock[4]}`)
                : clock[5]
                  ? Number(clock[5]) / frameRate
                  : 0;

            return (
                Number(clock[1]) * 3600 +
                Number(clock[2]) * 60 +
                Number(clock[3]) +
                fraction
            );
        }

        function numericXmlAttribute(element, localName, fallback) {
            const attribute = Array.from(element?.attributes || []).find(
                (item) => item.localName === localName,
            );
            const value = Number(attribute?.value);
            return Number.isFinite(value) && value > 0 ? value : fallback;
        }

        /**
         * Sorts, merges overlapping cues with identical start times,
         * and guarantees monotonically increasing, complete cue objects with comfortable reading durations.
         */
        function finalizeCues(rawCues, { preserveTiming = false } = {}) {
            if (!Array.isArray(rawCues)) return [];

            const sorted = rawCues
                .filter(
                    (cue) =>
                        cue &&
                        Number.isFinite(cue.startTime) &&
                        cue.startTime >= 0 &&
                        typeof cue.text === "string" &&
                        cue.text.trim().length > 0,
                )
                .sort((a, b) => a.startTime - b.startTime);

            // Platform tracks already define their display intervals. Dual subtitles
            // must retain these boundaries, including gaps and overlapping cues.
            if (preserveTiming) {
                return sorted
                    .filter((cue) =>
                        Number.isFinite(cue.endTime) &&
                        cue.endTime > cue.startTime,
                    )
                    .map((cue) => {
                        const text = cue.text.replace(/\s+/g, " ").trim();
                        return { ...cue, text, lines: [text] };
                    });
            }

            const merged = [];
            for (const cue of sorted) {
                const trimmedText = cue.text.trim();
                const cueLines =
                    Array.isArray(cue.lines) && cue.lines.length > 0
                        ? cue.lines
                        : trimmedText
                              .split(/\r?\n/)
                              .map((l) => l.trim())
                              .filter(Boolean);
                const previous = merged[merged.length - 1];

                // If start times are within 50ms, merge into single multi-line/phrase cue
                if (
                    previous &&
                    Math.abs(previous.startTime - cue.startTime) < 0.05
                ) {
                    if (!previous.text.includes(trimmedText)) {
                        previous.text += "\n" + trimmedText;
                        previous.lines = previous.text
                            .split(/\r?\n/)
                            .map((l) => l.trim())
                            .filter(Boolean);
                    }
                    previous.endTime = Math.max(
                        previous.endTime || 0,
                        cue.endTime || 0,
                    );
                    continue;
                }

                merged.push({
                    startTime: Math.round(cue.startTime * 1000) / 1000,
                    endTime: Number.isFinite(cue.endTime)
                        ? Math.round(cue.endTime * 1000) / 1000
                        : null,
                    text: trimmedText,
                    lines: cueLines,
                });
            }

            // Bridge subtitle durations so words stay on screen comfortably without gaps or early cutoffs
            for (let index = 0; index < merged.length; index += 1) {
                const current = merged[index];
                const next = merged[index + 1];
                const wordCount = current.text.split(/\s+/).length;
                const minReadableDuration = Math.max(
                    1.8,
                    Math.min(6.0, wordCount * 0.38),
                );

                if (next && Number.isFinite(next.startTime)) {
                    const gapToNext = next.startTime - current.startTime;
                    if (gapToNext <= 4.5 && gapToNext > 0) {
                        current.endTime =
                            Math.round(
                                Math.max(
                                    Number.isFinite(current.endTime)
                                        ? current.endTime
                                        : 0,
                                    next.startTime - 0.04,
                                ) * 1000,
                            ) / 1000;
                    } else {
                        const candidateEnd =
                            Number.isFinite(current.endTime) &&
                            current.endTime > current.startTime
                                ? Math.max(
                                      current.endTime,
                                      current.startTime + minReadableDuration,
                                  )
                                : current.startTime + minReadableDuration;
                        current.endTime =
                            Math.round(
                                Math.min(next.startTime - 0.04, candidateEnd) *
                                    1000,
                            ) / 1000;
                    }
                } else {
                    if (
                        !Number.isFinite(current.endTime) ||
                        current.endTime <= current.startTime
                    ) {
                        current.endTime =
                            Math.round(
                                (current.startTime + minReadableDuration) *
                                    1000,
                            ) / 1000;
                    }
                }
            }

            return merged;
        }

        /**
         * Parses standard WebVTT formatted text.
         */
        function parseWebVtt(text, options = {}) {
            const cues = [];
            const cleanText = String(text || "").replace(/^\uFEFF/, "");
            const blocks = cleanText.split(/\r?\n\s*\r?\n/);

            for (const block of blocks) {
                const lines = block
                    .split(/\r?\n/)
                    .map((l) => l.trim())
                    .filter(Boolean);
                const timingIndex = lines.findIndex((line) =>
                    line.includes("-->"),
                );
                if (timingIndex < 0) continue;

                const match = lines[timingIndex].match(
                    /^\s*([^\s]+)\s+-->\s+([^\s]+)/,
                );
                if (!match) continue;

                const startTime = parseWebVttTimestamp(match[1]);
                const endTime = parseWebVttTimestamp(match[2]);
                const rawBody = lines.slice(timingIndex + 1).join("\n");
                const cueText = cleanCueText(rawBody, {
                    preserveNewlines: true,
                });
                const cueLines = cueText
                    .split(/\r?\n/)
                    .map((l) => l.trim())
                    .filter(Boolean);

                if (startTime === null || !cueText) continue;
                cues.push({
                    startTime,
                    endTime,
                    text: cueText,
                    lines: cueLines,
                });
            }

            return finalizeCues(cues, options);
        }

        /**
         * Parses TTML / DFXP / XML subtitles (used extensively by Netflix, YouTube & broadcast).
         */
        function parseTtml(text, options = {}) {
            if (!text || typeof DOMParser === "undefined") return [];

            try {
                const xml = new DOMParser().parseFromString(
                    String(text),
                    "application/xml",
                );
                if (xml.querySelector("parsererror")) return [];

                const root = xml.documentElement;
                let frameRate = numericXmlAttribute(root, "frameRate", 30);
                if (options.preserveTiming) {
                    const multiplier = Array.from(root.attributes || [])
                        .find((attribute) => attribute.localName === "frameRateMultiplier")
                        ?.value.trim().split(/\s+/).map(Number);
                    if (multiplier?.length === 2 && multiplier.every((n) => Number.isFinite(n) && n > 0)) {
                        frameRate *= multiplier[0] / multiplier[1];
                    }
                }
                const tickRate = numericXmlAttribute(
                    root,
                    "tickRate",
                    10_000_000,
                );
                const cues = [];

                const paragraphs = Array.from(
                    xml.getElementsByTagNameNS("*", "p"),
                ).filter((paragraph) =>
                    paragraph.hasAttribute("begin") || paragraph.hasAttribute("t"),
                );

                for (const paragraph of paragraphs) {
                    // YouTube srv3 uses millisecond t/d attributes on paragraphs.
                    const isSrv3 = paragraph.hasAttribute("t");
                    let startTime = isSrv3
                        ? Number(paragraph.getAttribute("t")) / 1000
                        : parseTtmlTime(paragraph.getAttribute("begin"), frameRate, tickRate);
                    let endTime = isSrv3 && paragraph.hasAttribute("d")
                        ? startTime + Number(paragraph.getAttribute("d")) / 1000
                        : parseTtmlTime(paragraph.getAttribute("end"), frameRate, tickRate);

                    if (!Number.isFinite(endTime)) {
                        const duration = parseTtmlTime(
                            paragraph.getAttribute("dur"),
                            frameRate,
                            tickRate,
                        );
                        if (
                            Number.isFinite(startTime) &&
                            Number.isFinite(duration)
                        ) {
                            endTime = startTime + duration;
                        }
                    }

                    if (options.preserveTiming && !isSrv3 && Number.isFinite(startTime)) {
                        const duration = parseTtmlTime(paragraph.getAttribute("dur"), frameRate, tickRate);
                        if (Number.isFinite(duration)) {
                            endTime = Number.isFinite(endTime)
                                ? Math.min(endTime, startTime + duration)
                                : startTime + duration;
                        }
                    }

                    if (options.preserveTiming && !isSrv3 && Number.isFinite(startTime)) {
                        // TTML begin/end offsets are relative to the containing
                        // element. Netflix usually uses a zero-offset body/div.
                        let ancestor = paragraph.parentElement;
                        let offset = 0;
                        while (ancestor && ancestor !== root) {
                            const begin = parseTtmlTime(ancestor.getAttribute("begin"), frameRate, tickRate);
                            if (Number.isFinite(begin)) offset += begin;
                            ancestor = ancestor.parentElement;
                        }
                        startTime += offset;
                        if (Number.isFinite(endTime)) endTime += offset;
                    }

                    const textClone = paragraph.cloneNode(true);
                    for (const lineBreak of Array.from(
                        textClone.getElementsByTagNameNS("*", "br"),
                    )) {
                        lineBreak.replaceWith(xml.createTextNode("\n"));
                    }

                    const cueText = cleanCueText(
                        textClone.textContent || textClone.innerHTML || "",
                        { preserveNewlines: true },
                    );
                    const cueLines = cueText
                        .split(/\r?\n/)
                        .map((l) => l.trim())
                        .filter(Boolean);

                    if (!Number.isFinite(startTime) || !cueText) continue;
                    cues.push({
                        startTime,
                        endTime,
                        text: cueText,
                        lines: cueLines,
                    });
                }

                // YouTube XML transcript fallback (<text start=".." dur="..">)
                const textNodes = Array.from(
                    xml.getElementsByTagNameNS("*", "text"),
                ).filter((node) => node.hasAttribute("start"));

                for (const node of textNodes) {
                    const startAttr = node.getAttribute("start");
                    const startTime = Number(startAttr);
                    const duration = node.hasAttribute("dur")
                        ? Number(node.getAttribute("dur"))
                        : options.preserveTiming ? NaN : 3;
                    const endTime = Number.isFinite(duration)
                        ? startTime + duration
                        : options.preserveTiming ? null : startTime + 3;
                    const cueText = cleanCueText(node.textContent || "", {
                        preserveNewlines: true,
                    });
                    const cueLines = cueText
                        .split(/\r?\n/)
                        .map((l) => l.trim())
                        .filter(Boolean);
                    if (Number.isFinite(startTime) && cueText) {
                        cues.push({
                            startTime,
                            endTime,
                            text: cueText,
                            lines: cueLines,
                        });
                    }
                }

                return finalizeCues(cues, options);
            } catch (error) {
                console.warn("[Lectoro] TTML subtitle parsing failed:", error);
                return [];
            }
        }

        /**
         * Re-attaches orphaned sentence tails, pushes orphan sentence heads forward across cluster
         * boundaries, and normalizes detached punctuation (e.g. leading commas or hanging opening marks).
         */
        function repairClusterBoundaries(cues) {
            if (!Array.isArray(cues) || cues.length < 2) return;
            const TERMINAL_PUNCT_RE = /[.!?。！？]["'»”’)\]]?\s*$/;
            const ABBREV_RE = /(?:^|\s)(?:dr|mr|mrs|ms|prof|st|vs|etc|e\.g|i\.e|u\.s|jr|sr|np|ul|godz|itd|itp|tzn)\.$/i;
            const DECIMAL_RE = /\d\.\s*$/;

            function getSegSplitTimestamp(cue, part1Text) {
                const segs = cue.segs;
                if (!Array.isArray(segs) || segs.length < 2 || cue.tStartMs == null) return null;
                let accumulatedText = "";
                const cleanTarget = String(part1Text || "").replace(/\s+/g, " ").trim();
                for (let s = 0; s < segs.length; s++) {
                    const segText = (segs[s]?.utf8 || "").trim();
                    if (!segText) continue;
                    accumulatedText = (accumulatedText + " " + segText).trim();
                    if (accumulatedText === cleanTarget || accumulatedText.startsWith(cleanTarget)) {
                        for (let next = s + 1; next < segs.length; next++) {
                            if (segs[next] && segs[next].tOffsetMs != null) {
                                return (cue.tStartMs + Number(segs[next].tOffsetMs)) / 1000;
                            }
                        }
                        break;
                    }
                }
                return null;
            }

            // Pass 1: Detached leading punctuation in curr & hanging opening punctuation in prev
            for (let i = 1; i < cues.length; i++) {
                const prev = cues[i - 1];
                const curr = cues[i];
                if (!prev || !curr || !prev.text || !curr.text) continue;

                // A. Detached leading punctuation in curr (e.g. ", but..." or "? Really?")
                const leadMatch = curr.text.match(/^([,;:!?]|\.(?!\.\.)|[)\]}”’»]+)\s*(.*)$/);
                if (leadMatch) {
                    const punct = leadMatch[1];
                    const remaining = leadMatch[2];
                    curr.text = remaining;
                    curr.lines = remaining ? [remaining] : [];
                    if (!prev.text.endsWith(punct) && !/[.,;:!?]$/.test(prev.text.trim())) {
                        prev.text = (prev.text.trim() + punct).trim();
                        prev.lines = [prev.text];
                    }
                }

                // B. Hanging opening punctuation at end of prev (e.g. "He said: (\"" -> move to curr)
                const hangMatch = prev.text.match(/\s+([(\[«„“¿¡])$/);
                if (hangMatch) {
                    const openPunct = hangMatch[1];
                    prev.text = prev.text.slice(0, hangMatch.index).trim();
                    prev.lines = [prev.text];
                    curr.text = openPunct + curr.text.trim();
                    curr.lines = [curr.text];
                }
            }

            // Pass 2: Backward Merge (orphaned sentence/clause tails at start of curr -> prev)
            for (let i = 1; i < cues.length; i++) {
                const prev = cues[i - 1];
                const curr = cues[i];
                if (!prev || !curr || !prev.text || !curr.text) continue;

                // Only repair if previous cue did not finish its sentence
                if (TERMINAL_PUNCT_RE.test(prev.text.trim())) continue;

                // Gap check: if there is a long silence gap between cues, do not merge across it
                if (curr.startTime - (prev.endTime || prev.startTime) > 1.5) continue;

                // Check if current cue starts with a single orphan word ending in terminal punctuation,
                // followed immediately by whitespace and an uppercase letter (new sentence)
                const match = curr.text.match(/^(\S+[.!?。！？]["'»”’)\]]?)\s+([A-ZÀ-ÿ0-9].*)$/);
                if (match) {
                    const orphanText = match[1].trim();
                    const remainingText = match[2].trim();

                    if (!ABBREV_RE.test(orphanText.toLowerCase())) {
                        let splitTime = getSegSplitTimestamp(curr, orphanText);
                        if (!splitTime || !Number.isFinite(splitTime)) {
                            const orphanWords = 1;
                            const totalWords = curr.text.split(/\s+/).length;
                            const dur = curr.endTime - curr.startTime;
                            const estDur = Math.min(1.5, Math.max(0.3, dur * (orphanWords / totalWords)));
                            splitTime = curr.startTime + estDur;
                        }

                        prev.text = (prev.text + " " + orphanText).trim();
                        prev.lines = [prev.text];
                        prev.endTime = splitTime;

                        curr.text = remainingText;
                        curr.lines = [remainingText];
                        curr.startTime = splitTime;
                        if (curr.tStartMs != null) {
                            curr.tStartMs = Math.round(splitTime * 1000);
                        }
                        continue;
                    }
                }
            }

            // Pass 3: Forward Push (orphaned single word head at end of prev -> curr)
            // "jesli jest kropka i duza litera to dodaj ja klaster do przodu"
            for (let i = 1; i < cues.length; i++) {
                const prev = cues[i - 1];
                const curr = cues[i];
                if (!prev || !curr || !prev.text || !curr.text) continue;

                // Gap check: if there is a long silence gap between cues, do not push across it
                if (curr.startTime - (prev.endTime || prev.startTime) > 1.5) continue;

                // Match complete sentence ending in terminal punctuation (or comma/semicolon before capital),
                // followed by a single word starting with a capital letter (e.g. "... beat him. So")
                const match = prev.text.match(/^([\s\S]+(?:[.!?。！？]|[,;])["'»”’)\]]?)\s+([A-ZÀ-ÿ0-9]\S*)$/);
                if (!match) continue;

                const headText = match[1].trim();
                const orphanHead = match[2].trim();

                // Check that headText is not ending in an abbreviation (e.g. "Dr.") or decimal number (e.g. "1.5")
                const lastHeadWord = headText.split(/\s+/).pop() || "";
                if (ABBREV_RE.test(lastHeadWord.toLowerCase())) continue;
                if (DECIMAL_RE.test(headText)) continue;

                // orphanHead must not end in terminal punctuation (it's uncompleted/cut off)
                if (TERMINAL_PUNCT_RE.test(orphanHead)) continue;

                const currStartsWithUpper = /^[A-ZÀ-ÿ0-9]/.test(curr.text.trim());
                const isCommaPunct = /[,;]["'»”’)\]]?$/.test(headText);

                if (isCommaPunct) {
                    if (currStartsWithUpper && !/^(?:so|now|but|and|then|however|therefore|also)\b/i.test(orphanHead)) continue;
                }

                // Determine split timestamp corresponding to start of orphanHead in prev
                let splitTime = getSegSplitTimestamp(prev, headText);
                if (!splitTime || !Number.isFinite(splitTime)) {
                    const prevWords = prev.text.split(/\s+/).length;
                    const headWords = prevWords - 1;
                    const dur = prev.endTime - prev.startTime;
                    const estDur = Math.max(0.3, dur * (headWords / prevWords));
                    splitTime = prev.startTime + estDur;
                }

                prev.text = headText;
                prev.lines = [headText];
                prev.endTime = splitTime;

                curr.text = (orphanHead + " " + curr.text).trim();
                curr.lines = [curr.text];
                curr.startTime = splitTime;
                if (curr.tStartMs != null) {
                    curr.tStartMs = Math.round(splitTime * 1000);
                }
            }
        }
        const repairOrphanedSentenceTails = repairClusterBoundaries;

        /**
         * Parses YouTube JSON3 timed text format (used by YouTube API for manual and ASR captions).
         * Extracts every single word token with precise timestamps and stitches dynamic streams into complete, natural sentences.
         */
        function parseYouTubeJson3(jsonOrText, options = {}) {
            if (!jsonOrText) return [];
            let data;
            try {
                data =
                    typeof jsonOrText === "string"
                        ? JSON.parse(jsonOrText)
                        : jsonOrText;
            } catch (_) {
                return [];
            }
            if (!data || !Array.isArray(data.events)) return [];

            if (options.preserveTiming) {
                const cues = [];
                for (const event of data.events) {
                    if (!event || !Array.isArray(event.segs)) continue;
                    const startTime = Number(event.tStartMs) / 1000;
                    const duration = Number(event.dDurationMs) / 1000;
                    const text = cleanCueText(event.segs
                        .map((segment) => typeof segment?.utf8 === "string" ? segment.utf8 : "")
                        .join(""));
                    if (!text) continue;
                    const cue = { startTime, endTime: startTime + duration, text };
                    if (event.tStartMs != null) {
                        Object.defineProperty(cue, "tStartMs", {
                            value: Number(event.tStartMs),
                            writable: true,
                            configurable: true,
                            enumerable: false,
                        });
                    }
                    if (event.dDurationMs != null) {
                        Object.defineProperty(cue, "dDurationMs", {
                            value: Number(event.dDurationMs),
                            writable: true,
                            configurable: true,
                            enumerable: false,
                        });
                    }
                    Object.defineProperty(cue, "segs", {
                        value: event.segs,
                        writable: true,
                        configurable: true,
                        enumerable: false,
                    });
                    cues.push(cue);
                }

                // YouTube dynamic ASR captions use overlapping rolling windows (e.g. 2-line display).
                // Cap each cluster's endTime to the next cluster's startTime so each phrase displays
                // cleanly without overlapping or stealing translations, while preserving genuine silences.
                cues.sort((a, b) => a.startTime - b.startTime);
                for (let i = 0; i < cues.length; i++) {
                    const current = cues[i];
                    for (let j = i + 1; j < cues.length; j++) {
                        const next = cues[j];
                        if (next.startTime > current.startTime) {
                            if (next.startTime < current.endTime) {
                                current.endTime = next.startTime;
                            }
                            break;
                        }
                    }
                }

                // Re-attach orphaned sentence tails, push orphan sentence heads forward,
                // and clean boundary punctuation across clusters.
                repairClusterBoundaries(cues);

                return finalizeCues(cues, options);
            }

            // 1. Collect all word tokens with exact timestamps
            const tokens = [];
            for (const event of data.events) {
                if (!event || !Array.isArray(event.segs)) continue;
                const eventStart = Number(event.tStartMs) || 0;
                const eventDur = Number(event.dDurationMs) || 0;

                for (const seg of event.segs) {
                    if (!seg || typeof seg.utf8 !== "string") continue;
                    const text = seg.utf8;
                    if (!text) continue;

                    const wordOffset = Number(seg.tOffsetMs) || 0;
                    const wordStartSec = (eventStart + wordOffset) / 1000;

                    const parts = text.split("\n");
                    for (let i = 0; i < parts.length; i++) {
                        const part = parts[i];
                        if (part) {
                            tokens.push({
                                text: part,
                                time: wordStartSec,
                                isBreak: i < parts.length - 1,
                            });
                        } else if (i < parts.length - 1 && tokens.length > 0) {
                            tokens[tokens.length - 1].isBreak = true;
                        }
                    }
                }
            }

            if (tokens.length === 0) return [];

            // 2. Assemble tokens into complete, natural sentence cues
            const rawCues = [];
            let currentTokens = [];

            function flushCue(nextStartTime = null) {
                if (currentTokens.length === 0) return;
                const rawText = currentTokens.map((t) => t.text).join(" ");
                const cleaned = cleanCueText(rawText);
                if (cleaned) {
                    const firstTime = currentTokens[0].time;
                    const lastTime =
                        currentTokens[currentTokens.length - 1].time;
                    const wordCount = cleaned.split(/\s+/).length;
                    const minDuration = Math.max(1.8, wordCount * 0.35);
                    let endTime;

                    if (
                        Number.isFinite(nextStartTime) &&
                        nextStartTime > firstTime
                    ) {
                        endTime = Math.min(
                            firstTime + Math.max(minDuration, 5.0),
                            nextStartTime - 0.04,
                        );
                        endTime = Math.max(endTime, firstTime + 0.8);
                    } else {
                        endTime = Math.max(
                            lastTime + 1.5,
                            firstTime + minDuration,
                        );
                    }

                    rawCues.push({
                        startTime: Math.round(firstTime * 1000) / 1000,
                        endTime: Math.round(endTime * 1000) / 1000,
                        text: cleaned,
                    });
                }
                currentTokens = [];
            }

            for (let i = 0; i < tokens.length; i++) {
                const token = tokens[i];
                const nextToken = tokens[i + 1];
                currentTokens.push(token);

                const textTrimmed = token.text.trim();
                const endsWithPunct = /[.!?。！？]$/.test(textTrimmed);
                const isExplicitBreak = token.isBreak;
                const timeGap = nextToken ? nextToken.time - token.time : 0;
                const isPauseBreak = timeGap > 0.9;
                const isLengthBreak =
                    currentTokens.length >= 10 && timeGap > 0.35;
                const isHardLengthLimit = currentTokens.length >= 14;

                if (
                    endsWithPunct ||
                    isExplicitBreak ||
                    isPauseBreak ||
                    isLengthBreak ||
                    isHardLengthLimit ||
                    !nextToken
                ) {
                    flushCue(nextToken ? nextToken.time : null);
                }
            }

            return finalizeCues(rawCues);
        }

        /**
         * Parses SubRip (.srt) subtitles.
         */
        function parseSrt(text, options = {}) {
            const cues = [];
            const cleanText = String(text || "").replace(/^\uFEFF/, "");
            const blocks = cleanText.split(/\r?\n\s*\r?\n/);

            for (const block of blocks) {
                const lines = block
                    .split(/\r?\n/)
                    .map((l) => l.trim())
                    .filter(Boolean);
                const timingIndex = lines.findIndex((line) =>
                    line.includes("-->"),
                );
                if (timingIndex < 0) continue;

                const match = lines[timingIndex].match(
                    /(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3})/,
                );
                if (!match) continue;

                const startTime = parseWebVttTimestamp(match[1]);
                const endTime = parseWebVttTimestamp(match[2]);
                const rawBody = lines.slice(timingIndex + 1).join("\n");
                const cueText = cleanCueText(rawBody, {
                    preserveNewlines: true,
                });
                const cueLines = cueText
                    .split(/\r?\n/)
                    .map((l) => l.trim())
                    .filter(Boolean);

                if (startTime === null || !cueText) continue;
                cues.push({
                    startTime,
                    endTime,
                    text: cueText,
                    lines: cueLines,
                });
            }

            return finalizeCues(cues, options);
        }

        /**
         * Universal entry point: autodetects subtitle format and returns normalized cues array.
         */
        function parseTimedText(text, profile = "", contentType = "", options = {}) {
            if (!text) return [];
            const raw = String(text).trim();
            const meta = `${profile || ""} ${contentType || ""}`.toLowerCase();

            // YouTube JSON3 format
            if (raw.startsWith("{") || meta.includes("json")) {
                const jsonCues = parseYouTubeJson3(raw, options);
                if (jsonCues.length > 0) return jsonCues;
            }

            if (meta.includes("webvtt") || /^\s*WEBVTT/i.test(raw)) {
                return parseWebVtt(raw, options);
            }
            if (
                meta.includes("ttml") ||
                meta.includes("dfxp") ||
                meta.includes("srv3") ||
                meta.includes("xml") ||
                /^\s*<\?xml|<tt\b|<transcript\b|<timedtext\b/i.test(raw)
            ) {
                return parseTtml(raw, options);
            }
            if (/^\d+\r?\n\d{1,2}:\d{2}:\d{2}/.test(raw)) {
                return parseSrt(raw, options);
            }

            // Fallback attempts
            const tryJson = parseYouTubeJson3(raw, options);
            if (tryJson.length > 0) return tryJson;

            const tryTtml = parseTtml(raw, options);
            if (tryTtml.length > 0) return tryTtml;

            const tryVtt = parseWebVtt(raw, options);
            if (tryVtt.length > 0) return tryVtt;

            return parseSrt(raw, options);
        }

        /**
         * Smart timeline navigation for A and D keys.
         *
         * Direction > 0 (Key D - Next Subtitle):
         *   Jumps to the next cue starting after currentTime.
         *
         * Direction < 0 (Key A - Previous Subtitle / Repeat):
         *   - If currently in the middle of a sentence (> currentCue.startTime + 1.2s),
         *     first jumps back to the BEGINNING of current sentence (replay current sentence).
         *   - If at the beginning of current sentence (<= currentCue.startTime + 1.2s),
         *     jumps to the PREVIOUS sentence.
         *
         * @param {Array<{startTime: number, endTime: number, text: string}>} cues
         * @param {number|HTMLVideoElement} videoOrTime
         * @param {number} direction - 1 for next, -1 for previous
         * @returns {number|null} target seek time in seconds, or null
         */
        function findAdjacentCueTime(cues, videoOrTime, direction) {
            if (!Array.isArray(cues) || cues.length === 0) return null;

            const currentTime =
                typeof videoOrTime === "number"
                    ? videoOrTime
                    : Number(videoOrTime?.currentTime ?? NaN);

            if (!Number.isFinite(currentTime)) return null;

            const dir = direction >= 0 ? 1 : -1;
            const TIME_EPSILON = 0.08;
            const REPLAY_THRESHOLD_SECONDS = 1.2;

            if (dir > 0) {
                // Find next cue that starts strictly after current time
                const next = cues.find(
                    (c) => c.startTime > currentTime + TIME_EPSILON,
                );
                return next ? next.startTime : null;
            }

            // Search backward for previous/current cue
            let currentOrPreviousIndex = -1;
            for (let i = cues.length - 1; i >= 0; i--) {
                if (cues[i].startTime <= currentTime + TIME_EPSILON) {
                    currentOrPreviousIndex = i;
                    break;
                }
            }

            if (currentOrPreviousIndex < 0) {
                return null;
            }

            const currentCue = cues[currentOrPreviousIndex];
            const isInsideCue =
                currentTime >= currentCue.startTime - TIME_EPSILON &&
                currentTime <=
                    (currentCue.endTime || currentCue.startTime + 3) + 0.2;

            if (isInsideCue) {
                const timeSinceStart = currentTime - currentCue.startTime;
                if (timeSinceStart > REPLAY_THRESHOLD_SECONDS) {
                    // In the middle of sentence: rewind to sentence start
                    return currentCue.startTime;
                }
                // At sentence start: jump to previous sentence
                const prevIndex = currentOrPreviousIndex - 1;
                return prevIndex >= 0 ? cues[prevIndex].startTime : 0;
            }

            // Between cues: jump to the cue that just ended
            return currentCue.startTime;
        }

        /**
         * Extracts surrounding dialogue context (previous and subsequent subtitle cues)
         * relative to the active video time or active text.
         *
         * @param {Array<{startTime: number, endTime: number, text: string}>} cues
         * @param {number|HTMLVideoElement} videoOrTime
         * @param {string} [activeText]
         * @param {{ maxBefore?: number, maxAfter?: number }} [options]
         * @returns {{ before: string[], current: string, after: string[] }}
         */
        function getSurroundingContext(
            cues,
            videoOrTime,
            activeText = "",
            { maxBefore = 2, maxAfter = 2 } = {},
        ) {
            if (!Array.isArray(cues) || cues.length === 0) {
                return {
                    before: [],
                    current: String(activeText || "").trim(),
                    after: [],
                };
            }

            const currentTime =
                typeof videoOrTime === "number"
                    ? videoOrTime
                    : Number(videoOrTime?.currentTime ?? NaN);

            const normalizedTarget = String(activeText || "")
                .toLowerCase()
                .replace(/\s+/g, " ")
                .trim();

            let currentIndex = -1;

            // 1. If activeText is provided, check if any cue around currentTime matches it
            if (normalizedTarget) {
                if (Number.isFinite(currentTime)) {
                    let bestDistance = Infinity;
                    for (let i = 0; i < cues.length; i++) {
                        const cue = cues[i];
                        const cueNorm = String(cue?.text || "")
                            .toLowerCase()
                            .replace(/\s+/g, " ")
                            .trim();
                        const matches =
                            cueNorm === normalizedTarget ||
                            cueNorm.includes(normalizedTarget) ||
                            normalizedTarget.includes(cueNorm);
                        if (matches) {
                            const dist = Math.abs(
                                (cue.startTime ?? 0) - currentTime,
                            );
                            if (dist < bestDistance) {
                                bestDistance = dist;
                                currentIndex = i;
                            }
                        }
                    }
                }

                // If not found near currentTime, search entire cues array
                if (currentIndex < 0) {
                    for (let i = 0; i < cues.length; i++) {
                        const cueNorm = String(cues[i]?.text || "")
                            .toLowerCase()
                            .replace(/\s+/g, " ")
                            .trim();
                        if (
                            cueNorm === normalizedTarget ||
                            cueNorm.includes(normalizedTarget) ||
                            normalizedTarget.includes(cueNorm)
                        ) {
                            currentIndex = i;
                            break;
                        }
                    }
                }
            }

            // 2. If index not resolved by text, find cue active at currentTime
            if (currentIndex < 0 && Number.isFinite(currentTime)) {
                for (let i = 0; i < cues.length; i++) {
                    const cue = cues[i];
                    const start = (cue.startTime ?? 0) - 0.15;
                    const end =
                        (Number.isFinite(cue.endTime)
                            ? cue.endTime
                            : cue.startTime + 4) + 0.25;
                    if (currentTime >= start && currentTime <= end) {
                        currentIndex = i;
                        break;
                    }
                }
                // If between cues, take the last cue that started before currentTime
                if (currentIndex < 0) {
                    for (let i = cues.length - 1; i >= 0; i--) {
                        if ((cues[i].startTime ?? 0) <= currentTime + 0.1) {
                            currentIndex = i;
                            break;
                        }
                    }
                }
            }

            // Fallback: if still not found, return activeText without surrounding cues
            if (currentIndex < 0) {
                return {
                    before: [],
                    current: String(activeText || "").trim(),
                    after: [],
                };
            }

            const currentCueText =
                cues[currentIndex].text || String(activeText || "").trim();

            // Extract before cues (preserving chronological order)
            const startBefore = Math.max(0, currentIndex - maxBefore);
            const beforeCues = cues
                .slice(startBefore, currentIndex)
                .map((c) => c.text?.trim())
                .filter(Boolean);

            // Extract after cues
            const endAfter = Math.min(cues.length, currentIndex + 1 + maxAfter);
            const afterCues = cues
                .slice(currentIndex + 1, endAfter)
                .map((c) => c.text?.trim())
                .filter(Boolean);

            return {
                before: beforeCues,
                current: currentCueText,
                after: afterCues,
            };
        }

        /**
         * Reconstructs fragmented subtitle cues into complete, natural sentences in a single row.
         * Merges consecutive segments until terminal punctuation ([.!?。！？]),
         * a significant pause (> 1.4s gap), or a speaker change marker (>>, -, —).
         */
        function reconstructFullSentenceCues(cues, options = {}) {
            if (!Array.isArray(cues) || cues.length === 0) return [];

            const validCues = cues.filter(
                (c) =>
                    c &&
                    Number.isFinite(c.startTime) &&
                    typeof c.text === "string" &&
                    c.text.trim().length > 0,
            );
            if (validCues.length === 0) return [];

            const TERMINAL_PUNCT_RE = /[.!?。！？]["'»”’)\]]?\s*$/;
            const CLAUSE_PUNCT_RE = /[,;:\-—–]["'»”’)\]]?\s*$/;
            const SPEAKER_CHANGE_RE = /^(?:>>+|<<+|»+|«+|››+|[-—–]\s+[A-ZÀ-ÿ]|\b[A-Z0-9_]{2,}:)/;

            const sentences = [];
            let currentCluster = [];

            function flushCluster() {
                if (currentCluster.length === 0) return;
                const firstCue = currentCluster[0];
                const lastCue = currentCluster[currentCluster.length - 1];

                const fullRawText = currentCluster
                    .map((c) => (c.text || "").trim())
                    .filter(Boolean)
                    .join(" ");

                const cleanedText = cleanCueText(fullRawText, { preserveNewlines: false })
                    .replace(/\s+/g, " ")
                    .trim();

                if (cleanedText) {
                    const startTime = Math.round(firstCue.startTime * 1000) / 1000;
                    const rawEnd = Number.isFinite(lastCue.endTime)
                        ? lastCue.endTime
                        : lastCue.startTime + 2.5;
                    const endTime = Math.round(Math.max(startTime + 0.8, rawEnd) * 1000) / 1000;

                    const existingTranslation = currentCluster
                        .map((c) => (c.translation || "").trim())
                        .filter(Boolean)
                        .join(" ");

                    sentences.push({
                        startTime,
                        endTime,
                        text: cleanedText,
                        lines: [cleanedText],
                        translation: existingTranslation,
                    });
                }
                currentCluster = [];
            }

            for (let i = 0; i < validCues.length; i++) {
                const cue = validCues[i];
                const nextCue = validCues[i + 1];

                currentCluster.push(cue);

                const trimmedText = (cue.text || "").trim();
                const endsWithPunct = TERMINAL_PUNCT_RE.test(trimmedText);
                const endsWithClausePunct = CLAUSE_PUNCT_RE.test(trimmedText);

                const timeGap = nextCue ? nextCue.startTime - (cue.endTime || cue.startTime) : 0;
                const isLongPause = timeGap > 0.65;
                const nextStartsSpeakerChange = nextCue ? SPEAKER_CHANGE_RE.test((nextCue.text || "").trim()) : false;

                const totalWordsInCluster = currentCluster
                    .reduce((acc, c) => acc + (c.text || "").split(/\s+/).length, 0);
                const totalCharsInCluster = currentCluster
                    .reduce((acc, c) => acc + (c.text || "").length, 0) + currentCluster.length - 1;

                const isSafetyBreak =
                    totalWordsInCluster >= 11 ||
                    totalCharsInCluster >= 65 ||
                    (totalWordsInCluster >= 7 && timeGap > 0.15) ||
                    (endsWithClausePunct && totalWordsInCluster >= 5);

                if (
                    endsWithPunct ||
                    isLongPause ||
                    nextStartsSpeakerChange ||
                    isSafetyBreak ||
                    !nextCue
                ) {
                    flushCluster();
                }
            }

            return finalizeCues(sentences, options);
        }

        /**
         * Attach a slave track to immutable master intervals. A slave cue belongs
         * to the master with the greatest positive overlap (ties prefer the earlier
         * master). It is never replayed across successive master fragments. Missing
         * overlaps stay empty; no guessed drift, cue fusion, or duration stretching.
         * The renderer therefore needs only the active master cue's lifecycle.
         *
         * @returns {Array<{startTime: number, endTime: number, text: string, translation: string}>}
         */
        function alignSlaveTrackToMaster(masterCues, slaveCues) {
            if (!Array.isArray(masterCues) || masterCues.length === 0) return [];

            const unified = masterCues.map((master) => {
                const text = String(master?.text || "").replace(/\s+/g, " ").trim();
                const res = { ...master, text, lines: [text], translation: "" };
                if (master && master.tStartMs != null) {
                    Object.defineProperty(res, "tStartMs", {
                        value: master.tStartMs,
                        writable: true,
                        configurable: true,
                        enumerable: false,
                    });
                }
                return res;
            });
            if (!Array.isArray(slaveCues) || slaveCues.length === 0) return unified;

            const masters = unified
                .map((cue, index) => ({ cue, index }))
                .filter(({ cue }) => Number.isFinite(cue.startTime) &&
                    Number.isFinite(cue.endTime) && cue.endTime > cue.startTime)
                .sort((a, b) => a.cue.startTime - b.cue.startTime || a.index - b.index);
            const slaves = slaveCues
                .filter((cue) => cue && Number.isFinite(cue.startTime) &&
                    Number.isFinite(cue.endTime) && cue.endTime > cue.startTime)
                .map((cue) => {
                    const text = cleanCueText(cue.text);
                    const res = { ...cue, text };
                    if (cue && cue.tStartMs != null) {
                        Object.defineProperty(res, "tStartMs", {
                            value: cue.tStartMs,
                            writable: true,
                            configurable: true,
                            enumerable: false,
                        });
                    }
                    return res;
                })
                .filter((cue) => cue.text)
                .sort((a, b) => a.startTime - b.startTime);
            const translations = unified.map(() => new Set());
            let firstMaster = 0;

            for (const slave of slaves) {
                // 1. Direct cluster match by exact tStartMs or matching startTime (e.g. YouTube JSON3 clusters)
                let exactOwner = -1;
                for (let i = 0; i < masters.length; i++) {
                    const { cue, index } = masters[i];
                    if (
                        (cue.tStartMs != null && slave.tStartMs != null && cue.tStartMs === slave.tStartMs) ||
                        Math.abs(cue.startTime - slave.startTime) < 0.045
                    ) {
                        exactOwner = index;
                        break;
                    }
                }

                if (exactOwner >= 0) {
                    translations[exactOwner].add(slave.text);
                    continue;
                }

                // 2. Interval overlap fallback for tracks with different authoring / segmentation
                while (firstMaster < masters.length &&
                    masters[firstMaster].cue.endTime <= slave.startTime) {
                    firstMaster++;
                }
                let owner = -1;
                let greatestOverlap = 0;
                let closestStartDiff = Infinity;
                for (let i = firstMaster; i < masters.length; i++) {
                    const { cue, index } = masters[i];
                    if (cue.startTime >= slave.endTime) break;
                    const overlap = Math.min(cue.endTime, slave.endTime) -
                        Math.max(cue.startTime, slave.startTime);
                    const startDiff = Math.abs(cue.startTime - slave.startTime);
                    if (overlap > 0) {
                        if (
                            owner < 0 ||
                            overlap > greatestOverlap + 1e-4 ||
                            (Math.abs(overlap - greatestOverlap) <= 1e-4 && startDiff < closestStartDiff)
                        ) {
                            greatestOverlap = overlap;
                            closestStartDiff = startDiff;
                            owner = index;
                        }
                    }
                }
                if (owner >= 0) translations[owner].add(slave.text);
            }

            for (let i = 0; i < unified.length; i++) {
                unified[i].translation = [...translations[i]].join(" ");
            }
            return unified;
        }

        return Object.freeze({
            cleanCueText,
            parseWebVttTimestamp,
            parseTtmlTime,
            finalizeCues,
            reconstructFullSentenceCues,
            alignSlaveTrackToMaster,
            parseYouTubeJson3,
            parseWebVtt,
            parseTtml,
            parseSrt,
            parseTimedText,
            findAdjacentCueTime,
            getSurroundingContext,
            repairClusterBoundaries,
            repairOrphanedSentenceTails,
        });
    },
);
