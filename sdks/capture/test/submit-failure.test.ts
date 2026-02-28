import { describe, expect, it } from "bun:test"

import {
  getCaptureSdk,
  sdkTestState,
  setupCaptureSdkTestHooks,
} from "./lib/sdk-test-harness"

setupCaptureSdkTestHooks()

describe("capture SDK submit failure regression", () => {
  it("keeps the review state intact and does not show success when submit fails", async () => {
    const capture = getCaptureSdk()

    capture.init({
      key: "crk_submit_failure",
      host: "https://api.crikket.io",
      submitTransport: (request) => {
        sdkTestState.submitRequests.push(request)
        return Promise.reject(new Error("Submission failed hard."))
      },
    })

    await capture.takeScreenshot()

    await expect(
      capture.submit({
        title: "Failed report",
        description: "Regression path",
        priority: "medium",
      })
    ).rejects.toThrow("Submission failed hard.")

    expect(sdkTestState.submitRequests).toHaveLength(1)
    expect(sdkTestState.uiShowReviewInputs).toHaveLength(1)
    expect(sdkTestState.uiShowSuccessUrls).toEqual([])
    expect(sdkTestState.objectUrlsRevoked).toEqual([])
  })
})
