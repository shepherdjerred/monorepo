import { GlobalNavbar } from "@scout-for-lol/design-system/layout";
import {
  ScoutThemeProvider,
  type ScoutThemeChangedPayload,
} from "@scout-for-lol/design-system/runtime";
import { GET_STARTED_CLICK_EVENT } from "#src/lib/marketing-constants.ts";
import { APP_ORIGIN, DOCS_ORIGIN } from "#src/lib/marketing-constants.ts";

function captureThemeChange(payload: ScoutThemeChangedPayload): void {
  const posthog: unknown = Reflect.get(globalThis, "posthog");
  if (typeof posthog !== "object" || posthog === null) return;
  const capture: unknown = Reflect.get(posthog, "capture");
  if (typeof capture === "function") {
    Reflect.apply(capture, posthog, ["theme_changed", payload]);
  }
}

export function SharedNavbar(props: { currentPath?: string | undefined }) {
  return (
    <ScoutThemeProvider surface="marketing" onThemeChanged={captureThemeChange}>
      <GlobalNavbar
        currentPath={props.currentPath}
        getStartedTrackingEvent={GET_STARTED_CLICK_EVENT}
        getStartedLocation="navbar"
        origins={{ app: APP_ORIGIN, docs: DOCS_ORIGIN }}
      />
    </ScoutThemeProvider>
  );
}
