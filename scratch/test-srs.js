const assert = require("assert");
const SRS = require("../shared/srs.js");

console.log("=== Running SRS Algorithm Tests (1m -> 10m -> 1d -> Multiplier) ===");

// 1. Default state
const def = SRS.defaultState();
assert.strictEqual(def.interval, 0);
assert.strictEqual(def.reps, 0);
assert.strictEqual(def.step, 0);
assert.strictEqual(def.easeFactor, 2.5);
assert.strictEqual(def.lapses, 0);
assert.strictEqual(def.nextReview, 0);
assert.strictEqual(def.lastReview, null);
console.log("✓ Default state test passed");

// 2. Progression with consecutive 'Znam' (grade = 2)
let card = SRS.defaultState();
const now = 1000000000000;

// Rep 1: New card -> 10 minutes
card = SRS.update(card, 2, now);
assert.strictEqual(card.reps, 1);
assert.strictEqual(card.step, 1);
assert.strictEqual(card.interval, 10 / 1440); // 10 minutes
assert.strictEqual(card.easeFactor, 2.5);
assert.strictEqual(card.lapses, 0);
assert.strictEqual(SRS.formatInterval(card.interval), "10 mins");
console.log(`✓ Rep 1 (Znam - short-term consolidation): interval=${SRS.formatInterval(card.interval)}, reps=${card.reps}`);

// Rep 2: 10m -> 1 day
card = SRS.update(card, 2, now + 10 * 60 * 1000);
assert.strictEqual(card.reps, 2);
assert.strictEqual(card.step, 2);
assert.strictEqual(card.interval, 1); // 1 day
assert.strictEqual(card.easeFactor, 2.5);
assert.strictEqual(SRS.formatInterval(card.interval), "1 day");
console.log(`✓ Rep 2 (Znam - graduation): interval=${card.interval}d (${SRS.formatInterval(card.interval)}), reps=${card.reps}`);

// Rep 3: 1d -> 3 days (1 * 2.5)
card = SRS.update(card, 2, now + 86400000);
assert.strictEqual(card.reps, 3);
assert.strictEqual(card.interval, 3); // 1 * 2.5 = 2.5 -> 3 days
assert.strictEqual(card.easeFactor, 2.5);
assert.strictEqual(SRS.formatInterval(card.interval), "3 days");
console.log(`✓ Rep 3 (Znam - multiplier): interval=${card.interval}d (${SRS.formatInterval(card.interval)}), reps=${card.reps}`);

// Rep 4: 3d -> 8 days (3 * 2.5)
card = SRS.update(card, 2, now);
assert.strictEqual(card.reps, 4);
assert.strictEqual(card.interval, 8); // 3 * 2.5 = 7.5 -> 8 days
assert.strictEqual(card.easeFactor, 2.55); // easeFactor boost +0.05
assert.strictEqual(SRS.formatInterval(card.interval), "8 days");
console.log(`✓ Rep 4 (Znam - multiplier): interval=${card.interval}d (${SRS.formatInterval(card.interval)}), reps=${card.reps}, easeFactor=${card.easeFactor}`);

// Rep 5: 8d -> 20 days
card = SRS.update(card, 2, now);
assert.strictEqual(card.reps, 5);
assert.strictEqual(card.interval, 20); // 8 * 2.55 = 20.4 -> 20 days
assert.strictEqual(card.easeFactor, 2.60);
console.log(`✓ Rep 5 (Znam - multiplier): interval=${card.interval}d (${SRS.formatInterval(card.interval)}), reps=${card.reps}, easeFactor=${card.easeFactor}`);

// Rep 6: 20d -> 52 days
card = SRS.update(card, 2, now);
assert.strictEqual(card.reps, 6);
assert.strictEqual(card.interval, 52); // 20 * 2.60 = 52 days
assert.strictEqual(card.easeFactor, 2.65);
console.log(`✓ Rep 6 (Znam - multiplier): interval=${card.interval}d (${SRS.formatInterval(card.interval)}), reps=${card.reps}, easeFactor=${card.easeFactor}`);

// Rep 7: 52d -> 138 days
card = SRS.update(card, 2, now);
assert.strictEqual(card.reps, 7);
assert.strictEqual(card.interval, 138); // 52 * 2.65 = 137.8 -> 138 days
assert.strictEqual(card.easeFactor, 2.70);
console.log(`✓ Rep 7 (Znam - multiplier): interval=${card.interval}d (${SRS.formatInterval(card.interval)}), reps=${card.reps}, easeFactor=${card.easeFactor}`);

