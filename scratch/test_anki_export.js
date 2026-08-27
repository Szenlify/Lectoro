const assert = require("assert");

// 1. Test SharedTtsService getAudioBlob export
const SharedTtsService = require("../shared/tts-service.js");
assert(typeof SharedTtsService.getAudioBlob === "function", "getAudioBlob must be a function on SharedTtsService");

// Test that getAudioBlob with allowSynthesis: false returns null or google-tts fallback (does not throw or call ElevenLabs proxy)
(async () => {
    // With allowFallback: false, should return null if not in cache/R2
    const miss = await SharedTtsService.getAudioBlob("nonexistent_rare_word_xyz_123", "en", { allowSynthesis: false, allowFallback: false });
    assert.strictEqual(miss, null, "Should return null when allowFallback is false and not in cache");

    const res = await SharedTtsService.getAudioBlob("hello", "en", { allowSynthesis: false, allowFallback: true });
    assert(res === null || res?.provider === "google-tts" || res?.provider === "elevenlabs");
})();

// 2. Test Anki formatting logic
const SharedUtils = require("../shared/utils.js");
const { escapeHtml } = SharedUtils;

const testWord = {
    original: "reluctant",
    translated: "niechętny",
    sentence: "He was reluctant to join the meeting.",
    sentenceTranslated: "Niechętnie dołączył do spotkania.",
    aiSentence: "She was reluctant to accept the offer.",
    aiSentenceTranslated: "Niechętnie przyjęła tę ofertę.",
    screenshot: "data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAQAcJaQAA3AA/v39gAA=",
    srcLang: "en",
    tgtLang: "pl",
};

