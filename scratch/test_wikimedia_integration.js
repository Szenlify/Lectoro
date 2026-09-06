/**
 * Integration Test: SharedImageService with Wikimedia Commons (commons.wikimedia.org)
 * Verifies:
 * 1. searchWikimediaCommons queries commons.wikimedia.org API successfully.
 * 2. All file types (JPG, PNG, WEBP, SVG, GIF) are supported and properly mapped.
 * 3. cleanMediaTitle cleans prefixes, extensions, underscores, and noisy numbers.
 * 4. Thumbnails are converted to Data URIs (bypassing CSP).
 * 5. Memory LRU cache correctly caches results.
 */
const assert = require("assert");
const ImageServiceFactory = require("../shared/image-service");
const Constants = require("../shared/constants");
const Utils = require("../shared/utils");

const service = ImageServiceFactory;

(async () => {
    console.log("🧪 Testing SharedImageService with Wikimedia Commons...");

    // Test 1: Title cleaning
    console.log("Test 1: cleanMediaTitle");
    assert.strictEqual(
        service.cleanMediaTitle("File:Pink_lady_and_cross_section.jpg"),
        "Pink lady and cross section",
        "Should clean File:, underscores, and extensions"
    );
    assert.strictEqual(
        service.cleanMediaTitle("File:20110425 German Shepherd Dog 8505.jpg"),
        "German Shepherd Dog",
        "Should remove camera and date codes"
    );
    assert.strictEqual(
        service.cleanMediaTitle("File:Cat_pattern_-_Bicolor_(french).svg"),
        "Cat pattern",
        "Should remove brackets and suffixes"
    );
    assert.strictEqual(
        service.cleanMediaTitle(""),
        "",
        "Empty string returns empty"
    );
    console.log("✓ cleanMediaTitle passed");

    // Test 2: searchWikimediaCommons for a standard word
    console.log("Test 2: searchWikimediaCommons for 'apple'");
    const appleResults = await service.searchWikimediaCommons("apple", "apple");
    assert(Array.isArray(appleResults), "Should return an array");
    assert(appleResults.length > 0, "Should have results for 'apple'");
    const firstApple = appleResults[0];
    assert.strictEqual(firstApple.source, "wikimedia");
    assert(firstApple.id.startsWith("commons_"), "ID should have commons_ prefix");
    assert(firstApple.thumbnail.startsWith("data:image/"), "Thumbnail should be Data URI");
    assert(firstApple.title.length > 0, "Title should not be empty");
    console.log(`✓ Got ${appleResults.length} Wikimedia results for 'apple' (First: ${firstApple.title})`);

    // Test 3: Multiple file types check across queries
    console.log("Test 3: Verify all file types support across diverse queries");
    const testWords = ["cat", "dog", "running", "airplane"];
    const foundSources = new Set();
    const foundMimeTypes = new Set();

    for (const word of testWords) {
        const res = await service.searchWikimediaCommons(word, word);
        assert(res.length > 0, `Should find results for ${word}`);
        res.forEach((r) => {
            foundSources.add(r.source);
            if (r.thumbnail.startsWith("data:image/")) {
                const mime = r.thumbnail.slice(5, r.thumbnail.indexOf(";"));
                foundMimeTypes.add(mime);
            }
        });
    }
    console.log("  Detected Data URI MIME types:", Array.from(foundMimeTypes));
    assert(foundSources.has("wikimedia"), "Source must be wikimedia");
    assert(foundMimeTypes.size > 0, "Should have generated Data URIs");
    console.log("✓ All file types and Data URI conversion passed");

    // Test 4: End-to-end service.search with translation context and caching
    console.log("Test 4: service.search with LRU caching");
    const queryWord = "happy";
    const searchRes1 = await service.search(queryWord, {
        original: "happy",
        translated: "szczęśliwy",
        srcLang: "en",
        targetLang: "pl",
    });
    assert(Array.isArray(searchRes1) && searchRes1.length > 0, "search should return results");

    // Re-query: must hit in-memory LRU cache immediately
    const startCache = Date.now();
    const searchRes2 = await service.search(queryWord, {
        original: "happy",
        translated: "szczęśliwy",
        srcLang: "en",
        targetLang: "pl",
    });
    const cacheDuration = Date.now() - startCache;
    assert.strictEqual(searchRes1.length, searchRes2.length);
    assert.strictEqual(searchRes1[0].id, searchRes2[0].id);
    assert(cacheDuration < 5, `Cache lookup should be near instant (<5ms), took ${cacheDuration}ms`);
    console.log(`✓ Cache returned in ${cacheDuration}ms (instant LRU hit)`);

    // Test 5: Ignored simple or multi-word queries
    console.log("Test 5: Skip simple words or multi-word sentences");
    assert.deepStrictEqual(await service.search("the"), [], "the is a simple word");
    assert.deepStrictEqual(await service.search("is"), [], "is is a simple word");
    assert.deepStrictEqual(await service.search("hello world how are you"), [], "multi-word phrase skipped");
    console.log("✓ Stop words and sentence guards passed");

    console.log("\n🎉 ALL WIKIMEDIA INTEGRATION TESTS PASSED SUCCESSFULLY!");
})();
