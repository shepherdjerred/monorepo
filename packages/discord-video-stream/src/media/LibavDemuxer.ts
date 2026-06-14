import pDebounce from "p-debounce";
import {
  BitStreamFilterAPI,
  Demuxer,
  avGetCodecName,
  type Stream,
} from "node-av";
import { Log } from "debug-level";
import { randomUUID } from "node:crypto";
import { AVCodecID } from "./LibavCodecId.js";
import { PassThrough } from "node:stream";
import type { CodecParameters, Packet } from "node-av";
import type { Readable } from "node:stream";

type MediaStreamInfoCommon = {
  index: number;
  codec: AVCodecID;
  codecpar: CodecParameters;
  avStream: Stream;
};

export type VideoStreamInfo = MediaStreamInfoCommon & {
  width: number;
  height: number;
  framerate_num: number;
  framerate_den: number;
};
export type AudioStreamInfo = MediaStreamInfoCommon & {
  sample_rate: number;
};

const allowedVideoCodec = new Set([
  AVCodecID.AV_CODEC_ID_H264,
  AVCodecID.AV_CODEC_ID_H265,
  AVCodecID.AV_CODEC_ID_VP8,
  AVCodecID.AV_CODEC_ID_VP9,
  AVCodecID.AV_CODEC_ID_AV1,
]);

const allowedAudioCodec = new Set([AVCodecID.AV_CODEC_ID_OPUS]);

function parseOpusPacketDuration(frame: Uint8Array) {
  const toc = frame[0];
  if (toc === undefined) throw new Error("Cannot parse an empty Opus packet");

  // https://datatracker.ietf.org/doc/html/rfc6716#section-3.1
  const frameSizes = [
    // SILK only, narrow band
    10, 20, 40, 60,

    // SILK only, medium band
    10, 20, 40, 60,

    // SILK only, wide band
    10, 20, 40, 60,

    // Hybrid, super wide band
    10, 20,

    // Hybrid, full band
    10, 20,

    // CELT only, narrow band
    2.5, 5, 10, 20,

    // CELT only, wide band
    2.5, 5, 10, 20,

    // CELT only, super wide band
    2.5, 5, 10, 20,

    // CELT only, full band
    2.5, 5, 10, 20,
  ];

  const size = frameSizes[toc >> 3];
  if (size === undefined) throw new Error("Invalid Opus packet TOC byte");
  const frameSize = (48000 / 1000) * size;

  let frameCount = 0;
  const c = toc & 0b11;
  switch (c) {
    case 0:
      frameCount = 1;
      break;

    case 1:
    case 2:
      frameCount = 2;
      break;

    case 3:
      {
        const countByte = frame[1];
        if (countByte === undefined)
          throw new Error("Invalid Opus code 3 packet");
        frameCount = countByte & 0b111111;
      }
      break;
  }

  return frameSize * frameCount;
}

type DemuxerOptions = {
  format: "matroska" | "nut";
};

