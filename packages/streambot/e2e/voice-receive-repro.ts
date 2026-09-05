/**
 * Minimal voice-INGRESS repro harness.
 *
 * Reproduces the production failure where Streambot joined voice, saw speakers,
 * but never received a single inbound audio packet (`voice_receive_packets_total`
 * never emitted; `lastPacketAtMs` null). No wake models, no OpenAI, no session
 * machine — just: one selfbot joins as a RECEIVER (receiveAudio:true) and a
 * second selfbot joins and replays a `.dopus` fixture as a SPEAKER. We then
 * report exactly what the receiver's transport observed.
 *
 * Env:
 *   REPRO_RECEIVER_TOKEN   selfbot user token that receives
 *   REPRO_SENDER_TOKEN     selfbot user token that speaks
 *   REPRO_GUILD_ID         guild both accounts are in
 *   REPRO_CHANNEL_ID       a voice channel (type 2) in that guild
 *   REPRO_FIXTURE          optional .dopus path (default: a clean-positive clip)
 *   REPRO_SECONDS          optional observation window (default 20)
 *
 * Run: bun run e2e/voice-receive-repro.ts
 */
import path from "node:path";
import { Client } from "discord.js-selfbot-v13";
import { Streamer } from "@shepherdjerred/discord-video-stream";
import type {
  VoiceReceiveObserver,
  VoiceReceivePacketOutcome,
} from "@shepherdjerred/discord-video-stream";
import { decodeDiscordOpusContainer } from "@shepherdjerred/streambot/voice/discord-opus-container.ts";

