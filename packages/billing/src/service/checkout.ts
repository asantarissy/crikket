import { db } from "@crikket/db"
import { user } from "@crikket/db/schema/auth"
import { organizationBillingAccount } from "@crikket/db/schema/billing"
import { env } from "@crikket/env/server"
import { reportNonFatalError } from "@crikket/shared/lib/errors"
import { ORPCError } from "@orpc/server"
import { eq } from "drizzle-orm"
import { polarClient } from "../lib/payments"
import {
  ACTIVE_PAID_SUBSCRIPTION_STATUSES,
  type BillingPlan,
  normalizeBillingPlan,
  normalizeBillingSubscriptionStatus,
} from "../model"
import { assertUserCanManageOrganizationBilling } from "./access"
import { upsertOrganizationBillingProjection } from "./entitlements"
import {
  extractReferenceIdFromMetadata,
  resolvePlanFromProductId,
} from "./polar-payload"
import type { ChangeOrganizationPlanResult } from "./types"
import { getErrorMessage, isPolarResourceNotFoundError } from "./utils"
import { findWebhookBillingBackfill } from "./webhooks"

type BillingInterval = "monthly" | "yearly"

function resolveProductIdByPlan(input: {
  plan: Exclude<BillingPlan, "free">
  billingInterval: BillingInterval
}): string {
  const productId =
    input.plan === "studio"
      ? input.billingInterval === "yearly"
        ? env.POLAR_STUDIO_YEARLY_PRODUCT_ID
        : env.POLAR_STUDIO_PRODUCT_ID
      : input.billingInterval === "yearly"
        ? env.POLAR_PRO_YEARLY_PRODUCT_ID
        : env.POLAR_PRO_PRODUCT_ID

  if (!productId) {
    const productPeriodSuffix =
      input.billingInterval === "yearly" ? "_YEARLY" : ""
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: `POLAR_${input.plan.toUpperCase()}${productPeriodSuffix}_PRODUCT_ID is not configured.`,
    })
  }

  return productId
}

function assertPaymentsEnabled(): void {
  if (env.ENABLE_PAYMENTS) {
    return
  }

  throw new ORPCError("BAD_REQUEST", {
    message: "Payments are disabled in this deployment.",
  })
}

type OrganizationBillingAccountSnapshot = {
  polarCustomerId: string | null
  polarSubscriptionId: string | null
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean | null
}

type PolarSubscription = Awaited<
  ReturnType<typeof polarClient.subscriptions.get>
>

type PolarCustomer = Awaited<
  ReturnType<typeof polarClient.customers.getExternal>
>

type BillingUserProfile = {
  email: string
  name: string
}

type ActiveSubscriptionListFilter =
  | { customerId: string }
  | { externalCustomerId: string }
  | { metadata: { referenceId: string } }

const EMPTY_BILLING_ACCOUNT_SNAPSHOT: OrganizationBillingAccountSnapshot = {
  polarCustomerId: null,
  polarSubscriptionId: null,
  currentPeriodStart: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: null,
}

function isActivePaidSubscriptionStatus(status: unknown): boolean {
  return ACTIVE_PAID_SUBSCRIPTION_STATUSES.has(
    normalizeBillingSubscriptionStatus(status)
  )
}

function isSubscriptionBoundToOrganization(
  subscription: {
    metadata: unknown
    customer: { externalId: string | null }
  },
  organizationId: string
): boolean {
  const referenceId = extractReferenceIdFromMetadata(subscription.metadata)
  if (referenceId === organizationId) {
    return true
  }

  return subscription.customer.externalId === organizationId
}

function isPolarCustomerEmailAlreadyExistsError(error: unknown): boolean {
  const message = getErrorMessage(error, "")
  if (message.includes("already exists") && message.includes("email")) {
    return true
  }

  if (!error || typeof error !== "object") {
    return false
  }

  const detail =
    "detail" in error && Array.isArray(error.detail) ? error.detail : null
  if (!detail) {
    return false
  }

  return detail.some((entry) => {
    if (!entry || typeof entry !== "object") {
      return false
    }

    const loc = "loc" in entry && Array.isArray(entry.loc) ? entry.loc : []
    const msg = "msg" in entry && typeof entry.msg === "string" ? entry.msg : ""

    return loc.includes("email") && msg.includes("already exists")
  })
}

