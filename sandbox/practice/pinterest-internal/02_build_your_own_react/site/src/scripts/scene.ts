import { defined } from "#lib/invariant.ts";
import { frameCode } from "#lib/camera.ts";
import { clamp, phases } from "#lib/lines.ts";
import type { CodeState, ImageState, WaveData } from "#lib/lines.ts";
import {
  emphasis,
  prepareTransition,
  sampleTransition,
} from "#lib/transition.ts";
import { required } from "#scripts/dom.ts";
import { fillLine } from "#scripts/tokens.ts";

type Camera = { width: number; height: number; y: number; scrollTop: number };
type RenderedLine = {
  element: HTMLElement;
  semantic: CodeState | null;
  generation: number;
  columns: { element: HTMLElement; from: number; to: number }[];
};

export class Scene {
  readonly nodes = new Map<number, RenderedLine>();
  readonly images = new Map<number, HTMLImageElement>();
  readonly scene: HTMLElement;
  readonly viewport: HTMLElement;
  private selectedState: CodeState | null = null;
  private metrics: {
    width: number;
    height: number;
    fontSize: number;
    lineHeight: number;
  };
  private cameras = new WeakMap<CodeState, Camera>();
  private transition: {
    from: CodeState;
    to: CodeState;
    lines: ReturnType<typeof prepareTransition>;
  } | null = null;
  private generation = 0;
  private animating = false;
  private scrollTop = 0;
  private cameraOffset = 0;
  constructor(
    readonly element: HTMLElement,
    readonly data: WaveData,
  ) {
    this.scene = required(element, ".scene");
    this.viewport = required(element, ".viewport");
    this.scene.replaceChildren();
    this.metrics = this.readMetrics();
  }
  private readMetrics() {
    const style = getComputedStyle(this.scene);
    return {
      width: this.viewport.clientWidth,
      height: this.viewport.clientHeight,
      fontSize: Number.parseFloat(style.fontSize),
      lineHeight: Number.parseFloat(style.lineHeight),
    };
  }
  measure(): void {
    const metrics = this.readMetrics();
    if (
      metrics.width !== this.metrics.width ||
      metrics.height !== this.metrics.height ||
      metrics.lineHeight !== this.metrics.lineHeight ||
      metrics.fontSize !== this.metrics.fontSize
    )
      this.selectedState = null;
    this.metrics = metrics;
    this.cameras = new WeakMap();
  }
  readScroll(): void {
    this.scrollTop = this.viewport.scrollTop;
  }
  private camera(state: CodeState): Camera {
    const cached = this.cameras.get(state);
    if (cached !== undefined) return cached;
    const longest = Math.max(
      1,
      ...state.lines.map((id) => defined(this.data.lines[id]).text.length),
    );
    const { width, height, fontSize, lineHeight } = this.metrics;
    const result = {
      width: Math.max(width - 32, longest * fontSize * 0.6 + 16),
      ...frameCode({
        lineCount: state.lines.length,
        focus: state.focus.map((focus) => focus.line - 1),
        height,
        lineHeight,
      }),
    };
    this.cameras.set(state, result);
    return result;
  }
  private paintImages(
    from: ImageState,
    to: ImageState,
    options: { a: number; b: number; progress: number },
  ): void {
    const { a, b, progress } = options;
    const states =
      a === b ? [[a, from] as const] : [[a, from] as const, [b, to] as const];
    for (const [index, state] of states) {
      let image = this.images.get(index);
      if (image === undefined) {
        image = document.createElement("img");
        image.src = new URL(state.src, document.baseURI).href;
        image.alt = state.alt;
        this.scene.append(image);
        this.images.set(index, image);
      }
      image.style.opacity = String(
        a === b ? 1 : index === a ? 1 - progress : progress,
      );
    }
    for (const [index, node] of this.images)
      if (index !== a && index !== b) {
        node.remove();
        this.images.delete(index);
      }
  }
  private paintCode(from: CodeState, to: CodeState, progress: number): void {
    const { height, lineHeight } = this.metrics;
    if (this.transition?.from !== from || this.transition.to !== to) {
      this.transition = { from, to, lines: prepareTransition(from, to) };
      this.generation++;
    }
    const semantic = progress < 0.5 ? from : to;
    const aCamera = this.camera(from),
      bCamera = this.camera(to);
    // Keep the complete example in the scroll surface, including lines above the focus.
    this.scene.style.width = `${String(Math.max(aCamera.width, bCamera.width))}px`;
    this.scene.style.height = `${String(Math.max(aCamera.height, bCamera.height))}px`;
    if (semantic !== this.selectedState) {
      this.cameraOffset = this.camera(semantic).scrollTop;
      this.viewport.scrollTo({
        top: this.cameraOffset,
        left: 0,
        behavior: "instant",
      });
      this.scrollTop = this.cameraOffset;
      this.selectedState = semantic;
    }
    // Compensate for the native scroll offset so switching states preserves smooth motion.
    const cameraY =
      aCamera.y +
      (bCamera.y - aCamera.y) * phases(progress).move +
      this.cameraOffset;
    const visible = sampleTransition(
      this.transition.lines,
      progress,
      lineHeight,
    ).filter((line) => {
      const y = line.y + cameraY - this.scrollTop;
      return (
        line.opacity > 0.005 &&
        y + lineHeight >= -lineHeight * 2 &&
        y <= height + lineHeight * 2
      );
    });
    const ids = new Set(visible.map((line) => line.id));
    for (const [id, node] of this.nodes)
      if (!ids.has(id)) {
        node.element.remove();
        this.nodes.delete(id);
      }
    for (const line of visible) {
      let node = this.nodes.get(line.id);
      if (node === undefined) {
        const element = document.createElement("div");
        element.className = "code-line";
        element.dataset.line = String(line.id);
        this.scene.append(element);
        node = { element, semantic: null, generation: -1, columns: [] };
        this.nodes.set(line.id, node);
      }
      if (node.semantic !== semantic || node.generation !== this.generation) {
        const index = semantic.lines.indexOf(line.id);
        fillLine(node.element, defined(this.data.lines[line.id]), {
          hovers: semantic.hovers[line.id] ?? [],
          infos: this.data.hovers,
          columns: semantic.focus.find((item) => item.line === index + 1)
            ?.columns,
        });
        node.columns = [
          ...node.element.querySelectorAll<HTMLElement>("[data-column]"),
        ].map((element) => ({
          element,
          from: emphasis(from, line.a, Number(element.dataset.column)),
          to: emphasis(to, line.b, Number(element.dataset.column)),
        }));
        node.semantic = semantic;
        node.generation = this.generation;
      }
      for (const column of node.columns)
        column.element.style.opacity = String(
          (column.from + (column.to - column.from) * progress) /
            line.brightness,
        );
      node.element.style.transform = `translate(${String(line.x)}px,${String(line.y + cameraY)}px)`;
      node.element.style.opacity = String(line.opacity * line.brightness);
      const screenY = cameraY + line.y - this.scrollTop;
      node.element.inert =
        line.opacity < 0.05 || screenY + lineHeight < 0 || screenY > height;
    }
    this.scene.style.transform = "translateX(16px)";
  }
  paint(position: number): void {
    position = clamp(position, 0, this.data.states.length - 1);
    const a = Math.floor(position),
      b = Math.ceil(position),
      progress = position - a;
    const animating = progress > 0;
    if (animating !== this.animating) {
      this.scene.classList.toggle("animating", animating);
      this.animating = animating;
    }
    const from = defined(this.data.states[a]),
      to = defined(this.data.states[b]);
    if (from.kind === "image" && to.kind === "image")
      this.paintImages(from, to, { a, b, progress });
    else if (from.kind === "code" && to.kind === "code")
      this.paintCode(from, to, progress);
    else throw new Error("Mixed image/code wave");
  }
}
