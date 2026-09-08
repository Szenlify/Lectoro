/** Preserve subtitle text while separating words in Japanese/Chinese scripts. */
(function (root) {
    "use strict";
    const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter("ja", { granularity: "word" }) : null;
    function tokenize(text) {
        if (typeof text !== "string" || !text) return [];
        const tokens = [];
        for (const chunk of text.match(/\S+|\s+/gu) || []) {
            if (!segmenter || !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(chunk)) {
                tokens.push({ type: /\S/u.test(chunk) ? "word" : "space", text: chunk });
                continue;
            }
            let prefix = "";
            for (const item of segmenter.segment(chunk)) {
                if (item.isWordLike) {
                    tokens.push({ type: "word", text: prefix + item.segment });
                    prefix = "";
                } else if (tokens.at(-1)?.type === "word") {
                    tokens[tokens.length - 1].text += item.segment;
                } else { prefix += item.segment; }
            }
            if (prefix) tokens.push({ type: "space", text: prefix });
        }
        return tokens.map((token) => token.type === "word" ? {
            ...token, clean: token.text.replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, "").toLowerCase(), isPhrase: false,
        } : token);
    }
    root.DictionaryTokenizer = Object.freeze({ tokenize });
    if (typeof module !== "undefined" && module.exports) module.exports = root.DictionaryTokenizer;
})(globalThis);