async function findUpdatableSubscription(input: {
  organizationId: string
  billingAccount?: OrganizationBillingAccountSnapshot | null
}) {
  const organizationBillingAccountSnapshot =
    input.billingAccount ?? EMPTY_BILLING_ACCOUNT_SNAPSHOT

  const candidateSubscription = await findCandidateSubscriptionById({
    billingAccount: organizationBillingAccountSnapshot,
    organizationId: input.organizationId,
  })
  if (candidateSubscription) {
    return candidateSubscription
  }

  const metadataMatchedSubscription =
    await findOrganizationSubscriptionByMetadata(input.organizationId)
  if (metadataMatchedSubscription) {
    return metadataMatchedSubscription
  }

  const listFilters: ActiveSubscriptionListFilter[] = []
  if (organizationBillingAccountSnapshot.polarCustomerId) {
    listFilters.push({
      customerId: organizationBillingAccountSnapshot.polarCustomerId,
    })
  }
  listFilters.push({ externalCustomerId: input.organizationId })

  const activeSubscriptions =
    await listActiveSubscriptionsByFilters(listFilters)

  const orgMatchedSubscription = activeSubscriptions.find((subscription) =>
    isSubscriptionBoundToOrganization(subscription, input.organizationId)
  )

  return orgMatchedSubscription ?? null
}

async function findCandidateSubscriptionById(input: {
  billingAccount: OrganizationBillingAccountSnapshot
  organizationId: string
}): Promise<PolarSubscription | null> {
  const { billingAccount, organizationId } = input
  const candidateSubscriptionId = billingAccount.polarSubscriptionId
  if (!candidateSubscriptionId) {
    return null
  }

  try {
    const subscription = await polarClient.subscriptions.get({
      id: candidateSubscriptionId,
    })
    if (!isActivePaidSubscriptionStatus(subscription.status)) {
      return null
    }

    if (isSubscriptionBoundToOrganization(subscription, organizationId)) {
      return subscription
    }

    return null
  } catch (error) {
    if (!isPolarResourceNotFoundError(error)) {
      throw error
    }

    return null
  }
}

async function listActiveSubscriptionsByFilters(
  listFilters: ActiveSubscriptionListFilter[]
): Promise<PolarSubscription[]> {
  const activeSubscriptions: PolarSubscription[] = []
  const seenSubscriptionIds = new Set<string>()

  for (const listFilter of listFilters) {
    const page = await polarClient.subscriptions.list({
      ...listFilter,
      active: true,
      limit: 100,
    })

    for (const subscription of page.result.items) {
      if (!isActivePaidSubscriptionStatus(subscription.status)) {
        continue
      }

      if (seenSubscriptionIds.has(subscription.id)) {
        continue
      }

      seenSubscriptionIds.add(subscription.id)
      activeSubscriptions.push(subscription)
    }
  }

  return activeSubscriptions
}

async function findOrganizationSubscriptionByMetadata(
  organizationId: string
): Promise<PolarSubscription | null> {
  const subscriptions = await listActiveSubscriptionsByFilters([
    { metadata: { referenceId: organizationId } },
  ])

  return subscriptions[0] ?? null
}

async function findPolarCustomerByEmail(
  email: string
): Promise<PolarCustomer | null> {
  const page = await polarClient.customers.list({
    email,
    limit: 10,
  })

  const exactMatch = page.result.items.find(
    (customer) => customer.email.toLowerCase() === email.toLowerCase()
  )

  return exactMatch ?? page.result.items[0] ?? null
}

function resolveDisplayName(name: string): string | null {
  const normalized = name.trim()
  return normalized.length > 0 ? normalized : null
}

async function getBillingUserProfile(
  userId: string
): Promise<BillingUserProfile> {
  const billingUser = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: {
      email: true,
      name: true,
    },
  })

  if (!billingUser) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Unable to resolve billing user for checkout.",
    })
  }

  return {
    email: billingUser.email,
    name: billingUser.name,
  }
}

async function getOrCreatePolarCustomerForUser(input: {
  userId: string
  userEmail: string
  userName: string | null
}): Promise<PolarCustomer> {
  try {
    return await polarClient.customers.getExternal({
      externalId: input.userId,
    })
  } catch (error) {
    if (!isPolarResourceNotFoundError(error)) {
      throw error
    }
  }

  try {
    return await polarClient.customers.create({
      externalId: input.userId,
      email: input.userEmail,
      name: input.userName,
    })
  } catch (error) {
    if (!isPolarCustomerEmailAlreadyExistsError(error)) {
      throw error
    }

    const existingCustomer = await findPolarCustomerByEmail(input.userEmail)
    if (!existingCustomer) {
      throw error
    }

    return existingCustomer
  }
}

