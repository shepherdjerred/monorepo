import { describe, expect, test } from "bun:test";
import {
  buildSoftwareVideoGraph,
  buildVaapiVideoGraph,
  escapeFilterPath,
  SOFTWARE_TONEMAP_CHAIN,
  subtitlePtsSandwich,
} from "../src/media/videoGraph.ts";

const SUB = "/tmp/streambot-subs/x.srt";

describe("escapeFilterPath", () => {
  test("escapes option-level specials (backslash, colon, quote)", () => {
    expect(escapeFilterPath(String.raw`C:\subs\it's.srt`)).toBe(
      String.raw`C\:\\subs\\it\'s.srt`,
    );
  });

  test("escapes graph-level metacharacters (comma, semicolon, brackets)", () => {
    expect(escapeFilterPath("/tmp/a,b;c[d].srt")).toBe(
      String.raw`/tmp/a\,b\;c\[d\].srt`,
    );
  });

  test("leaves plain temp paths untouched", () => {
    expect(escapeFilterPath(SUB)).toBe(SUB);
  });
});

describe("subtitlePtsSandwich", () => {
  test("no setpts pair at offset 0 (fresh play)", () => {
    expect(subtitlePtsSandwich("subtitles=filename=x.srt", 0)).toEqual([
      "subtitles=filename=x.srt",
    ]);
  });

  test("shifts to media clock and back around the filter when seeking", () => {
    expect(subtitlePtsSandwich("subtitles=filename=x.srt", 2367)).toEqual([
      "setpts=PTS+2367/TB",
      "subtitles=filename=x.srt",
      "setpts=PTS-2367/TB",
    ]);
  });
});

describe("buildSoftwareVideoGraph", () => {
  test("SDR, no subtitles: plain scale", () => {
    expect(
      buildSoftwareVideoGraph({
        width: 1920,
        height: 1080,
        inputColor: "sdr",
        encoderOutFilters: [],
      }),
    ).toEqual({ kind: "filterChain", filters: ["scale=1920:1080"] });
  });

  test("HDR: tonemap chain after scale", () => {
    expect(
      buildSoftwareVideoGraph({
        width: 1920,
        height: 1080,
        inputColor: "hdr",
        encoderOutFilters: [],
      }),
    ).toEqual({
      kind: "filterChain",
      filters: ["scale=1920:1080", SOFTWARE_TONEMAP_CHAIN],
    });
  });

  test("HDR + subtitles: burn lands after the tonemap (libass renders onto SDR frames)", () => {
    const graph = buildSoftwareVideoGraph({
      width: 1920,
      height: 1080,
      inputColor: "hdr",
      subtitle: { path: SUB, startTime: 0 },
      encoderOutFilters: [],
    });
    expect(graph).toEqual({
      kind: "filterChain",
      filters: [
        "scale=1920:1080",
        SOFTWARE_TONEMAP_CHAIN,
        `subtitles=filename=${SUB}`,
      ],
    });
  });

  test("subtitles + seek: setpts sandwich wraps only the subtitles filter", () => {
    const graph = buildSoftwareVideoGraph({
      width: 1280,
      height: 720,
      inputColor: "sdr",
      subtitle: { path: SUB, startTime: 90 },
      encoderOutFilters: [],
    });
    expect(graph).toEqual({
      kind: "filterChain",
      filters: [
        "scale=1280:720",
        "setpts=PTS+90/TB",
        `subtitles=filename=${SUB}`,
        "setpts=PTS-90/TB",
      ],
    });
  });

  test("pad (letterbox) goes between scale and tonemap; encoder outFilters last", () => {
    const graph = buildSoftwareVideoGraph({
      width: 1440,
      height: 1080,
      inputColor: "hdr",
      pad: { width: 1920, height: 1080 },
      subtitle: { path: SUB, startTime: 0 },
      encoderOutFilters: ["format=nv12|vaapi", "hwupload"],
    });
    expect(graph).toEqual({
      kind: "filterChain",
      filters: [
        "scale=1440:1080",
        "pad=1920:1080:-1:-1:color=black",
        SOFTWARE_TONEMAP_CHAIN,
        `subtitles=filename=${SUB}`,
        "format=nv12|vaapi",
        "hwupload",
      ],
    });
  });

  test("drops empty encoder filter entries so the -vf spec has no stray commas", () => {
    expect(
      buildSoftwareVideoGraph({
        width: 1280,
        height: 720,
        inputColor: "sdr",
        encoderOutFilters: ["", ""],
      }),
    ).toEqual({ kind: "filterChain", filters: ["scale=1280:720"] });
  });
});