// Rep 8: 138d -> 373 days (Mastered!)
card = SRS.update(card, 2, now);
assert.strictEqual(card.reps, 8);
assert.strictEqual(card.interval, 373); // 138 * 2.70 = 372.6 -> 373 days (> 1 year, Mastered)
assert.strictEqual(card.easeFactor, 2.75);
console.log(`✓ Rep 8 (Znam - Mastered): interval=${card.interval}d (${SRS.formatInterval(card.interval)}), reps=${card.reps}, easeFactor=${card.easeFactor}`);

// 3. Test Lapse / Failure ('Nie znam', grade = 1) -> exactly 1 minute
const failed = SRS.update(card, 1, now);
assert.strictEqual(failed.reps, 0);
assert.strictEqual(failed.step, 0);
assert.strictEqual(failed.lapses, 1);
assert.strictEqual(failed.easeFactor, 2.55); // 2.75 - 0.20 = 2.55
assert.strictEqual(failed.interval, 1 / 1440); // 1 minute
assert.strictEqual(SRS.formatInterval(failed.interval), "1 min");
assert.strictEqual(failed.nextReview, now + 60 * 1000);
console.log(`✓ Lapse (Nie znam): interval=${SRS.formatInterval(failed.interval)} (1 minute!), reps=${failed.reps}, lapses=${failed.lapses}, easeFactor=${failed.easeFactor}`);

// Recovery after lapse:
// In 1 minute -> clicks Znam -> advances to 10 minutes
const rec1 = SRS.update(failed, 2, now + 60 * 1000);
assert.strictEqual(rec1.reps, 1);
assert.strictEqual(rec1.interval, 10 / 1440); // 10 minutes
assert.strictEqual(SRS.formatInterval(rec1.interval), "10 mins");
console.log(`✓ Recovery 1 (Znam after 1m): interval=${SRS.formatInterval(rec1.interval)}, reps=${rec1.reps}`);

// In 10 minutes -> clicks Znam -> graduates to 1 day
const rec2 = SRS.update(rec1, 2, now + 10 * 60 * 1000);
assert.strictEqual(rec2.reps, 2);
assert.strictEqual(rec2.interval, 1); // 1 day
assert.strictEqual(SRS.formatInterval(rec2.interval), "1 day");
console.log(`✓ Recovery 2 (Znam after 10m): interval=${rec2.interval}d (${SRS.formatInterval(rec2.interval)}), reps=${rec2.reps}`);

// 4. Preview labels
const newCard = SRS.defaultState();
assert.strictEqual(SRS.previewLabel(newCard, 1), "1 min");
assert.strictEqual(SRS.previewLabel(newCard, 2), "10 mins");
console.log(`✓ Preview labels for new card: Nie znam -> "${SRS.previewLabel(newCard, 1)}", Znam -> "${SRS.previewLabel(newCard, 2)}"`);

assert.strictEqual(SRS.previewLabel(rec1, 1), "1 min");
assert.strictEqual(SRS.previewLabel(rec1, 2), "1 day");
console.log(`✓ Preview labels for 10m card: Nie znam -> "${SRS.previewLabel(rec1, 1)}", Znam -> "${SRS.previewLabel(rec1, 2)}"`);

assert.strictEqual(SRS.previewLabel(rec2, 1), "1 min");
console.log(`✓ Preview labels for 1d card: Nie znam -> "${SRS.previewLabel(rec2, 1)}", Znam -> "${SRS.previewLabel(rec2, 2)}"`);

// 5. Legacy migration and isDue
const legacyWord = { original: "test", sr: { step: 4, interval: 14, easeFactor: 2.3, nextReview: 123456 } };
SRS.ensure(legacyWord);
assert.strictEqual(legacyWord.sr.reps, 4);
assert.strictEqual(legacyWord.sr.step, 4);
assert.strictEqual(SRS.isDue({ sr: { nextReview: now - 1000 } }, now), true);
assert.strictEqual(SRS.isDue({ sr: { nextReview: now + 1000 } }, now), false);
console.log("✓ Legacy migration & isDue tests passed");

console.log("\nALL SRS TESTS PASSED PERFECTLY! 🎉");
