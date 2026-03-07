import { addIcon, Plugin } from "obsidian";
import { CookView, VIEW_TYPE_COOK } from "./cook-view.ts";
import { type CooklangSettings, CooklangSettingTab, DEFAULT_SETTINGS } from "./settings.ts";

// Chef hat SVG icon for .cook files
const CHEF_HAT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
  <path d="M30 65 C15 65 5 52 10 38 C15 24 28 20 35 22 C38 12 50 8 58 12 C66 8 78 12 82 22 C90 20 98 30 95 42 C92 54 82 60 75 60"/>
  <line x1="25" y1="65" x2="25" y2="82"/>
  <line x1="75" y1="60" x2="75" y2="82"/>
  <line x1="25" y1="82" x2="75" y2="82"/>
  <line x1="35" y1="65" x2="35" y2="82"/>
  <line x1="50" y1="65" x2="50" y2="82"/>
  <line x1="65" y1="60" x2="65" y2="82"/>
</svg>`;

export default class CooklangPlugin extends Plugin {
  settings: CooklangSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    addIcon("chef-hat", CHEF_HAT_ICON);

    this.registerView(VIEW_TYPE_COOK, (leaf) => new CookView(leaf, this));
    this.registerExtensions(["cook"], VIEW_TYPE_COOK);

    this.addSettingTab(new CooklangSettingTab(this.app, this));

    this.addCommand({
      id: "toggle-cook-preview",
      name: "Toggle recipe preview",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(CookView);
        if (view) {
          if (!checking) {
            view.toggleMode();
          }
          return true;
        }
        return false;
      },
    });
  }

  onunload(): void {
    // Views are automatically cleaned up by Obsidian
  }

  async loadSettings(): Promise<void> {
    const data: unknown = (await this.loadData()) as unknown;
    if (data != null && typeof data === "object") {
      this.settings = { ...DEFAULT_SETTINGS, ...data };
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
