import type { ReplayEngineFactory } from "@scout-for-lol/replay/engine";
import { createReplaySceneSession } from "@scout-for-lol/replay/scene";
import {
  ReplayCapabilityError,
  type ReplayMapActor,
  type ReplayMapPoint,
  type ReplayPerspective,
  type ReplayPresentationCapabilities,
  type ReplaySessionState,
  type ReplayStateListener,
} from "@scout-for-lol/replay/types";
import { LocalScoutTerrainManifestSchema } from "../../../../packages/scout-for-lol/packages/app/e2e/public-replay/local-scout-terrain-manifest.ts";
import { ScoutTerrainAnnouncer } from "./scout-terrain-announcer.ts";
import { loadRecordedInventory } from "./scout-terrain-inventory.ts";
import { neutralObjectiveLabel } from "./scout-terrain-objectives.ts";
import {
  loadRenderer,
  loadSceneMotion,
  parseTerrainJson,
  prepareScene,
  SceneSchema,
} from "./scout-terrain-scene.ts";
import {
  currentInhibitorArchiveModels,
  currentInhibitorRegistrationSha256,
} from "./tools/research/native-terrain-inhibitor-assets.mjs";
import * as terrainRenderer from "./tools/research/native-terrain.mjs";

const maxZoomStep = 8;
const detailDistance = 3000;
const clamp = (coordinate: number) => Math.max(0, Math.min(1, coordinate));

async function sha256Hex(bytes: BufferSource) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function recordedTimeline(
  data: ReturnType<typeof prepareScene>,
): NonNullable<ReplayPresentationCapabilities["timelineEvents"]> {
  const roster = new Map(
    data.trace.participants.map((participant) => [
      participant.participantId,
      participant,
    ]),
  );
  const eliminations = (data.scene.championEliminations ?? []).map(
    ({ killerId, victimId, timeSeconds }) => {
      const killer = roster.get(killerId);
      const victim = roster.get(victimId);
      if (
        killer === undefined ||
        victim === undefined ||
        killer.teamId === victim.teamId ||
        timeSeconds > data.trace.durationSeconds
      )
        throw new Error(
          "Recorded elimination disagrees with the replay roster or clock.",
        );
      return {
        timeSeconds,
        label: `${killer.championName} eliminated ${victim.championName}`,
        kind: "elimination" as const,
      };
    },
  );
  const neutral = (data.scene.neutralObjectiveKills ?? []).map(
    ({ actorContext, modelId, position, timeSeconds }) => {
      const participant = data.trace.participants.find(
        ({ participantId }) => participantId === actorContext,
      );
      if (participant === undefined || timeSeconds > data.trace.durationSeconds)
        throw new Error(
          "Neutral objective loss is outside the recorded match.",
        );
      return {
        timeSeconds,
        label: `${participant.championName} slays ${neutralObjectiveLabel(modelId)}`,
        ...(position === undefined
          ? {}
          : { mapPoint: data.mapPointAt(position) }),
      };
    },
  );
  const verifiedInhibitorLosses = new Set(data.inhibitorTimes ?? []);
  const inhibitors =
    data.scene.inhibitorModels?.instances.flatMap(
      ({ destroyedAtSeconds, inactiveRanges, position, teamId }) => {
        if (destroyedAtSeconds === null) return [];
        const times = [
          destroyedAtSeconds,
          ...(inactiveRanges
            ?.slice(1)
            .flatMap(([start]) =>
              verifiedInhibitorLosses.has(start) ? [start] : [],
            ) ?? []),
        ];
        return times.map((timeSeconds) => ({
          timeSeconds,
          label:
            teamId === 100
              ? "Blue inhibitor destroyed"
              : "Red inhibitor destroyed",
          mapPoint: data.mapPointAt(position),
        }));
      },
    ) ?? [];
  const positionedInhibitorLosses = new Set(
    inhibitors.map(({ timeSeconds }) => timeSeconds),
  );
  const unpositionedInhibitorLosses = (data.inhibitorTimes ?? [])
    .filter((timeSeconds) => !positionedInhibitorLosses.has(timeSeconds))
    .map((timeSeconds) => ({ timeSeconds, label: "Inhibitor destroyed" }));
  return [
    ...data.turretLosses.map(({ point, timeSeconds }) => ({
      timeSeconds,
      label: "Turret destroyed",
      mapPoint: point,
    })),
    ...Array.from(data.dragons, ([timeSeconds, champion]) => ({
      timeSeconds,
      label: `${champion} slays a dragon`,
    })),
    ...inhibitors,
    ...unpositionedInhibitorLosses,
    ...neutral,
    ...eliminations,
  ].sort((a, b) => a.timeSeconds - b.timeSeconds);
}

