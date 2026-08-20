export function ClipboardError(props: { visible: boolean }) {
  if (!props.visible) return null;
  return (
    <p role="alert" className="text-sm text-scout-danger">
      Copying is unavailable in this browser context. Select the column ID
      manually instead.
    </p>
  );
}
