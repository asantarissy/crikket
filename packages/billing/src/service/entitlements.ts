import { db } from "@crikket/db"
import { member } from "@crikket/db/schema/auth"
import {
  organizationBillingAccount,
  organizationEntitlement,
} from "@crikket/db/schema/billing"
import { env } from "@crikket/env/server"
import { reportNonFatalError } from "@crikket/shared/lib/errors"
import { count, eq } from "drizzle-orm"

import { polarClient } from "../lib/payments"
import {
  ACTIVE_PAID_SUBSCRIPTION_STATUSES,
  BILLING_PLAN,
  type BillingPlan,
  type BillingPlanLimitSnapshot,
  deserializeEntitlements,
  type EntitlementSnapshot,
  getBillingDisabledEntitlements,
  getBillingDisabledPlanLimitsSnapshot,
  getBillingPlanLimitsSnapshot,
  normalizeBillingPlan,
  normalizeBillingSubscriptionStatus,
  resolveEntitlements,
  serializeEntitlements,
} from "../model"
import { resolvePlanFromProductId } from "./polar-payload"
import type {
  BillingProjectionInput,
  OrganizationBillingSnapshot,
} from "./types"
import { asRecord } from "./utils"

export function upsertOrganizationBillingProjection(
  input: BillingProjectionInput
): Promise<EntitlementSnapshot> {
  return db.transaction(async (tx) => {
    const [existingBillingAccount, existingEntitlementRow] = await Promise.all([
      tx.query.organizationBillingAccount.findFirst({
        where: eq(
          organizationBillingAccount.organizationId,
          input.organizationId
        ),
        columns: {
          plan: true,
          subscriptionStatus: true,
        },
      }),
      tx.query.organizationEntitlement.findFirst({
        where: eq(organizationEntitlement.organizationId, input.organizationId),
        columns: {
          entitlements: true,
        },
      }),
    ])

    const nextPlan = normalizeBillingPlan(
      input.plan ?? existingBillingAccount?.plan
    )
    const nextSubscriptionStatus = normalizeBillingSubscriptionStatus(
      input.subscriptionStatus ?? existingBillingAccount?.subscriptionStatus
    )
    const entitlements = resolveEntitlements({
      plan: nextPlan,
      subscriptionStatus: nextSubscriptionStatus,
    })
    const nextEntitlementsPayload = {
      ...(asRecord(existingEntitlementRow?.entitlements) ?? {}),
      ...serializeEntitlements(entitlements),
    }

    await tx
      .insert(organizationBillingAccount)
      .values({
        organizationId: input.organizationId,
        provider: "polar",
        polarCustomerId: input.polarCustomerId,
        polarSubscriptionId: input.polarSubscriptionId,
        plan: nextPlan,
        subscriptionStatus: nextSubscriptionStatus,
        currentPeriodStart: input.currentPeriodStart,
        currentPeriodEnd: input.currentPeriodEnd,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
        lastWebhookAt: new Date(),
      })
      .onConflictDoUpdate({
        target: organizationBillingAccount.organizationId,
        set: {
          polarCustomerId:
            input.polarCustomerId ?? organizationBillingAccount.polarCustomerId,
          polarSubscriptionId:
            input.polarSubscriptionId ??
            organizationBillingAccount.polarSubscriptionId,
          plan: nextPlan,
          subscriptionStatus: nextSubscriptionStatus,
          currentPeriodStart:
            input.currentPeriodStart ??
            organizationBillingAccount.currentPeriodStart,
          currentPeriodEnd:
            input.currentPeriodEnd ??
            organizationBillingAccount.currentPeriodEnd,
          cancelAtPeriodEnd:
            input.cancelAtPeriodEnd ??
            organizationBillingAccount.cancelAtPeriodEnd,
          lastWebhookAt: new Date(),
          updatedAt: new Date(),
        },
      })

    await tx
      .insert(organizationEntitlement)
      .values({
        organizationId: input.organizationId,
        plan: entitlements.plan,
        entitlements: nextEntitlementsPayload,
        lastComputedAt: new Date(),
        source: input.source ?? "reconciliation",
      })
      .onConflictDoUpdate({
        target: organizationEntitlement.organizationId,
        set: {
          plan: entitlements.plan,
          entitlements: nextEntitlementsPayload,
          lastComputedAt: new Date(),
          source: input.source ?? "reconciliation",
          updatedAt: new Date(),
        },
      })

    return entitlements
  })
}