async function syncPolarCustomerProfile(input: {
  customer: PolarCustomer
  userEmail: string
  userName: string | null
}): Promise<PolarCustomer> {
  const shouldSyncCustomerProfile =
    input.customer.email !== input.userEmail ||
    (input.customer.name ?? null) !== input.userName
  if (!shouldSyncCustomerProfile) {
    return input.customer
  }

  try {
    return await polarClient.customers.update({
      id: input.customer.id,
      customerUpdate: {
        email: input.userEmail,
        name: input.userName,
      },
    })
  } catch (error) {
    reportNonFatalError(
      "Failed to sync Polar customer profile before checkout",
      error
    )
    return input.customer
  }
}

async function resolvePolarCustomerForUser(
  userId: string
): Promise<{ customer: PolarCustomer; userEmail: string; userName: string }> {
  const billingUser = await getBillingUserProfile(userId)
  const userName = resolveDisplayName(billingUser.name)

  const customer = await getOrCreatePolarCustomerForUser({
    userId,
    userEmail: billingUser.email,
    userName,
  })
  const syncedCustomer = await syncPolarCustomerProfile({
    customer,
    userEmail: billingUser.email,
    userName,
  })

  return {
    customer: syncedCustomer,
    userEmail: billingUser.email,
    userName: userName ?? "",
  }
}

async function createPortalSessionByExternalCustomerIds(input: {
  externalCustomerIds: string[]
  returnUrl?: string
}): Promise<{ url: string | null; failures: string[] }> {
  const failures: string[] = []

  for (const externalCustomerId of input.externalCustomerIds) {
    try {
      const customerSession = await polarClient.customerSessions.create({
        externalCustomerId,
        returnUrl: input.returnUrl,
      })

      return { url: customerSession.customerPortalUrl, failures }
    } catch (error) {
      failures.push(
        `external customer portal lookup failed for ${externalCustomerId} (${getErrorMessage(error, "unknown error")})`
      )
    }
  }

  return { url: null, failures }
}

type PortalResolutionState = {
  customerId: string | null
  subscriptionId: string | null
  recoveryFailures: string[]
}

function createPortalResolutionState(input: {
  billingAccount: OrganizationBillingAccountSnapshot | null
}): PortalResolutionState {
  return {
    customerId: input.billingAccount?.polarCustomerId ?? null,
    subscriptionId: input.billingAccount?.polarSubscriptionId ?? null,
    recoveryFailures: [],
  }
}

async function recoverPortalStateFromWebhookBackfill(input: {
  organizationId: string
  state: PortalResolutionState
}): Promise<void> {
  if (input.state.customerId && input.state.subscriptionId) {
    return
  }

  const webhookBackfill = await findWebhookBillingBackfill(input.organizationId)
  if (!webhookBackfill) {
    return
  }

  input.state.customerId =
    input.state.customerId ?? webhookBackfill.polarCustomerId ?? null
  input.state.subscriptionId =
    input.state.subscriptionId ?? webhookBackfill.polarSubscriptionId ?? null

  await upsertOrganizationBillingProjection({
    organizationId: input.organizationId,
    plan: webhookBackfill.plan,
    subscriptionStatus: webhookBackfill.subscriptionStatus,
    polarCustomerId: webhookBackfill.polarCustomerId,
    polarSubscriptionId: webhookBackfill.polarSubscriptionId,
    currentPeriodStart: webhookBackfill.currentPeriodStart,
    currentPeriodEnd: webhookBackfill.currentPeriodEnd,
    cancelAtPeriodEnd: webhookBackfill.cancelAtPeriodEnd,
    source: "portal-recovery",
  })
}

async function recoverPortalStateFromStoredSubscription(input: {
  organizationId: string
  state: PortalResolutionState
}): Promise<void> {
  if (!input.state.subscriptionId) {
    return
  }

  try {
    const subscription = await polarClient.subscriptions.get({
      id: input.state.subscriptionId,
    })

    if (isSubscriptionBoundToOrganization(subscription, input.organizationId)) {
      input.state.customerId = subscription.customerId ?? input.state.customerId
      return
    }

    input.state.subscriptionId = null
    input.state.customerId = null
    input.state.recoveryFailures.push(
      "stored subscription is not scoped to the active organization"
    )
  } catch (error) {
    input.state.recoveryFailures.push(
      `subscription lookup failed (${getErrorMessage(error, "unknown error")})`
    )
  }
}

