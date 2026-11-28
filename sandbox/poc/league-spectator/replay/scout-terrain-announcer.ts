import type { ReplayResources } from "@scout-for-lol/replay/engine";
import type { ReplaySessionState } from "@scout-for-lol/replay/types";
import { z } from "zod";

const digest = z.string().regex(/^[0-9a-f]{64}$/);
const mediaId = z.number().int().positive().max(0xffffffff);
export const AnnouncerEventsSchema = z
  .array(z.tuple([z.number().int().positive().max(0xffff), mediaId]))
  .nonempty()
  .refine(
    (events) => new Set(events.map(([event]) => event)).size === events.length,
  );
export const AnnouncerCuesSchema = z.array(
  z.strictObject({
    mediaId,
    timeSeconds: z.number().nonnegative(),
  }),
);
type AnnouncerCues = z.infer<typeof AnnouncerCuesSchema>;

export function validateAnnouncerCues(
  cues: AnnouncerCues,
  events: z.infer<typeof AnnouncerEventsSchema>,
  durationSeconds: number,
) {
  const media = new Set(events.map(([, id]) => id));
  if (
    cues.some(
      ({ mediaId, timeSeconds }, index) =>
        !media.has(mediaId) ||
        timeSeconds > durationSeconds ||
        timeSeconds < (cues[index - 1]?.timeSeconds ?? 0),
    )
  )
    throw new Error(
      "Announcer worker cue disagrees with the catalog or replay clock",
    );
}

const cue = <Id extends number>(mediaId: Id) =>
  z.strictObject({
    mediaId: z.literal(mediaId),
    timeSeconds: z.number().positive(),
  });
const TimelineSchema = z.strictObject({
  profile: z.literal("female1-en-us"),
  replaySha256: digest,
  receiptSha256: digest,
  cues: z.union([
    z.tuple([cue(133352710), cue(696717127)]),
    z.tuple([cue(133352710), cue(696717127), cue(56523430)]),
    z.tuple([cue(133352710), cue(696717127), cue(56523430), cue(963276642)]),
  ]),
});

type Clock = Pick<
  ReplaySessionState,
  "timeSeconds" | "durationSeconds" | "rate" | "playing" | "perspective"
>;

const combatCueFields = {
  replaySha256: digest,
  scope: z.literal("packet-clock-dry-source"),
  mediaId: z.literal(329446178),
};
export const sennaGroundHitWav = "combat-audio/329446178.wav";
const combatClock = z.number().positive();
export const CombatCueSchema = z.union([
  z.strictObject({ ...combatCueFields, timeSeconds: combatClock }),
  z.strictObject({
    ...combatCueFields,
    timesSeconds: z
      .array(combatClock)
      .nonempty()
      .max(46)
      .refine((times) =>
        times.every((time, index) => time > (times[index - 1] ?? 0)),
      ),
  }),
]);
type Cue = {
  resource: string;
  timeSeconds: number;
  allVisionOnly?: true;
};

export class ScoutTerrainAnnouncer {
  #context: AudioContext | undefined;
  #sounds: (Cue & { buffer: AudioBuffer })[] | undefined;
  #clock: Clock | undefined;
  #sources = new Map<AudioBufferSourceNode, boolean>();
  #scheduled = { announcer: false, combat: false };
  #enabled = false;
  #request = 0;

  constructor(
    private readonly resources: ReplayResources,
    private readonly replaySha256: string,
    private readonly signal: AbortSignal,
    private readonly options: {
      announcer: boolean;
      combat: boolean;
      decodedCues?: AnnouncerCues;
      combatCueTimes?: readonly number[];
    },
  ) {}