export async function getOrganizationEntitlements(
  organizationId: string
): Promise<EntitlementSnapshot> {
  if (!env.ENABLE_PAYMENTS) {
    return getBillingDisabledEntitlements()
  }

  const [billingRow, row] = await Promise.all([
    db.query.organizationBillingAccount.findFirst({
      where: eq(organizationBillingAccount.organizationId, organizationId),
      columns: {
        plan: true,
        subscriptionStatus: true,
      },
    }),
    db.query.organizationEntitlement.findFirst({
      where: eq(organizationEntitlement.organizationId, organizationId),
      columns: {
        entitlements: true,
      },
    }),
  ])
  const effectiveEntitlements = resolveEntitlements({
    plan: normalizeBillingPlan(billingRow?.plan),
    subscriptionStatus: normalizeBillingSubscriptionStatus(
      billingRow?.subscriptionStatus
    ),
  })

  if (row) {
    return deserializeEntitlements(effectiveEntitlements.plan, row.entitlements)
  }

  return effectiveEntitlements
}

type BillingSnapshotRow = {
  plan: string
  subscriptionStatus: string
  polarCustomerId: string | null
  polarSubscriptionId: string | null
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
}

type RecoverableBillingSnapshotRow = BillingSnapshotRow & {
  polarSubscriptionId: string
}

type PolarSubscription = Awaited<
  ReturnType<typeof polarClient.subscriptions.get>
>

function isActivePaidSubscriptionStatus(status: unknown): boolean {
  return ACTIVE_PAID_SUBSCRIPTION_STATUSES.has(
    normalizeBillingSubscriptionStatus(status)
  )
}

function resolveSubscriptionRecencyScore(
  subscription: PolarSubscription
): number {
  const periodEnd = subscription.currentPeriodEnd?.getTime() ?? 0
  if (periodEnd > 0) {
    return periodEnd
  }

  return subscription.currentPeriodStart.getTime()
}

function selectMostRecentActiveSubscription(
  subscriptions: PolarSubscription[]
): PolarSubscription | null {
  if (subscriptions.length === 0) {
    return null
  }

  return subscriptions.reduce((latest, current) => {
    const latestScore = resolveSubscriptionRecencyScore(latest)
    const currentScore = resolveSubscriptionRecencyScore(current)
    return currentScore > latestScore ? current : latest
  })
}

function canRecoverBillingSnapshotFromSubscription(
  billingRow: BillingSnapshotRow | undefined
): billingRow is RecoverableBillingSnapshotRow {
  if (!(env.ENABLE_PAYMENTS && billingRow?.polarSubscriptionId)) {
    return false
  }

  return !(
    billingRow.currentPeriodStart &&
    billingRow.currentPeriodEnd &&
    billingRow.polarCustomerId
  )
}

function shouldRecoverBillingSnapshotFromMetadata(
  billingRow: BillingSnapshotRow | undefined
): boolean {
  if (!env.ENABLE_PAYMENTS) {
    return false
  }

  if (!billingRow) {
    return true
  }

  const normalizedPlan = normalizeBillingPlan(billingRow.plan)
  const normalizedStatus = normalizeBillingSubscriptionStatus(
    billingRow.subscriptionStatus
  )
  const hasCompleteSubscriptionPointers = Boolean(
    billingRow.polarSubscriptionId &&
      billingRow.polarCustomerId &&
      billingRow.currentPeriodStart &&
      billingRow.currentPeriodEnd
  )

  return !(
    normalizedPlan !== BILLING_PLAN.free &&
    ACTIVE_PAID_SUBSCRIPTION_STATUSES.has(normalizedStatus) &&
    hasCompleteSubscriptionPointers
  )
}

