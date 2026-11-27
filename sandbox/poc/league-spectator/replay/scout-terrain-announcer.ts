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
  "timeSeconds" | "durationSeconds" | "rate" | "playing"
>;

export class ScoutTerrainAnnouncer {
  #context: AudioContext | undefined;
  #sounds: { timeSeconds: number; buffer: AudioBuffer }[] | undefined;
  #clock: Clock | undefined;
  #sources = new Set<AudioBufferSourceNode>();
  #scheduled = false;
  #enabled = false;
  #request = 0;

  constructor(
    private readonly resources: ReplayResources,
    private readonly replaySha256: string,
    private readonly signal: AbortSignal,
    private readonly decodedCues?: AnnouncerCues,
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

  async #readCues() {
    if (this.decodedCues !== undefined) return this.decodedCues;
    const bytes = await this.resources.read("announcer-preview/cues.json");
    const timeline = TimelineSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
    if (timeline.replaySha256 !== this.replaySha256)
      throw new Error("Announcer cue timeline belongs to another replay");
    return timeline.cues;
  }

  async #loadSounds(context: AudioContext) {
    const cues = await this.#readCues();
    const media = new Map<number, Promise<AudioBuffer>>();
    return Promise.all(
      cues.map(async ({ mediaId, timeSeconds }) => {
        let buffer = media.get(mediaId);
        if (buffer === undefined) {
          buffer = this.resources
            .read(`announcer-preview/${mediaId}.wav`)
            .then((wav) => {
              this.signal.throwIfAborted();
              return context.decodeAudioData(wav.buffer);
            });
          media.set(mediaId, buffer);
        }
        return {
          timeSeconds,
          buffer: await buffer,
        };
      }),
    );
  }

  update(clock: Clock) {
    if (
      this.#clock?.playing !== clock.playing ||
      this.#clock.rate !== clock.rate
    )
      this.invalidate();
    this.#clock = clock;
    this.#schedule();
  }

  invalidate() {
    this.#scheduled = false;
    for (const source of this.#sources) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    this.#sources.clear();
  }

  #schedule() {
    const clock = this.#clock;
    const context = this.#context;
    if (
      !this.#enabled ||
      this.#scheduled ||
      !clock?.playing ||
      !context ||
      !this.#sounds
    )
      return;
    this.#scheduled = true;
    const audioTime = context.currentTime;
    for (const { timeSeconds, buffer } of this.#sounds) {
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
      this.#sources.add(source);
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