  async setEnabled(enabled: boolean) {
    this.signal.throwIfAborted();
    const request = ++this.#request;
    if (!enabled) {
      this.#enabled = false;
      this.invalidate();
      return;
    }
    const context = (this.#context ??= new AudioContext());
    // Start resuming in the user gesture before fetching or decoding anything.
    const resume = context.resume();
    try {
      const [sounds] = await Promise.all([
        this.#sounds ?? this.#loadSounds(context),
        resume,
      ]);
      if (request !== this.#request) return;
      this.#sounds = sounds;
      this.#enabled = true;
      this.#schedule();
    } catch (error) {
      if (request !== this.#request) return;
      this.#enabled = false;
      this.invalidate();
      throw error;
    }
  }

  async #readAnnouncerCues() {
    if (this.options.decodedCues !== undefined) return this.options.decodedCues;
    const bytes = await this.resources.read("announcer-preview/cues.json");
    const timeline = TimelineSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
    if (timeline.replaySha256 !== this.replaySha256)
      throw new Error("Announcer cue timeline belongs to another replay");
    return timeline.cues;
  }

  async #readCombatCues(): Promise<Cue[]> {
    if (this.options.combatCueTimes !== undefined)
      return this.options.combatCueTimes.map((timeSeconds) => ({
        resource: sennaGroundHitWav,
        timeSeconds,
        allVisionOnly: true,
      }));
    const bytes = await this.resources.read("combat-audio/cue.json");
    const cue = CombatCueSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
    if (cue.replaySha256 !== this.replaySha256)
      throw new Error("Combat audio cue belongs to another replay");
    const times = "timesSeconds" in cue ? cue.timesSeconds : [cue.timeSeconds];
    const duration = this.#clock?.durationSeconds;
    if (duration !== undefined && times.some((time) => time >= duration))
      throw new Error("Combat audio cue exceeds the replay clock");
    return times.map((timeSeconds) => ({
      resource: sennaGroundHitWav,
      timeSeconds,
      allVisionOnly: true,
    }));
  }

  async #loadSounds(context: AudioContext) {
    const [announcer, combat] = await Promise.all([
      this.options.announcer ? this.#readAnnouncerCues() : [],
      this.options.combat ? this.#readCombatCues() : [],
    ]);
    const cues: Cue[] = announcer.map(({ mediaId, timeSeconds }) => ({
      resource: `announcer-preview/${String(mediaId)}.wav`,
      timeSeconds,
    }));
    cues.push(...combat);
    const media = new Map<string, Promise<AudioBuffer>>();
    return Promise.all(
      cues.map(async (cue) => {
        let buffer = media.get(cue.resource);
        if (buffer === undefined) {
          buffer = this.resources.read(cue.resource).then((wav) => {
            this.signal.throwIfAborted();
            return context.decodeAudioData(wav.buffer);
          });
          media.set(cue.resource, buffer);
        }
        return {
          ...cue,
          buffer: await buffer,
        };
      }),
    );
  }

  update(clock: Clock) {
    if (
      this.#clock?.playing !== clock.playing ||
      this.#clock.rate !== clock.rate
    ) {
      this.invalidate();
    } else if (
      this.options.combat &&
      this.#clock.perspective !== clock.perspective
    ) {
      this.#scheduled.combat = false;
      this.#stopSources(true);
    }
    this.#clock = clock;
    this.#schedule();
  }

  invalidate() {
    this.#scheduled.announcer = false;
    this.#scheduled.combat = false;
    this.#stopSources(false);
  }

  #stopSources(combatOnly: boolean) {
    for (const [source, isCombat] of this.#sources) {
      if (combatOnly && !isCombat) continue;
      source.onended = null;
      source.stop();
      source.disconnect();
      this.#sources.delete(source);
    }
  }

  #schedule() {
    const clock = this.#clock;
    const context = this.#context;
    if (!this.#enabled || !clock?.playing || !context || !this.#sounds) return;
    const scheduleAnnouncer =
      this.options.announcer && !this.#scheduled.announcer;
    const scheduleCombat =
      this.options.combat &&
      !this.#scheduled.combat &&
      clock.perspective === "all";
    if (!scheduleAnnouncer && !scheduleCombat) return;
    this.#scheduled.announcer ||= scheduleAnnouncer;
    this.#scheduled.combat ||= scheduleCombat;
    const audioTime = context.currentTime;
    for (const { timeSeconds, buffer, allVisionOnly } of this.#sounds) {
      if (allVisionOnly ? !scheduleCombat : !scheduleAnnouncer) continue;
      const start = Math.max(timeSeconds, clock.timeSeconds);
      const end = Math.min(
        timeSeconds + buffer.duration,
        clock.durationSeconds,
      );
      if (start >= end) continue;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = clock.rate;
      source.connect(context.destination);
      source.onended = () => {
        this.#sources.delete(source);
        source.disconnect();
      };
      source.start(
        audioTime + (start - clock.timeSeconds) / clock.rate,
        start - timeSeconds,
        end - start,
      );
      this.#sources.set(source, allVisionOnly === true);
    }
  }

  dispose() {
    this.#request++;
    this.#enabled = false;
    this.invalidate();
    const context = this.#context;
    this.#context = undefined;
    this.#sounds = undefined;
    void context?.close().catch(() => {
      // An already-closed context has no remaining audio resources.
    });
  }
}
