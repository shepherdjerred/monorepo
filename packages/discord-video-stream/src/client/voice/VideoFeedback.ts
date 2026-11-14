/** Feedback from the Discord transport peer, not viewer decode or playout telemetry. */
export type VideoFeedback =
  | {
      type: "receiver-report";
      fractionLost: number;
      cumulativePacketsLost: number;
      jitterSeconds: number;
    }
  | { type: "nack"; requestedPackets: number }
  | { type: "pli" }
  | { type: "fir"; requests: number }
  | { type: "malformed" };

/** Submission to native media handling is not an acknowledgement of wire or viewer delivery. */
export type VideoSubmission = {
  outcome: "submitted" | "not-ready" | "missing-packetizer" | "missing-track" | "error";
};

const VIDEO_CLOCK_RATE = 90_000;
const MAX_COMPOUND_BYTES = 65_536;

/**
 * Decode only the bounded diagnostic fields we need from compound RTCP. Malformed external
 * packets produce one diagnostic outcome, never partial reports or an exception. Unknown packet
 * types and reports for another SSRC are ignored. No payloads or identities leave this boundary.
 */
export function parseVideoFeedback(packet: Buffer, videoSsrc: number): VideoFeedback[] {
  const events: VideoFeedback[] = [];
  const malformed = (): VideoFeedback[] => [{ type: "malformed" }];
  if (packet.length < 4 || packet.length > MAX_COMPOUND_BYTES) return malformed();
  // Track callbacks can also carry RTP. Those are not RTCP parser failures.
  if (packet.readUInt8(1) < 192 || packet.readUInt8(1) > 223) return [];
  let offset = 0;
  while (offset < packet.length) {
    if (packet.length - offset < 4 || packet.readUInt8(offset) >> 6 !== 2) return malformed();
    const count = packet.readUInt8(offset) & 0x1f;
    const type = packet.readUInt8(offset + 1);
    const length = (packet.readUInt16BE(offset + 2) + 1) * 4;
    const end = offset + length;
    if (end > packet.length) return malformed();
    let payloadEnd = end;
    if (packet.readUInt8(offset) & 0x20) {
      const padding = packet.readUInt8(end - 1);
      if (end !== packet.length || padding === 0 || padding > length - 4) return malformed();
      payloadEnd -= padding;
    }
    if (type === 200 || type === 201) {
      const reportStart = offset + (type === 200 ? 28 : 8);
      if (reportStart + count * 24 > payloadEnd) return malformed();
      for (let report = reportStart; report < reportStart + count * 24; report += 24) {
        if (packet.readUInt32BE(report) !== videoSsrc) continue;
        events.push({
          type: "receiver-report",
          fractionLost: packet.readUInt8(report + 4) / 256,
          cumulativePacketsLost: packet.readIntBE(report + 5, 3),
          jitterSeconds: packet.readUInt32BE(report + 12) / VIDEO_CLOCK_RATE,
        });
      }
    } else if ((type === 205 && count === 1) || (type === 206 && (count === 1 || count === 4))) {
      if (payloadEnd - offset < 12) return malformed();
      const mediaSsrc = packet.readUInt32BE(offset + 8);
      const bodyBytes = payloadEnd - offset - 12;
      if (type === 205) {
        if (bodyBytes < 4 || bodyBytes % 4 !== 0) return malformed();
        if (mediaSsrc === videoSsrc) {
          let requestedPackets = 0;
          for (let field = offset + 12; field < payloadEnd; field += 4) {
            requestedPackets++;
            let mask = packet.readUInt16BE(field + 2);
            while (mask !== 0) {
              requestedPackets += mask & 1;
              mask >>>= 1;
            }
          }
          events.push({ type: "nack", requestedPackets });
        }
      } else if (count === 1) {
        if (bodyBytes !== 0) return malformed();
        if (mediaSsrc === videoSsrc) events.push({ type: "pli" });
      } else {
        if (bodyBytes < 8 || bodyBytes % 8 !== 0) return malformed();
        let requests = 0;
        // FIR's media-source field is normally zero; targets live in its FCI entries.
        for (let field = offset + 12; field < payloadEnd; field += 8) {
          if (packet.readUInt32BE(field) === videoSsrc) requests++;
        }
        if (requests > 0) events.push({ type: "fir", requests });
      }
    }
    offset = end;
  }
  return events;
}
