const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { loadFunction } = require("./helpers");
const Controller = require("../video/universal-video-controller");

function navigation(cues, observed = false) {
    const video = { currentTime: 10.5, duration: 120, paused: false };
    const session = { activeSubtitleStartTime: 10 };
    if (observed) session.observedCues = cues;
    else video.textTracks = [{ mode: "hidden", cues }];
    const context = vm.createContext({
        videoSessions: new Map([[video, session]]),
        isNetflixPage: () => false,
        LectoroUniversalVideoController: Controller,
        LectoroSubtitleOverlay: { getActiveSubtitleStartTime: () => 10 },
    });
    for (const name of ["getAllCues", "getAdjacentCueTime", "navigateSubtitle"]) {
        loadFunction(context, "adapters/player-registry.js", name);
    }
    return { video, navigate: (direction) => context.navigateSubtitle(video, direction) };
}

for (const observed of [false, true]) {
    test(`${observed ? "DOM" : "native"} subtitles allow rewinding past the first sentence`, async () => {
        const { video, navigate } = navigation([
            { startTime: 10, endTime: 14, text: "First" },
        ], observed);
        await navigate(-1);
        assert.equal(video.currentTime, 7.5);
        await navigate(-1);
        assert.equal(video.currentTime, 4.5);
        await navigate(-1);
        await navigate(-1);
        assert.equal(video.currentTime, 0);
        await navigate(-1);
        assert.equal(video.currentTime, 0);

        video.currentTime = 13;
        await navigate(-1);
        assert.equal(video.currentTime, 10, "late press still replays the first sentence");
        await navigate(-1);
        assert.equal(video.currentTime, 7, "next press rewinds beyond the first sentence");
    });

    test(`${observed ? "DOM" : "native"} subtitles use the shared replay threshold without an overlay override`, async () => {
        const cues = [
            { startTime: 2, endTime: 6, text: "Previous" },
            { startTime: 10, endTime: 14, text: "Current" },
            { startTime: 18, endTime: 20, text: "Next" },
        ];
        const { video, navigate } = navigation(cues, observed);
        for (const time of [10, 10.5, 11.99, 12, 13, 16]) {
            video.currentTime = time;
            await navigate(-1);
            assert.equal(video.currentTime, time < 12 ? 2 : 10, `backward at ${time}`);
        }
        video.currentTime = 13;
        await navigate(-1);
        await navigate(-1);
        assert.equal(video.currentTime, 2, "second press moves to the previous sentence");
        video.currentTime = 10.5;
        await navigate(1);
        assert.equal(video.currentTime, 18);
    });
}

test("short subtitles retain the shared minimum replay time", async () => {
    const { video, navigate } = navigation([
        { startTime: 2, endTime: 6 },
        { startTime: 10, endTime: 10.6 },
    ]);
    video.currentTime = 10.36;
    await navigate(-1);
    assert.equal(video.currentTime, 2);
    video.currentTime = 10.45;
    await navigate(-1);
    assert.equal(video.currentTime, 10);
});

test("videos without subtitles keep relative seeking", async () => {
    const { video, navigate } = navigation([]);
    await navigate(-1);
    assert.equal(video.currentTime, 7.5);
});

test("controller fallback allows rewinding near the start of a subtitle", async () => {
    const previous = global.LectoroSubtitleOverlay;
    global.LectoroSubtitleOverlay = { getActiveSubtitleStartTime: () => 10 };
    try {
        const video = { currentTime: 10.5, duration: 120, paused: false };
        await Controller.navigateSubtitle(video, -1);
        assert.equal(video.currentTime, 5.5);
        video.currentTime = 11.25;
        await Controller.navigateSubtitle(video, -1);
        assert.equal(video.currentTime, 10);
    } finally {
        global.LectoroSubtitleOverlay = previous;
    }
});
