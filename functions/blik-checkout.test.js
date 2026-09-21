const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const Config = require("./subscription-config");

function checkout({ userData = {}, subscriptions = [] } = {}) {
    const users = { stripeCustomerId: "cus_test", ...userData };
    const orders = new Map();
    const calls = [];
    const stripe = {
        customers: { retrieve: async () => ({ id: "cus_test" }) },
        subscriptions: { list: async () => ({ data: subscriptions }) },
        checkout: { sessions: { create: async (options) => {
            calls.push(options);
            return { id: "cs_test", url: "https://checkout.stripe.com/test" };
        } } },
        billingPortal: { sessions: { create: async () => ({ url: "https://billing.stripe.com/test" }) } },
    };
    const db = { collection: (name) => ({ doc: (id) => ({
        get: async () => ({ data: () => name === "users" ? users : orders.get(id) }),
        set: async (value) => orders.set(id, value),
    }) }) };
    const context = {
        exports: {}, console,
        require(name) {
            if (name === "firebase-functions/v2/https") return { onRequest: (_, handler) => handler };
            if (name === "firebase-functions/params") return { defineSecret: () => ({ value: () => "test-key" }) };
            if (name === "firebase-admin") return {
                apps: [{}], firestore: () => db,
                auth: () => ({ verifyIdToken: async () => ({ uid: "user", email: "test@example.com" }) }),
            };
            if (name === "stripe") return function () { return stripe; };
            if (name === "./subscription-config") return Config;
            if (name === "./prepaid-access") return require(name);
            throw new Error(`Unexpected dependency ${name}`);
        },
    };
    vm.runInNewContext(fs.readFileSync(require.resolve("./stripe-billing"), "utf8"), context);
    return { calls, orders, async request(body, authorization = "Bearer test") {
        const res = { statusCode: 200, set() {}, status(code) { this.statusCode = code; return this; },
            json(value) { this.body = value; return this; }, send(value) { this.body = value; return this; } };
        await context.exports.createStripeCheckoutSession({ method: "POST", headers: { authorization }, body }, res);
        return res;
    } };
}

for (const [plan, amount] of [["basic", 2999], ["pro", 7999]]) {
    test(`${plan} BLIK uses the server price and persists an order before returning Checkout`, async () => {
        const ctx = checkout();
        const res = await ctx.request({ plan, paymentMode: "blik", amount: 1, trialDays: 3 });
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.trialDays, 0);
        assert.equal(ctx.calls[0].mode, "payment");
        assert.equal(ctx.calls[0].line_items[0].price_data.unit_amount, amount);
        assert.equal(ctx.orders.get("cs_test").amount, amount);
        assert.equal(ctx.orders.get("cs_test").uid, "user");
    });
}

test("active recurring subscription goes to Portal without creating a BLIK payment", async () => {
    const ctx = checkout({ subscriptions: [{ status: "active" }] });
    const res = await ctx.request({ plan: "basic", paymentMode: "blik" });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "SUBSCRIPTION_ALREADY_ACTIVE");
    assert.equal(ctx.calls.length, 0);
});

test("prepaid permits same-plan renewal and blocks overlapping plan changes", async () => {
    const ctx = checkout({ userData: { prepaidAccess: { basic: Date.now() + 86400000 } } });
    assert.equal((await ctx.request({ plan: "pro", paymentMode: "blik" })).statusCode, 409);
    assert.equal((await ctx.request({ plan: "basic", paymentMode: "subscription" })).statusCode, 409);
    assert.equal(ctx.calls.length, 0);
    assert.equal((await ctx.request({ plan: "basic", paymentMode: "blik" })).statusCode, 200);
});

test("unauthenticated requests and unknown payment modes cannot create payments", async () => {
    const ctx = checkout();
    assert.equal((await ctx.request({ plan: "basic", paymentMode: "blik" }, "")).statusCode, 401);
    assert.equal((await ctx.request({ plan: "basic", paymentMode: "unknown" })).statusCode, 400);
    assert.equal(ctx.calls.length, 0);
});
