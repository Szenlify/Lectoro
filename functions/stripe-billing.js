const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { prepaidCheckoutOptions, fulfillPrepaidSession } = require("./prepaid-access");
let adminInstance = null;
function getAdmin() {
    if (!adminInstance) {
        adminInstance = require("firebase-admin");
        if (!adminInstance.apps.length) {
            adminInstance.initializeApp();
        }
    }
    return adminInstance;
}

let StripeSdk = null;
function getStripeSdk() {
    if (!StripeSdk) {
        StripeSdk = require("stripe");
    }
    return StripeSdk;
}
const {
    SUBSCRIPTION_PLANS,
    getPlanLimits,
    normalizePlan,
    resolveAccess,
} = require("./subscription-config");

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

const REGION = "europe-west1";
const PUBLIC_FUNCTIONS_URL = "https://europe-west1-extension-eng.cloudfunctions.net";
const CHECKOUT_RESULT_URL = `${PUBLIC_FUNCTIONS_URL}/stripeCheckoutResult`;
const ENTITLED_STATUSES = new Set(["active", "trialing"]);

function stripeClient() {
    const key = stripeSecretKey.value() || process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
    const Stripe = getStripeSdk();
    return new Stripe(key, { maxNetworkRetries: 2 });
}

function priceIds() {
    return {
        [SUBSCRIPTION_PLANS.BASIC]: "price_1UGiNEE5VRQaSjaXajWxr0pe",
        [SUBSCRIPTION_PLANS.PRO]: "price_1UGiU3E5VRQaSjaXvue7iu7N",
    };
}

function billingCors(req, res) {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.set("Cache-Control", "private, no-store");
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return true;
    }
    return false;
}

async function authenticatedUser(req, res) {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) {
        res.status(401).json({ error: "Zaloguj się, aby zarządzać płatnością." });
        return null;
    }
    try {
        return await getAdmin().auth().verifyIdToken(token);
    } catch (error) {
        console.warn("[Stripe] Invalid Firebase token:", error.message);
        res.status(401).json({ error: "Sesja wygasła. Zaloguj się ponownie." });
        return null;
    }
}

async function ensureStripeCustomer(stripe, decodedToken) {
    const db = getAdmin().firestore();
    const userRef = db.collection("users").doc(decodedToken.uid);
    const snapshot = await userRef.get();
    const savedCustomerId = snapshot.data()?.stripeCustomerId;

    if (savedCustomerId) {
        try {
            const customer = await stripe.customers.retrieve(savedCustomerId);
            if (!customer.deleted) return customer;
        } catch (error) {
            if (error.code !== "resource_missing") throw error;
        }
    }

    const customer = await stripe.customers.create(
        {
            email: decodedToken.email || undefined,
            name: decodedToken.name || undefined,
            metadata: { firebaseUid: decodedToken.uid },
        },
        { idempotencyKey: `lectoro-firebase-user-${decodedToken.uid}` },
    );
    await userRef.set(
        {
            stripeCustomerId: customer.id,
            email: decodedToken.email || snapshot.data()?.email || "",
        },
        { merge: true },
    );
    return customer;
}

async function uidForCustomer(stripe, customerId, hintedUid = "") {
    if (hintedUid) {
        try {
            await getAdmin().auth().getUser(hintedUid);
            const hintedProfile = await getAdmin()
                .firestore()
                .collection("users")
                .doc(hintedUid)
                .get();
            if (hintedProfile.data()?.stripeCustomerId === customerId) return hintedUid;
        } catch (_) {
            // Ignore stale/invalid metadata and resolve by the server-owned customer ID.
        }
    }

    const matches = await getAdmin()
        .firestore()
        .collection("users")
        .where("stripeCustomerId", "==", customerId)
        .limit(1)
        .get();
    if (!matches.empty) return matches.docs[0].id;

    const customer = await stripe.customers.retrieve(customerId);
    if (!customer.deleted && customer.metadata?.firebaseUid) {
        const uid = customer.metadata.firebaseUid;
        await getAdmin().auth().getUser(uid);
        return uid;
    }
    return "";
}

function planForSubscription(subscription, configuredPrices = priceIds()) {
    const subscribedPriceIds = new Set(
        (subscription?.items?.data || []).map((item) => item.price?.id).filter(Boolean),
    );
    if (subscribedPriceIds.has(configuredPrices[SUBSCRIPTION_PLANS.PRO])) {
        return SUBSCRIPTION_PLANS.PRO;
    }
    if (subscribedPriceIds.has(configuredPrices[SUBSCRIPTION_PLANS.BASIC])) {
        return SUBSCRIPTION_PLANS.BASIC;
    }
    return SUBSCRIPTION_PLANS.FREE;
}

