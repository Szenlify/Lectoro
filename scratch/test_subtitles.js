/**
 * Verification test for Universal Subtitle Service (WebVTT, TTML, SRT, navigation algorithm)
 */
const assert = require("assert");

// Mock environment for Node.js
global.SharedUtils = {
    extractSubtitleText: (node) => (node?.textContent || "").replace(/\s+/g, " ").trim(),
};

// Simple DOMParser mock for Node environment tests
class MockElement {
    constructor(tagName, textContent = "") {
        this.tagName = tagName;
        this.attributes = {};
        this.textContent = textContent;
        this.childNodes = [];
    }
    getAttribute(name) {
        return this.attributes[name] || null;
    }
    hasAttribute(name) {
        return name in this.attributes;
    }
    cloneNode() {
        const c = new MockElement(this.tagName, this.textContent);
        c.attributes = { ...this.attributes };
        return c;
    }
    getElementsByTagNameNS(_, tag) {
        return this.childNodes.filter(n => n.tagName.toLowerCase() === tag.toLowerCase());
    }
}

class MockDOMParser {
    parseFromString(text, type) {
        const root = new MockElement("tt");
        root.attributes["frameRate"] = "30";
        root.attributes["tickRate"] = "10000000";
        const doc = {
            documentElement: root,
            body: new MockElement("body", text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()),
            querySelector: () => null,
            getElementsByTagNameNS: (ns, tag) => {
                // Return mock paragraphs for sample ttml
                if (text.includes('begin="00:00:01.000"')) {
                    const p1 = new MockElement("p", "Hello world");
                    p1.attributes["begin"] = "00:00:01.000";
                    p1.attributes["end"] = "00:00:04.000";

                    const p2 = new MockElement("p", "This is a Netflix subtitle");
                    p2.attributes["begin"] = "00:00:05.500";
                    p2.attributes["end"] = "00:00:08.000";

                    const p3 = new MockElement("p", "Third sentence here");
                    p3.attributes["begin"] = "00:00:10.000";
                    p3.attributes["end"] = "00:00:12.000";

                    return [p1, p2, p3];
                }
                return [];
            },
        };
        return doc;
    }
}
global.DOMParser = MockDOMParser;

// Load SubtitleService
require("../shared/subtitle-service.js");
const service = global.SharedSubtitleService;

console.log("Testing SharedSubtitleService...");

// 1. WebVTT Parser test
const sampleVtt = `WEBVTT

00:01.000 --> 00:04.000
Hello <b>world</b>

00:05.500 --> 00:08.000
This is a test subtitle

00:10.000 --> 00:12.500
Third subtitle cue
`;

const vttCues = service.parseWebVtt(sampleVtt);
assert.strictEqual(vttCues.length, 3, "Should parse 3 WebVTT cues");
assert.strictEqual(vttCues[0].startTime, 1);
assert.strictEqual(vttCues[0].text, "Hello world");
console.log("✓ WebVTT parser passed.");

// 2. SRT Parser test
const sampleSrt = `1
00:00:01,000 --> 00:00:04,000
First subtitle line

2
00:00:05,500 --> 00:00:08,000
Second subtitle line
`;

const srtCues = service.parseSrt(sampleSrt);
assert.strictEqual(srtCues.length, 2, "Should parse 2 SRT cues");
assert.strictEqual(srtCues[0].startTime, 1);
assert.strictEqual(srtCues[0].text, "First subtitle line");
console.log("✓ SRT parser passed.");

// 3. Navigation tests (A and D keys)
const cues = [
    { startTime: 2.0, endTime: 5.0, text: "Sentence 1" },
    { startTime: 7.0, endTime: 10.0, text: "Sentence 2" },
    { startTime: 12.0, endTime: 15.0, text: "Sentence 3" },
];

// Next subtitle (D key / direction = 1)
assert.strictEqual(service.findAdjacentCueTime(cues, 0.0, 1), 2.0, "At t=0s, D should jump to Sentence 1 (2.0s)");
assert.strictEqual(service.findAdjacentCueTime(cues, 2.5, 1), 7.0, "At t=2.5s, D should jump to Sentence 2 (7.0s)");
assert.strictEqual(service.findAdjacentCueTime(cues, 5.5, 1), 7.0, "At t=5.5s (between 1 and 2), D should jump to Sentence 2 (7.0s)");
assert.strictEqual(service.findAdjacentCueTime(cues, 13.0, 1), null, "At t=13s, D should return null (no next cue)");

// Previous subtitle (A key / direction = -1)
// Case: inside sentence, more than 1.2s into it -> replay current sentence
assert.strictEqual(service.findAdjacentCueTime(cues, 4.0, -1), 2.0, "At t=4.0s (in middle of Sentence 1), A should rewind to start of Sentence 1 (2.0s)");
assert.strictEqual(service.findAdjacentCueTime(cues, 9.0, -1), 7.0, "At t=9.0s (in middle of Sentence 2), A should rewind to start of Sentence 2 (7.0s)");

// Case: at start of sentence (<= 1.2s into it) -> jump to previous sentence
assert.strictEqual(service.findAdjacentCueTime(cues, 7.5, -1), 2.0, "At t=7.5s (at start of Sentence 2), A should jump to Sentence 1 (2.0s)");
assert.strictEqual(service.findAdjacentCueTime(cues, 2.3, -1), 0, "At t=2.3s (at start of Sentence 1), A should jump to 0s");

// Case: between sentences (e.g. t=6.0s) -> jump to Sentence 1 (2.0s)
assert.strictEqual(service.findAdjacentCueTime(cues, 6.0, -1), 2.0, "At t=6.0s (gap between sentences), A should jump to Sentence 1 (2.0s)");

// HTMLVideoElement mock test
const mockVideo = { currentTime: 8.5 };
assert.strictEqual(service.findAdjacentCueTime(cues, mockVideo, -1), 7.0, "Supports passing HTMLVideoElement mock");

console.log("✓ Timeline navigation tests (A/D keys) passed.");

console.log("\nALL TESTS PASSED SUCCESSFULLY! 🚀");
