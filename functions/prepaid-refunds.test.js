const test = require("node:test");
const assert = require("node:assert/strict");
const { fulfillPrepaidSession, revokePrepaidSession, handlePrepaidRefund } = require("./prepaid-access");
const { resolveAccess } = require("./subscription-config");
const DAY = 86400000;
const START = 1800000000000;
const session = {
    id: "cs_one", mode: "payment", payment_status: "paid", currency: "pln", amount_total: 2999,
    customer: "cus_test", payment_intent: "pi_one", client_reference_id: "user",
    metadata: { purchaseType: "prepaid", firebaseUid: "user", plan: "basic", accessDays: "30" },
};
function database({ fulfilled = true, renewal = false, recurringPlan = "free" } = {}) {
    const values = new Map([
        ["prepaidOrders/cs_one", { uid: "user", plan: "basic", amount: 2999, customerId: "cus_test",
            ...(fulfilled ? { fulfilledAt: START, endsAt: START + 30 * DAY, paymentIntentId: "pi_one" } : {}) }],
        ["users/user", { plan: recurringPlan, prepaidAccess: { basic: fulfilled ? START + (renewal ? 60 : 30) * DAY : 0, pro: 0 } }],
    ]);
    if (renewal) values.set("prepaidOrders/cs_two", {
        uid: "user", plan: "basic", amount: 2999, customerId: "cus_test", paymentIntentId: "pi_two",
        fulfilledAt: START + 20 * DAY, endsAt: START + 60 * DAY,
    });
    const db = {
        collection: (name) => ({
            doc: (id) => `${name}/${id}`,
            where: (key, operator, value) => ({ name, key, value }),
        }),
        runTransaction: async (fn) => fn({
            get: async (ref) => typeof ref === "string"
                ? { exists: values.has(ref), data: () => values.get(ref) }
                : { docs: [...values].filter(([key, value]) => key.startsWith(`${ref.name}/`) && value[ref.key] === ref.value)
                    .map(([key, value]) => ({ id: key.split("/")[1], data: () => value })) },
            set: (ref, patch) => {
                const old = values.get(ref) || {};
                values.set(ref, { ...old, ...patch,
                    ...(patch.prepaidAccess ? { prepaidAccess: { ...old.prepaidAccess, ...patch.prepaidAccess } } : {}) });
            },
        }),
    };
    return { db, values, profile: () => values.get("users/user") };
}

test("full refund removes purchased access and duplicate deliveries have no further effect", async () => {
    const ctx = database();
    assert.equal(await revokePrepaidSession(ctx.db, session, START + DAY), true);
    assert.equal(resolveAccess(ctx.profile(), "free", START + DAY).plan, "free");
    assert.equal(await revokePrepaidSession(ctx.db, session, START + 2 * DAY), false);
    assert.equal(await fulfillPrepaidSession(ctx.db, session, START + 3 * DAY), false);
});

test("refund before activation prevents a late Checkout webhook granting access", async () => {
    const ctx = database({ fulfilled: false });
    await revokePrepaidSession(ctx.db, session, START + DAY);
    assert.equal(await fulfillPrepaidSession(ctx.db, session, START + 2 * DAY), false);
    assert.equal(ctx.profile().prepaidAccess.basic, 0);
});

test("refunding an older purchase preserves the full duration of an independent renewal", async () => {
    const ctx = database({ renewal: true });
    await revokePrepaidSession(ctx.db, session, START + 25 * DAY);
    assert.equal(ctx.profile().prepaidAccess.basic, START + 50 * DAY);
    assert.equal(resolveAccess(ctx.profile(), "free", START + 25 * DAY).plan, "basic");
});

test("refunding the latest renewal preserves the first paid period and other plans", async () => {
    const ctx = database({ renewal: true, recurringPlan: "pro" });
    await revokePrepaidSession(ctx.db, { ...session, id: "cs_two", payment_intent: "pi_two" }, START + 25 * DAY);
    assert.equal(ctx.profile().prepaidAccess.basic, START + 30 * DAY);
    assert.equal(resolveAccess(ctx.profile(), "free", START + 25 * DAY).plan, "pro");
});

function stripe(refunds, checkoutSession = session) {
    return {
        charges: { retrieve: async () => ({ id: "ch_one", payment_intent: "pi_one", currency: "pln", amount: 2999 }) },
        checkout: { sessions: { list: async () => ({ data: [checkoutSession] }) } },
        refunds: { list: () => (async function* () { yield* refunds; })() },
    };
}
const event = { type: "charge.refunded", data: { object: { id: "ch_one" } } };

test("partial, pending, canceled and failed refunds leave access intact", async () => {
    for (const refund of [
        { status: "succeeded", amount: 1000 },
        { status: "pending", amount: 2999 },
        { status: "failed", amount: 2999 },
        { status: "canceled", amount: 2999 },
    ]) {
        const ctx = database();
        assert.equal(await handlePrepaidRefund(stripe([refund]), ctx.db, event), false);
        assert.equal(ctx.profile().prepaidAccess.basic, START + 30 * DAY);
    }
});

test("multiple successful partial refunds totaling the full price revoke access", async () => {
    const ctx = database();
    assert.equal(await handlePrepaidRefund(stripe([
        { status: "succeeded", amount: 1000 }, { status: "succeeded", amount: 1999 },
    ]), ctx.db, { type: "refund.updated", data: { object: { charge: "ch_one" } } }), true);
    assert.equal(ctx.profile().prepaidAccess.basic, 0);
});

test("unrelated Checkout payments never alter prepaid access", async () => {
    const ctx = database();
    assert.equal(await handlePrepaidRefund(stripe([{ status: "succeeded", amount: 2999 }], { metadata: {} }), ctx.db, event), false);
});
