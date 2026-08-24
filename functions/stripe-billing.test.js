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

// Minimal Stripe mock for isTrialEligible
function mockStripe({ customersByEmail = [], subsByCustomer = {} } = {}) {
    return {
        customers: {
            list: async () => ({ data: customersByEmail }),
        },
        subscriptions: {
            list: async ({ customer }) => ({
                data: subsByCustomer[customer] || [],
            }),
        },
    };
}

test("three-day trial is available only before the first subscription", async () => {
    const stripe = mockStripe();
    assert.equal(await _test.isTrialEligible(stripe, "new@test.com", [], {}), true);
    assert.equal(await _test.isTrialEligible(stripe, "new@test.com", [], { stripeTrialUsed: true }), false);
    assert.equal(await _test.isTrialEligible(stripe, "new@test.com", [], { stripeHasSubscribed: true }), false);
    assert.equal(await _test.isTrialEligible(stripe, "new@test.com", [subscription("canceled", "price_basic")], {}), false);
});

test("trial is denied when same email had a subscription on a deleted account", async () => {
    const oldCustomer = { id: "cus_old", deleted: false };
    const stripe = mockStripe({
        customersByEmail: [oldCustomer],
        subsByCustomer: {
            cus_old: [subscription("canceled", "price_basic")],
        },
    });
    // New account (empty currentSubscriptions, clean userData) but old Stripe customer exists
    assert.equal(await _test.isTrialEligible(stripe, "reuser@test.com", [], {}), false);
});

test("trial Checkout requires a card and defers billing for exactly three days", () => {
    const options = _test.checkoutSessionOptions({
        customerId: "cus_test",
        uid: "firebase_user",
        plan: "basic",
        priceId: "price_basic",
        trialDays: 3,
    });
    assert.equal(options.payment_method_collection, "always");
    assert.equal(options.subscription_data.trial_period_days, 3);
    assert.equal(options.metadata.trialDays, "3");
    assert.match(options.success_url, /status=trial_success/);
});

test("Checkout starts normal billing when trial is no longer available", () => {
    const options = _test.checkoutSessionOptions({
        customerId: "cus_test",
        uid: "firebase_user",
        plan: "pro",
        priceId: "price_pro",
    });
    assert.equal(options.payment_method_collection, "always");
    assert.equal(options.subscription_data.trial_period_days, undefined);
    assert.match(options.success_url, /status=success/);
});

test("Stripe result page clearly confirms a trial without claiming a payment", () => {
    const html = _test.resultPage("trial_success");
    assert.match(html, /3 dni za darmo rozpoczęte/);
    assert.match(html, /dziś nic nie pobraliśmy/);
});

test("Stripe result page contains no reflected query text", () => {
    const html = _test.resultPage('<script>alert("x")</script>');
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /Ustawienia płatności zapisane/);
});
