import { CAPTURE_CORE_VERSION } from "@crikket/capture-core"

const DEFAULT_ENDPOINT = "https://app.crikket.com"
const TRAILING_SLASHES_REGEX = /\/+$/

export interface CaptureInitOptions {
  publicKey: string
  endpoint?: string
}

export interface CaptureRuntimeConfig {
  publicKey: string
  endpoint: string
}

let runtimeConfig: CaptureRuntimeConfig | null = null

function normalizePublicKey(value: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new Error(
      "@crikket/capture requires a non-empty publicKey in capture.init({ publicKey })"
    )
  }

  return normalized
}

function normalizeEndpoint(value?: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return DEFAULT_ENDPOINT
  }

  return value.trim().replace(TRAILING_SLASHES_REGEX, "")
}

export function init(options: CaptureInitOptions): CaptureRuntimeConfig {
  runtimeConfig = {
    publicKey: normalizePublicKey(options.publicKey),
    endpoint: normalizeEndpoint(options.endpoint),
  }

  return runtimeConfig
}

export function isInitialized(): boolean {
  return runtimeConfig !== null
}

export function getConfig(): CaptureRuntimeConfig | null {
  return runtimeConfig
}

export function getCoreVersion(): string {
  return CAPTURE_CORE_VERSION
}

export function open(): never {
  if (!runtimeConfig) {
    throw new Error(
      "Capture SDK is not initialized. Call capture.init({ publicKey }) first."
    )
  }

  throw new Error(
    "Capture UI is not implemented yet. This package currently provides Phase A scaffolding."
  )
}