async function recoverPortalStateFromOrganizationSubscription(input: {
  organizationId: string
  billingAccount: OrganizationBillingAccountSnapshot | null
  state: PortalResolutionState
}): Promise<void> {
  if (input.state.customerId && input.state.subscriptionId) {
    return
  }

  const organizationSubscription = await findUpdatableSubscription({
    organizationId: input.organizationId,
    billingAccount: input.billingAccount,
  }).catch((error) => {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: getErrorMessage(
        error,
        "Failed to resolve organization subscription"
      ),
    })
  })

  if (!organizationSubscription) {
    return
  }

  const resolvedPlan = normalizeBillingPlan(
    resolvePlanFromProductId(organizationSubscription.productId)
  )
  const resolvedStatus = normalizeBillingSubscriptionStatus(
    organizationSubscription.status
  )

  input.state.customerId = organizationSubscription.customerId
  input.state.subscriptionId = organizationSubscription.id

  await upsertOrganizationBillingProjection({
    organizationId: input.organizationId,
    plan: resolvedPlan,
    subscriptionStatus: resolvedStatus,
    polarCustomerId: organizationSubscription.customerId ?? undefined,
    polarSubscriptionId: organizationSubscription.id,
    currentPeriodStart: organizationSubscription.currentPeriodStart,
    currentPeriodEnd: organizationSubscription.currentPeriodEnd ?? undefined,
    cancelAtPeriodEnd: organizationSubscription.cancelAtPeriodEnd,
    source: "portal-recovery",
  })
}

export async function createOrganizationCheckoutSession(input: {
  organizationId: string
  plan: "pro" | "studio"
  billingInterval?: BillingInterval
  userId: string
}): Promise<{ url: string }> {
  assertPaymentsEnabled()

  await assertUserCanManageOrganizationBilling({
    organizationId: input.organizationId,
    userId: input.userId,
  })

  if (!env.POLAR_SUCCESS_URL) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "POLAR_SUCCESS_URL is not configured.",
    })
  }

  const billingInterval = input.billingInterval ?? "monthly"
  const productId = resolveProductIdByPlan({
    plan: input.plan,
    billingInterval,
  })

  try {
    const { customer, userEmail, userName } = await resolvePolarCustomerForUser(
      input.userId
    )

    const checkout = await polarClient.checkouts.create({
      customerEmail: userEmail,
      customerId: customer.id,
      customerName: userName.length > 0 ? userName : null,
      products: [productId],
      successUrl: env.POLAR_SUCCESS_URL,
      metadata: {
        billingInterval,
        initiatedByUserId: input.userId,
        plan: input.plan,
        referenceId: input.organizationId,
        source: "crikket-billing-checkout",
      },
    })

    return { url: checkout.url }
  } catch (error) {
    const message = getErrorMessage(error, "Failed to create checkout session")

    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message,
    })
  }
}