describe("buildVaapiVideoGraph", () => {
  test("SDR, no subtitles: single GPU scale (unchanged from the pre-overlay pipeline)", () => {
    expect(
      buildVaapiVideoGraph({ width: 1920, height: 1080, inputColor: "sdr" }),
    ).toEqual({
      kind: "filterChain",
      filters: ["scale_vaapi=w=1920:h=1080:format=nv12"],
    });
  });

  test("HDR, no subtitles: 10-bit GPU scale then tonemap_vaapi to BT.709 NV12", () => {
    expect(
      buildVaapiVideoGraph({ width: 1920, height: 1080, inputColor: "hdr" }),
    ).toEqual({
      kind: "filterChain",
      filters: [
        "scale_vaapi=w=1920:h=1080:format=p010," +
          "tonemap_vaapi=format=nv12:t=bt709:m=bt709:p=bt709",
      ],
    });
  });

  test("SDR + subtitles: filter_complex with BGRA alpha canvas, hwupload, overlay_vaapi", () => {
    expect(
      buildVaapiVideoGraph({
        width: 1920,
        height: 1080,
        frameRate: 30,
        inputColor: "sdr",
        subtitle: { path: SUB, startTime: 0 },
      }),
    ).toEqual({
      kind: "filterComplex",
      graph: [
        "[0:v]scale_vaapi=w=1920:h=1080:format=nv12[base]",
        "color=c=black@0:s=1920x1080:r=30,format=bgra," +
          `subtitles=filename=${SUB}:alpha=1,hwupload[subs]`,
        "[base][subs]overlay_vaapi[vout]",
      ],
      mapLabel: "vout",
    });
  });

  test("HDR + subtitles + seek: tonemapped base, setpts sandwich on the canvas branch", () => {
    expect(
      buildVaapiVideoGraph({
        width: 1920,
        height: 1080,
        frameRate: 30,
        inputColor: "hdr",
        subtitle: { path: SUB, startTime: 2367 },
      }),
    ).toEqual({
      kind: "filterComplex",
      graph: [
        "[0:v]scale_vaapi=w=1920:h=1080:format=p010," +
          "tonemap_vaapi=format=nv12:t=bt709:m=bt709:p=bt709[base]",
        "color=c=black@0:s=1920x1080:r=30,format=bgra," +
          "setpts=PTS+2367/TB," +
          `subtitles=filename=${SUB}:alpha=1,` +
          "setpts=PTS-2367/TB,hwupload[subs]",
        "[base][subs]overlay_vaapi[vout]",
      ],
      mapLabel: "vout",
    });
  });

  test("omits the canvas rate when frameRate is unset (framesync follows the main input)", () => {
    const graph = buildVaapiVideoGraph({
      width: 1280,
      height: 720,
      inputColor: "sdr",
      subtitle: { path: SUB, startTime: 0 },
    });
    if (graph.kind !== "filterComplex") {
      throw new Error("expected a filterComplex graph");
    }
    expect(graph.graph[1]).toStartWith("color=c=black@0:s=1280x720,format=bgra");
  });

  test("escapes subtitle paths for graph context (quote, comma, brackets)", () => {
    const graph = buildVaapiVideoGraph({
      width: 1280,
      height: 720,
      inputColor: "sdr",
      subtitle: { path: "/tmp/it's [v1],final.srt", startTime: 0 },
    });
    if (graph.kind !== "filterComplex") {
      throw new Error("expected a filterComplex graph");
    }
    expect(graph.graph[1]).toContain(
      String.raw`subtitles=filename=/tmp/it\'s \[v1\]\,final.srt:alpha=1`,
    );
  });
});
