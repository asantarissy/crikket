"use client"

import { ConfirmationDialog } from "@crikket/ui/components/dialogs/confirmation-dialog"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@crikket/ui/components/ui/alert"
import { Button } from "@crikket/ui/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@crikket/ui/components/ui/card"
import * as React from "react"

import { BillingSummary } from "./organization-billing/billing-summary"
import { PlanOptionCard } from "./organization-billing/plan-option-card"
import type {
  BillingInterval,
  BillingSummaryPricing,
  BillingSummarySnapshot,
  OrganizationBillingCardProps,
  PlanOptionCardContext,
} from "./organization-billing/types"
import { useBillingActions } from "./organization-billing/use-billing-actions"
import {
  formatMoney,
  formatPlanLabel,
  getPendingPlanPrice,
  getPlanOptions,
  getPlanPrice,
  inferCurrentBillingInterval,
} from "./organization-billing/utils"

export function OrganizationBillingCard({
  billing,
  organizationId,
  canManageBilling,
}: OrganizationBillingCardProps) {
  const {
    currentPeriodEnd,
    currentPeriodStart,
    limits,
    memberCap,
    memberCount,
    plan,
    subscriptionStatus,
  } = billing
  const [billingInterval, setBillingInterval] =
    React.useState<BillingInterval>("monthly")

  const {
    currentPlanLimit,
    currentPlanMonthlyPrice,
    currentPlanYearlyPrice,
    proMemberCap,
    proPrice,
    proYearlyPrice,
    studioPrice,
    studioYearlyPrice,
  } = getPlanPrice({
    limits,
    plan,
  })

  const isBillingEnabled = proPrice > 0 || studioPrice > 0
  const planOptions = getPlanOptions({
    proPrice,
    proYearlyPrice,
    studioPrice,
    studioYearlyPrice,
  })

  const actions = useBillingActions({
    billingInterval,
    organizationId,
  })

  const currentBillingInterval = inferCurrentBillingInterval({
    currentPeriodStart,
    currentPeriodEnd,
  })

  const pendingPlanPrice = getPendingPlanPrice({
    pendingPlan: actions.pendingPlan,
    billingInterval,
    proPrice,
    proYearlyPrice,
    studioPrice,
    studioYearlyPrice,
  })

  const canOpenPortal = plan !== "free" && canManageBilling && isBillingEnabled
  const planOptionContext: PlanOptionCardContext = {
    billingInterval,
    canManageBilling,
    currentBillingInterval,
    currentPlan: plan,
    isMutating: actions.isMutating,
  }
  const billingSummarySnapshot: BillingSummarySnapshot = {
    currentBillingInterval,
    currentPeriodEnd,
    memberCap,
    memberCount,
    plan,
    proMemberCap,
    subscriptionStatus,
  }
  const billingSummaryPricing: BillingSummaryPricing = {
    currentPlanMonthlyPrice,
    currentPlanYearlyPrice,
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Organization Billing</CardTitle>
        <CardDescription>
          {isBillingEnabled
            ? "Billing is scoped to the active workspace."
            : "Billing is disabled for this deployment. All features are unlocked."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <BillingSummary
          currentPlanLimit={currentPlanLimit}
          pricing={billingSummaryPricing}
          snapshot={billingSummarySnapshot}
        />

        {isBillingEnabled ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium text-sm">Available plans</h3>
              <div className="inline-flex rounded-lg border p-1">
                <Button
                  className="h-8 px-3 text-xs"
                  onClick={() => setBillingInterval("monthly")}
                  size="sm"
                  type="button"
                  variant={billingInterval === "monthly" ? "default" : "ghost"}
                >
                  Monthly
                </Button>
                <Button
                  className="h-8 px-3 text-xs"
                  onClick={() => setBillingInterval("yearly")}
                  size="sm"
                  type="button"
                  variant={billingInterval === "yearly" ? "default" : "ghost"}
                >
                  Yearly
                </Button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {planOptions.map((option) => (
                <PlanOptionCard
                  context={planOptionContext}
                  key={option.slug}
                  onSelect={actions.handlePlanSelection}
                  option={option}
                />
              ))}
            </div>
          </div>
        ) : null}

        {canManageBilling && isBillingEnabled ? (
          <div className="flex flex-wrap gap-2">
            {canOpenPortal ? (
              <Button
                disabled={actions.isMutating}
                onClick={actions.openPortal}
                variant="outline"
              >
                Open Billing Portal
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            {isBillingEnabled
              ? "Only organization owners can manage billing."
              : "Payments are disabled in this deployment."}
          </p>
        )}
      </CardContent>

      <ConfirmationDialog
        cancelText="Keep current plan"
        confirmText={
          actions.pendingPlan
            ? `Confirm ${formatPlanLabel(actions.pendingPlan)}`
            : "Confirm"
        }
        content={
          actions.pendingPlan ? (
            <Alert>
              <AlertTitle>Billing notice</AlertTitle>
              <AlertDescription>
                Changing plans can charge your payment method immediately
                according to Polar prorations.
              </AlertDescription>
            </Alert>
          ) : null
        }
        description={
          actions.pendingPlan
            ? `Switch this organization to ${formatPlanLabel(actions.pendingPlan)} at ${formatMoney(
                pendingPlanPrice,
                billingInterval
              )}. Polar applies changes according to your billing configuration, including prorations when applicable.`
            : ""
        }
        isLoading={actions.isPlanChangePending}
        onConfirm={actions.handleConfirmPlanChange}
        onOpenChange={actions.handlePlanDialogOpenChange}
        open={actions.isPlanConfirmOpen}
        title={
          actions.pendingPlan
            ? `Change plan to ${formatPlanLabel(actions.pendingPlan)}?`
            : "Change plan"
        }
      />
    </Card>
  )
}
