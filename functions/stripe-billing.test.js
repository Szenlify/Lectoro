const test = require("node:test");
const assert = require("node:assert/strict");
const { _test } = require("./stripe-billing");

const prices = { basic: "price_basic", pro: "price_pro" };

function subscription(status, priceId, periodEnd = 0) {
    return {
        id: "sub_test",
        status,
        items: {
            data: [{ price: { id: priceId }, current_period_end: periodEnd }],
        },
    };
}

test("Stripe prices map only to known Lectoro plans", () => {
    assert.equal(_test.planForSubscription(subscription("active", "price_basic"), prices), "basic");
    assert.equal(_test.planForSubscription(subscription("active", "price_pro"), prices), "pro");
    assert.equal(_test.planForSubscription(subscription("active", "price_unknown"), prices), "free");
});

test("subscription period end is read from Stripe subscription items", () => {
    const data = subscription("active", "price_pro", 1_800_000_000);
    data.items.data.push({ price: { id: "price_extra" }, current_period_end: 1_900_000_000 });
    assert.equal(_test.subscriptionPeriodEnd(data), 1_900_000_000);
    assert.equal(_test.subscriptionPeriodEnd(null), null);
});

test("Stripe result page contains no reflected query text", () => {
    const html = _test.resultPage('<script>alert("x")</script>');
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /Ustawienia płatności zapisane/);
});