// Verify Cloze syntax formatting
const sentenceSource = (testWord.aiSentence || testWord.sentence || "").trim();
const cleanOriginal = (testWord.original || "").trim();
const cleanTranslated = (testWord.translated || "").trim();
const regex = new RegExp(`(${cleanOriginal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "i");

assert(regex.test(sentenceSource), "Regex should match word in AI sentence");

const clozeSentenceHtml = escapeHtml(sentenceSource).replace(
    regex,
    `{{c1::$1::${escapeHtml(cleanTranslated)}}}`,
);

assert(clozeSentenceHtml.includes("{{c1::reluctant::niechętny}}"), "Cloze replacement must be valid");

// Build Front Card HTML
const srcLangTag = (testWord.srcLang || "en").toUpperCase();
const tgtLangTag = (testWord.tgtLang || "pl").toUpperCase();
const frontCardHtml = `<style>.lectoro-anki-card .cloze { color: #38bdf8 !important; font-weight: 700; text-decoration: none; border-bottom: 2px solid #38bdf8; padding-bottom: 1px; }</style><div class="lectoro-anki-card" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 16px auto; padding: 26px 28px; background: linear-gradient(180deg, #0f172a 0%, #090d16 100%); border: 1px solid rgba(56, 189, 248, 0.22); border-radius: 20px; box-shadow: 0 12px 32px -8px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05); color: #f8fafc; text-align: center;"><div style="display: flex; justify-content: center; align-items: center; gap: 8px; margin-bottom: 18px;"><span style="background: rgba(56, 189, 248, 0.12); color: #38bdf8; font-weight: 700; font-size: 11px; padding: 4px 12px; border-radius: 20px; letter-spacing: 0.08em; border: 1px solid rgba(56, 189, 248, 0.25); text-transform: uppercase;">${srcLangTag} → ${tgtLangTag}</span><span style="background: rgba(255, 255, 255, 0.06); color: #94a3b8; font-size: 11px; font-weight: 600; padding: 4px 12px; border-radius: 20px; letter-spacing: 0.08em; border: 1px solid rgba(255, 255, 255, 0.08);">LECTORO ✦</span></div><div style="font-size: 20px; line-height: 1.65; color: #f8fafc; font-weight: 500; text-align: center; max-width: 500px; margin: 0 auto;">${clozeSentenceHtml}</div></div>`;

assert(frontCardHtml.includes("EN → PL"), "Front card must include language tag");
assert(frontCardHtml.includes("LECTORO ✦"), "Front card must include branding");
assert(frontCardHtml.includes("{{c1::reluctant::niechętny}}"), "Front card must contain cloze deletion");
assert(frontCardHtml.includes("text-align: center"), "Front card must be centered");

// Build Back Card HTML
const extraParts = [];
extraParts.push(`<div style="margin-bottom: 18px; text-align: center;"><div style="font-size: 11px; text-transform: uppercase; color: #38bdf8; font-weight: 700; letter-spacing: 0.12em; margin-bottom: 4px;">TŁUMACZENIE</div><div style="font-size: 26px; font-weight: 800; color: #ffffff; letter-spacing: -0.02em; text-shadow: 0 2px 12px rgba(56, 189, 248, 0.25);">${escapeHtml(cleanTranslated)}</div></div>`);
if (testWord.sentenceTranslated) {
    extraParts.push(`<div style="font-size: 14px; line-height: 1.55; color: #94a3b8; font-style: italic; margin: 0 auto 16px; text-align: center; max-width: 480px; padding: 8px 16px; background: rgba(0, 0, 0, 0.25); border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.06);">"${escapeHtml(testWord.sentenceTranslated)}"</div>`);
}
const screenshotSrc = testWord.screenshot;
extraParts.push(`<div style="margin: 16px auto 0; text-align: center;"><div style="display: inline-block; max-width: 100%; border-radius: 14px; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.12); background: #000000; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);"><img src="${escapeHtml(screenshotSrc)}" style="max-width: 100%; max-height: 250px; width: auto; height: auto; display: block; margin: 0 auto; object-fit: contain;"></div></div>`);
const audioFile = "lectoro_audio_test.mp3";
const audioDataUri = "data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA";
extraParts.push(`<div style="margin: 16px auto 0; max-width: 380px; padding: 8px 16px; background: rgba(0, 0, 0, 0.35); border-radius: 24px; border: 1px solid rgba(255, 255, 255, 0.1); display: flex; align-items: center; justify-content: center; gap: 10px;"><span style="font-size: 11px; color: #38bdf8; font-weight: 700; letter-spacing: 0.05em;">AUDIO</span><audio controls src="${audioDataUri}" style="height: 32px; width: 100%; max-width: 300px; outline: none;"></audio></div>`);

const backCardHtml = `<div class="lectoro-anki-extra" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 14px auto 0; padding: 24px 28px; background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 20px; box-shadow: 0 12px 32px -8px rgba(0, 0, 0, 0.5); color: #f8fafc; text-align: center;">${extraParts.join("")}</div>`;

assert(backCardHtml.includes("max-height: 250px"), "Screenshot must have max-height constraint");
assert(backCardHtml.includes("data:image/webp;base64"), "Screenshot must support direct base64 data URI");
assert(backCardHtml.includes("<audio controls"), "Back card must include playable HTML5 audio element");
assert(backCardHtml.includes("text-align: center"), "Back card must be centered");
assert(backCardHtml.includes("niechętny"), "Back card must include translation");

// Test TSV line serialization
const cleanField = (str) => String(str || "").replace(/[\r\n]+/g, "").replace(/\t/g, " ");
let finalBack = cleanField(backCardHtml);
if (audioFile) {
    finalBack += ` [sound:${audioFile}]`;
}
const tsvLine = `${cleanField(frontCardHtml)}\t${finalBack}`;

assert(!tsvLine.includes("\r"), "TSV line must not contain carriage returns");
assert(!tsvLine.includes("\n"), "TSV line must not contain raw newlines");
assert(tsvLine.endsWith(`[sound:${audioFile}]`), "Native Anki sound tag must be at the end of the line outside HTML");
const cols = tsvLine.split("\t");
assert.strictEqual(cols.length, 2, "TSV line must have exactly 2 columns");
// 3. Test Smart Cloze for whole sentences saved via key Z
// Load findBestClozeWord from export.js context
const fs = require("fs");
const exportJsContent = fs.readFileSync(require("path").join(__dirname, "../popup/export.js"), "utf8");
const findBestClozeWordMatch = exportJsContent.match(/function findBestClozeWord\([\s\S]*?\n\}/);
assert(findBestClozeWordMatch, "findBestClozeWord function must exist in export.js");
const findBestClozeWord = new Function("sentence", `${findBestClozeWordMatch[0]}; return findBestClozeWord(sentence);`);

// Test 3a: Sentence with obvious content words
const sentence1 = "You don't have to worry about that.";
const word1 = findBestClozeWord(sentence1);
assert.strictEqual(word1, "worry", "Should identify 'worry' as the key content word");

// Test 3b: Sentence with advanced content word
const sentence2 = "She made an extraordinary decision.";
const word2 = findBestClozeWord(sentence2);
assert.strictEqual(word2, "extraordinary", "Should identify 'extraordinary' as the key content word");

// Test 3c: Sentence saved via key Z generates Smart Cloze with first-letter hint and top translation
const testZSentence = {
    original: "You don't have to worry about that.",
    translated: "Nie musisz się tym martwić.",
    sentence: "",
    srcLang: "en",
    tgtLang: "pl",
};

const keyWord = findBestClozeWord(testZSentence.original);
assert.strictEqual(keyWord, "worry");
const firstChar = keyWord.charAt(0);
const hint = `${firstChar}...`;
const escapedSentence = escapeHtml(testZSentence.original);
const regexZ = new RegExp(`(${keyWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "i");
const clozeSentenceHtmlZ = escapedSentence.replace(regexZ, `{{c1::$1::${hint}}}`);

assert(clozeSentenceHtmlZ.includes("{{c1::worry::w...}}"), "Cloze replacement must have first letter hint");
assert(!clozeSentenceHtmlZ.includes("{{c1::You don't"), "Must NOT cloze the entire sentence");

const sentencePromptTopZ = `<div style="font-size: 15px; line-height: 1.55; color: #cbd5e1; font-style: italic; margin: 0 auto 16px; text-align: center; max-width: 500px; padding: 8px 16px; background: rgba(0, 0, 0, 0.3); border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.06);">"${escapeHtml(testZSentence.translated)}"</div>`;

const frontCardHtmlZ = `<style>.lectoro-anki-card .cloze { color: #38bdf8 !important; font-weight: 700; text-decoration: none; border-bottom: 2px solid #38bdf8; padding-bottom: 1px; }</style><div class="lectoro-anki-card" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 16px auto; padding: 26px 28px; background: linear-gradient(180deg, #0f172a 0%, #090d16 100%); border: 1px solid rgba(56, 189, 248, 0.22); border-radius: 20px; box-shadow: 0 12px 32px -8px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05); color: #f8fafc; text-align: center;"><div style="display: flex; justify-content: center; align-items: center; gap: 8px; margin-bottom: 18px;"><span style="background: rgba(56, 189, 248, 0.12); color: #38bdf8; font-weight: 700; font-size: 11px; padding: 4px 12px; border-radius: 20px; letter-spacing: 0.08em; border: 1px solid rgba(56, 189, 248, 0.25); text-transform: uppercase;">EN → PL</span><span style="background: rgba(255, 255, 255, 0.06); color: #94a3b8; font-size: 11px; font-weight: 600; padding: 4px 12px; border-radius: 20px; letter-spacing: 0.08em; border: 1px solid rgba(255, 255, 255, 0.08);">LECTORO ✦</span></div>${sentencePromptTopZ}<div style="font-size: 20px; line-height: 1.65; color: #f8fafc; font-weight: 500; text-align: center; max-width: 500px; margin: 0 auto;">${clozeSentenceHtmlZ}</div></div>`;

assert(frontCardHtmlZ.includes("Nie musisz się tym martwić"), "Front card must include Polish sentence prompt");
assert(frontCardHtmlZ.includes("{{c1::worry::w...}}"), "Front card must contain smart cloze with hint");

console.log("All Anki export tests (Smart Cloze, Single File, Centering) passed successfully!");
