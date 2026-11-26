import { useState } from "react";
import {
  Tabs,
  type TabOption,
} from "@shepherdjerred/console-ui/components/tabs.tsx";

export type EmailPreviewProps = {
  /** The rendered HTML body. It runs in a fully sandboxed frame: no script, no forms, no same-origin access. */
  readonly html: string;
  /** The plain-text alternative; the tab is hidden when absent. */
  readonly text?: string | null;
  /** Accessible name of the preview frame. */
  readonly title?: string;
};

type PreviewView = "light" | "dark" | "text";

/**
 * A sandboxed email preview with a light/dark toggle (the frame's
 * `color-scheme`, so emails with dark styles respond) and a plain-text tab.
 */
export function EmailPreview({
  html,
  text,
  title = "Rendered email preview",
}: EmailPreviewProps): React.JSX.Element {
  const [view, setView] = useState<PreviewView>("light");
  const hasText = text !== undefined && text !== null && text.length > 0;
  const options: readonly TabOption<PreviewView>[] = [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    ...(hasText ? [{ value: "text" as const, label: "Plain text" }] : []),
  ];
  return (
    <div className="ui-email-preview">
      <div className="ui-toolbar">
        <Tabs
          label="Email preview"
          value={view}
          onChange={setView}
          options={options}
        />
      </div>
      {view === "text" && hasText ? (
        <pre className="ui-email-text">{text}</pre>
      ) : (
        <iframe
          sandbox=""
          title={title}
          srcDoc={html}
          className="ui-email-frame"
          data-scheme={view === "dark" ? "dark" : "light"}
        />
      )}
    </div>
  );
}
