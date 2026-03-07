import { type App, PluginSettingTab, Setting } from "obsidian";
import type CooklangPlugin from "./main.ts";

export type CooklangSettings = {
  showInlineQuantities: boolean;
  defaultView: "source" | "preview";
  showNutrition: boolean;
  showCheckboxes: boolean;
}

export const DEFAULT_SETTINGS: CooklangSettings = {
  showInlineQuantities: false,
  defaultView: "preview",
  showNutrition: true,
  showCheckboxes: true,
};

export class CooklangSettingTab extends PluginSettingTab {
  plugin: CooklangPlugin;

  constructor(app: App, plugin: CooklangPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Cooklang Settings" });

    new Setting(containerEl)
      .setName("Default view")
      .setDesc("Choose the default view when opening a recipe")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("preview", "Preview")
          .addOption("source", "Source")
          .setValue(this.plugin.settings.defaultView)
          .onChange(async (value: string) => {
            if (value === "source" || value === "preview") {
              this.plugin.settings.defaultView = value;
            }
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Show inline quantities")
      .setDesc("Show ingredient quantities inline in the directions")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showInlineQuantities).onChange(async (value) => {
          this.plugin.settings.showInlineQuantities = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Show nutrition info")
      .setDesc("Show the nutrition section if available")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showNutrition).onChange(async (value) => {
          this.plugin.settings.showNutrition = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Ingredient checkboxes")
      .setDesc("Show checkboxes next to ingredients")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showCheckboxes).onChange(async (value) => {
          this.plugin.settings.showCheckboxes = value;
          await this.plugin.saveSettings();
        }),
      );
  }
}
