/** Coordinates Reading Modes; renderers keep DOM details in subtitle-overlay.js. */
(function (root) {
    "use strict";
    const overlay = () => root.LectoroSubtitleOverlay;

    async function translate(text, revision, layout = null) {
        const ui = overlay();
        const targetLang = await root.SharedTranslatorService.getTargetLang();
        if (revision !== ui.subtitleModeRevision || !String(text || "").trim())
            return null;
        const response = await root.SharedUtils.sendRuntimeMessage({
            type: root.LectoroConstants.MESSAGE_TYPES.TRANSLATE_SUBTITLE,
            text: String(text).trim(),
            targetLang,
        });
        if (revision !== ui.subtitleModeRevision) return null;
        const result = response?.result;
        if (result?.status === "limit") {
            ui.showSubtitleLimitOverlay(result.quota, layout);
            return { ...result, limitReached: true };
        }
        if (result?.status !== "success" || !result.translated?.trim()) {
            throw new Error("No translation received. Please try again.");
        }
        return { ...result, translatedText: result.translated };
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
            const translationTask = translate(
                snapshot.text,
                revision,
                snapshot.layout,
            );
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
            (changes.targetLang || changes.wordCloudMode || changes.subtitleTTS)
        ) {
            const ui = overlay();
            if (ui?.isSubtitleUiOpen()) ui.restoreOriginal();
        }
    });
})(globalThis);
