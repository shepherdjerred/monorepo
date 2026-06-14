import { createServer, type Server, type Socket } from "node:net";
import { PassThrough } from "node:stream";
import { AUDIO_SAMPLE_RATE, AUDIO_CHANNELS } from "#src/emulator/constants.ts";

// The emulator emits resampled PCM (signed 16-bit LE, stereo, 44.1 kHz). ffmpeg
// reads it raw over a loopback socket, so the format must be declared explicitly.
export const AUDIO_INPUT_OPTIONS = [
  "-f",
  "s16le",
  "-ar",
  String(AUDIO_SAMPLE_RATE),
  "-ac",
  String(AUDIO_CHANNELS),
];

export type AudioTransport = {
  /** Write resampled PCM here; piped to ffmpeg's audio input once it connects. */
  readonly sink: PassThrough;
  /** ffmpeg input source — a loopback TCP url ffmpeg dials as a client. */
  readonly source: string;
  /** ffmpeg input options describing the raw PCM format (see AUDIO_INPUT_OPTIONS). */
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
export async function createAudioTransport(): Promise<AudioTransport> {
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
    inputOptions: AUDIO_INPUT_OPTIONS,
    close: () => {
      if (closed) return;
      closed = true;
      sink.end();
      if (socket !== null) socket.destroy();
      server.close();
    },
  };
}
