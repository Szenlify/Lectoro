export type SubscriptionPlan = "free" | "basic" | "pro";
export type SubscriptionStatus =
    | "active"
    | "trialing"
    | "inactive"
    | "incomplete"
    | "incomplete_expired"
    | "past_due"
    | "unpaid"
    | "paused"
    | "canceled";
export type SubscriptionFeature = "ai" | "srs" | "elevenLabs";

export interface LectoroAuthClaims {
    plan?: SubscriptionPlan;
}

export interface MonthlyUsage {
    month: string; // YYYY-MM in UTC
    used: number;
}

export interface UserSubscriptionUsage {
    ai: MonthlyUsage;
    elevenLabsCharacters: MonthlyUsage;
}

/** Shape of the subscription-related fields in Firestore users/{uid}. */
export interface UserProfile {
    uid: string;
    email: string;
    displayName?: string;
    plan: SubscriptionPlan;
    subscriptionStatus: SubscriptionStatus;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    stripeCancelAtPeriodEnd?: boolean;
    stripeCurrentPeriodEnd?: unknown;
    aiCallsThisMonth: number;
    aiCallsResetDate: string;
    elevenLabsCharactersThisMonth: number;
    elevenLabsResetDate: string;
}

/** Safe profile cached in the extension (without Stripe identifiers). */
export interface SubscriptionProfile {
    uid: string;
    plan: SubscriptionPlan;
    subscriptionStatus: SubscriptionStatus;
    usage: UserSubscriptionUsage;
    updatedAt: number;
}

export interface LimitValidationResult {
    allowed: boolean;
    code: string | null;
    feature: SubscriptionFeature;
    plan: SubscriptionPlan;
    limit: number;
    used: number;
    requested: number;
    remaining: number;
    upgradeRequired: boolean;
    message: string;
}