function unixTimestamp(value) {
    return Number.isFinite(Number(value)) && Number(value) > 0
        ? getAdmin().firestore.Timestamp.fromMillis(Number(value) * 1000)
        : null;
}

function subscriptionPeriodEnd(subscription) {
    const ends = (subscription?.items?.data || [])
        .map((item) => Number(item.current_period_end || 0))
        .filter((value) => value > 0);
    return ends.length ? Math.max(...ends) : null;
}

/**
 * Check trial eligibility across ALL Stripe customers sharing this email,
 * not just the current customer. This prevents trial abuse via account
 * deletion + re-registration with the same Google account.
 */
async function isTrialEligible(stripe, email, currentSubscriptions = [], userData = {}) {
    // Fast path: Firestore flags from previous subscription on this uid
    if (userData.stripeTrialUsed || userData.stripeHasSubscribed) return false;

    // Check current customer's subscriptions
    const hasCurrentHistory = currentSubscriptions.some(
        (subscription) =>
            subscription?.id ||
            Number(subscription?.trial_start || 0) > 0 ||
            Number(subscription?.trial_end || 0) > 0,
    );
    if (hasCurrentHistory) return false;

    // Cross-customer check: look up ALL Stripe customers with this email
    // to catch re-registrations after account deletion
    if (email) {
        try {
            const customers = await stripe.customers.list({
                email: email.toLowerCase().trim(),
                limit: 100,
            });
            for (const customer of customers.data) {
                if (customer.deleted) continue;
                const subs = await stripe.subscriptions.list({
                    customer: customer.id,
                    status: "all",
                    limit: 10,
                });
                const hasHistory = subs.data.some(
                    (sub) =>
                        sub?.id ||
                        Number(sub?.trial_start || 0) > 0 ||
                        Number(sub?.trial_end || 0) > 0,
                );
                if (hasHistory) return false;
            }
        } catch (err) {
            console.warn("[Stripe] isTrialEligible cross-customer check warning:", err.message);
            // On Stripe API error, deny trial to be safe
            return false;
        }
    }

    return true;
}

function checkoutSessionOptions({ customerId, uid, plan, priceId, trialDays = 0, lang = "auto" }) {
    const normalizedTrialDays = Math.max(0, Number(trialDays) || 0);
    const successStatus = normalizedTrialDays > 0 ? "trial_success" : "success";
    const supportedLocales = new Set(["auto", "en", "pl", "de", "es", "fr", "it", "ja", "ko", "nl", "cs", "pt"]);
    const rawLang = String(lang || "auto").toLowerCase().slice(0, 2);
    const locale = supportedLocales.has(rawLang)
        ? (rawLang === "pt" ? "pt-BR" : rawLang)
        : "auto";
    return {
        mode: "subscription",
        customer: customerId,
        client_reference_id: uid,
        line_items: [{ price: priceId, quantity: 1 }],
        payment_method_collection: "always",
        allow_promotion_codes: true,
        locale,
        adaptive_pricing: {
            enabled: true,
        },
        success_url: `${CHECKOUT_RESULT_URL}?status=${successStatus}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${CHECKOUT_RESULT_URL}?status=cancel`,
        metadata: {
            firebaseUid: uid,
            plan,
            trialDays: String(normalizedTrialDays),
        },
        subscription_data: {
            metadata: { firebaseUid: uid, plan },
            ...(normalizedTrialDays > 0
                ? { trial_period_days: normalizedTrialDays }
                : {}),
        },
    };
}

