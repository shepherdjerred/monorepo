export function dareEditorInstanceKey(dare: {
  id: number;
  currentRevision: number;
}): string {
  return `${dare.id.toString()}:${dare.currentRevision.toString()}`;
}
