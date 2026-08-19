/**
 * Lectoro – Universal Subtitle Service & Parser (Single Source of Truth)
 * Handles parsing (WebVTT, TTML/XML/DFXP, SRT), cue normalization, binary search indexing,
 * and precise subtitle timeline navigation (A/D keys) for all video platforms.
 */
(() => {
    "use strict";

    function cleanCueText(rawText) {
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
                    const holder = document.createElement("div");
                    holder.innerHTML = text
                        .replace(/<br\s*\/?>/gi, " ")
                        .replace(/\n+/g, " ");

                    if (
                        typeof SharedUtils !== "undefined" &&
                        typeof SharedUtils.extractSubtitleText === "function"
                    ) {
                        text = SharedUtils.extractSubtitleText(holder);
                    } else {
                        text = holder.textContent || "";
                    }
                }
            } catch (_) {
                // Fallback tag stripper
                text = text.replace(/<[^>]+>/g, " ");
            }
        } else {
            text = text.replace(/<[^>]+>/g, " ");
        }

        return text
            .replace(/\{[^}]+\}/g, "") // Remove ASS/SSA style tags
            .replace(/(?:^|\s)(?:>>+|<<+|»+|«+|››+)(?:\s|$)/g, " ") // Strip speaker change markers >>, >>>, <<, », «
            .replace(/^[>»›<«\s—–-]+/, "") // Strip leading markers/arrows
            .replace(/(?:^|\s)[>»›](?=\s)/g, " ") // Strip isolated single > markers
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
    function finalizeCues(rawCues) {
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

        const merged = [];
        for (const cue of sorted) {
            const trimmedText = cue.text.trim();
            const previous = merged[merged.length - 1];

            // If start times are within 50ms, merge into single multi-line/phrase cue
            if (
                previous &&
                Math.abs(previous.startTime - cue.startTime) < 0.05
            ) {
                if (!previous.text.includes(trimmedText)) {
                    previous.text += " " + trimmedText;
                }
                previous.endTime = Math.max(
                    previous.endTime || 0,
                    cue.endTime || 0,
                );
                continue;
            }

            merged.push({
                startTime: Math.round(cue.startTime * 1000) / 1000,
                endTime: Number.isFinite(cue.endTime) ? Math.round(cue.endTime * 1000) / 1000 : null,
                text: trimmedText,
            });
        }

        // Bridge subtitle durations so words stay on screen comfortably without gaps or early cutoffs
        for (let index = 0; index < merged.length; index += 1) {
            const current = merged[index];
            const next = merged[index + 1];
            const wordCount = current.text.split(/\s+/).length;
            const minReadableDuration = Math.max(1.8, Math.min(6.0, wordCount * 0.38));

            if (next && Number.isFinite(next.startTime)) {
                const gapToNext = next.startTime - current.startTime;
                if (gapToNext <= 4.5 && gapToNext > 0) {
                    current.endTime = Math.round(Math.max(
                        Number.isFinite(current.endTime) ? current.endTime : 0,
                        next.startTime - 0.04,
                    ) * 1000) / 1000;
                } else {
                    const candidateEnd = Number.isFinite(current.endTime) && current.endTime > current.startTime
                        ? Math.max(current.endTime, current.startTime + minReadableDuration)
                        : current.startTime + minReadableDuration;
                    current.endTime = Math.round(Math.min(next.startTime - 0.04, candidateEnd) * 1000) / 1000;
                }
            } else {
                if (!Number.isFinite(current.endTime) || current.endTime <= current.startTime) {
                    current.endTime = Math.round((current.startTime + minReadableDuration) * 1000) / 1000;
                }
            }
        }

        return merged;
    }

    /**
     * Parses standard WebVTT formatted text.
     */
    function parseWebVtt(text) {
        const cues = [];
        const cleanText = String(text || "").replace(/^\uFEFF/, "");
        const blocks = cleanText.split(/\r?\n\s*\r?\n/);

        for (const block of blocks) {
            const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
            const timingIndex = lines.findIndex((line) => line.includes("-->"));
            if (timingIndex < 0) continue;

            const match = lines[timingIndex].match(
                /^\s*([^\s]+)\s+-->\s+([^\s]+)/,
            );
            if (!match) continue;

            const startTime = parseWebVttTimestamp(match[1]);
            const endTime = parseWebVttTimestamp(match[2]);
            const rawBody = lines.slice(timingIndex + 1).join(" ");
            const cueText = cleanCueText(rawBody);

            if (startTime === null || !cueText) continue;
            cues.push({ startTime, endTime, text: cueText });
        }

        return finalizeCues(cues);
    }

    /**
     * Parses TTML / DFXP / XML subtitles (used extensively by Netflix, YouTube & broadcast).
     */
    function parseTtml(text) {
        if (!text || typeof DOMParser === "undefined") return [];

        try {
            const xml = new DOMParser().parseFromString(
                String(text),
                "application/xml",
            );
            if (xml.querySelector("parsererror")) return [];

            const root = xml.documentElement;
            const frameRate = numericXmlAttribute(root, "frameRate", 30);
            const tickRate = numericXmlAttribute(root, "tickRate", 10_000_000);
            const cues = [];

            const paragraphs = Array.from(
                xml.getElementsByTagNameNS("*", "p"),
            ).filter((paragraph) => paragraph.hasAttribute("begin"));

            for (const paragraph of paragraphs) {
                const startTime = parseTtmlTime(
                    paragraph.getAttribute("begin"),
                    frameRate,
                    tickRate,
                );
                let endTime = parseTtmlTime(
                    paragraph.getAttribute("end"),
                    frameRate,
                    tickRate,
                );

                if (!Number.isFinite(endTime)) {
                    const duration = parseTtmlTime(
                        paragraph.getAttribute("dur"),
                        frameRate,
                        tickRate,
                    );
                    if (Number.isFinite(startTime) && Number.isFinite(duration)) {
                        endTime = startTime + duration;
                    }
                }

                const textClone = paragraph.cloneNode(true);
                for (const lineBreak of Array.from(
                    textClone.getElementsByTagNameNS("*", "br"),
                )) {
                    lineBreak.replaceWith(xml.createTextNode(" "));
                }

                const cueText = cleanCueText(
                    textClone.textContent || textClone.innerHTML || "",
                );

                if (!Number.isFinite(startTime) || !cueText) continue;
                cues.push({ startTime, endTime, text: cueText });
            }

            // YouTube XML transcript fallback (<text start=".." dur="..">)
            const textNodes = Array.from(
                xml.getElementsByTagNameNS("*", "text"),
            ).filter((node) => node.hasAttribute("start"));

            for (const node of textNodes) {
                const startAttr = node.getAttribute("start");
                const startTime = Number(startAttr);
                const duration = Number(node.getAttribute("dur") || 3);
                const endTime = Number.isFinite(duration) ? startTime + duration : startTime + 3;
                const cueText = cleanCueText(node.textContent || "");
                if (Number.isFinite(startTime) && cueText) {
                    cues.push({ startTime, endTime, text: cueText });
                }
            }

            return finalizeCues(cues);
        } catch (error) {
            console.warn("[Lectoro] TTML subtitle parsing failed:", error);
            return [];
        }
    }

    /**
     * Parses YouTube JSON3 timed text format (used by YouTube API for manual and ASR captions).
     * Extracts every single word token with precise timestamps and stitches dynamic streams into complete, natural sentences.
     */
    function parseYouTubeJson3(jsonOrText) {
        if (!jsonOrText) return [];
        let data;
        try {
            data = typeof jsonOrText === "string" ? JSON.parse(jsonOrText) : jsonOrText;
        } catch (_) {
            return [];
        }
        if (!data || !Array.isArray(data.events)) return [];

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
                const lastTime = currentTokens[currentTokens.length - 1].time;
                const wordCount = cleaned.split(/\s+/).length;
                const minDuration = Math.max(1.8, wordCount * 0.35);
                let endTime;

                if (Number.isFinite(nextStartTime) && nextStartTime > firstTime) {
                    endTime = Math.min(
                        firstTime + Math.max(minDuration, 5.0),
                        nextStartTime - 0.04,
                    );
                    endTime = Math.max(endTime, firstTime + 0.8);
                } else {
                    endTime = Math.max(lastTime + 1.5, firstTime + minDuration);
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
            const timeGap = nextToken ? (nextToken.time - token.time) : 0;
            const isPauseBreak = timeGap > 0.9;
            const isLengthBreak = currentTokens.length >= 10 && timeGap > 0.35;
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
    function parseSrt(text) {
        const cues = [];
        const cleanText = String(text || "").replace(/^\uFEFF/, "");
        const blocks = cleanText.split(/\r?\n\s*\r?\n/);

        for (const block of blocks) {
            const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
            const timingIndex = lines.findIndex((line) => line.includes("-->"));
            if (timingIndex < 0) continue;

            const match = lines[timingIndex].match(
                /(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3})/,
            );
            if (!match) continue;

            const startTime = parseWebVttTimestamp(match[1]);
            const endTime = parseWebVttTimestamp(match[2]);
            const cueText = cleanCueText(lines.slice(timingIndex + 1).join(" "));

            if (startTime === null || !cueText) continue;
            cues.push({ startTime, endTime, text: cueText });
        }

        return finalizeCues(cues);
    }

    /**
     * Universal entry point: autodetects subtitle format and returns normalized cues array.
     */
    function parseTimedText(text, profile = "", contentType = "") {
        if (!text) return [];
        const raw = String(text).trim();
        const meta = `${profile || ""} ${contentType || ""}`.toLowerCase();

        // YouTube JSON3 format
        if (raw.startsWith("{") || meta.includes("json")) {
            const jsonCues = parseYouTubeJson3(raw);
            if (jsonCues.length > 0) return jsonCues;
        }

        if (meta.includes("webvtt") || /^\s*WEBVTT/i.test(raw)) {
            return parseWebVtt(raw);
        }
        if (
            meta.includes("ttml") ||
            meta.includes("dfxp") ||
            meta.includes("xml") ||
            /^\s*<\?xml|<tt\b|<transcript\b/i.test(raw)
        ) {
            return parseTtml(raw);
        }
        if (/^\d+\r?\n\d{1,2}:\d{2}:\d{2}/.test(raw)) {
            return parseSrt(raw);
        }

        // Fallback attempts
        const tryJson = parseYouTubeJson3(raw);
        if (tryJson.length > 0) return tryJson;

        const tryTtml = parseTtml(raw);
        if (tryTtml.length > 0) return tryTtml;

        const tryVtt = parseWebVtt(raw);
        if (tryVtt.length > 0) return tryVtt;

        return parseSrt(raw);
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
            const next = cues.find((c) => c.startTime > currentTime + TIME_EPSILON);
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
            currentTime <= (currentCue.endTime || currentCue.startTime + 3) + 0.2;

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

    const SubtitleService = Object.freeze({
        cleanCueText,
        parseWebVttTimestamp,
        parseTtmlTime,
        finalizeCues,
        parseYouTubeJson3,
        parseWebVtt,
        parseTtml,
        parseSrt,
        parseTimedText,
        findAdjacentCueTime,
    });

    globalThis.SharedSubtitleService = SubtitleService;
    globalThis.LectoroSubtitleService = SubtitleService;
})();
