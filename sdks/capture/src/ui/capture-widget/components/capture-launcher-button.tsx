export function CaptureLauncherButton(props: {
  disabled: boolean
  onClick: () => void
  zIndex: number
}): React.JSX.Element {
  return (
    <button
      aria-label="Report an issue"
      className="capture-launcher"
      disabled={props.disabled}
      onClick={props.onClick}
      style={{ ["--capture-z-index" as string]: String(props.zIndex) }}
      type="button"
    >
      Report Issue
    </button>
  )
}
