import { GlobalNavbar } from "@scout-for-lol/design-system/layout";
import { ScoutThemeProvider } from "@scout-for-lol/design-system/runtime";
import type { ReactNode } from "react";

export function SharedDocsNavbar(props: { children?: ReactNode }) {
  return (
    <ScoutThemeProvider surface="docs">
      <GlobalNavbar currentPath="/docs/" utility={props.children} />
    </ScoutThemeProvider>
  );
}
