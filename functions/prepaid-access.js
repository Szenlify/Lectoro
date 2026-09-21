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
        if (order.fulfilledAt || order.refundedAt) return false;
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
/** Rebuild the paid timeline instead of deleting unrelated renewals or subscriptions. */
function remainingAccessEnd(orders, plan) {
    return orders
        .filter((order) => order.plan === plan && order.fulfilledAt && !order.refundedAt)
        .sort((left, right) => left.fulfilledAt - right.fulfilledAt)
        .reduce((end, order) => extendAccess(end, Number(order.fulfilledAt)), 0);
}

async function revokePrepaidSession(db, session, now = Date.now()) {
    const purchase = paidPurchase(session);
    if (!purchase) return false;
    const orderRef = db.collection("prepaidOrders").doc(session.id);
    const userRef = db.collection("users").doc(purchase.uid);
    // A single-field query needs no additional composite index.
    const ordersQuery = db.collection("prepaidOrders").where("uid", "==", purchase.uid);
    return db.runTransaction(async (transaction) => {
        const [orderSnapshot, userSnapshot, allOrders] = await Promise.all([
            transaction.get(orderRef), transaction.get(userRef), transaction.get(ordersQuery),
        ]);
        const order = orderSnapshot.data();
        if (!order || order.uid !== purchase.uid || order.plan !== purchase.plan ||
            order.amount !== session.amount_total || order.customerId !== session.customer ||
            (order.paymentIntentId && order.paymentIntentId !== session.payment_intent)) {
            throw new Error("Refund does not match prepaid order");
        }
        if (order.refundedAt) return false;
        const remaining = allOrders.docs
            .filter((doc) => doc.id !== session.id)
            .map((doc) => doc.data());
        const endsAt = remainingAccessEnd(remaining, purchase.plan);
        transaction.set(orderRef, {
            refundedAt: now, paymentIntentId: session.payment_intent,
        }, { merge: true });
        // A refund may arrive before the purchase webhook, or after account deletion.
        if (order.fulfilledAt && userSnapshot.exists) {
            transaction.set(userRef, {
                prepaidAccess: { [purchase.plan]: endsAt },
            }, { merge: true });
        }
        return true;
    });
}

/** Use current Stripe state, not a possibly delayed webhook payload. */
async function handlePrepaidRefund(stripe, db, event) {
    const object = event.data.object;
    const chargeId = event.type === "charge.refunded" ? object.id :
        (typeof object.charge === "string" ? object.charge : object.charge?.id);
    if (!chargeId) return false;
    const charge = await stripe.charges.retrieve(chargeId);
    const paymentIntentId = typeof charge.payment_intent === "string"
        ? charge.payment_intent : charge.payment_intent?.id;
    if (!paymentIntentId || charge.currency !== "pln" || !(charge.amount > 0)) return false;
    const sessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 100 });
    const session = sessions.data.find((item) => item.metadata?.purchaseType === "prepaid");
    if (!session) return false;
    // Pending/failed refunds never revoke access. Several partial refunds may add up to a full refund.
    let refundedAmount = 0;
    for await (const refund of stripe.refunds.list({ charge: chargeId, limit: 100 })) {
        if (refund.status === "succeeded") refundedAmount += refund.amount;
    }
    if (refundedAmount < charge.amount) return false;
    if (session.amount_total !== charge.amount || session.payment_intent !== paymentIntentId) {
        throw new Error("Refund amount does not match Checkout session");
    }
    return revokePrepaidSession(db, session);
}

module.exports = {
    ACCESS_DAYS, prepaidCheckoutOptions, paidPurchase, extendAccess,
    fulfillPrepaidSession, remainingAccessEnd, revokePrepaidSession, handlePrepaidRefund,
};
