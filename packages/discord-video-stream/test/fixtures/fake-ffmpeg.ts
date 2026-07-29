#!/usr/bin/env bun

const missingInput = "/definitely/not/a/real/discord-video-stream-input";

if (process.argv.includes(missingInput)) {
  console.error(`${missingInput}: No such file or directory`);
  process.exit(2);
}

console.error("Input #0, lavfi, from 'testsrc':");
console.error("  Duration: 00:00:01.00, start: 0.000000, bitrate: N/A");
console.error("  Stream #0:0: Video: wrapped_avframe, yuv420p");
console.error("frame=1");
console.error("fps=2");
console.error("bitrate=1.0kbits/s");
console.error("total_size=14");
console.error("out_time=00:00:01.000000");
console.error("progress=end");
process.stdout.write("fixture-output");
