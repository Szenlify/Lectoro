const test = require("node:test");
const assert = require("node:assert/strict");
const SRS = require("../shared/srs.js");

test("SRS default state is correctly initialized", () => {
    const def = SRS.defaultState();
    assert.strictEqual(def.interval, 0);
    assert.strictEqual(def.reps, 0);
    assert.strictEqual(def.step, 0);
    assert.strictEqual(def.easeFactor, 2.5);
    assert.strictEqual(def.lapses, 0);
    assert.strictEqual(def.nextReview, 0);
    assert.strictEqual(def.lastReview, null);
});

test("SRS progression with consecutive positive grades (Znam, grade = 2)", () => {
    let card = SRS.defaultState();
    const now = 1000000000000;

    // Rep 1: New card -> 10 minutes
    card = SRS.update(card, 2, now);
    assert.strictEqual(card.reps, 1);
    assert.strictEqual(card.step, 1);
    assert.strictEqual(card.interval, 10 / 1440);
    assert.strictEqual(card.easeFactor, 2.5);
    assert.strictEqual(card.lapses, 0);
    assert.strictEqual(SRS.formatInterval(card.interval), "10 mins");

    // Rep 2: 10m -> 1 day
    card = SRS.update(card, 2, now + 10 * 60 * 1000);
    assert.strictEqual(card.reps, 2);
    assert.strictEqual(card.step, 2);
    assert.strictEqual(card.interval, 1);
    assert.strictEqual(card.easeFactor, 2.5);
    assert.strictEqual(SRS.formatInterval(card.interval), "1 day");

    // Rep 3: 1d -> 3 days (1 * 2.5)
    card = SRS.update(card, 2, now + 86400000);
    assert.strictEqual(card.reps, 3);
    assert.strictEqual(card.interval, 3);
    assert.strictEqual(card.easeFactor, 2.5);
    assert.strictEqual(SRS.formatInterval(card.interval), "3 days");

    // Rep 4: 3d -> 8 days (3 * 2.5 = 7.5 -> 8)
    card = SRS.update(card, 2, now);
    assert.strictEqual(card.reps, 4);
    assert.strictEqual(card.interval, 8);
    assert.strictEqual(card.easeFactor, 2.55);
    assert.strictEqual(SRS.formatInterval(card.interval), "8 days");

    // Rep 5: 8d -> 20 days (8 * 2.55 = 20.4 -> 20)
    card = SRS.update(card, 2, now);
    assert.strictEqual(card.reps, 5);
    assert.strictEqual(card.interval, 20);
    assert.strictEqual(card.easeFactor, 2.60);

    // Rep 6: 20d -> 52 days
    card = SRS.update(card, 2, now);
    assert.strictEqual(card.reps, 6);
    assert.strictEqual(card.interval, 52);
    assert.strictEqual(card.easeFactor, 2.65);

    // Rep 7: 52d -> 138 days
    card = SRS.update(card, 2, now);
    assert.strictEqual(card.reps, 7);
    assert.strictEqual(card.interval, 138);
    assert.strictEqual(card.easeFactor, 2.70);

    // Rep 8: 138d -> 373 days (Mastered!)
    card = SRS.update(card, 2, now);
    assert.strictEqual(card.reps, 8);
    assert.strictEqual(card.interval, 373);
    assert.strictEqual(card.easeFactor, 2.75);
});

test("SRS lapse and failure handling ('Nie znam', grade = 1) with subsequent recovery", () => {
    const now = 1000000000000;
    let card = SRS.defaultState();
    card = SRS.update(card, 2, now); // rep 1
    card = SRS.update(card, 2, now + 600000); // rep 2
    card = SRS.update(card, 2, now + 86400000); // rep 3

    // Lapse: 'Nie znam' resets interval to 1 min
    const failed = SRS.update(card, 1, now);
    assert.strictEqual(failed.reps, 0);
    assert.strictEqual(failed.step, 0);
    assert.strictEqual(failed.lapses, 1);
    assert.strictEqual(failed.easeFactor, 2.30);
    assert.strictEqual(failed.interval, 1 / 1440);
    assert.strictEqual(SRS.formatInterval(failed.interval), "1 min");
    assert.strictEqual(failed.nextReview, now + 60 * 1000);

    // Recovery 1: Znam after 1m -> advances to 10m
    const rec1 = SRS.update(failed, 2, now + 60 * 1000);
    assert.strictEqual(rec1.reps, 1);
    assert.strictEqual(rec1.interval, 10 / 1440);
    assert.strictEqual(SRS.formatInterval(rec1.interval), "10 mins");

    // Recovery 2: Znam after 10m -> graduates to 1d
    const rec2 = SRS.update(rec1, 2, now + 10 * 60 * 1000);
    assert.strictEqual(rec2.reps, 2);
    assert.strictEqual(rec2.interval, 1);
    assert.strictEqual(SRS.formatInterval(rec2.interval), "1 day");
});

test("SRS preview labels show next intervals for grades 1 and 2", () => {
    const newCard = SRS.defaultState();
    assert.strictEqual(SRS.previewLabel(newCard, 1), "1 min");
    assert.strictEqual(SRS.previewLabel(newCard, 2), "10 mins");

    const tenMinCard = SRS.update(newCard, 2, Date.now());
    assert.strictEqual(SRS.previewLabel(tenMinCard, 1), "1 min");
    assert.strictEqual(SRS.previewLabel(tenMinCard, 2), "1 day");
});

test("SRS legacy word migration and due checks", () => {
    const now = 1000000000000;
    const legacyWord = { original: "test", sr: { step: 4, interval: 14, easeFactor: 2.3, nextReview: 123456 } };
    SRS.ensure(legacyWord);
    assert.strictEqual(legacyWord.sr.reps, 4);
    assert.strictEqual(legacyWord.sr.step, 4);
    assert.strictEqual(SRS.isDue({ sr: { nextReview: now - 1000 } }, now), true);
    assert.strictEqual(SRS.isDue({ sr: { nextReview: now + 1000 } }, now), false);
});
