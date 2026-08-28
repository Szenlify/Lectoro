/**
 * Lectoro – Multi-Word Expression (MWE), Phrasal Verbs & Collocation Detector
 *
 * Single Source of Truth for identifying multi-word linguistic units in subtitles.
 * Ensures phrasal verbs (e.g. "killing up", "give up", "look forward to", "turn down"),
 * collocations ("all around", "by the way", "at all"), and compound idioms are
 * translated, highlighted, and saved as cohesive units rather than misleading isolated words.
 */
(() => {
    "use strict";

    /**
     * Particles commonly forming English phrasal verbs.
     */
    const PARTICLES = new Set([
        "up", "down", "in", "out", "on", "off", "away", "back", "over",
        "through", "about", "around", "round", "into", "across", "along",
        "by", "with", "after", "ahead", "behind", "apart", "together"
    ]);

    /**
     * Curated high-frequency English phrasal verbs, idioms, and collocations.
     * Includes inflected forms (-ing, -ed, -s, irregulars) for high performance.
     */
    const KNOWN_PHRASES = [
        // Phrasal verbs: kill / die / tear / beat
        "killing up", "killed up", "kills up", "kill up",
        "killing off", "killed off", "kills off", "kill off",
        "dying down", "died down", "dies down", "die down",
        "dying out", "died out", "dies out", "die out",
        "tearing down", "tore down", "torn down", "tears down", "tear down",
        "tearing up", "tore up", "torn up", "tears up", "tear up",
        "tearing apart", "tore apart", "torn apart", "tear apart",
        "beating up", "beat up", "beaten up", "beats up",

        // Phrasal verbs: give
        "give up", "gave up", "giving up", "given up", "gives up",
        "give in", "gave in", "giving in", "given in", "gives in",
        "give out", "gave out", "giving out", "given out", "gives out",
        "give away", "gave away", "giving away", "given away", "gives away",
        "give back", "gave back", "giving back", "given back", "gives back",
        "give off", "gave off", "giving off", "given off", "gives off",

        // Phrasal verbs: look
        "look at", "looked at", "looking at", "looks at",
        "look for", "looked for", "looking for", "looks for",
        "look up", "looked up", "looking up", "looks up",
        "look out", "looked out", "looking out", "looks out",
        "look after", "looked after", "looking after", "looks after",
        "look into", "looked into", "looking into", "looks into",
        "look down", "looked down", "looking down", "looks down",
        "look back", "looked back", "looking back", "looks back",
        "look forward to", "looked forward to", "looking forward to", "looks forward to",
        "look up to", "looked up to", "looking up to", "looks up to",
        "look down on", "looked down on", "looking down on", "looks down on",

        // Phrasal verbs: turn
        "turn on", "turned on", "turning on", "turns on",
        "turn off", "turned off", "turning off", "turns off",
        "turn up", "turned up", "turning up", "turns up",
        "turn down", "turned down", "turning down", "turns down",
        "turn into", "turned into", "turning into", "turns into",
        "turn out", "turned out", "turning out", "turns out",
        "turn around", "turned around", "turning around", "turns around",
        "turn round", "turned round", "turning round", "turns round",
        "turn away", "turned away", "turning away", "turns away",
        "turn back", "turned back", "turning back", "turns back",
        "turn over", "turned over", "turning over", "turns over",

        // Phrasal verbs: take
        "take off", "took off", "taking off", "taken off", "takes off",
        "take on", "took on", "taking on", "taken on", "takes on",
        "take up", "took up", "taking up", "taken up", "takes up",
        "take down", "took down", "taking down", "taken down", "takes down",
        "take out", "took out", "taking out", "taken out", "takes out",
        "take in", "took in", "taking in", "taken in", "takes in",
        "take over", "took over", "taking over", "taken over", "takes over",
        "take back", "took back", "taking back", "taken back", "takes back",
        "take away", "took away", "taking away", "taken away", "takes away",
        "take after", "took after", "taking after", "taken after", "takes after",
        "take part in", "took part in", "taking part in", "takes part in",

        // Phrasal verbs: get
        "get up", "got up", "getting up", "gets up",
        "get out", "got out", "getting out", "gets out",
        "get in", "got in", "getting in", "gets in",
        "get off", "got off", "getting off", "gets off",
        "get on", "got on", "getting on", "gets on",
        "get over", "got over", "getting over", "gets over",
        "get away", "got away", "getting away", "gets away",
        "get along", "got along", "getting along", "gets along",
        "get back", "got back", "getting back", "gets back",
        "get through", "got through", "getting through", "gets through",
        "get by", "got by", "getting by", "gets by",
        "get down", "got down", "getting down", "gets down",
        "get rid of", "got rid of", "getting rid of", "gets rid of",
        "get used to", "got used to", "getting used to",

        // Phrasal verbs: put
        "put on", "putting on", "puts on",
        "put off", "putting off", "puts off",
        "put out", "putting out", "puts out",
        "put up", "putting up", "puts up",
        "put down", "putting down", "puts down",
        "put away", "putting away", "puts away",
        "put up with", "putting up with", "puts up with",
        "put together", "putting together", "puts together",

        // Phrasal verbs: come
        "come on", "came on", "coming on", "comes on",
        "come in", "came in", "coming in", "comes in",
        "come back", "came back", "coming back", "comes back",
        "come out", "came out", "coming out", "comes out",
        "come up", "came up", "coming up", "comes up",
        "come across", "came across", "coming across", "comes across",
        "come over", "came over", "coming over", "comes over",
        "come from", "came from", "coming from", "comes from",
        "come down", "came down", "coming down", "comes down",
        "come along", "came along", "coming along", "comes along",
        "come up with", "came up with", "coming up with", "comes up with",

        // Phrasal verbs: go
        "go on", "went on", "going on", "gone on", "goes on",
        "go out", "went out", "going out", "gone out", "goes out",
        "go up", "went up", "going up", "gone up", "goes up",
        "go down", "went down", "going down", "gone down", "goes down",
        "go back", "went back", "going back", "gone back", "goes back",
        "go away", "went away", "going away", "gone away", "goes away",
        "go off", "went off", "going off", "gone off", "goes off",
        "go through", "went through", "going through", "gone through", "goes through",
        "go over", "went over", "going over", "gone over", "goes over",
        "go ahead", "went ahead", "going ahead", "gone ahead", "goes ahead",

        // Phrasal verbs: make
        "make up", "made up", "making up", "makes up",
        "make out", "made out", "making out", "makes out",
        "make sure", "made sure", "making sure", "makes sure",
        "make of", "made of", "making of", "makes of",
        "make sense", "made sense", "making sense", "makes sense",

        // Phrasal verbs: find / figure / check
        "find out", "found out", "finding out", "finds out",
        "figure out", "figured out", "figuring out", "figures out",
        "check in", "checked in", "checking in", "checks in",
        "check out", "checked out", "checking out", "checks out",
        "check up", "checked up", "checking up", "checks up",

        // Phrasal verbs: break / call / bring
        "break down", "broke down", "broken down", "breaking down", "breaks down",
        "break up", "broke up", "broken up", "breaking up", "breaks up",
        "break out", "broke out", "broken out", "breaking out", "breaks out",
        "break into", "broke into", "broken into", "breaking into", "breaks into",
        "break in", "broke in", "broken in", "breaking in", "breaks in",
        "call off", "called off", "calling off", "calls off",
        "call back", "called back", "calling back", "calls back",
        "call out", "called out", "calling out", "calls out",
        "call up", "called up", "calling up", "calls up",
        "bring up", "brought up", "bringing up", "brings up",
        "bring down", "brought down", "bringing down", "brings down",
        "bring back", "brought back", "bringing back", "brings back",
        "bring on", "brought on", "bringing on", "brings on",
        "bring about", "brought about", "bringing about", "brings about",

        // Phrasal verbs: carry / hold / set / pick / hang
        "carry on", "carried on", "carrying on", "carries on",
        "carry out", "carried out", "carrying out", "carries out",
        "hold on", "held on", "holding on", "holds on",
        "hold up", "held up", "holding up", "holds up",
        "hold back", "held back", "holding back", "holds back",
        "hold out", "held out", "holding out", "holds out",
        "set up", "setting up", "sets up",
        "set off", "setting off", "sets off",
        "set out", "setting out", "sets out",
        "pick up", "picked up", "picking up", "picks up",
        "pick out", "picked out", "picking out", "picks out",
        "hang out", "hung out", "hanging out", "hangs out",
        "hang on", "hung on", "hanging on", "hangs on",
        "hang up", "hung up", "hanging up", "hangs up",

        // Phrasal verbs: show / shut / catch / keep / run
        "show up", "showed up", "showing up", "shown up", "shows up",
        "show off", "showed off", "showing off", "shown off", "shows off",
        "shut down", "shutting down", "shuts down",
        "shut up", "shutting up", "shuts up",
        "catch up", "caught up", "catching up", "catches up",
        "catch on", "caught on", "catching on", "catches on",
        "keep on", "kept on", "keeping on", "keeps on",
        "keep up", "kept up", "keeping up", "keeps up",
        "keep out", "kept out", "keeping out", "keeps out",
        "keep away", "kept away", "keeping away", "keeps away",
        "run into", "ran into", "running into", "runs into",
        "run out of", "ran out of", "running out of", "runs out of",
        "run away", "ran away", "running away", "runs away",
        "run over", "ran over", "running over", "runs over",
        "run down", "ran down", "running down", "runs down",

        // Phrasal verbs: grow / wake / calm / clean / cheer / watch / work
        "grow up", "grew up", "growing up", "grown up", "grows up",
        "wake up", "woke up", "waking up", "woken up", "wakes up",
        "calm down", "calmed down", "calming down", "calms down",
        "clean up", "cleaned up", "cleaning up", "cleans up",
        "cheer up", "cheered up", "cheering up", "cheers up",
        "watch out", "watched out", "watching out", "watches out",
        "work out", "worked out", "working out", "works out",
        "stand up", "stood up", "standing up", "stands up",
        "stand out", "stood out", "standing out", "stands out",
        "stand for", "stood for", "standing for", "stands for",
        "sit down", "sat down", "sitting down", "sits down",
        "lie down", "lay down", "lying down", "lies down",
        "pass out", "passed out", "passing out", "passes out",
        "pass away", "passed away", "passing away", "passes away",
        "blow up", "blew up", "blowing up", "blown up", "blows up",
        "let down", "letting down", "lets down",
        "let go", "letting go", "lets go",
        "speed up", "sped up", "speeding up", "speeds up",
        "slow down", "slowed down", "slowing down", "slows down",
        "mess up", "messed up", "messing up", "messes up",
        "screw up", "screwed up", "screwing up", "screws up",
        "freak out", "freaked out", "freaking out", "freaks out",
        "chill out", "chilled out", "chilling out", "chills out",
        "burn down", "burned down", "burnt down", "burning down", "burns down",
        "pay back", "paid back", "paying back", "pays back",
        "pay off", "paid off", "paying off", "pays off",
        "cut off", "cutting off", "cuts off",
        "cut down", "cutting down", "cuts down",
        "end up", "ended up", "ending up", "ends up",
        "fill out", "filled out", "filling out", "fills out",
        "fill in", "filled in", "filling in", "fills in",
        "fall apart", "fell apart", "falling apart", "falls apart",
        "point out", "pointed out", "pointing out", "points out",
        "rip off", "ripped off", "ripping off", "rips off",
        "sign in", "signed in", "signing in", "signs in",
        "sign up", "signed up", "signing up", "signs up",
        "wrap up", "wrapped up", "wrapping up", "wraps up",
        "warm up", "warmed up", "warming up", "warms up",
        "stick around", "stuck around", "sticking around", "sticks around",
        "throw away", "threw away", "throwing away", "thrown away", "throws away",
        "throw up", "threw up", "throwing up", "thrown up", "throws up",
        "hook up", "hooked up", "hooking up", "hooks up",
        "knock out", "knocked out", "knocking out", "knocks out",
        "pass by", "passed by", "passing by", "passes by",
        "drop off", "dropped off", "dropping off", "drops off",
        "open up", "opened up", "opening up", "opens up",
        "lock up", "locked up", "locking up", "locks up",
        "back off", "backed off", "backing off", "backs off",
        "back up", "backed up", "backing up", "backs up",

        // Collocations & Idioms (High Frequency in Video Subtitles)
        "all around", "all over", "all along", "all of a sudden", "all at once", "all the time",
        "at all", "at least", "at most", "at last", "at first", "at once", "at best", "at worst",
        "by the way", "in the way", "on the way", "out of the way",
        "kind of", "sort of",
        "as well as", "as soon as", "as far as", "as long as", "as if", "as though", "as usual",
        "out of", "out of order", "out of nowhere", "out of date", "out of hand", "out of control",
        "in fact", "in front of", "in case", "in order to", "in spite of", "in terms of",
        "on time", "in time", "ahead of time", "behind time",
        "right now", "right here", "right away", "right then",
        "so far", "so that", "so much", "so many", "so well",
        "no matter", "never mind", "no way", "no problem", "no doubt", "no wonder",
        "a lot of", "lots of", "plenty of", "a few", "a couple of",
        "each other", "one another",
        "up to", "used to", "ought to",
        "for example", "for instance", "for now", "for good",
        "of course",
        "piece of cake",
        "once upon a time", "once again", "once in a while", "once and for all",
        "from time to time",
        "more or less",
        "sooner or later",
        "upside down", "inside out",
        "take care", "takes care", "took care", "taking care",
        "pay attention", "pays attention", "paid attention",
        "give a hand", "gave a hand",
        "keep in mind", "kept in mind",
        "face to face",
        "day by day", "step by step", "little by little",
        "again and again", "now and then", "here and there",
        "keep going", "keeps going", "kept going", "keeping going"
    ];

    const PHRASES_SET = new Set(KNOWN_PHRASES);

    /**
     * Stem regular English verb forms to base form.
     */
    function stemVerb(word) {
        const w = (word || "").toLowerCase();
        if (w.endsWith("ing") && w.length > 5) {
            const base = w.slice(0, -3);
            if (base.endsWith("ll") || base.endsWith("tt") || base.endsWith("pp") || base.endsWith("nn") || base.endsWith("mm") || base.endsWith("gg")) {
                return base.slice(0, -1);
            }
            return base;
        }
        if (w.endsWith("ed") && w.length > 4) {
            const base = w.slice(0, -2);
            if (base.endsWith("ll") || base.endsWith("tt") || base.endsWith("pp") || base.endsWith("nn") || base.endsWith("mm") || base.endsWith("gg")) {
                return base.slice(0, -1);
            }
            return base;
        }
        if (w.endsWith("es") && w.length > 4) return w.slice(0, -2);
        if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) return w.slice(0, -1);
        return w;
    }

    /**
     * Test whether a candidate phrase string is a recognized multi-word expression.
     */
    function isPhrase(candidate) {
        if (!candidate) return false;
        const norm = candidate.trim().toLowerCase().replace(/\s+/g, " ");
        if (PHRASES_SET.has(norm)) return true;

        // Dynamic rule: verb + particle
        const parts = norm.split(" ");
        if (parts.length === 2) {
            const [v, p] = parts;
            if (PARTICLES.has(p)) {
                const baseV = stemVerb(v);
                if (PHRASES_SET.has(`${baseV} ${p}`) || PHRASES_SET.has(`${v} ${p}`)) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Tokenize a line of subtitle text into sequential tokens, merging phrasal verbs,
     * collocations, and idioms into single cohesive units while preserving exact
     * spacing and punctuation.
     *
     * Example input:  "Killing up all around me"
     * Example output: [
     *   { type: "word", text: "Killing up", clean: "killing up", isPhrase: true },
     *   { type: "space", text: " " },
     *   { type: "word", text: "all around", clean: "all around", isPhrase: true },
     *   { type: "space", text: " " },
     *   { type: "word", text: "me", clean: "me", isPhrase: false }
     * ]
     */
    function tokenizeSubtitleLine(lineText) {
        if (!lineText || typeof lineText !== "string") return [];

        const rawTokens = lineText.match(/\S+|\s+/g) || [];
        if (rawTokens.length === 0) return [];

        const words = [];
        for (let i = 0; i < rawTokens.length; i++) {
            const token = rawTokens[i];
            if (/\S/.test(token)) {
                // Strip outer punctuation for dictionary lookup
                const clean = token
                    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
                    .toLowerCase();
                // Sentence terminator check: words shouldn't merge across sentence boundaries
                const hasSentenceEnd = /[.?!;:]/.test(token);
                words.push({
                    tokenIndex: i,
                    raw: token,
                    clean,
                    hasSentenceEnd,
                });
            }
        }

        if (words.length === 0) {
            return rawTokens.map((t) => ({ type: "space", text: t }));
        }

        // Greedy matching: 3-gram, then 2-gram, then 1-gram
        const matchedChunks = [];
        let w = 0;

        while (w < words.length) {
            let matched = false;

            // 1. Try 3-gram
            if (w + 2 < words.length && !words[w].hasSentenceEnd && !words[w + 1].hasSentenceEnd) {
                const trigram = `${words[w].clean} ${words[w + 1].clean} ${words[w + 2].clean}`;
                if (isPhrase(trigram)) {
                    matchedChunks.push({
                        startTokenIndex: words[w].tokenIndex,
                        endTokenIndex: words[w + 2].tokenIndex,
                        clean: trigram,
                        isPhrase: true,
                    });
                    w += 3;
                    matched = true;
                    continue;
                }
            }

            // 2. Try 2-gram
            if (!matched && w + 1 < words.length && !words[w].hasSentenceEnd) {
                const bigram = `${words[w].clean} ${words[w + 1].clean}`;
                if (isPhrase(bigram)) {
                    matchedChunks.push({
                        startTokenIndex: words[w].tokenIndex,
                        endTokenIndex: words[w + 1].tokenIndex,
                        clean: bigram,
                        isPhrase: true,
                    });
                    w += 2;
                    matched = true;
                    continue;
                }
            }

            // 3. Fallback: single word
            if (!matched) {
                matchedChunks.push({
                    startTokenIndex: words[w].tokenIndex,
                    endTokenIndex: words[w].tokenIndex,
                    clean: words[w].clean,
                    isPhrase: false,
                });
                w += 1;
            }
        }

        // Reconstruct full token stream with original whitespace and punctuation
        const output = [];
        let currentTokenIndex = 0;

        for (const chunk of matchedChunks) {
            // Append any preceding whitespace
            while (currentTokenIndex < chunk.startTokenIndex) {
                output.push({
                    type: "space",
                    text: rawTokens[currentTokenIndex],
                });
                currentTokenIndex += 1;
            }

            // Join raw parts for this word or multi-word phrase
            const parts = [];
            for (let i = chunk.startTokenIndex; i <= chunk.endTokenIndex; i++) {
                parts.push(rawTokens[i]);
            }
            output.push({
                type: "word",
                text: parts.join(""),
                clean: chunk.clean,
                isPhrase: chunk.isPhrase,
            });
            currentTokenIndex = chunk.endTokenIndex + 1;
        }

        // Trailing whitespace
        while (currentTokenIndex < rawTokens.length) {
            output.push({
                type: "space",
                text: rawTokens[currentTokenIndex],
            });
            currentTokenIndex += 1;
        }

        return output;
    }

    const SharedPhraseDetector = Object.freeze({
        isPhrase,
        tokenizeSubtitleLine,
    });

    if (typeof module !== "undefined" && module.exports) {
        module.exports = SharedPhraseDetector;
    }
    if (typeof globalThis !== "undefined") {
        globalThis.SharedPhraseDetector = SharedPhraseDetector;
    }
})();
