const test = require("node:test");
const assert = require("node:assert/strict");
const { prepaidCheckoutOptions, paidPurchase, extendAccess } = require("./prepaid-access");

const session = {
    id: "cs_test", mode: "payment", payment_status: "paid", currency: "pln", amount_total: 2999,
    customer: "cus_test", payment_intent: "pi_test", client_reference_id: "user",
    metadata: { purchaseType: "prepaid", firebaseUid: "user", plan: "basic", accessDays: "30" },
};

test("BLIK uses a one-time PLN payment without saving a card or starting a subscription", () => {
    const options = prepaidCheckoutOptions({ customerId: "cus_test", uid: "user", plan: "basic", amountPlnMinor: 2999, resultUrl: "https://example.com/result" });
    assert.equal(options.mode, "payment");
    assert.deepEqual(options.payment_method_types, ["blik"]);
    assert.equal(options.line_items[0].price_data.currency, "pln");
    assert.equal(options.line_items[0].price_data.unit_amount, 2999);
    assert.equal(options.subscription_data, undefined);
    assert.equal(options.payment_intent_data.setup_future_usage, undefined);
    assert.throws(() => prepaidCheckoutOptions({ plan: "basic", amountPlnMinor: null }));
});

test("unpaid or unrelated Checkout sessions cannot grant prepaid access", () => {
    assert.equal(paidPurchase({ ...session, payment_status: "unpaid" }), null);
    assert.equal(paidPurchase({ ...session, mode: "subscription" }), null);
    assert.equal(paidPurchase({ ...session, metadata: {} }), null);
    assert.throws(() => paidPurchase({ ...session, currency: "usd" }));
    assert.throws(() => paidPurchase({ ...session, client_reference_id: "other-user" }));
    assert.deepEqual(paidPurchase(session), { uid: "user", plan: "basic", days: 30 });
});

test("renewal preserves unused time and expired access restarts from the payment processing time", () => {
    const now = 1800000000000;
    const thirtyDays = 30 * 86400000;
    assert.equal(extendAccess(now + 86400000, now), now + 86400000 + thirtyDays);
    assert.equal(extendAccess(now - 1, now), now + thirtyDays);
    assert.equal(extendAccess(undefined, now), now + thirtyDays);
});

const { resolveAccess } = require("./subscription-config");
const { fulfillPrepaidSession } = require("./prepaid-access");

test("prepaid access expires exactly on time without losing an independent subscription", () => {
    const now = 1800000000000;
    const data = { plan: "basic", prepaidAccess: { pro: now + 1 } };
    assert.equal(resolveAccess(data, "free", now).plan, "pro");
    assert.equal(resolveAccess(data, "free", now + 1).plan, "basic");
    assert.equal(resolveAccess({ plan: "free", prepaidAccess: { pro: now } }, "pro", now).plan, "free");
    assert.equal(resolveAccess({ plan: "pro", prepaidAccess: { basic: now + 1 } }, "free", now).plan, "pro");
});

test("repeated Stripe deliveries grant 30 days only once and preserve subscription fields", async () => {
    const now = 1800000000000;
    const data = new Map([
        ["prepaidOrders/cs_test", { uid: "user", plan: "basic", amount: 2999, customerId: "cus_test" }],
        ["users/user", { plan: "pro", prepaidAccess: { basic: now + 1000 } }],
    ]);
    const db = {
        collection: (name) => ({ doc: (id) => `${name}/${id}` }),
        runTransaction: async (fn) => fn({
            get: async (ref) => ({ data: () => data.get(ref) }),
            set: (ref, patch) => data.set(ref, { ...data.get(ref), ...patch }),
        }),
    };
    assert.equal(await fulfillPrepaidSession(db, session, now), true);
    assert.equal(await fulfillPrepaidSession(db, session, now + 5000), false);
    assert.equal(data.get("users/user").prepaidAccess.basic, now + 1000 + 30 * 86400000);
    assert.equal(data.get("users/user").plan, "pro");
    await assert.rejects(fulfillPrepaidSession(db, { ...session, amount_total: 1 }, now));
});
