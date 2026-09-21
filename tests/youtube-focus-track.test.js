const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { loadFunction } = require("./helpers");

test("Focus respects the selected manual or automatic YouTube caption track", () => {
    let loaded;
    const context = vm.createContext({
        getVideoIdFromUrl: () => "video",
        isShortsPage: () => false,
        isFocusModeEnabled: () => true,
        youtubeFocusModeActive: true,
        activeTrack: null,
        currentVideoId: "video",
        boundVideo: null,
        document: { querySelector: () => null },
        loadCaptionTrack: (track) => { loaded = track; },
        dispatchSetTrackToBridge: () => { throw new Error("Must not change the selected track"); },
    });
    loadFunction(context, "adapters/youtube-adapter.js", "handleTracksAvailable");
    const tracks = [
        { languageCode: "en", kind: "", vssId: ".en", baseUrl: "manual" },
        { languageCode: "en", kind: "asr", vssId: "a.en", baseUrl: "automatic" },
    ];
    for (const activeTrack of tracks) {
        context.handleTracksAvailable({ videoId: "video", isCcActive: true, tracks, activeTrack });
        assert.equal(loaded, activeTrack);
    }
});
