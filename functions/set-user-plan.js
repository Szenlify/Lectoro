/**
 * Admin-only CLI for assigning a Firebase Auth Custom Claim.
 *
 * Usage from the functions directory:
 *   npm run plan:set -- <firebase-uid> basic
 *
 * Run with Application Default Credentials, for example after `firebase login`
 * in a trusted admin environment or with GOOGLE_APPLICATION_CREDENTIALS set.
 */
const admin = require("firebase-admin");
const { SUBSCRIPTION_LIMITS } = require("./subscription-config");

const [, , uid, requestedPlan] = process.argv;
const plan = String(requestedPlan || "").trim().toLowerCase();

if (!uid || !Object.prototype.hasOwnProperty.call(SUBSCRIPTION_LIMITS, plan)) {
    console.error("Użycie: npm run plan:set -- <firebase-uid> <free|basic|pro>");
    process.exitCode = 1;
} else {
    admin.initializeApp();
    void (async () => {
        const user = await admin.auth().getUser(uid);
        const currentClaims = user.customClaims || {};
        await admin.auth().setCustomUserClaims(uid, { ...currentClaims, plan });
        await admin.firestore().collection("users").doc(uid).set(
            {
                plan,
                subscriptionStatus: "active",
                planUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
        );
        console.log(`Ustawiono plan ${plan.toUpperCase()} dla ${uid}.`);
        console.log("Nowy claim pojawi się po odświeżeniu tokenu lub ponownym logowaniu.");
    })().catch((error) => {
        console.error("Nie udało się ustawić planu:", error);
        process.exitCode = 1;
    });
}