async function applySubscriptionState(uid, customerId, subscription) {
    const entitled =
        !!subscription &&
        ENTITLED_STATUSES.has(subscription.status) &&
        planForSubscription(subscription) !== SUBSCRIPTION_PLANS.FREE;
    const plan = entitled ? planForSubscription(subscription) : SUBSCRIPTION_PLANS.FREE;
    const status = subscription?.status || "inactive";
    const usedTrial =
        Number(subscription?.trial_start || 0) > 0 ||
        Number(subscription?.trial_end || 0) > 0;
    const authUser = await getAdmin().auth().getUser(uid);

    await getAdmin().auth().setCustomUserClaims(uid, {
        ...(authUser.customClaims || {}),
        plan,
    });
    await getAdmin()
        .firestore()
        .collection("users")
        .doc(uid)
        .set(
            {
                plan,
                subscriptionPlan: plan,
                subscriptionStatus: status,
                stripeCustomerId: customerId,
                stripeSubscriptionId: subscription?.id || getAdmin().firestore.FieldValue.delete(),
                stripeCancelAtPeriodEnd: !!subscription?.cancel_at_period_end,
                stripeCurrentPeriodEnd:
                    unixTimestamp(subscriptionPeriodEnd(subscription)) ||
                    getAdmin().firestore.FieldValue.delete(),
                stripeTrialEnd:
                    unixTimestamp(subscription?.trial_end) ||
                    getAdmin().firestore.FieldValue.delete(),
                ...(subscription ? { stripeHasSubscribed: true } : {}),
                ...(usedTrial ? { stripeTrialUsed: true } : {}),
                planUpdatedAt: getAdmin().firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
        );
    console.log(`[Stripe] Synced ${uid}: ${plan} (${status})`);
}

async function syncCustomerSubscriptions(stripe, customerId, hintedUid = "") {
    const uid = await uidForCustomer(stripe, customerId, hintedUid);
    if (!uid) {
        console.warn(`[Stripe] No Firebase user for customer ${customerId}`);
        return;
    }
    const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 20,
    });
    const valid = subscriptions.data.filter(
        (subscription) => planForSubscription(subscription) !== SUBSCRIPTION_PLANS.FREE,
    );
    const subscription =
        valid.find(
            (item) =>
                ENTITLED_STATUSES.has(item.status) &&
                planForSubscription(item) === SUBSCRIPTION_PLANS.PRO,
        ) ||
        valid.find((item) => ENTITLED_STATUSES.has(item.status)) ||
        valid.sort((left, right) => Number(right.created || 0) - Number(left.created || 0))[0] ||
        null;
    await applySubscriptionState(uid, customerId, subscription);
}

exports.createStripeCheckoutSession = onRequest(
    {
        region: REGION,
        timeoutSeconds: 30,
        maxInstances: 10,
        concurrency: 80,
        memory: "256MiB",
        secrets: [stripeSecretKey],
    },
    async (req, res) => {
        if (billingCors(req, res)) return;
        if (req.method !== "POST") {
            return res.status(405).json({ error: "Method not allowed" });
        }
        const decodedToken = await authenticatedUser(req, res);
        if (!decodedToken) return;

        const requestedPlan = normalizePlan(req.body?.plan);
        if (![SUBSCRIPTION_PLANS.BASIC, SUBSCRIPTION_PLANS.PRO].includes(requestedPlan)) {
            return res.status(400).json({ error: "Wybierz plan BASIC albo PRO." });
        }

        const paymentMode = req.body?.paymentMode || "subscription";
        if (!["subscription", "blik"].includes(paymentMode)) {
            return res.status(400).json({ error: "Nieprawidłowa metoda płatności." });
        }

        try {
            const stripe = stripeClient();
            const customer = await ensureStripeCustomer(stripe, decodedToken);
            const activeSubscriptions = await stripe.subscriptions.list({
                customer: customer.id,
                status: "all",
                limit: 20,
            });
            if (activeSubscriptions.data.some((item) => ENTITLED_STATUSES.has(item.status))) {
                const portal = await stripe.billingPortal.sessions.create({
                    customer: customer.id,
                    return_url: `${CHECKOUT_RESULT_URL}?status=portal`,
                });
                return res.status(409).json({
                    error: "Masz już aktywną subskrypcję. Zmień plan w panelu Stripe.",
                    code: "SUBSCRIPTION_ALREADY_ACTIVE",
                    url: portal.url,
                });
            }

            const selectedPrice = priceIds()[requestedPlan];
            if (!selectedPrice?.startsWith("price_")) {
                throw new Error(`Stripe price for ${requestedPlan} is not configured`);
            }
            const userSnapshot = await getAdmin()
                .firestore()
                .collection("users")
                .doc(decodedToken.uid)
                .get();
            const access = resolveAccess(userSnapshot.data() || {});
            const activePrepaidPlan = ["pro", "basic"].find(
                (plan) => Number(access.prepaidAccess[plan]) > Date.now(),
            );
            if (activePrepaidPlan && (paymentMode !== "blik" || activePrepaidPlan !== requestedPlan)) {
                return res.status(409).json({
                    error: "Masz aktywny dostęp BLIK. Możesz przedłużyć ten sam plan; inny wybierzesz po jego wygaśnięciu.",
                    code: "PREPAID_ALREADY_ACTIVE",
                });
            }
            if (paymentMode === "blik") {
                const offer = getPlanLimits(requestedPlan).prepaid;
                const session = await stripe.checkout.sessions.create({
                    ...prepaidCheckoutOptions({
                        customerId: customer.id,
                        uid: decodedToken.uid,
                        plan: requestedPlan,
                        amountPlnMinor: offer.amountMinor,
                        resultUrl: CHECKOUT_RESULT_URL,
                    }),
                    expires_at: Math.floor(Date.now() / 1000) + 1800,
                });
                // Persist the server-priced order before exposing its payment URL.
                await getAdmin().firestore().collection("prepaidOrders").doc(session.id).set({
                    uid: decodedToken.uid,
                    plan: requestedPlan,
                    amount: offer.amountMinor,
                    customerId: customer.id,
                    createdAt: Date.now(),
                });
                return res.status(200).json({ url: session.url, trialDays: 0, paymentMode: "blik" });
            }
            const trialDays = (await isTrialEligible(
                stripe,
                decodedToken.email || "",
                activeSubscriptions.data,
                userSnapshot.data() || {},
            ))
                ? getPlanLimits(requestedPlan).trialDays
                : 0;
            const session = await stripe.checkout.sessions.create(
                checkoutSessionOptions({
                    customerId: customer.id,
                    uid: decodedToken.uid,
                    plan: requestedPlan,
                    priceId: selectedPrice,
                    trialDays,
                    lang: req.body?.lang || "auto",
                }),
            );
            return res.status(200).json({ url: session.url, trialDays });
        } catch (error) {
            console.error("[Stripe Checkout] Error:", error);
            return res.status(500).json({
                error: "Nie udało się otworzyć płatności Stripe. Spróbuj ponownie.",
            });
        }
    },
);

