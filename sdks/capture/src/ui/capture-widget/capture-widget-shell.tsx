import type { CaptureUiHandlers, CaptureUiState } from "../types"
import { CaptureLauncherButton } from "./components/capture-launcher-button"
import { Button } from "./components/primitives/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./components/primitives/card"
import { ChooserSection } from "./sections/chooser-section"
import { RecordingDock } from "./sections/recording-dock"
import { ReviewFormSection } from "./sections/review-form-section"
import { SuccessSection } from "./sections/success-section"
import { getViewDescription } from "./utils/get-view-description"

export function CaptureWidgetShell(props: {
  zIndex: number
  state: CaptureUiState
  handlers: CaptureUiHandlers
  isSubmitPending: boolean
  recordingTime: string
}): React.JSX.Element {
  const isBusy = props.state.busy || props.isSubmitPending

  return (
    <div className="crikket-capture-root">
      <CaptureLauncherButton
        disabled={isBusy}
        onClick={props.handlers.onLauncherClick}
        zIndex={props.zIndex}
      />

      {props.state.overlayOpen ? (
        <div
          className="fixed inset-0 z-[var(--capture-overlay-z-index)] grid place-items-center bg-black/60 p-4"
          style={{
            ["--capture-overlay-z-index" as string]: String(props.zIndex + 1),
          }}
        >
          <Card
            className="w-full max-w-[560px] border-border/80 bg-card text-card-foreground shadow-2xl"
            role="dialog"
          >
            <CardHeader className="flex flex-row items-start justify-between gap-3 border-b">
              <div className="grid gap-1">
                <CardTitle>Crikket Capture</CardTitle>
                <CardDescription>
                  {getViewDescription(props.state.view)}
                </CardDescription>
              </div>
              <Button
                disabled={isBusy}
                onClick={props.handlers.onClose}
                type="button"
                variant="outline"
              >
                Close
              </Button>
            </CardHeader>

            {props.state.errorMessage ? (
              <p
                className="mx-5 mt-5 rounded-md border bg-muted px-3 py-2 text-sm"
                role="alert"
              >
                {props.state.errorMessage}
              </p>
            ) : null}

            <CardContent className="px-0 pb-0">
              {props.state.view === "chooser" ? (
                <ChooserSection
                  busy={isBusy}
                  onStartVideo={props.handlers.onStartVideo}
                  onTakeScreenshot={props.handlers.onTakeScreenshot}
                />
              ) : null}

              {props.state.view === "review" ? (
                <ReviewFormSection
                  formKey={props.state.reviewFormKey}
                  isSubmitting={props.isSubmitPending}
                  onCancel={props.handlers.onCancel}
                  onSubmit={props.handlers.onSubmit}
                  state={props.state}
                />
              ) : null}

              {props.state.view === "success" ? (
                <SuccessSection handlers={props.handlers} state={props.state} />
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {props.state.recordingDockOpen ? (
        <RecordingDock
          busy={isBusy}
          onStopRecording={props.handlers.onStopRecording}
          recordingTime={props.recordingTime}
          zIndex={props.zIndex}
        />
      ) : null}
    </div>
  )
}