async function recoverBillingSnapshotFromSubscription(input: {
  organizationId: string
  billingRow: RecoverableBillingSnapshotRow
}): Promise<{
  billingRow: BillingSnapshotRow
  entitlements: EntitlementSnapshot
} | null> {
  try {
    const subscription = await polarClient.subscriptions.get({
      id: input.billingRow.polarSubscriptionId,
    })
    const recoveredPlan =
      resolvePlanFromProductId(subscription.productId) ??
      normalizeBillingPlan(input.billingRow.plan)
    const recoveredSubscriptionStatus = normalizeBillingSubscriptionStatus(
      subscription.status
    )

    const entitlements = await upsertOrganizationBillingProjection({
      organizationId: input.organizationId,
      plan: recoveredPlan,
      subscriptionStatus: recoveredSubscriptionStatus,
      polarCustomerId:
        subscription.customerId ??
        input.billingRow.polarCustomerId ??
        undefined,
      polarSubscriptionId:
        subscription.id ?? input.billingRow.polarSubscriptionId,
      currentPeriodStart:
        subscription.currentPeriodStart ??
        input.billingRow.currentPeriodStart ??
        undefined,
      currentPeriodEnd:
        subscription.currentPeriodEnd ??
        input.billingRow.currentPeriodEnd ??
        undefined,
      cancelAtPeriodEnd:
        subscription.cancelAtPeriodEnd ??
        input.billingRow.cancelAtPeriodEnd ??
        false,
      source: "snapshot-recovery",
    })

    return {
      entitlements,
      billingRow: {
        ...input.billingRow,
        plan: recoveredPlan,
        subscriptionStatus: recoveredSubscriptionStatus,
        polarCustomerId:
          subscription.customerId ?? input.billingRow.polarCustomerId,
        polarSubscriptionId:
          subscription.id ?? input.billingRow.polarSubscriptionId,
        currentPeriodStart:
          subscription.currentPeriodStart ??
          input.billingRow.currentPeriodStart,
        currentPeriodEnd:
          subscription.currentPeriodEnd ?? input.billingRow.currentPeriodEnd,
        cancelAtPeriodEnd:
          subscription.cancelAtPeriodEnd ??
          input.billingRow.cancelAtPeriodEnd ??
          false,
      },
    }
  } catch (error) {
    reportNonFatalError(
      "Failed to recover organization billing snapshot from subscription",
      error
    )
    return null
  }
}

async function recoverBillingSnapshotFromMetadata(input: {
  organizationId: string
  billingRow: BillingSnapshotRow | undefined
}): Promise<{
  billingRow: BillingSnapshotRow
  entitlements: EntitlementSnapshot
} | null> {
  try {
    const page = await polarClient.subscriptions.list({
      active: true,
      limit: 100,
      metadata: { referenceId: input.organizationId },
    })
    const paidSubscriptions = page.result.items.filter((subscription) =>
      isActivePaidSubscriptionStatus(subscription.status)
    )
    const activeSubscription =
      selectMostRecentActiveSubscription(paidSubscriptions)
    if (!activeSubscription) {
      return null
    }

    const recoveredPlan =
      resolvePlanFromProductId(activeSubscription.productId) ??
      normalizeBillingPlan(input.billingRow?.plan)
    const recoveredSubscriptionStatus = normalizeBillingSubscriptionStatus(
      activeSubscription.status
    )
    const entitlements = await upsertOrganizationBillingProjection({
      organizationId: input.organizationId,
      plan: recoveredPlan,
      subscriptionStatus: recoveredSubscriptionStatus,
      polarCustomerId: activeSubscription.customerId,
      polarSubscriptionId: activeSubscription.id,
      currentPeriodStart: activeSubscription.currentPeriodStart,
      currentPeriodEnd: activeSubscription.currentPeriodEnd ?? undefined,
      cancelAtPeriodEnd: activeSubscription.cancelAtPeriodEnd,
      source: "snapshot-recovery",
    })

    return {
      entitlements,
      billingRow: {
        plan: recoveredPlan,
        subscriptionStatus: recoveredSubscriptionStatus,
        polarCustomerId: activeSubscription.customerId,
        polarSubscriptionId: activeSubscription.id,
        currentPeriodStart: activeSubscription.currentPeriodStart,
        currentPeriodEnd: activeSubscription.currentPeriodEnd,
        cancelAtPeriodEnd: activeSubscription.cancelAtPeriodEnd,
      },
    }
  } catch (error) {
    reportNonFatalError(
      "Failed to recover organization billing snapshot from metadata",
      error
    )
    return null
  }
}

