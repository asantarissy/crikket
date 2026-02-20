export function getRequestErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "Unknown error"
  }

  const message =
    "message" in error && typeof error.message === "string"
      ? error.message
      : null
  if (message && message.length > 0) {
    return message
  }

  const statusText =
    "statusText" in error && typeof error.statusText === "string"
      ? error.statusText
      : null
  if (statusText && statusText.length > 0) {
    return statusText
  }

  const code =
    "code" in error && typeof error.code === "string" ? error.code : null
  return code ?? "Unknown error"
}
