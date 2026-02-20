import {
  billingPlanMonthlyBasePriceUsd,
  billingPlanYearlyBasePriceUsd,
} from "@crikket/shared/constants/billing"
import type {
  BillingInterval,
  BillingPlan,
  BillingPlanLimits,
  PlanOption,
  SwitchablePlan,
} from "./types"

export function formatPlanLabel(plan: BillingPlan): string {
  if (plan === "pro") return "Pro"
  if (plan === "studio") return "Studio"
  return "Free"
}

export function formatSubscriptionStatus(status: string): string {
  if (!status || status === "none") return "Not subscribed"
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

export function planBadgeVariant(
  plan: BillingPlan
): "default" | "secondary" | "outline" {
  if (plan === "studio") return "default"
  if (plan === "pro") return "secondary"
  return "outline"
}

export function getErrorMessage(
  error: { message?: string } | null | undefined,
  fallback = "Request failed"
): string {
  return error?.message ?? fallback
}

export function extractRedirectUrl(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null
  }

  const candidate = (data as { url?: unknown }).url
  return typeof candidate === "string" && candidate.length > 0
    ? candidate
    : null
}

export function formatVideoDurationLabel(durationMs: number | null): string {
  if (durationMs === null) {
    return "Unlimited"
  }

  if (typeof durationMs !== "number" || durationMs <= 0) {
    return "Locked"
  }

  const minutes = Math.floor(durationMs / 60_000)
  if (minutes < 60) {
    return `${minutes} minutes per recording`
  }

  const hours = (durationMs / 3_600_000).toFixed(1)
  return `${hours} hours per recording`
}

export function formatMoney(
  valueUsd: number,
  billingInterval: BillingInterval
): string {
  return `$${valueUsd}/${billingInterval === "yearly" ? "year" : "month"}`
}

export function resolvePriceByInterval(
  prices: { monthlyPriceUsd: number; yearlyPriceUsd: number },
  billingInterval: BillingInterval
): number {
  return billingInterval === "yearly"
    ? prices.yearlyPriceUsd
    : prices.monthlyPriceUsd
}

export function formatDateLabel(value: string | Date | null): string | null {
  if (!value) {
    return null
  }

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date)
}

function parseDate(value: string | Date | null): Date | null {
  if (!value) {
    return null
  }

  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function inferCurrentBillingInterval(input: {
  currentPeriodStart: string | Date | null
  currentPeriodEnd: string | Date | null
}): BillingInterval | null {
  const currentPeriodStart = parseDate(input.currentPeriodStart)
  const currentPeriodEnd = parseDate(input.currentPeriodEnd)
  if (!(currentPeriodStart && currentPeriodEnd)) {
    return null
  }

  const MS_PER_DAY = 86_400_000
  const days = Math.max(
    0,
    Math.round(
      (currentPeriodEnd.getTime() - currentPeriodStart.getTime()) / MS_PER_DAY
    )
  )

  return days >= 330 ? "yearly" : "monthly"
}

export function getPlanOptions(prices: {
  proPrice: number
  proYearlyPrice: number
  studioPrice: number
  studioYearlyPrice: number
}): PlanOption[] {
  return [
    {
      slug: "pro",
      description: "For growing teams with up to 15 members",
      prices: {
        monthlyPriceUsd: prices.proPrice,
        yearlyPriceUsd: prices.proYearlyPrice,
      },
    },
    {
      slug: "studio",
      description: "For teams that need unlimited seats",
      prices: {
        monthlyPriceUsd: prices.studioPrice,
        yearlyPriceUsd: prices.studioYearlyPrice,
      },
    },
  ]
}

export function getPendingPlanPrice(input: {
  pendingPlan: SwitchablePlan | null
  billingInterval: BillingInterval
  proPrice: number
  proYearlyPrice: number
  studioPrice: number
  studioYearlyPrice: number
}): number {
  if (input.pendingPlan === "pro") {
    return resolvePriceByInterval(
      {
        monthlyPriceUsd: input.proPrice,
        yearlyPriceUsd: input.proYearlyPrice,
      },
      input.billingInterval
    )
  }

  if (input.pendingPlan === "studio") {
    return resolvePriceByInterval(
      {
        monthlyPriceUsd: input.studioPrice,
        yearlyPriceUsd: input.studioYearlyPrice,
      },
      input.billingInterval
    )
  }

  return 0
}

export function getPlanPrice(input: {
  limits: BillingPlanLimits | null
  plan: BillingPlan
}): {
  proPrice: number
  proYearlyPrice: number
  studioPrice: number
  studioYearlyPrice: number
  currentPlanMonthlyPrice: number
  currentPlanYearlyPrice: number
  proMemberCap: number
  currentPlanLimit: BillingPlanLimits[BillingPlan] | null
} {
  const proPrice =
    input.limits?.pro.monthlyPriceUsd ?? billingPlanMonthlyBasePriceUsd.pro
  const proYearlyPrice =
    input.limits?.pro.yearlyPriceUsd ?? billingPlanYearlyBasePriceUsd.pro
  const studioPrice =
    input.limits?.studio.monthlyPriceUsd ??
    billingPlanMonthlyBasePriceUsd.studio
  const studioYearlyPrice =
    input.limits?.studio.yearlyPriceUsd ?? billingPlanYearlyBasePriceUsd.studio

  return {
    proPrice,
    proYearlyPrice,
    studioPrice,
    studioYearlyPrice,
    currentPlanMonthlyPrice:
      input.plan === "pro"
        ? proPrice
        : input.plan === "studio"
          ? studioPrice
          : 0,
    currentPlanYearlyPrice:
      input.plan === "pro"
        ? proYearlyPrice
        : input.plan === "studio"
          ? studioYearlyPrice
          : 0,
    proMemberCap: input.limits?.pro.memberCap ?? 15,
    currentPlanLimit: input.limits?.[input.plan] ?? null,
  }
}
