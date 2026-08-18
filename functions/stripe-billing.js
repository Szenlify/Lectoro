const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");
const admin = require("firebase-admin");
let StripeSdk = null;
function getStripeSdk() {
    if (!StripeSdk) {
        StripeSdk = require("stripe");
    }
    return StripeSdk;
}
const { SUBSCRIPTION_PLANS, normalizePlan } = require("./subscription-config");

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");
const stripeBasicPriceId = defineSecret("STRIPE_BASIC_PRICE_ID");
const stripeProPriceId = defineSecret("STRIPE_PRO_PRICE_ID");

const REGION = "europe-west1";
const PUBLIC_FUNCTIONS_URL = "https://europe-west1-extension-eng.cloudfunctions.net";
const CHECKOUT_RESULT_URL = `${PUBLIC_FUNCTIONS_URL}/stripeCheckoutResult`;
const ENTITLED_STATUSES = new Set(["active", "trialing"]);

function stripeClient() {
    const key = stripeSecretKey.value();
    if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
    const Stripe = getStripeSdk();
    return new Stripe(key, { maxNetworkRetries: 2 });
}

function priceIds() {
    return {
        [SUBSCRIPTION_PLANS.BASIC]: stripeBasicPriceId.value(),
        [SUBSCRIPTION_PLANS.PRO]: stripeProPriceId.value(),
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
        return await admin.auth().verifyIdToken(token);
    } catch (error) {
        console.warn("[Stripe] Invalid Firebase token:", error.message);
        res.status(401).json({ error: "Sesja wygasła. Zaloguj się ponownie." });
        return null;
    }
}

async function ensureStripeCustomer(stripe, decodedToken) {
    const db = admin.firestore();
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
            await admin.auth().getUser(hintedUid);
            const hintedProfile = await admin
                .firestore()
                .collection("users")
                .doc(hintedUid)
                .get();
            if (hintedProfile.data()?.stripeCustomerId === customerId) return hintedUid;
        } catch (_) {
            // Ignore stale/invalid metadata and resolve by the server-owned customer ID.
        }
    }

    const matches = await admin
        .firestore()
        .collection("users")
        .where("stripeCustomerId", "==", customerId)
        .limit(1)
        .get();
    if (!matches.empty) return matches.docs[0].id;

    const customer = await stripe.customers.retrieve(customerId);
    if (!customer.deleted && customer.metadata?.firebaseUid) {
        const uid = customer.metadata.firebaseUid;
        await admin.auth().getUser(uid);
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
        ? admin.firestore.Timestamp.fromMillis(Number(value) * 1000)
        : null;
}

function subscriptionPeriodEnd(subscription) {
    const ends = (subscription?.items?.data || [])
        .map((item) => Number(item.current_period_end || 0))
        .filter((value) => value > 0);
    return ends.length ? Math.max(...ends) : null;
}

async function applySubscriptionState(uid, customerId, subscription) {
    const entitled =
        !!subscription &&
        ENTITLED_STATUSES.has(subscription.status) &&
        planForSubscription(subscription) !== SUBSCRIPTION_PLANS.FREE;
    const plan = entitled ? planForSubscription(subscription) : SUBSCRIPTION_PLANS.FREE;
    const status = subscription?.status || "inactive";
    const authUser = await admin.auth().getUser(uid);

    await admin.auth().setCustomUserClaims(uid, {
        ...(authUser.customClaims || {}),
        plan,
    });
    await admin
        .firestore()
        .collection("users")
        .doc(uid)
        .set(
            {
                plan,
                subscriptionStatus: status,
                stripeCustomerId: customerId,
                stripeSubscriptionId: subscription?.id || admin.firestore.FieldValue.delete(),
                stripeCancelAtPeriodEnd: !!subscription?.cancel_at_period_end,
                stripeCurrentPeriodEnd:
                    unixTimestamp(subscriptionPeriodEnd(subscription)) ||
                    admin.firestore.FieldValue.delete(),
                planUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
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
        memory: "256MiB",
        secrets: [stripeSecretKey, stripeBasicPriceId, stripeProPriceId],
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
            const session = await stripe.checkout.sessions.create({
                mode: "subscription",
                customer: customer.id,
                client_reference_id: decodedToken.uid,
                line_items: [{ price: selectedPrice, quantity: 1 }],
                allow_promotion_codes: true,
                locale: "pl",
                success_url: `${CHECKOUT_RESULT_URL}?status=success&session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${CHECKOUT_RESULT_URL}?status=cancel`,
                metadata: { firebaseUid: decodedToken.uid, plan: requestedPlan },
                subscription_data: {
                    metadata: { firebaseUid: decodedToken.uid, plan: requestedPlan },
                },
            });
            return res.status(200).json({ url: session.url });
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
        memory: "256MiB",
        secrets: [
            stripeSecretKey,
            stripeWebhookSecret,
            stripeBasicPriceId,
            stripeProPriceId,
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
            if (event.type === "checkout.session.completed") {
                const session = event.data.object;
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
        success: {
            icon: "✓",
            title: "Płatność zakończona",
            text: "Stripe przyjął płatność. Zamknij tę kartę i ponownie otwórz Lectoro. Plan pojawi się po kilku sekundach.",
        },
        cancel: {
            icon: "←",
            title: "Płatność anulowana",
            text: "Nic nie pobraliśmy. Możesz zamknąć tę kartę i wrócić do Lectoro.",
        },
        portal: {
            icon: "✓",
            title: "Ustawienia płatności zapisane",
            text: "Zamknij tę kartę i ponownie otwórz Lectoro, aby zobaczyć aktualny plan.",
        },
    };
    const message = messages[status] || messages.portal;
    return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lectoro — Stripe</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#090b16;color:#eef2ff;font-family:system-ui,sans-serif}.card{max-width:520px;margin:24px;padding:36px;border:1px solid #30365b;border-radius:22px;background:#13162a;text-align:center;box-shadow:0 24px 70px #0008}.icon{display:grid;place-items:center;width:56px;height:56px;margin:auto;border-radius:50%;background:#6366f1;color:white;font-size:30px}h1{font-size:25px;margin:20px 0 10px}p{color:#b8bfd9;line-height:1.6;margin:0}</style></head><body><main class="card"><div class="icon">${message.icon}</div><h1>${message.title}</h1><p>${message.text}</p></main></body></html>`;
}

exports.stripeCheckoutResult = onRequest({ region: REGION }, (req, res) => {
    res.set("Content-Type", "text/html; charset=utf-8");
    res.set("Cache-Control", "no-store");
    res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
    return res.status(200).send(resultPage(String(req.query.status || "")));
});

// Non-enumerable means Firebase does not deploy these pure helpers as functions.
Object.defineProperty(exports, "_test", {
    enumerable: false,
    value: { planForSubscription, resultPage, subscriptionPeriodEnd },
});
