const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("popup.html and popup.css include carousel arrow buttons and border sweep animation", () => {
    const html = fs.readFileSync(path.join(__dirname, "../popup.html"), "utf8");
    const css = fs.readFileSync(path.join(__dirname, "../popup.css"), "utf8");

    assert.ok(html.includes('id="carouselPrev"'), "carouselPrev exists in popup.html");
    assert.ok(html.includes('class="carousel-arrow-prev is-hidden"'), "carouselPrev has default hidden class");
    assert.ok(html.includes('id="carouselNext"'), "carouselNext exists in popup.html");
    assert.ok(html.includes('class="carousel-arrow-next"'), "carouselNext has arrow class");

    assert.ok(css.includes("@keyframes __qt_ai_border_sweep"), "popup.css defines __qt_ai_border_sweep");
    assert.ok(css.includes("--qt-ai-angle"), "popup.css uses --qt-ai-angle");
    assert.ok(css.includes(".carousel-arrow-next::before"), "carousel-arrow-next has ::before pseudo-element");
    assert.ok(css.includes("animation: __qt_ai_border_sweep"), "carousel-arrow-next uses __qt_ai_border_sweep animation");
    assert.ok(css.includes(".carousel-arrow-prev"), "popup.css defines carousel-arrow-prev");
});

test("initSubscriptionCarousel scrolls right for paid plans and manages arrow visibility", () => {
    const source = fs.readFileSync(path.join(__dirname, "../popup/settings.js"), "utf8");
    const navFnCode = source.slice(
        source.indexOf("function initSubscriptionCarousel("),
        source.indexOf("function renderGeminiTtsUsage(")
    );

    function createMockElements(scrollLeft = 0) {
        const classSet = (initial = []) => {
            const set = new Set(initial);
            return {
                add: (c) => set.add(c),
                remove: (c) => set.delete(c),
                toggle: (c, force) => (force ? set.add(c) : set.delete(c)),
                contains: (c) => set.has(c),
                has: (c) => set.has(c),
            };
        };

        const nextBtn = {
            id: "carouselNext",
            classList: classSet(),
            listeners: {},
            addEventListener(ev, fn) { this.listeners[ev] = fn; }
        };
        const prevBtn = {
            id: "carouselPrev",
            classList: classSet(["is-hidden"]),
            listeners: {},
            addEventListener(ev, fn) { this.listeners[ev] = fn; }
        };
        const carousel = {
            id: "subscriptionCarousel",
            classList: classSet()
        };

        let currentScrollLeft = scrollLeft;
        const scrollCalls = [];

        const grid = {
            dataset: {},
            scrollWidth: 500,
            clientWidth: 300,
            get scrollLeft() { return currentScrollLeft; },
            set scrollLeft(val) { currentScrollLeft = val; },
            scrollBy(opts) {
                scrollCalls.push(opts);
                currentScrollLeft += opts.left;
            },
            querySelectorAll(sel) {
                if (sel === ".subscription-plan-card") return [{ id: "c1" }, { id: "c2" }, { id: "c3" }];
                return [];
            },
            listeners: {},
            addEventListener(ev, fn) { this.listeners[ev] = fn; }
        };

        return { grid, nextBtn, prevBtn, carousel, scrollCalls };
    }

    // 1. Test paid plan auto-scrolls to right
    {
        const { grid, nextBtn, prevBtn, carousel } = createMockElements(0);
        const sandbox = {
            document: {
                getElementById: (id) => {
                    if (id === "carouselNext") return nextBtn;
                    if (id === "carouselPrev") return prevBtn;
                    if (id === "subscriptionCarousel") return carousel;
                    return null;
                }
            },
            requestAnimationFrame: (cb) => cb(),
            Math
        };
        vm.runInNewContext(navFnCode + "\nthis.initSubscriptionCarousel = initSubscriptionCarousel;", sandbox);

        sandbox.initSubscriptionCarousel(grid, true);
        assert.equal(grid.scrollLeft, 200, "Paid plan scrolls to maxScroll (500 - 300 = 200)");
        assert.equal(prevBtn.classList.contains("is-hidden"), false, "Prev button is visible at end");
        assert.equal(nextBtn.classList.contains("is-hidden"), true, "Next button is hidden at end");
    }

    // 2. Test free plan starts at 0
    {
        const { grid, nextBtn, prevBtn, carousel, scrollCalls } = createMockElements(0);
        const sandbox = {
            document: {
                getElementById: (id) => {
                    if (id === "carouselNext") return nextBtn;
                    if (id === "carouselPrev") return prevBtn;
                    if (id === "subscriptionCarousel") return carousel;
                    return null;
                }
            },
            requestAnimationFrame: (cb) => cb(),
            Math
        };
        vm.runInNewContext(navFnCode + "\nthis.initSubscriptionCarousel = initSubscriptionCarousel;", sandbox);

        sandbox.initSubscriptionCarousel(grid, false);
        assert.equal(grid.scrollLeft, 0, "Free plan stays at scrollLeft 0");
        assert.equal(prevBtn.classList.contains("is-hidden"), true, "Prev button is hidden at start");
        assert.equal(nextBtn.classList.contains("is-hidden"), false, "Next button is visible at start");

        // Next button click scrolls forward
        nextBtn.listeners.click();
        assert.equal(scrollCalls.length, 1);
        assert.ok(scrollCalls[0].left > 0, "Next button scrolls with positive left value");

        // Prev button click scrolls backward
        prevBtn.listeners.click();
        assert.equal(scrollCalls.length, 2);
        assert.ok(scrollCalls[1].left < 0, "Prev button scrolls with negative left value");
    }
});
