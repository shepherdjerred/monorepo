import { setIcon, TextFileView, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { cookLanguage } from "./syntax/cook-language.ts";
import { parseRecipe } from "./cook-parser.ts";
import { renderRecipe } from "./cook-renderer.ts";
import type CooklangPlugin from "./main.ts";

export const VIEW_TYPE_COOK = "cook";

export class CookView extends TextFileView {
  plugin: CooklangPlugin;
  private editor: EditorView | null = null;
  private readonly editorEl: HTMLElement;
  private readonly previewEl: HTMLElement;
  private isPreview: boolean;
  private toggleBtn: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: CooklangPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.isPreview = plugin.settings.defaultView === "preview";

    this.editorEl = this.contentEl.createDiv({ cls: "cook-editor-container" });
    this.previewEl = this.contentEl.createDiv({ cls: "cook-preview-container" });
  }

  getViewType(): string {
    return VIEW_TYPE_COOK;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "Recipe";
  }

  getIcon(): string {
    return "chef-hat";
  }

  async onOpen(): Promise<void> {
    await super.onOpen();

    // Add toggle button to view header using Obsidian's addAction API
    const initialIcon = this.isPreview ? "code" : "eye";
    const initialLabel = this.isPreview ? "Show source" : "Show preview";
    this.toggleBtn = this.addAction(initialIcon, initialLabel, () => {
      this.toggleMode();
    });

    this.updateVisibility();
  }

  async onClose(): Promise<void> {
    this.editor?.destroy();
    this.editor = null;
    await super.onClose();
  }

  getViewData(): string {
    if (this.editor) {
      return this.editor.state.doc.toString();
    }
    return this.data;
  }

  setViewData(data: string, _clear: boolean): void {
    this.data = data;

    // Update or create editor
    if (this.editor) {
      const currentDoc = this.editor.state.doc.toString();
      if (currentDoc !== data) {
        this.editor.dispatch({
          changes: { from: 0, to: currentDoc.length, insert: data },
        });
      }
    } else {
      this.createEditor(data);
    }

    // Update preview
    this.renderPreview();
    this.updateVisibility();
  }

  clear(): void {
    this.data = "";
    if (this.editor) {
      const doc = this.editor.state.doc.toString();
      this.editor.dispatch({
        changes: { from: 0, to: doc.length, insert: "" },
      });
    }
    this.previewEl.empty();
  }

  private createEditor(content: string): void {
    this.editorEl.empty();

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        this.data = update.state.doc.toString();
        this.requestSave();
        if (this.isPreview) {
          this.renderPreview();
        }
      }
    });

    const state = EditorState.create({
      doc: content,
      extensions: [
        cookLanguage,
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        updateListener,
        EditorView.lineWrapping,
      ],
    });

    this.editor = new EditorView({
      state,
      parent: this.editorEl,
    });
  }

  private renderPreview(): void {
    const recipe = parseRecipe(this.data);
    renderRecipe(this.previewEl, recipe, this.plugin.settings);
  }

  toggleMode(): void {
    this.isPreview = !this.isPreview;

    if (this.isPreview) {
      this.renderPreview();
    }

    this.updateVisibility();
    this.updateToggleIcon();
  }

  private updateVisibility(): void {
    if (this.isPreview) {
      this.editorEl.hide();
      this.previewEl.show();
    } else {
      this.editorEl.show();
      this.previewEl.hide();
    }
  }

  private updateToggleIcon(): void {
    if (!this.toggleBtn) return;
    this.toggleBtn.empty();
    // Use Obsidian's setIcon for safe SVG rendering
    const iconName = this.isPreview ? "code" : "eye";
    setIcon(this.toggleBtn, iconName);
    this.toggleBtn.setAttribute(
      "aria-label",
      this.isPreview ? "Show source" : "Show preview",
    );
  }

  getState(): Record<string, unknown> {
    const state = super.getState();
    state.mode = this.isPreview ? "preview" : "source";
    return state;
  }

  setState(state: Record<string, unknown>, result: ViewStateResult): Promise<void> {
    if (state.mode === "source") {
      this.isPreview = false;
    } else if (state.mode === "preview") {
      this.isPreview = true;
    }
    this.updateVisibility();
    this.updateToggleIcon();
    return super.setState(state, result);
  }
}
