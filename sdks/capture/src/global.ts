import * as capture from "./eager"
import type { CaptureGlobalApi } from "./types"

declare global {
  interface Window {
    CrikketCapture?: CaptureGlobalApi
  }
}

if (typeof window !== "undefined") {
  window.CrikketCapture = capture
}