export async function getOrganizationBillingSnapshot(
  organizationId: string
): Promise<OrganizationBillingSnapshot> {
  const [billingRow, memberCountResult] = await Promise.all([
    db.query.organizationBillingAccount.findFirst({
      where: eq(organizationBillingAccount.organizationId, organizationId),
      columns: {
        plan: true,
        subscriptionStatus: true,
        polarCustomerId: true,
        polarSubscriptionId: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
      },
    }),
    db
      .select({ value: count() })
      .from(member)
      .where(eq(member.organizationId, organizationId)),
  ])

  let resolvedBillingRow = billingRow
  let resolvedEntitlement: EntitlementSnapshot | null = null

  if (canRecoverBillingSnapshotFromSubscription(billingRow)) {
    const recovery = await recoverBillingSnapshotFromSubscription({
      organizationId,
      billingRow,
    })
    if (recovery) {
      resolvedBillingRow = recovery.billingRow
      resolvedEntitlement = recovery.entitlements
    }
  }

  if (
    !resolvedEntitlement &&
    shouldRecoverBillingSnapshotFromMetadata(resolvedBillingRow)
  ) {
    const metadataRecovery = await recoverBillingSnapshotFromMetadata({
      organizationId,
      billingRow: resolvedBillingRow,
    })
    if (metadataRecovery) {
      resolvedBillingRow = metadataRecovery.billingRow
      resolvedEntitlement = metadataRecovery.entitlements
    }
  }

  const entitlement =
    resolvedEntitlement ?? (await getOrganizationEntitlements(organizationId))

  return {
    organizationId,
    plan: entitlement.plan,
    subscriptionStatus: normalizeBillingSubscriptionStatus(
      resolvedBillingRow?.subscriptionStatus
    ),
    currentPeriodStart: resolvedBillingRow?.currentPeriodStart ?? null,
    currentPeriodEnd: resolvedBillingRow?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: resolvedBillingRow?.cancelAtPeriodEnd ?? false,
    memberCount: memberCountResult[0]?.value ?? 0,
    entitlements: entitlement,
  }
}

export function getBillingPlanLimits(): Record<
  BillingPlan,
  BillingPlanLimitSnapshot
> {
  if (!env.ENABLE_PAYMENTS) {
    return getBillingDisabledPlanLimitsSnapshot()
  }

  return getBillingPlanLimitsSnapshot()
}

export async function recomputeOrganizationEntitlements(
  organizationId: string
) {
  const billingRow = await db.query.organizationBillingAccount.findFirst({
    where: eq(organizationBillingAccount.organizationId, organizationId),
    columns: {
      plan: true,
      subscriptionStatus: true,
      polarCustomerId: true,
      polarSubscriptionId: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      cancelAtPeriodEnd: true,
    },
  })

  const plan = normalizeBillingPlan(billingRow?.plan)
  const subscriptionStatus = normalizeBillingSubscriptionStatus(
    billingRow?.subscriptionStatus
  )
  const entitlements = await upsertOrganizationBillingProjection({
    organizationId,
    plan,
    subscriptionStatus,
    polarCustomerId: billingRow?.polarCustomerId ?? undefined,
    polarSubscriptionId: billingRow?.polarSubscriptionId ?? undefined,
    currentPeriodStart: billingRow?.currentPeriodStart ?? undefined,
    currentPeriodEnd: billingRow?.currentPeriodEnd ?? undefined,
    cancelAtPeriodEnd: billingRow?.cancelAtPeriodEnd ?? false,
    source: "manual-recompute",
  })

  return {
    organizationId,
    plan,
    subscriptionStatus,
    entitlements,
  }
}

export async function assertOrganizationCanAddMembers(
  organizationId: string,
  incomingMembers = 1
): Promise<void> {
  const entitlements = await getOrganizationEntitlements(organizationId)
  const memberCap = entitlements.memberCap

  if (memberCap === null) {
    return
  }

  const memberCountResult = await db
    .select({ value: count() })
    .from(member)
    .where(eq(member.organizationId, organizationId))
  const memberCount = memberCountResult[0]?.value ?? 0

  if (memberCount + incomingMembers <= memberCap) {
    return
  }

  if (entitlements.plan === BILLING_PLAN.pro) {
    throw new Error(
      `Pro plan supports up to ${memberCap} members. Upgrade to Studio to add more teammates.`
    )
  }

  if (entitlements.plan === BILLING_PLAN.free) {
    throw new Error("Upgrade to Pro to invite teammates to this organization.")
  }

  throw new Error("Organization member limit reached.")
}
