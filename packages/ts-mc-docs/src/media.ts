import { PublicMediaSchema } from "@shepherdjerred/mc-harness/protocol/media.ts";
import { overlaySvg } from "@shepherdjerred/mc-harness/protocol/media-overlay.ts";

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
    toggle.textContent = "Hide annotations";
    toggle.setAttribute("aria-pressed", "true");
    const steps = document.createElement("ol");
    steps.className = "storm-media-steps";
    manifest.annotations.forEach((cue) => {
      const row = document.createElement("li");
      if (media instanceof HTMLVideoElement) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = cue.text;
        button.addEventListener(
          "click",
          () => {
            media.currentTime = cue.startMs / 1000;
          },
          { signal },
        );
        row.append(button);
      } else row.textContent = cue.text;
      steps.append(row);
    });
    const controls = document.createElement("div");
    controls.className = "storm-media-controls";
    controls.append(toggle, steps);
    this.append(controls);
    toggle.addEventListener(
      "click",
      () => {
        overlay.hidden = !overlay.hidden;
        toggle.textContent = overlay.hidden
          ? "Show annotations"
          : "Hide annotations";
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
    };
    draw();
  }
}

if (!customElements.get("storm-media"))
  customElements.define("storm-media", StormMedia);
