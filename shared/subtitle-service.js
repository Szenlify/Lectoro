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
     * and guarantees monotonically increasing valid cue objects.
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

            // If start times are within 40ms, treat as continuation/multi-line subtitle
            if (
                previous &&
                Math.abs(previous.startTime - cue.startTime) < 0.04
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
                startTime: cue.startTime,
                endTime: Number.isFinite(cue.endTime) ? cue.endTime : null,
                text: trimmedText,
            });
        }

        // Fill missing or invalid end times
        for (let index = 0; index < merged.length; index += 1) {
            const current = merged[index];
            if (
                !Number.isFinite(current.endTime) ||
                current.endTime <= current.startTime
            ) {
                const nextStart = merged[index + 1]?.startTime;
                current.endTime = Number.isFinite(nextStart)
                    ? Math.max(current.startTime + 0.2, nextStart - 0.02)
                    : current.startTime + 3.0;
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
     * Parses TTML / DFXP / XML subtitles (used extensively by Netflix & broadcast).
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

            return finalizeCues(cues);
        } catch (error) {
            console.warn("[Lectoro] TTML subtitle parsing failed:", error);
            return [];
        }
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

        if (meta.includes("webvtt") || /^\s*WEBVTT/i.test(raw)) {
            return parseWebVtt(raw);
        }
        if (
            meta.includes("ttml") ||
            meta.includes("dfxp") ||
            meta.includes("xml") ||
            /^\s*<\?xml|<tt\b/i.test(raw)
        ) {
            return parseTtml(raw);
        }
        if (/^\d+\r?\n\d{1,2}:\d{2}:\d{2}/.test(raw)) {
            return parseSrt(raw);
        }

        // Fallback attempts
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
        parseWebVtt,
        parseTtml,
        parseSrt,
        parseTimedText,
        findAdjacentCueTime,
    });

    globalThis.SharedSubtitleService = SubtitleService;
    globalThis.LectoroSubtitleService = SubtitleService;
})();