exports.createStripePortalSession = onRequest(
    {
        region: REGION,
        timeoutSeconds: 30,
        maxInstances: 10,
        concurrency: 80,
        memory: "256MiB",
        secrets: [stripeSecretKey],
    },
    async (req, res) => {
        if (billingCors(req, res)) return;
        if (req.method !== "POST") {
            return res.status(405).json({ error: "Method not allowed" });
        }
        const decodedToken = await authenticatedUser(req, res);
        if (!decodedToken) return;
        try {
            const stripe = stripeClient();
            const customer = await ensureStripeCustomer(stripe, decodedToken);
            const session = await stripe.billingPortal.sessions.create({
                customer: customer.id,
                return_url: `${CHECKOUT_RESULT_URL}?status=portal`,
            });
            return res.status(200).json({ url: session.url });
        } catch (error) {
            console.error("[Stripe Portal] Error:", error);
            return res.status(500).json({
                error: "Nie udało się otworzyć panelu płatności Stripe.",
            });
        }
    },
);

exports.stripeWebhook = onRequest(
    {
        region: REGION,
        timeoutSeconds: 60,
        maxInstances: 10,
        concurrency: 80,
        memory: "256MiB",
        secrets: [
            stripeSecretKey,
            stripeWebhookSecret,
        ],
    },
    async (req, res) => {
        if (req.method !== "POST") return res.status(405).send("Method not allowed");
        const signature = req.headers["stripe-signature"];
        if (!signature) return res.status(400).send("Missing Stripe-Signature");

        let event;
        let stripe;
        try {
            stripe = stripeClient();
            event = stripe.webhooks.constructEvent(
                req.rawBody,
                signature,
                stripeWebhookSecret.value(),
            );
        } catch (error) {
            console.warn("[Stripe Webhook] Invalid signature:", error.message);
            return res.status(400).send("Invalid webhook signature");
        }

        try {
            if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
                const session = event.data.object;
                if (session.metadata?.purchaseType === "prepaid") {
                    await fulfillPrepaidSession(getAdmin().firestore(), session);
                }
                if (session.mode === "subscription" && session.customer) {
                    await syncCustomerSubscriptions(
                        stripe,
                        String(session.customer),
                        session.client_reference_id || session.metadata?.firebaseUid || "",
                    );
                }
            } else if (
                event.type === "customer.subscription.created" ||
                event.type === "customer.subscription.updated" ||
                event.type === "customer.subscription.deleted"
            ) {
                const subscription = event.data.object;
                await syncCustomerSubscriptions(
                    stripe,
                    String(subscription.customer),
                    subscription.metadata?.firebaseUid || "",
                );
            } else if (
                event.type === "invoice.paid" ||
                event.type === "invoice.payment_failed"
            ) {
                const invoice = event.data.object;
                if (invoice.customer) {
                    await syncCustomerSubscriptions(stripe, String(invoice.customer));
                }
            }
            return res.status(200).json({ received: true });
        } catch (error) {
            console.error(`[Stripe Webhook] ${event.type} failed:`, error);
            return res.status(500).send("Webhook processing failed");
        }
    },
);

