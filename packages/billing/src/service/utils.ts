export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

export function toDateOrUndefined(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? undefined : parsed
  }

  if (typeof value !== "string" || value.length === 0) {
    return undefined
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export function isPolarResourceNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false
  }

  const errorCode =
    "error" in error && typeof error.error === "string" ? error.error : ""
  if (errorCode === "ResourceNotFound") {
    return true
  }

  const message = getErrorMessage(error, "")
  return message.includes("ResourceNotFound")
}

export function findFirstStringByKeys(
  value: unknown,
  keys: readonly string[],
  depth = 0
): string | undefined {
  if (depth > 5) {
    return undefined
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findFirstStringByKeys(entry, keys, depth + 1)
      if (found) {
        return found
      }
    }
    return undefined
  }

  const record = asRecord(value)
  if (!record) {
    return undefined
  }

  for (const key of keys) {
    const candidate = record[key]
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate
    }
  }

  for (const nested of Object.values(record)) {
    const found = findFirstStringByKeys(nested, keys, depth + 1)
    if (found) {
      return found
    }
  }

  return undefined
}

export function getNestedString(
  value: unknown,
  keys: readonly string[]
): string | undefined {
  let current: unknown = value
  for (const key of keys) {
    const record = asRecord(current)
    if (!record) {
      return undefined
    }
    current = record[key]
  }

  return typeof current === "string" && current.length > 0 ? current : undefined
}
