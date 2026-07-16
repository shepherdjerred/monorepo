import { createServer, type Server, type Socket } from "node:net";
import { PassThrough } from "node:stream";

// The emulator emits raw PCM (games differ in sample format and rate: pokemon
// hands ffmpeg the m4a mixer's un-quantised Float32 LRLR PCM at 13379 Hz;
// mario-kart hands it resampled signed-16-bit LE stereo at 44.1 kHz). ffmpeg
// reads it raw over a loopback socket, so the format must be declared explicitly.
export type AudioSampleFormat = "s16le" | "f32le";

export type AudioTransportOptions = {
  /** ffmpeg raw-PCM sample format (`-f`). f32le for un-quantised mixer output, s16le for resampled PCM. */
  format: AudioSampleFormat;
  /** Sample rate in Hz (`-ar`). */
  sampleRate: number;
  /** Channel count (`-ac`). */
  channels: number;
};

export function buildAudioInputOptions(
  options: AudioTransportOptions,
): string[] {
  return [
    "-f",
    options.format,
    "-ar",
    String(options.sampleRate),
    "-ac",
    String(options.channels),
  ];
}

export type AudioTransport = {
  /** Write raw PCM (in the configured format) here; piped to ffmpeg's audio input once it connects. */
  readonly sink: PassThrough;
  /** ffmpeg input source — a loopback TCP url ffmpeg dials as a client. */
  readonly source: string;
  /** ffmpeg input options describing the raw PCM format (see buildAudioInputOptions). */
  readonly inputOptions: string[];
  /** End the sink and tear down the connected socket + listening server. Idempotent. */
  readonly close: () => void;
};

// Bind a server to an ephemeral loopback port and resolve with the chosen port.
function listenOnLoopback(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("audio TCP server did not bind to a numeric port"));
        return;
      }
      resolve(address.port);
    });
  });
}

/**
 * Stand up the out-of-band audio transport for prepareStream.
 *
 * fluent-ffmpeg can only pipe one Readable (the video frames, to stdin), so the
 * second live input (audio) reaches ffmpeg over a loopback TCP socket it dials as
 * a client (`tcp://127.0.0.1:<port>`). Callers write PCM into `sink` and pass
 * `{ source, inputOptions }` to prepareStream's `audioInput`. The server is
 * listening before this resolves, so ffmpeg's connect succeeds immediately.
 */
export async function createAudioTransport(
  options: AudioTransportOptions,
): Promise<AudioTransport> {
  const sink = new PassThrough();
  let socket: Socket | null = null;
  const server = createServer((connection) => {
    socket = connection;
    // Stop accepting new connections immediately after the first ffmpeg client
    // connects. Leaving the server open would allow a second connect (e.g. an
    // ffmpeg reconnect on error) to pipe the same sink to a second destination,
    // duplicating audio bytes and leaking the first socket's lifetime.
    server.close();
    // ffmpeg dropping the connection on stop surfaces as a socket error; the
    // close() path owns cleanup, so just keep it from crashing the process.
    connection.on("error", () => {
      /* ffmpeg closed the audio input; expected on stop */
    });
    sink.pipe(connection);
  });
  const port = await listenOnLoopback(server);

  let closed = false;
  return {
    sink,
    source: `tcp://127.0.0.1:${String(port)}`,
    inputOptions: buildAudioInputOptions(options),
    close: () => {
      if (closed) return;
      closed = true;
      sink.end();
      if (socket !== null) socket.destroy();
      server.close();
    },
  };
}