export async function demux(input: Readable, { format }: DemuxerOptions) {
  const loggerFormat = new Log("demux:format");
  const loggerFrameCommon = new Log("demux:frame:common");
  const loggerFrameVideo = new Log("demux:frame:video");
  const loggerFrameAudio = new Log("demux:frame:audio");

  const filename = randomUUID();
  const demuxer = await Demuxer.open(input, {
    options: {
      fflags: "nobuffer",
    },
    format,
    bufferSize: 8192,
  });

  const cleanup = () => {
    input.destroy();
    demuxer.close();
    vPipe.off("drain", readFrame);
    aPipe.off("drain", readFrame);
    vPipe.end();
    aPipe.end();
    vbsf.forEach((e) => {
      e.close();
    });
  };

  const vStream = demuxer.video();
  const aStream = demuxer.audio();

  let vInfo: VideoStreamInfo | undefined;
  let aInfo: AudioStreamInfo | undefined;
  const vPipe = new PassThrough({
    objectMode: true,
    writableHighWaterMark: 128,
  });
  const aPipe = new PassThrough({
    objectMode: true,
    writableHighWaterMark: 128,
  });

  const vbsf: BitStreamFilterAPI[] = [];
  if (vStream) {
    const codecId = vStream.codecpar.codecId;
    if (!allowedVideoCodec.has(codecId)) {
      const codecName = avGetCodecName(codecId);
      cleanup();
      throw new Error(`Video codec ${codecName} is not allowed`);
    }
    try {
      switch (codecId) {
        case AVCodecID.AV_CODEC_ID_H264:
          vbsf.push(BitStreamFilterAPI.create("h264_mp4toannexb", vStream));
          vbsf.push(
            BitStreamFilterAPI.create("h264_metadata", vStream, {
              options: {
                aud: "remove",
              },
            }),
          );
          vbsf.push(BitStreamFilterAPI.create("dump_extra", vStream));
          break;
        case AVCodecID.AV_CODEC_ID_HEVC:
          vbsf.push(BitStreamFilterAPI.create("hevc_mp4toannexb", vStream));
          vbsf.push(
            BitStreamFilterAPI.create("hevc_metadata", vStream, {
              options: {
                aud: "remove",
              },
            }),
          );
          vbsf.push(BitStreamFilterAPI.create("dump_extra", vStream));
          break;
        default:
          vbsf.push(BitStreamFilterAPI.create("null", vStream));
          break;
      }
    } catch (e) {
      cleanup();
      throw new Error(`Failed to construct bitstream filterchain`, {
        cause: e instanceof Error ? e.cause : e,
      });
    }

    const codecpar = vbsf.at(-1)?.outputCodecParameters ?? vStream.codecpar;
    vInfo = {
      index: vStream.index,
      codec: codecId,
      codecpar,
      width: codecpar.width ?? 0,
      height: codecpar.height ?? 0,
      framerate_num: codecpar.frameRate.num,
      framerate_den: codecpar.frameRate.den,
      avStream: vStream,
    };
    loggerFormat.info(
      {
        info: vInfo,
      },
      `Found video stream in input ${filename}`,
    );
  }
  if (aStream) {
    const codecId = aStream.codecpar.codecId;
    if (!allowedAudioCodec.has(codecId)) {
      const codecName = avGetCodecName(codecId);
      cleanup();
      throw new Error(`Audio codec ${codecName} is not allowed`);
    }
    aInfo = {
      index: aStream.index,
      codec: codecId,
      codecpar: aStream.codecpar,
      sample_rate: aStream.codecpar.sampleRate || 0,
      avStream: aStream,
    };
    loggerFormat.info(
      {
        info: aInfo,
      },
      `Found audio stream in input ${filename}`,
    );
  }

  const packetIterator = demuxer.packets();
  const applyBitStreamFilters = async (
    input: Packet | null,
    filters: BitStreamFilterAPI[],
  ) => {
    let packets = [input];
    for (const filter of filters) {
      let newPackets: (Packet | null)[] = [];
      for (const packet of packets) {
        newPackets = [...newPackets, ...(await filter.filterAll(packet))];
        packet?.free();
      }
      if (!input) newPackets.push(null);
      packets = newPackets;
    }
    return packets;
  };
  const readFrame = pDebounce.promise(async () => {
    let resume = true;
    while (resume) {
      try {
        const { value: inPacket, done } = await packetIterator.next();
        if (done) {
          loggerFrameCommon.info("Reached end of stream. Stopping");
          const packets = await applyBitStreamFilters(null, vbsf);
          for (const packet of packets) {
            if (packet) vPipe.write(packet);
          }
          cleanup();
          return;
        } else if (inPacket) {
          const streamIndex = inPacket.streamIndex;
          if (vInfo && vInfo.index === streamIndex) {
            loggerFrameVideo.trace("Received a video packet");
            const packets = await applyBitStreamFilters(inPacket.clone(), vbsf);
            // Write every packet the filter chain produced, even after backpressure fires:
            // short-circuiting on the first `false` would drop (and leak) every subsequent
            // packet in this array. `resume &&= write(...)` would also short-circuit if
            // `resume` was already false from an earlier iteration's audio write, silently
            // dropping these video packets. Track backpressure separately.
            for (const packet of packets) {
              if (!packet) continue;
              if (!vPipe.write(packet)) resume = false;
            }
          } else if (aInfo && aInfo.index === streamIndex) {
            const packet = inPacket.clone();
            if (!packet) {
              inPacket.free();
              continue;
            }
            if (!packet.data) {
              packet.free();
              inPacket.free();
              continue;
            }
            packet.duration ||= BigInt(parseOpusPacketDuration(packet.data));
            if (!aPipe.write(packet)) resume = false;
          }
          inPacket.free();
        }
      } catch (e) {
        loggerFrameCommon.info(
          { error: e },
          "Received an error during frame extraction. Stopping",
        );
        cleanup();
        return;
      }
    }
  });
  vPipe.on("drain", () => {
    loggerFrameVideo.trace("Video pipe drained");
    readFrame();
  });
  aPipe.on("drain", () => {
    loggerFrameAudio.trace("Audio pipe drained");
    readFrame();
  });
  readFrame();
  return {
    video: vInfo ? { ...vInfo, stream: vPipe as Readable } : undefined,
    audio: aInfo ? { ...aInfo, stream: aPipe as Readable } : undefined,
  };
}
