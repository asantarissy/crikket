import { db } from "@crikket/db"
import {
  billingWebhookEvent,
  organizationBillingAccount,
} from "@crikket/db/schema/billing"
import { reportNonFatalError } from "@crikket/shared/lib/errors"
import { eq, sql } from "drizzle-orm"

import { polarClient } from "../lib/payments"
import {
  type BillingPlan,
  type BillingSubscriptionStatus,
  normalizeBillingSubscriptionStatus,
} from "../model"
import { upsertOrganizationBillingProjection } from "./entitlements"
import {
  extractCancelAtPeriodEnd,
  extractCheckoutId,
  extractCurrentPeriodEnd,
  extractCurrentPeriodStart,
  extractCustomerId,
  extractProductId,
  extractProviderEventId,
  extractReferenceId,
  extractReferenceIdFromMetadata,
  extractSubscriptionId,
  extractSubscriptionStatus,
  resolvePlanFromProductId,
} from "./polar-payload"
import type {
  PolarWebhookPayload,
  PolarWebhookProcessingResult,
  WebhookBillingBackfill,
} from "./types"
import {
  asRecord,
  findFirstStringByKeys,
  getErrorMessage,
  isPolarResourceNotFoundError,
} from "./utils"

type ExtractedWebhookBillingProjection = {
  plan?: BillingPlan
  subscriptionStatus?: BillingSubscriptionStatus
  polarCustomerId?: string
  polarSubscriptionId?: string
  currentPeriodStart?: Date
  currentPeriodEnd?: Date
  cancelAtPeriodEnd?: boolean
}

function extractWebhookBillingProjection(
  payload: PolarWebhookPayload
): ExtractedWebhookBillingProjection {
  return {
    plan: resolvePlanFromProductId(extractProductId(payload)),
    subscriptionStatus: extractSubscriptionStatus(payload),
    polarCustomerId: extractCustomerId(payload),
    polarSubscriptionId: extractSubscriptionId(payload),
    currentPeriodStart: extractCurrentPeriodStart(payload),
    currentPeriodEnd: extractCurrentPeriodEnd(payload),
    cancelAtPeriodEnd: extractCancelAtPeriodEnd(payload),
  }
}

async function hydrateBillingProjectionFromSubscription(input: {
  projection: ExtractedWebhookBillingProjection
}): Promise<ExtractedWebhookBillingProjection> {
  const subscriptionId = input.projection.polarSubscriptionId
  if (!subscriptionId) {
    return input.projection
  }

  const hasCoreSubscriptionFields = Boolean(
    input.projection.plan &&
      input.projection.subscriptionStatus &&
      input.projection.currentPeriodStart &&
      input.projection.currentPeriodEnd
  )
  const requiresHydration =
    !hasCoreSubscriptionFields ||
    input.projection.cancelAtPeriodEnd === undefined ||
    !input.projection.polarCustomerId

  if (!requiresHydration) {
    return input.projection
  }

  try {
    const subscription = await polarClient.subscriptions.get({
      id: subscriptionId,
    })

    return {
      plan:
        input.projection.plan ??
        resolvePlanFromProductId(subscription.productId),
      subscriptionStatus:
        input.projection.subscriptionStatus ??
        normalizeBillingSubscriptionStatus(subscription.status),
      polarCustomerId:
        input.projection.polarCustomerId ??
        subscription.customerId ??
        undefined,
      polarSubscriptionId:
        subscription.id ?? input.projection.polarSubscriptionId,
      currentPeriodStart:
        input.projection.currentPeriodStart ??
        subscription.currentPeriodStart ??
        undefined,
      currentPeriodEnd:
        input.projection.currentPeriodEnd ??
        subscription.currentPeriodEnd ??
        undefined,
      cancelAtPeriodEnd:
        input.projection.cancelAtPeriodEnd ??
        subscription.cancelAtPeriodEnd ??
        undefined,
    }
  } catch (error) {
    reportNonFatalError(
      "Failed to hydrate billing projection from subscription",
      error
    )
    return input.projection
  }
}

type OrganizationLookupResult = {
  organizationId?: string
  lookupError?: Error
}