export async function changeOrganizationPlan(input: {
  organizationId: string
  plan: "pro" | "studio"
  billingInterval?: BillingInterval
  userId: string
}): Promise<ChangeOrganizationPlanResult> {
  assertPaymentsEnabled()

  await assertUserCanManageOrganizationBilling({
    organizationId: input.organizationId,
    userId: input.userId,
  })

  const billingAccount = await db.query.organizationBillingAccount.findFirst({
    where: eq(organizationBillingAccount.organizationId, input.organizationId),
    columns: {
      polarCustomerId: true,
      polarSubscriptionId: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      cancelAtPeriodEnd: true,
    },
  })

  const nextPlan = normalizeBillingPlan(input.plan)
  const billingInterval = input.billingInterval ?? "monthly"
  const targetProductId = resolveProductIdByPlan({
    plan: input.plan,
    billingInterval,
  })

  const updatableSubscription = await findUpdatableSubscription({
    organizationId: input.organizationId,
    billingAccount,
  }).catch((error) => {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: getErrorMessage(
        error,
        "Failed to resolve existing subscription"
      ),
    })
  })

  if (!updatableSubscription) {
    const checkout = await createOrganizationCheckoutSession({
      billingInterval,
      organizationId: input.organizationId,
      plan: input.plan,
      userId: input.userId,
    })

    return {
      action: "checkout_required",
      plan: nextPlan,
      url: checkout.url,
    }
  }

  const currentPlan = normalizeBillingPlan(
    resolvePlanFromProductId(updatableSubscription.productId)
  )
  const isSamePlanAndCadence =
    currentPlan === nextPlan &&
    updatableSubscription.productId === targetProductId

  if (isSamePlanAndCadence) {
    const resolvedSubscriptionStatus = normalizeBillingSubscriptionStatus(
      updatableSubscription.status
    )

    await upsertOrganizationBillingProjection({
      organizationId: input.organizationId,
      plan: currentPlan,
      subscriptionStatus: resolvedSubscriptionStatus,
      polarCustomerId:
        updatableSubscription.customerId ??
        billingAccount?.polarCustomerId ??
        undefined,
      polarSubscriptionId: updatableSubscription.id,
      currentPeriodStart:
        updatableSubscription.currentPeriodStart ??
        billingAccount?.currentPeriodStart ??
        undefined,
      currentPeriodEnd:
        updatableSubscription.currentPeriodEnd ??
        billingAccount?.currentPeriodEnd ??
        undefined,
      cancelAtPeriodEnd:
        updatableSubscription.cancelAtPeriodEnd ??
        billingAccount?.cancelAtPeriodEnd ??
        false,
      source: "manual-change-plan",
    })

    return {
      action: "unchanged",
      plan: nextPlan,
    }
  }

  try {
    const subscription = await polarClient.subscriptions.update({
      id: updatableSubscription.id,
      subscriptionUpdate: {
        productId: targetProductId,
      },
    })

    const resolvedPlan =
      resolvePlanFromProductId(subscription.productId) ??
      normalizeBillingPlan(input.plan)
    const resolvedSubscriptionStatus = normalizeBillingSubscriptionStatus(
      subscription.status
    )

    await upsertOrganizationBillingProjection({
      organizationId: input.organizationId,
      plan: resolvedPlan,
      subscriptionStatus: resolvedSubscriptionStatus,
      polarCustomerId:
        subscription.customerId ??
        updatableSubscription.customerId ??
        billingAccount?.polarCustomerId ??
        undefined,
      polarSubscriptionId: subscription.id,
      currentPeriodStart:
        subscription.currentPeriodStart ??
        updatableSubscription.currentPeriodStart ??
        billingAccount?.currentPeriodStart ??
        undefined,
      currentPeriodEnd:
        subscription.currentPeriodEnd ??
        updatableSubscription.currentPeriodEnd ??
        billingAccount?.currentPeriodEnd ??
        undefined,
      cancelAtPeriodEnd:
        subscription.cancelAtPeriodEnd ??
        updatableSubscription.cancelAtPeriodEnd ??
        billingAccount?.cancelAtPeriodEnd ??
        false,
      source: "manual-change-plan",
    })

    return {
      action: "updated",
      plan: resolvedPlan,
    }
  } catch (error) {
    const message = getErrorMessage(error, "Failed to change organization plan")

    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message,
    })
  }
}

export async function createOrganizationPortalSession(input: {
  organizationId: string
  userId: string
}): Promise<{ url: string }> {
  assertPaymentsEnabled()

  await assertUserCanManageOrganizationBilling({
    organizationId: input.organizationId,
    userId: input.userId,
  })

  const billingAccount = await db.query.organizationBillingAccount.findFirst({
    where: eq(organizationBillingAccount.organizationId, input.organizationId),
    columns: {
      polarCustomerId: true,
      polarSubscriptionId: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      cancelAtPeriodEnd: true,
    },
  })

  const portalState = createPortalResolutionState({
    billingAccount: billingAccount ?? null,
  })

  await recoverPortalStateFromWebhookBackfill({
    organizationId: input.organizationId,
    state: portalState,
  })
  await recoverPortalStateFromStoredSubscription({
    organizationId: input.organizationId,
    state: portalState,
  })
  await recoverPortalStateFromOrganizationSubscription({
    organizationId: input.organizationId,
    billingAccount: billingAccount ?? null,
    state: portalState,
  })

  if (!portalState.customerId) {
    const externalLookup = await createPortalSessionByExternalCustomerIds({
      externalCustomerIds: [input.organizationId],
      returnUrl: env.POLAR_SUCCESS_URL ?? undefined,
    })
    portalState.recoveryFailures.push(...externalLookup.failures)
    if (externalLookup.url) {
      return { url: externalLookup.url }
    }
  }

  if (!portalState.customerId) {
    const recoveryHint =
      portalState.recoveryFailures.length > 0
        ? ` Recovery attempts failed (${portalState.recoveryFailures.join("; ")}).`
        : ""
    throw new ORPCError("BAD_REQUEST", {
      message: `No billing customer found for this organization. Start a Pro or Studio checkout first.${recoveryHint}`,
    })
  }

  try {
    const customerSession = await polarClient.customerSessions.create({
      customerId: portalState.customerId,
      returnUrl: env.POLAR_SUCCESS_URL ?? undefined,
    })

    return { url: customerSession.customerPortalUrl }
  } catch (error) {
    const message = getErrorMessage(
      error,
      "Failed to create customer portal session"
    )

    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message,
    })
  }
}
