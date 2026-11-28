import { Button } from "@shepherdjerred/console-ui/components/button.tsx";
import { ICONS } from "@shepherdjerred/console-ui/icons.ts";

export type ExportFormat = "csv" | "json";

const FORMATS: readonly ExportFormat[] = ["csv", "json"];

/**
 * "Copy CSV" and "Copy JSON". The DataTable announces each copy in its
 * polite live region. (CU2's `CopyButton` copies one value; this pair copies
 * the table's rows, so it stays local to DataTable.)
 */
export function ExportButtons({
  copied,
  onCopy,
}: {
  readonly copied: ExportFormat | null;
  readonly onCopy: (format: ExportFormat) => void;
}): React.JSX.Element {
  return (
    <>
      {FORMATS.map((format) => {
        const Icon = copied === format ? ICONS.copied : ICONS.copy;
        const name = format.toUpperCase();
        return (
          <Button
            key={format}
            onClick={() => {
              onCopy(format);
            }}
          >
            <Icon aria-hidden="true" />
            {copied === format ? `Copied ${name}` : `Copy ${name}`}
          </Button>
        );
      })}
    </>
  );
}

/** Writes text to the clipboard where the browser allows it. */
export async function copyText(text: string): Promise<boolean> {
  // Insecure origins and some embedded views have no Clipboard API.
  if (!("clipboard" in globalThis.navigator)) {
    return false;
  }
  try {
    await globalThis.navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
