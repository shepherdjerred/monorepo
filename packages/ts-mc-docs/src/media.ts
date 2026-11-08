import {
  PublicMediaSchema,
  type PublicMedia,
} from "@shepherdjerred/mc-harness/protocol/media.ts";
import { overlaySvg } from "@shepherdjerred/mc-harness/protocol/media-overlay.ts";

const icons = {
  annotations:
    "M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Zm10 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z",
  expand: "M7 3H3v4m10-4h4v4M3 13v4h4m10-4v4h-4",
  download: "M10 2v10m-4-4 4 4 4-4M3 13v4h14v-4",
};

function actionLabel(
  element: HTMLElement,
  icon: keyof typeof icons,
  text: string,
): void {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
  shape.setAttribute("d", icons[icon]);
  svg.append(shape);
  const label = document.createElement("span");
  label.textContent = text;
  element.append(svg, label);
}

function cueTime(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60).toString()}:${(seconds % 60).toString().padStart(2, "0")}`;
}

function annotationSteps(
  manifest: PublicMedia,
  media: HTMLImageElement | HTMLVideoElement,
  signal: AbortSignal,
): HTMLOListElement {
  const steps = document.createElement("ol");
  steps.className = "storm-media-steps";
  steps.setAttribute("role", "list");
  steps.setAttribute(
    "aria-label",
    media instanceof HTMLVideoElement ? "Video moments" : "Annotation key",
  );
  manifest.annotations.forEach((cue, index) => {
    const row = document.createElement("li");
    row.className = "storm-media-step";
    const number = document.createElement("span");
    number.className = "storm-media-step-number";
    number.setAttribute("aria-hidden", "true");
    number.textContent = (index + 1).toString();
    const label = document.createElement("span");
    label.className = "storm-media-step-label";
    label.textContent = cue.text;
    if (media instanceof HTMLVideoElement) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute(
        "aria-label",
        `Jump to ${cueTime(cue.startMs)}: ${cue.text}`,
      );
      const time = document.createElement("span");
      time.className = "storm-media-step-time";
      time.textContent = cueTime(cue.startMs);
      time.setAttribute("aria-hidden", "true");
      button.append(number, label, time);
      button.addEventListener(
        "click",
        () => {
          media.currentTime = cue.startMs / 1000;
        },
        { signal },
      );
      row.append(button);
    } else row.append(number, label);
    steps.append(row);
  });
  return steps;
}

/** Retain the original download markup for the unenhanced and disconnected states. */
function replaceDownloadFallback(root: HTMLElement, href: string): () => void {
  const selector = `a[href="${href}"]`;
  const inline = root.querySelector<HTMLAnchorElement>(selector);
  const wrapper = root.parentElement;
  const following =
    root.nextElementSibling ??
    (wrapper instanceof HTMLDivElement && wrapper.childElementCount === 1
      ? wrapper.nextElementSibling
      : null);
  const paragraph =
    following instanceof HTMLParagraphElement &&
    following.childElementCount === 1 &&
    following.querySelector(selector)
      ? following
      : undefined;
  const original = inline ?? paragraph;
  if (!original) return () => {};
  const marker = document.createComment("Media download fallback");
  original.replaceWith(marker);
  return () => {
    marker.replaceWith(original);
  };
}

class StormMedia extends HTMLElement {
  private controller: AbortController | undefined;
  private cleanup: (() => void) | undefined;

  connectedCallback(): void {
    const controller = new AbortController();
    this.controller = controller;
    void this.enhance(controller.signal).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      const failure = document.createElement("p");
      failure.textContent = "Media annotations could not load.";
      failure.setAttribute("role", "alert");
      this.append(failure);
      console.error(error);
    });
  }

  disconnectedCallback(): void {
    this.controller?.abort();
    this.cleanup?.();
    this.cleanup = undefined;
  }

  private async enhance(signal: AbortSignal): Promise<void> {
    const source = this.dataset["manifest"];
    if (
      source === undefined ||
      !/^\/media\/[a-z0-9-]+\/media\.json$/u.test(source)
    )
      throw new Error("Invalid media manifest path");
    const response = await fetch(source, { signal });
    if (!response.ok)
      throw new Error(`Media manifest HTTP ${response.status.toString()}`);
    const manifest = PublicMediaSchema.parse(await response.json());
    const media = this.querySelector("img, video");
    if (!(
      media instanceof HTMLImageElement || media instanceof HTMLVideoElement
    ))
      throw new Error("Missing media fallback");
    const original = media.getAttribute("src");
    if (original !== manifest.src)
      throw new Error("Media source differs from its manifest");
    const stage = document.createElement("div");
    stage.className = "storm-media-stage";
    media.before(stage);
    stage.append(media);
    const overlay = document.createElement("div");
    overlay.className = "storm-media-overlay";
    overlay.setAttribute("aria-hidden", "true");
    stage.append(overlay);
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "storm-media-action storm-media-toggle";
    actionLabel(toggle, "annotations", "Annotations");
    const toggleState = document.createElement("span");
    toggleState.className = "storm-media-toggle-state";
    toggleState.textContent = "On";
    toggleState.setAttribute("aria-hidden", "true");
    toggle.append(toggleState);
    toggle.setAttribute("aria-pressed", "true");
    toggle.setAttribute("aria-label", "Hide annotations");
    toggle.title = "Hide annotations";
    const steps = annotationSteps(manifest, media, signal);
    const controls = document.createElement("div");
    controls.className = "storm-media-controls";
    const toolbar = document.createElement("div");
    toolbar.className = "storm-media-toolbar";
    const actions = document.createElement("div");
    actions.className = "storm-media-actions";
    if (manifest.annotations.length > 0) actions.append(toggle);
    if (media instanceof HTMLImageElement) {
      const fullSize = document.createElement("a");
      fullSize.className = "storm-media-action storm-media-full-size";
      fullSize.href = manifest.src;
      fullSize.target = "_blank";
      fullSize.rel = "noopener";
      fullSize.setAttribute("aria-label", "Open full-size image in a new tab");
      actionLabel(fullSize, "expand", "Full size");
      actions.append(fullSize);
    }
    const download = document.createElement("a");
    download.className = "storm-media-action storm-media-download";
    const downloadPath = `/media/${manifest.name}/annotated.${manifest.kind === "video" ? "mp4" : "webp"}`;
    download.href = downloadPath;
    download.download = "";
    download.title = `Download ${manifest.annotations.length > 0 ? "annotated " : ""}${manifest.kind}`;
    download.setAttribute("aria-label", download.title);
    actionLabel(download, "download", "Download");
    const restoreDownload = replaceDownloadFallback(this, downloadPath);
    actions.append(download);
    toolbar.append(actions);
    controls.append(toolbar);
    if (manifest.annotations.length > 0) controls.append(steps);
    this.append(controls);
    this.classList.add("storm-media-enhanced");
    this.classList.toggle("storm-media-video", manifest.kind === "video");
    toggle.addEventListener(
      "click",
      () => {
        overlay.hidden = !overlay.hidden;
        const label = overlay.hidden ? "Show annotations" : "Hide annotations";
        toggle.setAttribute("aria-label", label);
        toggle.title = label;
        toggleState.textContent = overlay.hidden ? "Off" : "On";
        toggle.setAttribute("aria-pressed", String(!overlay.hidden));
      },
      { signal },
    );
    let previous = "";
    const draw = () => {
      const time =
        media instanceof HTMLVideoElement ? media.currentTime * 1000 : 0;
      const active =
        manifest.kind === "image"
          ? manifest.annotations
          : manifest.annotations.filter(
              (cue) => time >= cue.startMs && time < cue.endMs,
            );
      const width = stage.clientWidth,
        height = stage.clientHeight;
      if (width <= 0 || height <= 0) return;
      const signature = JSON.stringify([width, height, active]);
      if (signature === previous) return;
      previous = signature;
      // Geometry contains only validated numbers and XML-escaped plain text.
      overlay.innerHTML = overlaySvg(active, width, height, 16);
    };
    if (media instanceof HTMLVideoElement) {
      for (const event of ["timeupdate", "seeked", "loadedmetadata"])
        media.addEventListener(event, draw, { signal });
    }
    const observer = new ResizeObserver(draw);
    observer.observe(stage);
    this.cleanup = () => {
      observer.disconnect();
      stage.before(media);
      stage.remove();
      controls.remove();
      restoreDownload();
      this.classList.remove("storm-media-enhanced", "storm-media-video");
    };
    draw();
  }
}

if (!customElements.get("storm-media"))
  customElements.define("storm-media", StormMedia);
