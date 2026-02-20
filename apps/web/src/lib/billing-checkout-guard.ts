import { reportNonFatalError } from "@crikket/shared/lib/errors"

const CHECKOUT_GUARD_KEY = "crikket:billing:checkout-pending"
const CHECKOUT_GUARD_MAX_AGE_MS = 1000 * 60 * 45

function runBestEffortStorageWrite(writeOperation: () => void): void {
  try {
    writeOperation()
  } catch (error) {
    reportNonFatalError("Billing checkout guard storage write failed", error, {
      once: true,
    })
  }
}

export function setCheckoutPendingGuard(): void {
  runBestEffortStorageWrite(() => {
    window.sessionStorage.setItem(
      CHECKOUT_GUARD_KEY,
      JSON.stringify({
        createdAt: Date.now(),
      })
    )
  })
}

export function hasValidCheckoutPendingGuard(): boolean {
  try {
    const raw = window.sessionStorage.getItem(CHECKOUT_GUARD_KEY)
    if (!raw) {
      return false
    }

    const parsed = JSON.parse(raw) as { createdAt?: unknown }
    if (typeof parsed.createdAt !== "number") {
      return false
    }

    const ageMs = Date.now() - parsed.createdAt
    return ageMs >= 0 && ageMs <= CHECKOUT_GUARD_MAX_AGE_MS
  } catch (error) {
    reportNonFatalError("Billing checkout guard validation failed", error, {
      once: true,
    })
    return false
  }
}

export function clearCheckoutPendingGuard(): void {
  runBestEffortStorageWrite(() => {
    window.sessionStorage.removeItem(CHECKOUT_GUARD_KEY)
  })
}