async function resolveOrganizationIdFromSubscriptionPayload(
  payload: PolarWebhookPayload
): Promise<OrganizationLookupResult> {
  const subscriptionId = extractSubscriptionId(payload)
  if (!subscriptionId) {
    return {}
  }

  const billingAccountBySubscription =
    await db.query.organizationBillingAccount.findFirst({
      where: eq(organizationBillingAccount.polarSubscriptionId, subscriptionId),
      columns: {
        organizationId: true,
      },
    })
  if (billingAccountBySubscription?.organizationId) {
    return { organizationId: billingAccountBySubscription.organizationId }
  }

  try {
    const subscription = await polarClient.subscriptions.get({
      id: subscriptionId,
    })
    const subscriptionReferenceId =
      extractReferenceIdFromMetadata(subscription.metadata) ??
      findFirstStringByKeys(subscription, ["referenceId", "reference_id"])
    if (subscriptionReferenceId) {
      return { organizationId: subscriptionReferenceId }
    }
  } catch (error) {
    if (isPolarResourceNotFoundError(error)) {
      return {}
    }

    return {
      lookupError: new Error(
        `Failed to resolve subscription ${subscriptionId}: ${getErrorMessage(
          error,
          "Unknown subscription lookup error"
        )}`
      ),
    }
  }

  return {}
}

async function resolveOrganizationIdFromCheckoutPayload(
  payload: PolarWebhookPayload
): Promise<OrganizationLookupResult> {
  const checkoutId = extractCheckoutId(payload)
  if (!checkoutId) {
    return {}
  }

  try {
    const checkout = await polarClient.checkouts.get({
      id: checkoutId,
    })
    const checkoutReferenceId =
      extractReferenceIdFromMetadata(checkout.metadata) ??
      findFirstStringByKeys(checkout, ["referenceId", "reference_id"])
    if (checkoutReferenceId) {
      return { organizationId: checkoutReferenceId }
    }
  } catch (error) {
    return {
      lookupError: new Error(
        `Failed to resolve checkout ${checkoutId}: ${getErrorMessage(
          error,
          "Unknown checkout lookup error"
        )}`
      ),
    }
  }

  return {}
}

async function resolveOrganizationIdFromCustomerId(
  customerId: string
): Promise<string | undefined> {
  const billingAccountsByCustomer = await db
    .select({
      organizationId: organizationBillingAccount.organizationId,
    })
    .from(organizationBillingAccount)
    .where(eq(organizationBillingAccount.polarCustomerId, customerId))
    .limit(2)

  if (billingAccountsByCustomer.length === 1) {
    return billingAccountsByCustomer[0]?.organizationId
  }

  return undefined
}

async function resolveOrganizationIdFromWebhookPayload(
  payload: PolarWebhookPayload
): Promise<string | undefined> {
  const referenceId = extractReferenceId(payload)
  if (referenceId) {
    return referenceId
  }

  const subscriptionLookup =
    await resolveOrganizationIdFromSubscriptionPayload(payload)
  if (subscriptionLookup.organizationId) {
    return subscriptionLookup.organizationId
  }

  const checkoutLookup = await resolveOrganizationIdFromCheckoutPayload(payload)
  if (checkoutLookup.organizationId) {
    return checkoutLookup.organizationId
  }

  const customerId = extractCustomerId(payload)
  if (!customerId) {
    if (subscriptionLookup.lookupError) {
      throw subscriptionLookup.lookupError
    }

    if (checkoutLookup.lookupError) {
      throw checkoutLookup.lookupError
    }

    return undefined
  }

  const customerLookupOrganizationId =
    await resolveOrganizationIdFromCustomerId(customerId)
  if (customerLookupOrganizationId) {
    return customerLookupOrganizationId
  }

  if (subscriptionLookup.lookupError) {
    throw subscriptionLookup.lookupError
  }

  if (checkoutLookup.lookupError) {
    throw checkoutLookup.lookupError
  }

  return undefined
}

