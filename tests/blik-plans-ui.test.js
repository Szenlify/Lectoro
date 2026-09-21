const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const Config = require("../shared/subscription-config");
const I18n = require("../shared/i18n");

function render(lang, subscription = { plan: "free" }) {
    const grid = { dataset: {}, children: [], innerHTML: "" };
    const source = fs.readFileSync(require.resolve("../popup/settings"), "utf8");
    const fn = source.slice(source.indexOf("function renderSubscriptionPlans("), source.indexOf("/* Subscription Carousel Navigation */"));
    const sandbox = {
        document: { getElementById: (id) => id === "subscriptionPlansGrid" ? grid : null },
        SubscriptionConfig: Config, SharedI18n: I18n,
        getPopupLang: () => lang, initSubscriptionCarousel() {},
    };
    vm.runInNewContext(fn, sandbox);
    sandbox.renderSubscriptionPlans(subscription, true);
    return grid.innerHTML;
}

test("Polish plans offer one-time BLIK at both approved PLN prices", () => {
    const html = render("pl");
    assert.equal((html.match(/data-billing-action="blik"/g) || []).length, 2);
    assert.match(html, /29,99/);
    assert.match(html, /79,99/);
    assert.match(html, /Bez karty i automatycznego odnowienia/);
    assert.match(html, /800/);
    assert.doesNotMatch(render("en"), /data-billing-action="blik"/);
});

test("prepaid users can renew without being sent to the subscription portal", () => {
    const html = render("pl", { plan: "basic", accessType: "prepaid", accessExpiresAt: Date.now() + 86400000 });
    assert.equal((html.match(/data-billing-action="blik"/g) || []).length, 1);
    assert.match(html, /Przedłuż BLIKIEM/);
    assert.match(html, /Dostęp do/);
    assert.doesNotMatch(html, /data-billing-action="portal"/);
});

test("recurring subscribers have no additional BLIK purchase button", () => {
    assert.doesNotMatch(render("pl", { plan: "basic", accessType: "subscription" }), /data-billing-action="blik"/);
});
