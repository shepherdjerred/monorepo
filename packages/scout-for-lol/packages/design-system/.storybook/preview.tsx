import type { Decorator, Preview } from "@storybook/react-vite";
import { ScoutThemeProvider } from "#src/runtime/context.tsx";
import {
  ScoutModePreferenceSchema,
  ScoutSkinSchema,
  writeScoutThemePreference,
} from "#src/runtime/theme.ts";
import "#styles/index.css";

// The toolbar picks a story's theme by writing the stored preference the
// provider boots from, then remounting the provider through `key`. That is the
// same path a real page load takes, so a story sees exactly the state a user
// would — rather than a second source of truth pushing updates in after mount.
//
// Seeding beats pushing here: the provider exposes setSkin and setMode as
// separate commits over the same preference object, so calling both in one
// render applies the second over a stale copy of the first.
//
// The globals only seed. A story that changes the theme from inside — the theme
// menu, or a `storage` event from another tab — keeps that change, because
// nothing re-asserts the toolbar value until the toolbar itself changes.
const withScoutTheme: Decorator = (story, context) => {
  const parsedSkin = ScoutSkinSchema.safeParse(context.globals["skin"]);
  const skin = parsedSkin.success ? parsedSkin.data : "modern";
  const parsedMode = ScoutModePreferenceSchema.safeParse(
    context.globals["mode"],
  );
  const mode = parsedMode.success ? parsedMode.data : "dark";
  try {
    writeScoutThemePreference(globalThis.localStorage, {
      version: 1,
      skin,
      mode,
    });
  } catch {
    // Storage is an optional boundary; the provider falls back to its default.
  }
  return (
    <ScoutThemeProvider key={`${skin}-${mode}`} surface="storybook">
      {story()}
    </ScoutThemeProvider>
  );
};

const preview: Preview = {
  globalTypes: {
    skin: {
      description: "Scout skin",
      toolbar: {
        title: "Skin",
        icon: "paintbrush",
        items: ["modern", "classic"],
        dynamicTitle: true,
      },
    },
    mode: {
      description: "Appearance",
      toolbar: {
        title: "Mode",
        icon: "mirror",
        items: ["light", "dark", "system"],
        dynamicTitle: true,
      },
    },
  },
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
