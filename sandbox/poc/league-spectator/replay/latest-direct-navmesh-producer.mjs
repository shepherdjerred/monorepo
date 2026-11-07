import { directNavmeshMask4x } from "./latest-direct-navmesh-mask.mjs";
import {
  DIRECT_NAVMESH_FILTER_DEFAULTS,
  directNavmeshFadeParameters,
  directNavmeshBlurParameters,
} from "./latest-direct-navmesh-filter-math.mjs";

export const DIRECT_NAVMESH_PRODUCER_POLICY =
  "original-navmesh-fade-four-blur-v1";
const f = Math.fround;
const finite = (v) => Number.isFinite(v) && Number.isFinite(f(v));

// Explicit source/configuration only. This class does not derive a mask from
// terrain, recover a map variant, supply scene admission, or run guest code.
// The two binary-history masks persist. Color targets are transient pool leases
// acquired for each update; their physical GPU identities are allocator-owned.
export class DirectNavmeshProducer {
  #width;
  #height;
  #high;
  #cpu;
  #current = "mask-a";
  #target = "mask-b";
  #lastUpdate = 0;
  #filter;

  constructor({
    width,
    height,
    highResolution,
    filter = DIRECT_NAVMESH_FILTER_DEFAULTS,
  }) {
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 2 ||
      height < 2 ||
      width > 1024 ||
      height > 1024 ||
      typeof highResolution !== "boolean"
    )
      throw Error(
        "Bounded explicit navmesh source dimensions/configuration required",
      );
    this.#width = width;
    this.#height = height;
    this.#high = highResolution;
    this.#filter = structuredClone(filter);
    const scale = highResolution ? 4 : 1;
    this.#cpu = new Uint8Array(width * height * scale * scale);
    directNavmeshBlurParameters(width * scale, height * scale, this.#filter);
  }

  resources() {
    const scale = this.#high ? 4 : 1,
      width = this.#width * scale,
      height = this.#height * scale;
    return {
      width,
      height,
      masks: ["mask-a", "mask-b"].map((id) => ({
        id,
        format: "r8-unorm",
        initialBytes: new Uint8Array(width * height),
      })),
      targets: ["output", "scratch"].map((id) => ({
        id,
        format: "bgra8-unorm",
        initialBytes: null,
        lifetime: "per-update-pool-lease",
      })),
    };
  }

  update({ now, rgba, dirty, force, modeUpdatesEnabled }) {
    if (
      !finite(now) ||
      !(rgba instanceof Uint8Array) ||
      rgba.length !== this.#width * this.#height * 4 ||
      [dirty, force, modeUpdatesEnabled].some((v) => typeof v !== "boolean")
    )
      throw Error(
        "Explicit finite clock, current RGBA and original update predicates required",
      );
    now = f(now);
    const upload = force || (modeUpdatesEnabled && dirty);
    let uploadCommand = null;
    if (upload) {
      this.#lastUpdate = now;
      [this.#current, this.#target] = [this.#target, this.#current];
      if (this.#high)
        this.#cpu = directNavmeshMask4x({
          width: this.#width,
          height: this.#height,
          rgba,
          previous: this.#cpu,
        }).bytes;
      else
        for (let i = 0; i < this.#cpu.length; i++)
          this.#cpu[i] = rgba[i * 4 + 2];
      uploadCommand = { target: this.#target, bytes: this.#cpu.slice() };
    }
    const scale = this.#high ? 4 : 1,
      width = this.#width * scale,
      height = this.#height * scale,
      blur = directNavmeshBlurParameters(width, height, this.#filter),
      passes = [
        {
          shader: "fade",
          target: "output",
          textures: { current: this.#current, target: this.#target },
          samplers: { current: "clamp-nearest", target: "clamp-linear" },
          parameters: directNavmeshFadeParameters(now, this.#lastUpdate),
        },
      ];
    for (let i = 0; i < 2; i++) {
      passes.push({
        shader: "blur",
        target: "scratch",
        textures: { source: "output" },
        samplers: { source: "clamp-linear" },
        parameters: blur.horizontal.slice(),
      });
      passes.push({
        shader: "blur",
        target: "output",
        textures: { source: "scratch" },
        samplers: { source: "clamp-linear" },
        parameters: blur.vertical.slice(),
      });
    }
    return {
      policy: DIRECT_NAVMESH_PRODUCER_POLICY,
      width,
      height,
      upload: uploadCommand,
      sourceDirtyCleared: upload,
      lastUpdate: this.#lastUpdate,
      passes,
      targetLifetime: "per-update-pool-lease",
      scenePublicationEstablished: false,
    };
  }
}