function required(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required env ${name}`);
  }
  return value;
}

const RECEIVER_TOKEN = required("REPRO_RECEIVER_TOKEN");
const SENDER_TOKEN = required("REPRO_SENDER_TOKEN");
const GUILD_ID = required("REPRO_GUILD_ID");
const CHANNEL_ID = required("REPRO_CHANNEL_ID");
const FIXTURE = path.resolve(
  Bun.env["REPRO_FIXTURE"] ??
    path.join(
      import.meta.dir,
      "../test/fixtures/voice-corpus/clips/clean-positive-001.dopus",
    ),
);
const WINDOW_SECONDS = Number(Bun.env["REPRO_SECONDS"] ?? "20");

async function login(token: string, label: string): Promise<Client> {
  const client = new Client();
  const ready = new Promise<void>((resolve) => {
    client.once("ready", () => {
      resolve();
    });
  });
  await client.login(token);
  await ready;
  process.stdout.write(
    `[${label}] logged in as ${client.user?.username ?? "?"}\n`,
  );
  return client;
}

async function main(): Promise<void> {
  const packetOutcomes = new Map<VoiceReceivePacketOutcome, number>();
  const speaking = new Map<string, boolean>();
  let audioEvents = 0;
  let lastDave = { protocolVersion: 0, required: false, ready: false };
  let receiveReady = false;

  const observer: VoiceReceiveObserver = {
    onPacket: (o) => {
      packetOutcomes.set(o.outcome, (packetOutcomes.get(o.outcome) ?? 0) + 1);
    },
    onSpeaking: (o) => {
      speaking.set(o.userId, o.speaking);
    },
    onDaveState: (o) => {
      lastDave = {
        protocolVersion: o.protocolVersion,
        required: o.required,
        ready: o.ready,
      };
    },
    onReceiveState: (o) => {
      receiveReady = o.ready;
    },
  };

  const receiverClient = await login(RECEIVER_TOKEN, "receiver");
  const senderClient = await login(SENDER_TOKEN, "sender");
  const receiver = new Streamer(receiverClient);
  const sender = new Streamer(senderClient);

  process.stdout.write("[receiver] joining voice (receiveAudio:true)…\n");
  await receiver.joinVoice(GUILD_ID, CHANNEL_ID, {
    receiveAudio: true,
    receiveObserver: observer,
  });
  // Also count the high-level decoded "audio" events the pipeline would consume.
  receiver.voiceConnection?.on("audio", () => {
    audioEvents += 1;
  });

  process.stdout.write("[sender] joining voice…\n");
  const sConn = await sender.joinVoice(GUILD_ID, CHANNEL_ID, {
    receiveAudio: true,
  });

  // Give DAVE (needs ≥2 participants) a moment to establish its MLS group.
  await Bun.sleep(4000);
  process.stdout.write(
    `[receiver] dave=${JSON.stringify(lastDave)} receiveReady=${String(receiveReady)}\n`,
  );

  // Optional pause so a human can join the same channel and watch/talk before
  // the fixture replay begins. Any human speech in the window is also observed.
  const preSendWait = Number(Bun.env["REPRO_PRESEND_WAIT"] ?? "0");
  if (preSendWait > 0) {
    process.stdout.write(
      `\n>>> JOIN the voice channel now — starting fixture replay in ${String(preSendWait)}s. Talk if you like; any speech is recorded too. <<<\n\n`,
    );
    for (let remaining = preSendWait; remaining > 0; remaining -= 5) {
      await Bun.sleep(Math.min(5, remaining) * 1000);
      process.stdout.write(
        `  …${String(Math.max(0, remaining - 5))}s to replay | speaking so far: ${JSON.stringify(Object.fromEntries(speaking))} | inbound packets: ${String([...packetOutcomes.values()].reduce((a, b) => a + b, 0))}\n`,
      );
    }
  }

  const container = decodeDiscordOpusContainer(
    new Uint8Array(await Bun.file(FIXTURE).arrayBuffer()),
  );
  process.stdout.write(
    `[sender] replaying ${String(container.packets.length)} opus frames from ${path.basename(FIXTURE)} (looping for ~${String(WINDOW_SECONDS)}s)…\n`,
  );

  const deadline = Bun.nanoseconds() + WINDOW_SECONDS * 1e9;
  sConn.mediaConnection.setSpeaking(true);
  try {
    while (Bun.nanoseconds() < deadline) {
      for (const packet of container.packets) {
        sConn.sendAudioFrame(Buffer.from(packet), 20);
        await Bun.sleep(20);
        if (Bun.nanoseconds() >= deadline) break;
      }
    }
  } finally {
    sConn.mediaConnection.setSpeaking(false);
  }

  // Let any in-flight inbound packets land.
  await Bun.sleep(1000);

  const totalPackets = [...packetOutcomes.values()].reduce((a, b) => a + b, 0);
  process.stdout.write("\n===== RECEIVE REPRO REPORT =====\n");
  process.stdout.write(`sender id: ${senderClient.user?.id ?? "?"}\n`);
  process.stdout.write(
    `dave: version=${String(lastDave.protocolVersion)} required=${String(lastDave.required)} ready=${String(lastDave.ready)}\n`,
  );
  process.stdout.write(`receiveReady: ${String(receiveReady)}\n`);
  process.stdout.write(
    `speaking observations: ${JSON.stringify(Object.fromEntries(speaking))}\n`,
  );
  process.stdout.write(
    `inbound packets by outcome: ${JSON.stringify(Object.fromEntries(packetOutcomes))}\n`,
  );
  process.stdout.write(`total inbound packets: ${String(totalPackets)}\n`);
  process.stdout.write(`decoded "audio" events: ${String(audioEvents)}\n`);
  if (totalPackets === 0) {
    process.stdout.write(
      "\nRESULT: REPRODUCED — receiver got zero inbound packets despite a speaker sending audio.\n",
    );
  } else if ((packetOutcomes.get("accepted") ?? 0) > 0) {
    process.stdout.write(
      "\nRESULT: HEALTHY — receiver accepted inbound audio (bug not reproduced here).\n",
    );
  } else {
    process.stdout.write(
      "\nRESULT: PARTIAL — packets arrived but none accepted (see outcome breakdown).\n",
    );
  }

  receiver.leaveVoice();
  sender.leaveVoice();
  receiverClient.destroy();
  senderClient.destroy();
}

await main();
process.exit(0);
