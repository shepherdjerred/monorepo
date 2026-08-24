import {
  GlobalNavbar,
  useNavbarSessionState,
} from "@scout-for-lol/design-system/layout";
import { ScoutThemeProvider } from "@scout-for-lol/design-system/runtime";
import type { ReactNode } from "react";

function localSurfaceOrigin(
  configured: unknown,
  developmentFallback: string,
): string | undefined {
  if (typeof configured === "string" && configured.length > 0) {
    return configured;
  }
  return import.meta.env.DEV ? developmentFallback : undefined;
}

const appOrigin = localSurfaceOrigin(
  import.meta.env.PUBLIC_APP_ORIGIN,
  "http://localhost:5180",
);
const marketingOrigin = localSurfaceOrigin(
  import.meta.env.PUBLIC_MARKETING_ORIGIN,
  "http://localhost:4321",
);

export function SharedDocsNavbar(props: { children?: ReactNode }) {
  const signedIn = useNavbarSessionState();

  return (
    <ScoutThemeProvider surface="docs">
      <GlobalNavbar
        signedIn={signedIn}
        currentPath="/docs/"
        landmark="div"
        origins={{ app: appOrigin, marketing: marketingOrigin }}
        utility={props.children}
      />
    </ScoutThemeProvider>
  );
}
