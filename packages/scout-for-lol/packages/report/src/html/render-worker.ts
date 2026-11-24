import type * as ArenaIndexModule from "#src/html/arena/index.tsx";
import type * as ClassicIndexModule from "#src/html/classic/index.tsx";
import type * as EchartsImageModule from "#src/html/echarts-image.ts";
import type * as HtmlIndexModule from "#src/html/index.tsx";
import type * as LoadingScreenIndexModule from "#src/html/loading-screen/index.tsx";
import {
  markRenderWorkerThread,
  RenderWorkerRequestSchema,
  type RenderWorkerReadyMessage,
  type RenderWorkerResponse,
  type RenderWorkerTask,
} from "#src/html/render-worker-protocol.ts";
import { z } from "zod";

// Synchronous module evaluation ONLY: `image-cache.ts` performs top-level
// `await` over Data Dragon assets, so importing layout modules statically here
// would delay `addEventListener("message")` and drop early messages.
markRenderWorkerThread();

const RequestIdFallbackSchema = z.looseObject({
  id: z.number().int().positive(),
});

let activeMissedItems: number[] = [];

type LoadedRenderModules = {
  readonly matchToSvgInThread: typeof HtmlIndexModule.matchToSvgInThread;
  readonly svgToPngInThread: typeof HtmlIndexModule.svgToPngInThread;
  readonly arenaMatchToSvgInThread: typeof ArenaIndexModule.arenaMatchToSvgInThread;
  readonly arenaMatchToImageInThread: typeof ArenaIndexModule.arenaMatchToImageInThread;
  readonly classicMatchToSvgInThread: typeof ClassicIndexModule.classicMatchToSvgInThread;
  readonly classicMatchToImageInThread: typeof ClassicIndexModule.classicMatchToImageInThread;
  readonly loadingScreenToSvgInThread: typeof LoadingScreenIndexModule.loadingScreenToSvgInThread;
  readonly loadingScreenToImageInThread: typeof LoadingScreenIndexModule.loadingScreenToImageInThread;
  readonly echartsSvgToImage: typeof EchartsImageModule.echartsSvgToImage;
};

let renderModulesPromise: Promise<LoadedRenderModules> | undefined;

function loadRenderModules(): Promise<LoadedRenderModules> {
  renderModulesPromise ??= (async () => {
    const [
      imageCache,
      htmlIndex,
      arenaIndex,
      classicIndex,
      loadingScreenIndex,
      echartsImage,
    ] = await Promise.all([
      import("#src/dataDragon/image-cache.ts"),
      import("#src/html/index.tsx"),
      import("#src/html/arena/index.tsx"),
      import("#src/html/classic/index.tsx"),
      import("#src/html/loading-screen/index.tsx"),
      import("#src/html/echarts-image.ts"),
    ]);
    imageCache.setItemMissHandler(({ itemId }) => {
      activeMissedItems.push(itemId);
    });
    return {
      matchToSvgInThread: htmlIndex.matchToSvgInThread,
      svgToPngInThread: htmlIndex.svgToPngInThread,
      arenaMatchToSvgInThread: arenaIndex.arenaMatchToSvgInThread,
      arenaMatchToImageInThread: arenaIndex.arenaMatchToImageInThread,
      classicMatchToSvgInThread: classicIndex.classicMatchToSvgInThread,
      classicMatchToImageInThread: classicIndex.classicMatchToImageInThread,
      loadingScreenToSvgInThread: loadingScreenIndex.loadingScreenToSvgInThread,
      loadingScreenToImageInThread:
        loadingScreenIndex.loadingScreenToImageInThread,
      echartsSvgToImage: echartsImage.echartsSvgToImage,
    };
  })();
  return renderModulesPromise;
}

function detachOwnedBytes(png: Uint8Array): Uint8Array<ArrayBuffer> {
  const owned = new Uint8Array(png.byteLength);
  owned.set(png);
  return owned;
}