function resultPage(status) {
    const messages = {
        trial_success: {
            title: "3 dni za darmo rozpoczęte",
            text: "Karta została zapisana, ale dziś nic nie pobraliśmy. Przed Tobą 3 dni odkrywania nowych możliwości Lectoro.",
        },
        prepaid_success: {
            title: "Dziękujemy za płatność BLIK!",
            text: "Po potwierdzeniu płatności dodamy 30 dni dostępu do Twojego planu. Bez podpinania karty i automatycznego odnowienia.",
        },
        success: {
            title: "Płatność zakończona",
            text: "Dziękujemy, że rozwijasz z nami swoje językowe możliwości. Twoja płatność została przyjęta.",
        },
        cancel: {
            title: "Płatność anulowana",
            text: "Nic nie pobraliśmy. Wróć do nauki i wybierz plan wtedy, kiedy będziesz gotowy.",
        },
        portal: {
            title: "Ustawienia płatności zapisane",
            text: "Wszystko gotowe. Otwórz ponownie Lectoro, aby zobaczyć aktualny plan.",
        },
    };
    const message = messages[status] || messages.portal;
    const celebrate = status === "success" || status === "trial_success" || status === "prepaid_success";
    const confetti = celebrate
        ? Array.from({ length: 64 }, (_, i) => `<i style="--x:${(i * 37) % 100}%;--delay:${(i % 9) * 0.09}s;--duration:${2.8 + (i % 7) * 0.16}s;--drift:${((i * 29) % 180) - 90}px;--spin:${i % 2 ? 620 : -540}deg;--color:${["#a5a0ff", "#74e4be", "#f5d78e", "#f6accd"][i % 4]}"></i>`).join("")
        : "";
    return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${message.title} — Lectoro</title>
<style>
:root { color-scheme: dark; --text: #f5f5fc; --muted: #a9adc4; --mint: #8de8c5; --line: #ffffff14; }
body { margin: 0; min-height: 100vh; min-height: 100dvh; display: grid; grid-template-rows: auto 1fr auto; background: radial-gradient(ellipse at 50% 35%, #252344 0, #10111e 45%, #0b0c15 80%); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.brand { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 36px 24px 20px; font-size: 1.3rem; font-weight: 750; letter-spacing: -.04em; }
.brand-mark { display: grid; place-items: center; width: 30px; height: 30px; border: 1px solid #a9a0ff55; border-radius: 10px; background: #9e90ff20; color: #c4bdff; font-size: 1rem; }
main { display: grid; place-items: center; padding: 24px; }
.card { box-sizing: border-box; position: relative; width: 100%; max-width: 600px; padding: 48px 48px 32px; border: 1px solid #ffffff1c; border-radius: 32px; background: linear-gradient(155deg, #202136, #151622 65%); box-shadow: 0 32px 100px #0005, inset 0 1px #ffffff08; text-align: center; animation: arrive .65s ease-out both; }
.card::before { content: ""; position: absolute; top: -1px; left: 20%; right: 20%; height: 1px; background: linear-gradient(90deg, transparent, #bbb0ffb0, transparent); }
.seal { display: grid; place-items: center; width: 88px; height: 88px; margin: 0 auto 28px; border: 1px solid #8de8c533; border-radius: 50%; background: radial-gradient(circle at 30% 20%, #8de8c530, #8de8c508); color: var(--mint); box-shadow: 0 0 0 10px #8de8c504, 0 0 60px #8de8c50c; }
.seal svg { width: 40px; height: 40px; }
.eyebrow { margin: 0 0 14px; color: var(--mint); font-size: .7rem; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; }
h1 { margin: 0; font-size: clamp(2rem, 1.5rem + 2vw, 2.8rem); line-height: 1.12; font-weight: 700; letter-spacing: -.055em; text-wrap: balance; }
.description { max-width: 410px; margin: 20px auto 0; color: var(--muted); font-size: 1rem; line-height: 1.75; text-wrap: pretty; }
.next { margin-top: 32px; padding: 22px 24px; border: 1px solid var(--line); border-radius: 18px; background: #0b0c152e; text-align: start; }
.next-title { margin: 0 0 14px; font-size: .85rem; font-weight: 650; }
.steps { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }
.steps li { display: flex; align-items: center; gap: 12px; color: #c3c6d9; font-size: .84rem; line-height: 1.5; }
.step-number { display: grid; place-items: center; flex-shrink: 0; width: 24px; height: 24px; border: 1px solid #a9a0ff30; border-radius: 8px; color: #c4bdff; background: #a9a0ff0d; font-size: .7rem; }
.note { margin: 22px 0 0; color: var(--muted); font-size: .75rem; line-height: 1.6; }
footer { padding: 24px 20px 30px; text-align: center; color: #9297af; font-size: .75rem; letter-spacing: .02em; }
footer span { color: #beb5ee; }
.confetti { position: fixed; inset: 0; overflow: hidden; pointer-events: none; z-index: 2; }
.confetti i { position: absolute; top: -20px; left: var(--x); width: 7px; height: 12px; border-radius: 2px; background: var(--color); animation: confetti-fall var(--duration) var(--delay) cubic-bezier(.2,.55,.6,1) both; }
.confetti i:nth-child(3n) { width: 7px; height: 7px; border-radius: 50%; }
.confetti i:nth-child(5n) { width: 4px; height: 15px; }
@keyframes confetti-fall { 0% { opacity: 0; transform: translate3d(0,-20px,0) rotate(0); } 8% { opacity: .9; } 75% { opacity: .75; } 100% { opacity: 0; transform: translate3d(var(--drift),105vh,0) rotate(var(--spin)); } }
@keyframes arrive { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
@media (max-width: 480px) { .brand { padding-top: 24px; } main { padding: 16px; } .card { padding: 36px 24px 28px; border-radius: 24px; } .next { padding: 20px 16px; } }
@media (prefers-reduced-motion: reduce) { .confetti { display: none; } .confetti i, .card { animation: none; } }
</style>
</head>
<body>
<header class="brand"><span class="brand-mark" aria-hidden="true">L</span>Lectoro</header>
${celebrate ? `<div class="confetti" aria-hidden="true">${confetti}</div>` : ""}
<main>
<section class="card" aria-labelledby="result-title">
<div class="seal" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${status === "cancel" ? '<path d="m14 8-8 8 8 8M6 16h20"/>' : '<path d="m8 16 5.5 5.5L25 10"/>'}</svg></div>
<p class="eyebrow">${celebrate ? "Dobry krok. Więcej możliwości." : "Twoje konto Lectoro"}</p>
<h1 id="result-title">${message.title}</h1>
<p class="description">${message.text}</p>
<div class="next">
<p class="next-title">${celebrate ? "Wracamy do nauki?" : "Wróć do Lectoro"}</p>
<ol class="steps">
<li><span class="step-number" aria-hidden="true">1</span><span>Zamknij tę kartę.</span></li>
<li><span class="step-number" aria-hidden="true">2</span><span>Otwórz Lectoro z paska rozszerzeń Chrome.</span></li>
</ol>
</div>
<p class="note">${status === "cancel" ? "Możesz wrócić do wyboru planu w dowolnej chwili." : "Aktualizacja planu może potrwać kilka sekund."}</p>
</section>
</main>
<footer>Małe kroki. <span>Coraz więcej rozumiesz.</span></footer>
</body>
</html>`;
}

exports.stripeCheckoutResult = onRequest(
    {
        region: REGION,
        maxInstances: 10,
        concurrency: 80,
    },
    (req, res) => {
    res.set("Content-Type", "text/html; charset=utf-8");
    res.set("Cache-Control", "no-store");
    res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
    return res.status(200).send(resultPage(String(req.query.status || "")));
});

// Non-enumerable means Firebase does not deploy these pure helpers as functions.
Object.defineProperty(exports, "_test", {
    enumerable: false,
    value: {
        checkoutSessionOptions,
        isTrialEligible,
        planForSubscription,
        resultPage,
        subscriptionPeriodEnd,
    },
});
