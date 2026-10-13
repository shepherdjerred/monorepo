import { defined } from "#lib/invariant.ts";
import { clamp, spring } from "#lib/lines.ts";
import { WaveDataSchema } from "#lib/schema.ts";
import { required } from "#scripts/dom.ts";
import { closePopup, placePopup } from "#scripts/popup.ts";
import { Scene } from "#scripts/scene.ts";

const motion = matchMedia("(prefers-reduced-motion: reduce)");
class WaveReader {
  loading: Promise<void> | null = null;
  scene: Scene | null = null;
  position = 0;
  velocity = 0;
  target = 0;
  paintedIndex = -1;
  dirty = true;
  top = 0;
  bottom = 0;
  firstStep = 0;
  private markerHeight = 0;
  private geometry: {
    top: number;
    bottom: number;
    offset: number;
    height: number;
  }[] = [];
  readonly steps: HTMLElement[];
  readonly marker: HTMLElement;
  readonly counter: HTMLElement;
  constructor(readonly element: HTMLElement) {
    this.steps = [...element.querySelectorAll<HTMLElement>("[data-state]")];
    this.marker = required(element, ".progress-marker");
    this.counter = required(element, "[data-counter]");
    element.classList.add("ready");
  }
  async load(): Promise<void> {
    this.loading ??= this.loadData();
    await this.loading;
  }
  private async fetchData(): Promise<unknown> {
    const response = await fetch(defined(this.element.dataset.source));
    if (!response.ok)
      throw new Error(`Code data returned ${String(response.status)}`);
    return response.json();
  }
  private async loadData(): Promise<void> {
    let json: unknown;
    try {
      json = await this.fetchData();
    } catch (error) {
      this.element.classList.remove("ready");
      this.element
        .querySelectorAll<HTMLDetailsElement>(".fallback")
        .forEach((detail) => {
          detail.open = true;
        });
      console.error(
        "Could not load animated code; complete code remains in the article.",
        error,
      );
      return;
    }
    this.scene = new Scene(this.element, WaveDataSchema.parse(json));
    this.measure();
    this.select();
    this.position = this.target;
    this.paint();
    schedule();
  }
  measure(): void {
    const scroll = window.scrollY;
    const bounds = this.element.getBoundingClientRect();
    const story = required(this.element, ".story").getBoundingClientRect();
    this.top = bounds.top + scroll;
    this.bottom = bounds.bottom + scroll;
    this.geometry = this.steps.map((step) => {
      const rect = step.getBoundingClientRect();
      const content = required(
        step,
        ".step-content > div",
      ).getBoundingClientRect();
      return {
        top: rect.top + scroll,
        bottom: rect.bottom + scroll,
        offset: content.top - story.top,
        height: content.height,
      };
    });
    this.firstStep = defined(this.geometry[0]).top;
    this.scene?.measure();
    this.dirty = true;
  }
  select(): void {
    const cursor =
      scrollY + (innerWidth < 1000 ? innerHeight * 0.72 : innerHeight * 0.5);
    let selected = 0;
    for (let i = 1; i < this.steps.length; i++) {
      const current = defined(this.geometry[i]);
      const previous = defined(this.geometry[i - 1]);
      if ((current.top + previous.bottom) / 2 <= cursor) selected = i;
    }
    if (selected !== this.target) {
      closePopup();
      this.target = selected;
    }
  }
  paint(): void {
    if (this.scene === null) return;
    const count = this.scene.data.states.length;
    const position = clamp(this.position, 0, count - 1);
    const a = defined(this.geometry[Math.floor(position)]),
      b = defined(this.geometry[Math.ceil(position)]);
    const progress = position - Math.floor(position);
    const nearest = Math.round(position);
    if (nearest !== this.paintedIndex) {
      closePopup();
      this.steps[this.paintedIndex]?.removeAttribute("aria-current");
      defined(this.steps[nearest]).setAttribute("aria-current", "step");
      this.paintedIndex = nearest;
      this.counter.textContent = `${String(nearest + 1)} / ${String(count)}`;
      this.element.dataset.activeState = String(nearest);
    }
    // Set the base height only when the measured block changes; animate its scale.
    if (this.markerHeight !== a.height) {
      this.marker.style.height = `${String(a.height)}px`;
      this.markerHeight = a.height;
    }
    const height = a.height + (b.height - a.height) * progress;
    this.marker.style.transform = `translateY(${String(a.offset + (b.offset - a.offset) * progress)}px) scaleY(${String(height / a.height)})`;
    this.scene.paint(position);
    this.dirty = false;
  }
  tick(seconds: number): boolean {
    this.select();
    const previous = this.position;
    if (motion.matches) {
      this.position = this.target;
      this.velocity = 0;
    } else
      ({ position: this.position, velocity: this.velocity } = spring(
        this.position,
        this.velocity,
        this.target,
        seconds,
      ));
    if (previous !== this.position || this.dirty) this.paint();
    return this.position !== this.target || this.velocity !== 0;
  }
}

const readers = [...document.querySelectorAll<HTMLElement>("[data-wave]")].map(
  (element) => new WaveReader(element),
);
let frame = 0,
  previousTime = 0;
let measurementsDirty = true;
let activeReader: WaveReader | undefined;
function remeasure(): void {
  measurementsDirty = true;
  schedule();
}
function schedule(): void {
  if (frame !== 0) return;
  previousTime = performance.now();
  frame = requestAnimationFrame(animate);
}
function animate(time: number): void {
  const seconds = Math.min((time - previousTime) / 1000, 0.05);
  previousTime = time;
  let running = false;
  if (measurementsDirty) {
    readers.forEach((reader) => {
      reader.measure();
    });
    measurementsDirty = false;
  }
  const cursor =
    scrollY + (innerWidth < 1000 ? innerHeight * 0.72 : innerHeight * 0.5);
  const active = readers.find(
    (reader) => reader.firstStep <= cursor && reader.bottom >= cursor,
  );
  if (active !== activeReader) {
    closePopup();
    activeReader?.element.classList.remove("active-wave");
    active?.element.classList.add("active-wave");
    activeReader = active;
  }
  const visible = readers.filter(
    (reader) => reader.bottom >= scrollY && reader.top <= scrollY + innerHeight,
  );
  // Complete geometry reads before any scene writes.
  visible.forEach((reader) => reader.scene?.readScroll());
  for (const reader of visible) {
    running = reader.tick(seconds) || running;
  }
  placePopup();
  frame = running ? requestAnimationFrame(animate) : 0;
}
const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const reader = defined(
        readers.find((item) => item.element === entry.target),
      );
      void reader.load();
      observer.unobserve(entry.target);
    }
  },
  { rootMargin: "100% 0px" },
);
async function start(): Promise<void> {
  await document.fonts.ready;
  readers.forEach((reader) => {
    observer.observe(reader.element);
  });
  schedule();
}
void start();
window.addEventListener(
  "scroll",
  () => {
    closePopup();
    schedule();
  },
  { passive: true },
);
window.addEventListener("resize", () => {
  placePopup();
  remeasure();
});
window.visualViewport?.addEventListener("resize", () => {
  placePopup();
  remeasure();
});
motion.addEventListener("change", schedule);
document.addEventListener("toggle", remeasure, true);
const resize = new ResizeObserver(remeasure);
readers.forEach((reader) => {
  resize.observe(reader.element);
  required(reader.element, ".viewport").addEventListener(
    "scroll",
    () => {
      closePopup();
      reader.dirty = true;
      schedule();
    },
    { passive: true },
  );
});
document.fonts.addEventListener("loadingdone", remeasure);
schedule();
