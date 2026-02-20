"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"

import {
  clearCheckoutPendingGuard,
  hasValidCheckoutPendingGuard,
} from "@/lib/billing-checkout-guard"

interface SuccessPageGuardProps {
  checkoutId: string
}

export function SuccessPageGuard({ checkoutId }: SuccessPageGuardProps) {
  const router = useRouter()

  useEffect(() => {
    if (checkoutId.length === 0 || !hasValidCheckoutPendingGuard()) {
      router.replace("/settings/organization")
      return
    }

    clearCheckoutPendingGuard()
  }, [checkoutId, router])

  return null
}