async function executeRenderTask(
  task: RenderWorkerTask,
): Promise<
  | { readonly kind: "svg"; readonly svg: string }
  | { readonly kind: "png"; readonly bytes: Uint8Array<ArrayBuffer> }
> {
  const modules = await loadRenderModules();
  switch (task.kind) {
    case "matchToSvg":
      return {
        kind: "svg",
        svg: await modules.matchToSvgInThread(task.match, task.options),
      };
    case "svgToPng":
      return {
        kind: "png",
        bytes: detachOwnedBytes(
          await modules.svgToPngInThread(task.svg, task.options),
        ),
      };
    case "arenaMatchToSvg":
      return {
        kind: "svg",
        svg: await modules.arenaMatchToSvgInThread(task.match),
      };
    case "arenaMatchToImage":
      return {
        kind: "png",
        bytes: detachOwnedBytes(
          await modules.arenaMatchToImageInThread(task.match),
        ),
      };
    case "classicMatchToSvg":
      return {
        kind: "svg",
        svg: await modules.classicMatchToSvgInThread(task.match),
      };
    case "classicMatchToImage":
      return {
        kind: "png",
        bytes: detachOwnedBytes(
          await modules.classicMatchToImageInThread(task.match),
        ),
      };
    case "loadingScreenToSvg":
      return {
        kind: "svg",
        svg: await modules.loadingScreenToSvgInThread(task.data),
      };
    case "loadingScreenToImage":
      return {
        kind: "png",
        bytes: detachOwnedBytes(
          await modules.loadingScreenToImageInThread(task.data),
        ),
      };
    case "echartsSvgToPng":
      return {
        kind: "png",
        bytes: detachOwnedBytes(
          modules.echartsSvgToImage(
            task.svg,
            [...task.fontFiles],
            task.defaultFontFamily,
          ),
        ),
      };
  }
}

async function handleWorkerMessage(
  event: MessageEvent<unknown>,
): Promise<void> {
  const parsed = RenderWorkerRequestSchema.safeParse(event.data);
  if (!parsed.success) {
    const fallbackId = RequestIdFallbackSchema.safeParse(event.data);
    if (fallbackId.success) {
      const response: RenderWorkerResponse = {
        id: fallbackId.data.id,
        ok: false,
        error: {
          name: "ZodError",
          message: parsed.error.message,
        },
        missedItemIds: [],
      };
      globalThis.postMessage(response);
    }
    return;
  }

  const { id, task } = parsed.data;
  activeMissedItems = [];
  try {
    const result = await executeRenderTask(task);
    const missedItemIds = [...activeMissedItems];
    const response: RenderWorkerResponse = {
      id,
      ok: true,
      result,
      missedItemIds,
    };
    if (result.kind === "png") {
      globalThis.postMessage(response, [result.bytes.buffer]);
    } else {
      globalThis.postMessage(response);
    }
  } catch (error) {
    const missedItemIds = [...activeMissedItems];
    const response: RenderWorkerResponse = {
      id,
      ok: false,
      error:
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              ...(error.stack === undefined ? {} : { stack: error.stack }),
            }
          : {
              name: "Error",
              message: String(error),
            },
      missedItemIds,
    };
    globalThis.postMessage(response);
  }
}

const inbox: MessageEvent<unknown>[] = [];
let draining = false;

async function drainInbox(): Promise<void> {
  if (draining) {
    return;
  }
  draining = true;
  try {
    while (inbox.length > 0) {
      const next = inbox.shift();
      if (next !== undefined) {
        await handleWorkerMessage(next);
      }
    }
  } finally {
    draining = false;
  }
}

globalThis.addEventListener("message", (event: MessageEvent<unknown>) => {
  inbox.push(event);
  void drainInbox();
});

const readyMessage: RenderWorkerReadyMessage = { kind: "render-worker-ready" };
globalThis.postMessage(readyMessage);
