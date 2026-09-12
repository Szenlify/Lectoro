/** Coordinates Reading Modes; renderers keep DOM details in subtitle-overlay.js. */
(function (root) {
    "use strict";
    const overlay = () => root.LectoroSubtitleOverlay;

    async function translate(text, revision, layout = null) {
        const ui = overlay();
        const { targetLang, learningLang } = await root.SharedTranslatorService.getReadingSettings();
        if (revision !== ui.subtitleModeRevision || !String(text || "").trim())
            return null;

        let response = null;
        let requestError = null;
        try {
            response = await root.SharedUtils.sendRuntimeMessage({
                type: root.LectoroConstants.MESSAGE_TYPES.TRANSLATE_SUBTITLE,
                text: String(text).trim(),
                targetLang,
                sourceLang: learningLang,
            });
        } catch (error) {
            requestError = error;
        }

        if (revision !== ui.subtitleModeRevision) return null;
        const result = response?.result;
        if (result?.status === "limit") {
            ui.showSubtitleLimitOverlay(result.quota, layout);
            return { ...result, limitReached: true };
        }
        if (result?.status === "success" && result.translated?.trim()) {
            return { ...result, translatedText: result.translated };
        }

        // Do not replace a subtitle with an error screen when the AI/backend path is unavailable.
        // The backend already prefers shared R2 data; this is the final client-side translation fallback.
        try {
            const fallback = await root.QT?.translate?.(String(text).trim(), targetLang);
            if (revision !== ui.subtitleModeRevision) return null;
            if (fallback?.translated?.trim()) {
                return {
                    status: "success",
                    translated: fallback.translated,
                    translatedText: fallback.translated,
                    detectedLang: fallback.detectedLang || learningLang,
                    targetLang,
                    fallback: true,
                };
            }
        } catch (fallbackError) {
            console.warn("[Lectoro] Subtitle fallback translation failed:", fallbackError);
        }

        if (requestError) throw requestError;
        throw new Error("No translation received. Please try again.");
    }

    async function start(video) {
        const ui = overlay();
        const registry = root.LectoroPlayerRegistry;
        if (!ui || !video) return;
        root.cleanupReading?.();
        const revision = ui.nextSubtitleModeRevision();
        const isCurrent = () => revision === ui.subtitleModeRevision;
        const wasPlaying = !video.paused;
        // Freeze and capture the current cue before any asynchronous storage read.
        if (wasPlaying)
            registry?.pauseVideo ? registry.pauseVideo(video) : video.pause();
        const snapshot = ui.captureSubtitleSnapshot();
        try {
            const settings =
                await root.SharedTranslatorService.getReadingSettings();
            if (!isCurrent()) return;
            ui.resetSubtitleModeStarting();
            if (
                !snapshot.text ||
                (!settings.wordCloudMode && !settings.subtitleTTS)
            ) {
                ui.restoreOriginal();
                if (wasPlaying) ui.resumeVideoAfterSubtitleClose(video);
                return;
            }
            const translationTask = settings.subtitleTTS ? translate(
                snapshot.text,
                revision,
                snapshot.layout,
            ) : null;
            const tasks = [];
            if (settings.wordCloudMode) {
                tasks.push(
                    ui.showWordClouds(video, {
                        skipSpeech: settings.subtitleTTS,
                        revision,
                        sourceText: snapshot.text,
                        sourceElements: snapshot.elements,
                        translationTask,
                    }),
                );
            }
            if (settings.subtitleTTS) {
                tasks.push(
                    ui.doSentenceTranslation(video, snapshot.text, {
                        speakTranslated: true,
                        revision,
                        layout: snapshot.layout,
                        translationTask,
                    }),
                );
            }
            // Observe the shared task even when a renderer exits before awaiting it.
            const results = await Promise.allSettled([
                translationTask,
                ...tasks,
            ]);
            if (!isCurrent()) return;
            const failed = results.find(
                (result) => result.status === "rejected",
            );
            if (failed) ui.showReadingError(failed.reason, snapshot.layout);
        } catch (error) {
            if (isCurrent()) {
                ui.resetSubtitleModeStarting();
                ui.showReadingError(error, snapshot.layout);
            }
        }
    }

    root.LectoroReadingModes = Object.freeze({ start, translate });
    // A pending response for the old language must never repaint the new settings.
    root.chrome?.storage?.onChanged?.addListener((changes, area) => {
        if (
            area === "local" &&
            (changes.targetLang || changes.learningLang || changes.wordCloudMode || changes.subtitleTTS)
        ) {
            const ui = overlay();
            if (ui?.isSubtitleUiOpen()) ui.restoreOriginal();
            if (changes.targetLang || changes.learningLang) {
                ui?.closeSubTooltip?.({ resumeVideo: false });
                if (ui?.isAiTooltipActive?.()) ui.closeAiTooltip({ resumeVideo: false });
            }
        }
    });
})(globalThis);