export async function findWebhookBillingBackfill(
  organizationId: string
): Promise<WebhookBillingBackfill | null> {
  const recentWebhookEvents = await db
    .select({
      payload: billingWebhookEvent.payload,
    })
    .from(billingWebhookEvent)
    .orderBy(sql`${billingWebhookEvent.receivedAt} DESC`)
    .limit(500)

  for (const event of recentWebhookEvents) {
    const payloadRecord = asRecord(event.payload)
    if (!payloadRecord) {
      continue
    }

    const payload = payloadRecord as PolarWebhookPayload
    if (extractReferenceId(payload) !== organizationId) {
      continue
    }

    const projection = extractWebhookBillingProjection(payload)
    const hasProjectionData =
      projection.plan !== undefined ||
      projection.subscriptionStatus !== undefined ||
      projection.polarCustomerId !== undefined ||
      projection.polarSubscriptionId !== undefined ||
      projection.currentPeriodStart !== undefined ||
      projection.currentPeriodEnd !== undefined ||
      projection.cancelAtPeriodEnd !== undefined

    if (!hasProjectionData) {
      continue
    }

    return {
      plan: projection.plan,
      subscriptionStatus: projection.subscriptionStatus,
      polarCustomerId: projection.polarCustomerId,
      polarSubscriptionId: projection.polarSubscriptionId,
      currentPeriodStart: projection.currentPeriodStart,
      currentPeriodEnd: projection.currentPeriodEnd,
      cancelAtPeriodEnd: projection.cancelAtPeriodEnd,
    }
  }

  return null
}

export async function processPolarWebhookPayload(
  payload: PolarWebhookPayload
): Promise<PolarWebhookProcessingResult> {
  const eventType =
    (typeof payload.type === "string" && payload.type.length > 0
      ? payload.type
      : "unknown") ?? "unknown"
  const providerEventId = extractProviderEventId(payload, eventType)

  const [existingWebhook] = await db
    .select({
      status: billingWebhookEvent.status,
    })
    .from(billingWebhookEvent)
    .where(eq(billingWebhookEvent.providerEventId, providerEventId))
    .limit(1)

  if (existingWebhook?.status === "processed") {
    return {
      eventType,
      ignored: true,
    }
  }

  if (existingWebhook) {
    await db
      .update(billingWebhookEvent)
      .set({
        status: "received",
        errorMessage: null,
        attemptCount: sql`${billingWebhookEvent.attemptCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(billingWebhookEvent.providerEventId, providerEventId))
  } else {
    await db.insert(billingWebhookEvent).values({
      id: crypto.randomUUID(),
      providerEventId,
      provider: "polar",
      eventType,
      status: "received",
      payload,
      attemptCount: 1,
    })
  }

  try {
    const organizationId =
      await resolveOrganizationIdFromWebhookPayload(payload)
    if (!organizationId) {
      await db
        .update(billingWebhookEvent)
        .set({
          status: "ignored",
          processedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(billingWebhookEvent.providerEventId, providerEventId))

      return {
        eventType,
        ignored: true,
      }
    }

    const extractedProjection = extractWebhookBillingProjection(payload)
    const projection = await hydrateBillingProjectionFromSubscription({
      projection: extractedProjection,
    })

    await upsertOrganizationBillingProjection({
      organizationId,
      plan: projection.plan,
      subscriptionStatus: projection.subscriptionStatus,
      polarCustomerId: projection.polarCustomerId,
      polarSubscriptionId: projection.polarSubscriptionId,
      currentPeriodStart: projection.currentPeriodStart,
      currentPeriodEnd: projection.currentPeriodEnd,
      cancelAtPeriodEnd: projection.cancelAtPeriodEnd,
      source: "webhook",
    })

    await db
      .update(billingWebhookEvent)
      .set({
        status: "processed",
        processedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(billingWebhookEvent.providerEventId, providerEventId))

    return {
      eventType,
      ignored: false,
      organizationId,
    }
  } catch (error) {
    const message = getErrorMessage(error, "Unknown webhook processing error")

    await db
      .update(billingWebhookEvent)
      .set({
        status: "failed",
        errorMessage: message,
        updatedAt: new Date(),
      })
      .where(eq(billingWebhookEvent.providerEventId, providerEventId))

    throw error
  }
}
