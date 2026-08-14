const test = require("node:test");
const assert = require("node:assert/strict");
const {
    SUBSCRIPTION_FIELDS,
    describeState,
    parseArgs,
    removePlanClaim,
    removeUserPlan,
} = require("./remove-user-plan");

test("accepts multiple UID/email identifiers and removes duplicates", () => {
    assert.deepEqual(parseArgs(["uid-1,uid-2", "person@example.com", "uid-1"]), {
        dryRun: false,
        revokeSessions: false,
        help: false,
        identifiers: ["uid-1", "uid-2", "person@example.com"],
    });
});

test("parses safe preview and session revocation options", () => {
    const parsed = parseArgs(["--dry-run", "--revoke-sessions", "uid-1"]);
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.revokeSessions, true);
    assert.deepEqual(parsed.identifiers, ["uid-1"]);
});

test("removes only the plan custom claim", () => {
    assert.deepEqual(
        removePlanClaim({ plan: "pro", admin: true, organization: "test" }),
        { admin: true, organization: "test" },
    );
});

test("dry-run description reports all matching data sources", () => {
    const description = describeState(
        {
            uid: "uid-1",
            email: "person@example.com",
            controlDocumentExists: true,
            hasPlanClaim: true,
            profileFields: ["plan", "stripeCustomerId"],
        },
        true,
    );
    assert.match(description, /^\[DRY RUN\] uid-1 \(person@example\.com\)/);
    assert.match(description, /subscriptionPlans/);
    assert.match(description, /Auth claim plan/);
});

test("removes the control document, subscription fields and only the plan claim", async () => {
    const deleted = Symbol("deleted-field");
    const actions = [];
    const customClaimWrites = [];
    const snapshots = {
        subscriptionPlans: { exists: true, data: () => ({ plan: "pro" }) },
        users: {
            exists: true,
            data: () => ({ plan: "pro", stripeCustomerId: "cus_1", nickname: "Ada" }),
        },
    };
    const db = {
        collection(name) {
            return {
                doc(uid) {
                    return {
                        name,
                        uid,
                        get: async () => snapshots[name],
                    };
                },
            };
        },
        async runTransaction(callback) {
            return callback({
                get: async (ref) => snapshots[ref.name],
                delete: (ref) => actions.push({ type: "delete", ref }),
                update: (ref, data) => actions.push({ type: "update", ref, data }),
            });
        },
    };
    const firestore = () => db;
    firestore.FieldValue = { delete: () => deleted };
    const auth = {
        getUser: async (uid) => ({
            uid,
            email: "ada@example.com",
            customClaims: { plan: "pro", admin: true },
        }),
        setCustomUserClaims: async (uid, claims) => customClaimWrites.push({ uid, claims }),
    };
    const adminSdk = { auth: () => auth, firestore };

    await removeUserPlan(adminSdk, "uid-1");

    assert.deepEqual(customClaimWrites, [{ uid: "uid-1", claims: { admin: true } }]);
    assert.equal(actions[0].type, "delete");
    assert.equal(actions[0].ref.name, "subscriptionPlans");
    assert.equal(actions[1].type, "update");
    assert.equal(actions[1].ref.name, "users");
    assert.deepEqual(Object.keys(actions[1].data), SUBSCRIPTION_FIELDS);
    assert.ok(Object.values(actions[1].data).every((value) => value === deleted));
});
