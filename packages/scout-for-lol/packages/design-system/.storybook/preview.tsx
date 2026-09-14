import type { Decorator, Preview } from "@storybook/react-vite";
import { ScoutThemeProvider } from "#src/runtime/context.tsx";
import {
  resolveScoutThemeGlobals,
  scoutThemeGlobalTypes,
  seedScoutThemePreference,
} from "#src/storybook/preview.ts";
import "#styles/index.css";

// The toolbar picks a story's theme by writing the stored preference the
// provider boots from, then remounting the provider through `key`. That is the
// same path a real page load takes, so a story sees exactly the state a user
// would — rather than a second source of truth pushing updates in after mount.
//
// The globals only seed. A story that changes the theme from inside — the theme
// menu, or a `storage` event from another tab — keeps that change, because
// nothing re-asserts the toolbar value until the toolbar itself changes.
const withScoutTheme: Decorator = (story, context) => {
  const theme = resolveScoutThemeGlobals(context.globals);
  seedScoutThemePreference(theme);
  return (
    <ScoutThemeProvider key={`${theme.skin}-${theme.mode}`} surface="storybook">
      {story()}
    </ScoutThemeProvider>
  );
};

const preview: Preview = {
  globalTypes: scoutThemeGlobalTypes,
  initialGlobals: {
    skin: "modern",
    mode: "dark",
    // The e2e suite owns the axe pass. Left automatic, the addon starts its own
    // run on story load and the two collide with "Axe is already running".
    // The panel still runs checks on demand while developing.
    a11y: { manual: true },
  },
  decorators: [withScoutTheme],
  parameters: { layout: "padded" },
};

export default preview;
