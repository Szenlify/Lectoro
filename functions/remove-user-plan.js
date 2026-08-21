/**
 * Admin-only CLI for removing manually assigned subscription entitlements.
 *
 * Usage from the functions directory:
 *   npm run plan:remove -- FIREBASE_UID
 *   npm run plan:remove -- UID_1 UID_2 user@example.com
 *   npm run plan:remove -- --dry-run UID_1,UID_2
 *
 * This does not delete the Firebase Auth account or the user's application
 * data. It removes the syncUserPlanClaim control document, the Auth `plan`
 * custom claim, and server-owned subscription fields from users/{uid}.
 */
const admin = require("firebase-admin");

const SUBSCRIPTION_FIELDS = [
    "plan",
    "subscriptionStatus",
    "stripeCustomerId",
    "stripeSubscriptionId",
    "stripeCancelAtPeriodEnd",
    "stripeCurrentPeriodEnd",
    "stripeTrialEnd",
    "planUpdatedAt",
];

function usage() {
    return [
        "Użycie:",
        "  npm run plan:remove -- <uid-lub-email> [kolejny-uid-lub-email ...]",
        "  npm run plan:remove -- --dry-run <uid-lub-email> [...]",
        "",
        "Opcje:",
        "  --dry-run          Tylko pokaż, co zostałoby usunięte.",
        "  --revoke-sessions  Unieważnij tokeny odświeżania (wymaga ponownego logowania).",
        "  --help             Pokaż tę pomoc.",
    ].join("\n");
}

function parseArgs(argv) {
    const options = {
        dryRun: false,
        revokeSessions: false,
        help: false,
        identifiers: [],
    };

    for (const argument of argv) {
        if (argument === "--dry-run") {
            options.dryRun = true;
        } else if (argument === "--revoke-sessions") {
            options.revokeSessions = true;
        } else if (argument === "--help" || argument === "-h") {
            options.help = true;
        } else if (argument.startsWith("--")) {
            throw new Error(`Nieznana opcja: ${argument}`);
        } else {
            options.identifiers.push(
                ...argument
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean),
            );
        }
    }

    options.identifiers = [...new Set(options.identifiers)];
    return options;
}

function removePlanClaim(customClaims = {}) {
    const claims = { ...customClaims };
    delete claims.plan;
    return claims;
}

function isMissingAuthUser(error) {
    return error?.code === "auth/user-not-found";
}

async function resolveUser(auth, identifier) {
    if (identifier.includes("@")) {
        return auth.getUserByEmail(identifier);
    }

    if (!identifier || identifier.includes("/") || identifier.length > 128) {
        throw new Error(`Nieprawidłowy UID: ${identifier}`);
    }

    try {
        return await auth.getUser(identifier);
    } catch (error) {
        if (isMissingAuthUser(error)) return { uid: identifier, customClaims: null };
        throw error;
    }
}

function deletionMap(fieldValue) {
    return Object.fromEntries(
        SUBSCRIPTION_FIELDS.map((field) => [field, fieldValue.delete()]),
    );
}

async function inspectUser(adminSdk, identifier) {
    const auth = adminSdk.auth();
    const db = adminSdk.firestore();
    const authUser = await resolveUser(auth, identifier);
    const uid = authUser.uid;
    const [controlSnapshot, profileSnapshot] = await Promise.all([
        db.collection("subscriptionPlans").doc(uid).get(),
        db.collection("users").doc(uid).get(),
    ]);

    return {
        uid,
        email: authUser.email || "",
        authUserExists: authUser.customClaims !== null,
        hasPlanClaim: Object.prototype.hasOwnProperty.call(
            authUser.customClaims || {},
            "plan",
        ),
        controlDocumentExists: controlSnapshot.exists,
        profileDocumentExists: profileSnapshot.exists,
        profileFields: profileSnapshot.exists
            ? SUBSCRIPTION_FIELDS.filter((field) =>
                  Object.prototype.hasOwnProperty.call(profileSnapshot.data() || {}, field),
              )
            : [],
        customClaims: authUser.customClaims || {},
    };
}

async function removeUserPlan(adminSdk, identifier, options = {}) {
    const state = await inspectUser(adminSdk, identifier);
    if (options.dryRun) return state;

    const db = adminSdk.firestore();
    const controlRef = db.collection("subscriptionPlans").doc(state.uid);
    const profileRef = db.collection("users").doc(state.uid);

    // Delete the trigger source before the Auth claim so an older control
    // document cannot restore the paid plan after this command completes.
    await db.runTransaction(async (transaction) => {
        const profileSnapshot = await transaction.get(profileRef);
        transaction.delete(controlRef);
        if (profileSnapshot.exists) {
            transaction.update(profileRef, deletionMap(adminSdk.firestore.FieldValue));
        }
    });

    if (state.authUserExists && state.hasPlanClaim) {
        await adminSdk.auth().setCustomUserClaims(
            state.uid,
            removePlanClaim(state.customClaims),
        );
    }
    if (state.authUserExists && options.revokeSessions) {
        await adminSdk.auth().revokeRefreshTokens(state.uid);
    }

    return state;
}

function describeState(state, dryRun) {
    const prefix = dryRun ? "[DRY RUN]" : "[OK]";
    const target = state.email ? `${state.uid} (${state.email})` : state.uid;
    const changes = [
        state.controlDocumentExists ? "subscriptionPlans" : null,
        state.hasPlanClaim ? "Auth claim plan" : null,
        state.profileFields.length ? `users: ${state.profileFields.join(", ")}` : null,
    ].filter(Boolean);
    return `${prefix} ${target}: ${changes.length ? changes.join("; ") : "brak danych planu"}`;
}

async function main(argv = process.argv.slice(2)) {
    let options;
    try {
        options = parseArgs(argv);
    } catch (error) {
        console.error(error.message);
        console.error(usage());
        process.exitCode = 1;
        return;
    }

    if (options.help || options.identifiers.length === 0) {
        console.log(usage());
        process.exitCode = options.help ? 0 : 1;
        return;
    }

    admin.initializeApp();
    let failures = 0;
    for (const identifier of options.identifiers) {
        try {
            const state = await removeUserPlan(admin, identifier, options);
            console.log(describeState(state, options.dryRun));
        } catch (error) {
            failures += 1;
            console.error(`[BŁĄD] ${identifier}: ${error.message}`);
        }
    }

    if (!options.dryRun && failures === 0) {
        console.log(
            options.revokeSessions
                ? "Gotowe. Użytkownicy muszą zalogować się ponownie."
                : "Gotowe. Plan FREE pojawi się po ponownym otwarciu ustawień rozszerzenia.",
        );
    }
    if (failures > 0) process.exitCode = 1;
}

if (require.main === module) {
    void main().catch((error) => {
        console.error("Nie udało się usunąć planów:", error);
        process.exitCode = 1;
    });
}

module.exports = {
    SUBSCRIPTION_FIELDS,
    describeState,
    parseArgs,
    removePlanClaim,
    removeUserPlan,
};
