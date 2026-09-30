import type { Preview } from "@storybook/react-vite";
import { scoutThemeGlobalTypes } from "@scout-for-lol/design-system/storybook/preview";
import {
  withAppProviders,
  withRouter,
  withScoutTheme,
} from "#src/lib/storybook/decorators.tsx";
// The app's own stylesheet, not the design system's: Tailwind v4 plus the
// `@theme inline` block that maps --scout-* tokens onto the utilities these
// components are written in. Importing only the design-system CSS renders
// every component off-token.
import "#src/styles/global.css";

const preview: Preview = {
  // Outermost to innermost, mirroring main.tsx: theme, then data, then router.
  decorators: [withScoutTheme, withAppProviders, withRouter],
  globalTypes: scoutThemeGlobalTypes,
  initialGlobals: {
    skin: "modern",
    mode: "dark",
    // The e2e suite owns the axe pass. Left automatic, the addon starts its own
    // run on story load and the two collide with "Axe is already running".
    a11y: { manual: true },
  },
  parameters: { layout: "padded" },
};

export default preview;
