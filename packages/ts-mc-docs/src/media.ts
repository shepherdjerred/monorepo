import { PublicMediaSchema } from "@shepherdjerred/mc-harness/protocol/media.ts";
import { overlaySvg } from "@shepherdjerred/mc-harness/protocol/media-overlay.ts";

function annotationToggle(): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "storm-media-toggle";
  button.setAttribute("aria-label", "Annotations");
  button.setAttribute("aria-pressed", "true");
  button.append("Annotations ");
  const state = document.createElement("span");
  state.className = "storm-media-toggle-state";
  state.textContent = "On";
  state.setAttribute("aria-hidden", "true");
  button.append(state);
  return button;
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

function imageLightbox(
  root: HTMLElement,
  stage: HTMLElement,
  media: HTMLImageElement,
  signal: AbortSignal,
  descriptionId: string | undefined,
): () => void {
  const open = document.createElement("button");
  open.type = "button";
  open.className = "storm-media-open";
  open.setAttribute("aria-label", `Enlarge screenshot: ${media.alt}`);
  open.setAttribute("aria-haspopup", "dialog");
  if (descriptionId) open.setAttribute("aria-describedby", descriptionId);
  stage.append(open);
  const dialog = document.createElement("dialog");
  dialog.className = "storm-media-lightbox";
  dialog.setAttribute("aria-label", media.alt || "Enlarged screenshot");
  if (descriptionId) dialog.setAttribute("aria-describedby", descriptionId);
  const figure = document.createElement("figure");
  const caption = root.querySelector("figcaption");
  if (caption) figure.append(caption.cloneNode(true));
  const close = document.createElement("button");
  close.type = "button";
  close.className = "storm-media-close";
  close.setAttribute("aria-label", "Close enlarged screenshot");
  close.textContent = "×";
  close.autofocus = true;
  dialog.append(figure, close);
  root.append(dialog);
  const placeholder = document.createElement("div");
  placeholder.setAttribute("aria-hidden", "true");
  let expanded = false;
  const restore = () => {
    if (!expanded) return;
    placeholder.replaceWith(stage);
    expanded = false;
  };
  const closeLightbox = () => {
    dialog.close();
    restore();
    open.focus({ preventScroll: true });
  };
  open.addEventListener(
    "click",
    () => {
      placeholder.style.height = `${stage.getBoundingClientRect().height.toString()}px`;
      stage.before(placeholder);
      figure.prepend(stage);
      expanded = true;
      dialog.showModal();
    },
    { signal },
  );
  close.addEventListener("click", closeLightbox, { signal });
  dialog.addEventListener(
    "cancel",
    (event) => {
      event.preventDefault();
      closeLightbox();
    },
    { signal },
  );
  dialog.addEventListener(
    "close",
    () => {
      if (!expanded) return;
      restore();
      open.focus({ preventScroll: true });
    },
    { signal },
  );
  dialog.addEventListener(
    "click",
    (event) => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
      )
        closeLightbox();
    },
    { signal },
  );
  return () => {
    dialog.close();
    restore();
    dialog.remove();
    open.remove();
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
    signal.throwIfAborted();
    const media = this.querySelector("img, video");
    if (!(
      media instanceof HTMLImageElement || media instanceof HTMLVideoElement
    ))
      throw new Error("Missing media fallback");
    if (media.getAttribute("src") !== manifest.src)
      throw new Error("Media source differs from its manifest");
    const stage = document.createElement("div");
    stage.className = "storm-media-stage";
    media.before(stage);
    stage.append(media);
    const overlay = document.createElement("div");
    overlay.className = "storm-media-overlay";
    overlay.id = `storm-media-${crypto.randomUUID()}`;
    overlay.setAttribute("aria-hidden", "true");
    stage.append(overlay);
    const toggle = annotationToggle();
    toggle.setAttribute("aria-controls", overlay.id);
    if (manifest.annotations.length > 0) stage.append(toggle);
    toggle.addEventListener(
      "click",
      () => {
        overlay.hidden = !overlay.hidden;
        toggle.setAttribute("aria-pressed", String(!overlay.hidden));
        const state = toggle.querySelector("span");
        if (state) state.textContent = overlay.hidden ? "Off" : "On";
        draw();
      },
      { signal },
    );
    const description = document.createElement("p");
    description.className = "storm-media-description";
    description.id = `${overlay.id}-description`;
    description.textContent = manifest.annotations
      .map((cue) => cue.text)
      .join(". ");
    const originalDescription = media.getAttribute("aria-describedby");
    const descriptionId =
      manifest.annotations.length > 0 ? description.id : undefined;
    if (descriptionId) {
      stage.append(description);
      media.setAttribute(
        "aria-describedby",
        [originalDescription, descriptionId].filter(Boolean).join(" "),
      );
    }
    const restoreLightbox =
      media instanceof HTMLImageElement
        ? imageLightbox(this, stage, media, signal, descriptionId)
        : undefined;
    const restoreDownload = replaceDownloadFallback(
      this,
      `/media/${manifest.name}/annotated.${manifest.kind === "video" ? "mp4" : "webp"}`,
    );
    let previous = "";
    const draw = () => {
      if (overlay.hidden) return;
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
      restoreLightbox?.();
      stage.before(media);
      stage.remove();
      description.remove();
      if (originalDescription === null)
        media.removeAttribute("aria-describedby");
      else media.setAttribute("aria-describedby", originalDescription);
      restoreDownload();
    };
    draw();
  }
}

if (!customElements.get("storm-media"))
  customElements.define("storm-media", StormMedia);
