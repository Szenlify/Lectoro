const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { loadFunction } = require("./helpers");

test("Focus automatically selects ASR on track discovery and when enabled during playback", () => {
    let loaded;
    let dispatched;
    const context = vm.createContext({
        getVideoIdFromUrl: () => "video",
        isShortsPage: () => false,
        isFocusModeEnabled: () => true,
        youtubeFocusModeActive: true,
        isCcActive: true,
        availableTracks: [],
        activeTrack: null,
        currentVideoId: "video",
        boundVideo: null,
        document: { querySelector: () => null },
        loadCaptionTrack: (track) => { loaded = track; },
        dispatchSetTrackToBridge: (track) => { dispatched = track; },
    });
    loadFunction(context, "adapters/youtube-adapter.js", "handleTracksAvailable");
    loadFunction(context, "adapters/youtube-adapter.js", "selectBestCaptionTrack");
    loadFunction(context, "adapters/youtube-adapter.js", "applyFocusTrackPreference");
    const tracks = [
        { languageCode: "en", kind: "", vssId: ".en", baseUrl: "manual" },
        { languageCode: "en", kind: "asr", vssId: "a.en", baseUrl: "automatic" },
    ];
    for (const activeTrack of tracks) {
        context.handleTracksAvailable({ videoId: "video", isCcActive: true, tracks, activeTrack });
        assert.equal(loaded, tracks[1]);
        assert.equal(dispatched, tracks[1]);
    }
    loaded = dispatched = null;
    context.activeTrack = tracks[0];
    context.availableTracks = tracks;
    context.applyFocusTrackPreference();
    assert.equal(loaded, tracks[1]);
    assert.equal(dispatched, tracks[1]);

    loaded = dispatched = null;
    context.availableTracks = [tracks[0]];
    context.applyFocusTrackPreference();
    assert.equal(loaded, null, "Manual-only video keeps its track");
    assert.equal(dispatched, null);

    context.activeTrack = null;
    context.handleTracksAvailable({ videoId: "video", isCcActive: true, tracks: [tracks[0]], activeTrack: tracks[0] });
    assert.equal(loaded, tracks[0]);
    assert.equal(dispatched, null);

    loaded = null;
    context.youtubeFocusModeActive = false;
    context.availableTracks = tracks;
    context.applyFocusTrackPreference();
    assert.equal(loaded, null, "Disabling Focus does not change captions");
    context.isFocusModeEnabled = () => false;
    context.handleTracksAvailable({ videoId: "video", isCcActive: true, tracks, activeTrack: tracks[0] });
    assert.equal(loaded, tracks[0]);
});
