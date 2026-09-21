/** One-time BLIK purchases. Amounts must come from server-owned configuration. */
const ACCESS_DAYS = 30;
const ACCESS_MS = ACCESS_DAYS * 24 * 60 * 60 * 1000;
const PAID_PLANS = new Set(["basic", "pro"]);

function prepaidCheckoutOptions({ customerId, uid, plan, amountPlnMinor, resultUrl }) {
    if (!PAID_PLANS.has(plan)) throw new Error("Invalid prepaid plan");
    if (!Number.isSafeInteger(amountPlnMinor) || amountPlnMinor <= 0) {
        throw new Error("BLIK price is not configured");
    }
    const metadata = { firebaseUid: uid, plan, purchaseType: "prepaid", accessDays: String(ACCESS_DAYS) };
    return {
        mode: "payment",
        customer: customerId,
        client_reference_id: uid,
        payment_method_types: ["blik"],
        locale: "pl",
        line_items: [{
            price_data: {
                currency: "pln",
                unit_amount: amountPlnMinor,
                product_data: {
                    name: `Lectoro ${plan.toUpperCase()} — ${ACCESS_DAYS} dni`,
                    description: "Jednorazowy dostęp. Bez karty i automatycznego odnowienia.",
                },
            },
            quantity: 1,
        }],
        metadata,
        payment_intent_data: { metadata, description: `Lectoro ${plan.toUpperCase()} — ${ACCESS_DAYS} dni dostępu` },
        success_url: `${resultUrl}?status=prepaid_success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${resultUrl}?status=cancel`,
    };
}

/** Called only with a verified Stripe session; an unpaid redirect never grants access. */
function paidPurchase(session) {
    if (session?.metadata?.purchaseType !== "prepaid") return null;
    if (session.mode !== "payment" || session.payment_status !== "paid") return null;
    const { plan, firebaseUid, accessDays } = session.metadata;
    if (!PAID_PLANS.has(plan) || !firebaseUid || accessDays !== String(ACCESS_DAYS) ||
        session.currency !== "pln" || !Number.isSafeInteger(session.amount_total) || session.amount_total <= 0 ||
        !session.id || !session.payment_intent || !session.customer ||
        session.client_reference_id !== firebaseUid) {
        throw new Error("Invalid prepaid payment");
    }
    return { uid: firebaseUid, plan, days: ACCESS_DAYS };
}

function extendAccess(currentEnd, now = Date.now()) {
    const previous = Number(currentEnd);
    return Math.max(now, Number.isFinite(previous) ? previous : 0) + ACCESS_MS;
}

/** The session ID is the idempotency key, including concurrent webhook deliveries. */
async function fulfillPrepaidSession(db, session, now = Date.now()) {
    const purchase = paidPurchase(session);
    if (!purchase) return false;
    const orderRef = db.collection("prepaidOrders").doc(session.id);
    const userRef = db.collection("users").doc(purchase.uid);
    return db.runTransaction(async (transaction) => {
        const [orderSnapshot, userSnapshot] = await Promise.all([
            transaction.get(orderRef), transaction.get(userRef),
        ]);
        const order = orderSnapshot.data();
        if (!order || order.uid !== purchase.uid || order.plan !== purchase.plan ||
            order.amount !== session.amount_total || order.customerId !== session.customer) {
            throw new Error("Prepaid order does not match payment");
        }
        if (order.fulfilledAt) return false;
        const user = userSnapshot.data() || {};
        const endsAt = extendAccess(user.prepaidAccess?.[purchase.plan], now);
        transaction.set(userRef, {
            prepaidAccess: { [purchase.plan]: endsAt },
            stripeHasSubscribed: true,
        }, { merge: true });
        transaction.set(orderRef, {
            fulfilledAt: now, endsAt, paymentIntentId: session.payment_intent,
        }, { merge: true });
        return true;
    });
}
module.exports = { ACCESS_DAYS, prepaidCheckoutOptions, paidPurchase, extendAccess, fulfillPrepaidSession };
