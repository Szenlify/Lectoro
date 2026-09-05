const service = require("../shared/image-service.js");

async function runTest() {
    console.log("Testing Openverse image service integration...");
    const testWords = ["apple", "dog", "house", "run"];
    for (const w of testWords) {
        console.log(`\nSearching for: "${w}"`);
        const results = await service.search(w);
        console.log(`Got ${results.length} results:`);
        results.forEach((r, idx) => {
            console.log(`  [${idx + 1}] ${r.title} (Source: ${r.source})`);
            console.log(`      Thumbnail: ${r.thumbnail ? r.thumbnail.slice(0, 40) + '...' : 'none'}`);
            console.log(`      Full URL: ${r.fullUrl}`);
        });
    }
}

runTest().catch(console.error);