function recordedMapActors(
  data: ReturnType<typeof prepareScene>,
  timeSeconds: number,
  isVisible: (context: number) => boolean,
) {
  const actors: ReplayMapActor[] = [];
  for (const { participantId, position, teamId } of data.livingChampionsAt(
    timeSeconds,
  )) {
    if (!isVisible(participantId)) continue;
    actors.push({
      id: participantId,
      point: data.mapPointAt(position),
      teamId,
      kind: "champion",
    });
  }
  for (const { context, position, teamId } of data.worldUnitsAt(timeSeconds) ??
    []) {
    if (context !== undefined && teamId !== undefined && isVisible(context))
      actors.push({
        id: context,
        point: data.mapPointAt(position),
        teamId,
        kind: "minion",
      });
  }
  return actors;
}

/** Private renderer for the exact saved replay and its prepared Map11 assets. */
export const createReplayEngine: ReplayEngineFactory = async ({
  canvas,
  replay,
  manifest,
  resources,
  signal,
  onState,
  onError,
}) => {
  const localManifest = LocalScoutTerrainManifestSchema.parse(manifest);
  const read = async (path: string) =>
    (await resources.read(path.slice(1))).buffer;
  const scene = SceneSchema.parse(parseTerrainJson(await read("/scene.json")));
  if (
    scene.identity.build !== localManifest.gameBuild ||
    scene.identity.protocol !== localManifest.protocol ||
    scene.identity.replaySha256 !== localManifest.capabilities.replaySha256
  )
    throw new ReplayCapabilityError(
      "incompatible-build",
      "The saved terrain scene does not match this rendering package.",
    );
  const modelCatalog = scene.workerMotion?.championModelCatalog;
  const animationCatalog = scene.workerMotion?.championAnimationModelCatalog;
  const files = new Map(localManifest.files.map((file) => [file.path, file]));
  const inhibitorCatalog = scene.workerMotion?.inhibitorCatalog;
  if (inhibitorCatalog !== undefined) {
    const registration = new TextEncoder().encode(
      JSON.stringify(inhibitorCatalog.registration),
    );
    if ((await sha256Hex(registration)) !== currentInhibitorRegistrationSha256)
      throw new ReplayCapabilityError(
        "invalid-package",
        "The inhibitor registration disagrees with the reviewed build.",
      );
    for (const [selector, id] of inhibitorCatalog.models) {
      const { sha256, bytes } = currentInhibitorArchiveModels[selector];
      const path = `inhibitor-models/${sha256}.glb`;
      const file = files.get(path);
      const binding = scene.inhibitorModelBindings?.find(
        ({ participantId }) => participantId === id,
      );
      if (
        file?.sha256 !== sha256 ||
        file.bytes !== bytes ||
        binding?.url !== `/${path}` ||
        binding.skinScale !== 1 ||
        binding.hiddenRanges.length !== 1 ||
        binding.hiddenRanges[0] !== "Destroyed"
      )
        throw new ReplayCapabilityError(
          "invalid-package",
          "An inhibitor model disagrees with its reviewed archive binding.",
        );
    }
  }
  if (modelCatalog !== undefined) {
    for (const { model } of Object.values(modelCatalog.assets)) {
      const file = files.get(`champion-models/${model.sha256}.glb`);
      if (file?.sha256 !== model.sha256 || file.bytes !== model.bytes)
        throw new ReplayCapabilityError(
          "invalid-package",
          "A champion catalog model disagrees with the rendering package inventory.",
        );
    }
  }
  for (const { actions } of animationCatalog?.models ?? []) {
    for (const { rig, bindings, clip } of actions) {
      for (const url of [rig, bindings, clip]) {
        const path = url.slice(1);
        const digest = path.slice(
          path.lastIndexOf("/") + 1,
          path.lastIndexOf("."),
        );
        if (files.get(path)?.sha256 !== digest)
          throw new ReplayCapabilityError(
            "invalid-package",
            "A champion animation resource disagrees with the rendering package inventory.",
          );
      }
    }
  }
  const announcerProfile = localManifest.capabilities.announcerPreview;
  if (
    announcerProfile === undefined &&
    scene.workerMotion?.announcerEvents !== undefined
  )
    throw new ReplayCapabilityError(
      "invalid-package",
      "Replay-derived announcements require the announcer preview capability.",
    );
  if (announcerProfile !== undefined) {
    const replayDigest = await sha256Hex(replay);
    if (replayDigest !== localManifest.capabilities.replaySha256)
      throw new ReplayCapabilityError(
        "incompatible-build",
        "The announcer preview belongs to another saved replay.",
      );
  }
  if (
    scene.workerMotion === undefined ||
    scene.terrainMaterials === undefined ||
    scene.terrainMaterials.bindings.length === 0
  )
    throw new ReplayCapabilityError(
      "invalid-package",
      "The saved terrain package requires textured geometry and a motion decoder.",
    );
  const motion = loadSceneMotion(scene, signal, {
    read,
    // The worker owns its copy. Scout retains the original for subsequent loads.
    replay: async () => replay.slice(0),
    worker: () => resources.worker("replay-motion-worker.mjs"),
  });
  const inventoryInput =
    scene.workerMotion.decodeChampionInventory === true
      ? motion.then(({ scene }) => scene.championInventory)
      : Promise.resolve(scene.championInventory);
  const [loaded, inventory] = await Promise.all([
    motion,
    inventoryInput.then((data) =>
      loadRecordedInventory(
        data,
        scene.participants.map(({ participantId }) => participantId),
        scene.identity.durationMilliseconds,
        (path) => resources.objectUrl(path, "image/png"),
      ),
    ),
  ]);
  if (!loaded.scene.decodedPositionFrames?.length)
    throw new ReplayCapabilityError(
      "engine-unavailable",
      "The motion decoder returned no observed participant positions.",
    );
  const announcer =
    announcerProfile !== undefined &&
    loaded.announcerCues?.length !== 0 &&
    typeof AudioContext !== "undefined"
      ? new ScoutTerrainAnnouncer(
          resources,
          localManifest.capabilities.replaySha256,
          signal,
          loaded.announcerCues,
        )
      : undefined;
  const data = prepareScene(loaded.scene, loaded.heights, inventory);
  let perspective: ReplayPerspective = "all";
  function visibilityAt(timeSeconds: number) {
    const side = perspective;
    return (context: number | undefined) =>
      side === "all" ||
      (context !== undefined &&
        data.visibleTo?.(context, timeSeconds).includes(side) === true);
  }
  const timelineEvents = recordedTimeline(data);
  const minimapUrl = await resources.objectUrl("minimap.png", "image/png");
  const renderer = await loadRenderer(
    canvas,
    data.scene,
    signal,
    read,
    terrainRenderer,
  );
  let width = canvas.clientWidth || canvas.width;
  let height = canvas.clientHeight || canvas.height;
  let devicePixelRatio = globalThis.devicePixelRatio || 1;
  const listeners = new Set<ReplayStateListener>();
  let zoomStep = 0;
  const zoom = () => 1.35 ** zoomStep;
  let manualView:
    { focus: [number, number, number]; distance: number } | undefined;
  let paint: (() => void) | undefined;
  const contextLost = () =>
    onError(new Error("The terrain WebGL2 context was lost."));
  const session = createReplaySceneSession({
    canvas,
    trace: data.trace,
    signal,
    sampleFrame: data.sampleFrame,
    presentation: {
      draw(frame, focusParticipantId) {
        const isVisible = visibilityAt(frame.timeSeconds);
        const positions = data.livingChampionsAt(frame.timeSeconds);
        const units = data.worldUnitsAt(frame.timeSeconds);
        const markers =
          perspective === "all"
            ? positions
            : positions.filter(({ participantId }) => isVisible(participantId));
        const worldUnits =
          perspective === "all"
            ? units
            : units?.filter(({ context }) => isVisible(context));
        const focus = markers.find(
          ({ participantId }) => participantId === focusParticipantId,
        )?.position;
        paint = () => {
          renderer.draw(
            {
              timeSeconds: frame.timeSeconds,
              markers,
              ...(worldUnits === undefined ? {} : { worldUnits }),
            },
            53,
            {
              width,
              height,
              devicePixelRatio,
              zoom: zoom(),
              isVisible,
              ...(data.championHealthAt === undefined
                ? {}
                : { championHealthAt: data.championHealthAt }),
              ...(manualView ??
                (focus === undefined
                  ? {}
                  : {
                      focus,
                      distance:
                        scene.followCameraDefaults?.eyeDistance ??
                        detailDistance,
                      useFollowDefaults: true,
                    })),
            },
          );
        };
        paint();
      },
      resize(nextWidth, nextHeight, nextRatio) {
        if (
          ![nextWidth, nextHeight, nextRatio].every(
            (value) => Number.isFinite(value) && value > 0,
          ) ||
          (nextWidth === width &&
            nextHeight === height &&
            nextRatio === devicePixelRatio)
        )
          return false;
        width = nextWidth;
        height = nextHeight;
        devicePixelRatio = nextRatio;
        return true;
      },
      dispose() {
        announcer?.dispose();
        listeners.clear();
        paint = undefined;
        canvas.removeEventListener("webglcontextlost", contextLost);
        renderer.dispose();
      },
    },
  });
  canvas.addEventListener("webglcontextlost", contextLost);
  function withPresentation(state: ReplaySessionState): ReplaySessionState {
    const scoreboard = data.scoreboardAt(state.timeSeconds);
    const { x, z } = renderer.dragFocus(0, 0);
    const [u, v] = data.mapPointAt([x, 0, z]);
    return {
      ...state,
      ...(scoreboard === undefined ? {} : { scoreboard }),
      mapActors: recordedMapActors(
        data,
        state.timeSeconds,
        visibilityAt(state.timeSeconds),
      ),
      cameraView: { mapPoint: [clamp(u), clamp(v)], zoomStep, maxZoomStep },
    };
  }
  function notify(state: ReplaySessionState) {
    const presented = withPresentation(state);
    onState(presented);
    for (const listener of listeners) listener(structuredClone(presented));
  }
  function repaint() {
    const state = session.getState();
    paint?.();
    notify(state);
  }
  session.subscribe((state) => {
    announcer?.update(state);
    notify(state);
  });
  session.subscribeErrors(onError);
  return {
    ...session,
    capabilities: {
      perspectives:
        data.visibleTo === undefined ? ["all"] : ["all", "blue", "red"],
      ...(data.visibleTo === undefined ? {} : { unitVisibility: true }),
      directedCamera: false,
      rates: [0.5, 1, 2, 4],
      minimapUrl,
      timelineEvents,
      ...(announcer === undefined ? {} : { announcerPreview: "female1-en-us" }),
    },
    ...(announcer === undefined
      ? {}
      : {
          setAnnouncerPreview: (enabled: boolean) =>
            announcer.setEnabled(enabled),
        }),
    getState: () => withPresentation(session.getState()),
    subscribe(listener) {
      const state = withPresentation(session.getState());
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
    // Scene construction synchronously submits the first terrain draw or throws.
    firstFrame: Promise.resolve(),
    seek(timeSeconds) {
      if (Number.isFinite(timeSeconds)) announcer?.invalidate();
      return session.seek(timeSeconds);
    },
    focusParticipant(participantId) {
      manualView = undefined;
      session.focusParticipant(participantId);
    },
    panCamera(deltaX, deltaY) {
      if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY))
        throw new RangeError("Camera displacement must be finite");
      if (session.getState().camera.mode !== "free") return;
      const { x, z, distance } = renderer.dragFocus(deltaX, deltaY);
      const [u, v] = data.mapPointAt([x, 0, z]);
      manualView = {
        focus: data.cameraGroundAt([clamp(u), clamp(v)]),
        distance: distance * zoom(),
      };
      repaint();
    },
    moveCameraToMap([u, v]: ReplayMapPoint) {
      if (!Number.isFinite(u) || !Number.isFinite(v))
        throw new RangeError("Minimap coordinates must be finite");
      const state = session.getState();
      manualView = {
        focus: data.cameraGroundAt([clamp(u), clamp(v)]),
        distance: detailDistance,
      };
      if (state.camera.mode === "free") repaint();
      else session.setCamera({ mode: "free" });
    },
    adjustCameraZoom(direction) {
      if (direction !== -1 && direction !== 1)
        throw new RangeError("Zoom direction must be -1 or 1");
      const next = Math.max(0, Math.min(maxZoomStep, zoomStep + direction));
      if (next === zoomStep) return;
      zoomStep = next;
      repaint();
    },
    setCamera(camera) {
      if (camera.mode === "directed")
        throw new ReplayCapabilityError(
          "unsupported-capability",
          "Directed camera is unavailable for this saved replay renderer.",
        );
      const reset =
        (manualView !== undefined || zoomStep > 0) &&
        camera.mode === "free" &&
        session.getState().camera.mode === "free";
      manualView = undefined;
      if (camera.mode === "free") zoomStep = 0;
      const previousPaint = paint;
      session.setCamera(camera);
      // Setting free twice leaves the playback state unchanged but resets pan.
      if (reset && paint === previousPaint) repaint();
    },
    setPerspective(next) {
      if (next !== "all" && data.visibleTo === undefined)
        throw new ReplayCapabilityError(
          "unsupported-capability",
          "Team vision is unavailable for this saved replay renderer.",
        );
      perspective = next;
      session.setPerspective(next);
    },
  };
};
