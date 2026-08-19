---
title: Diagnose Streambot voice
description: Capture a missed wake and follow one voice attempt across Grafana, Tempo, Loki, its manifest, and playable WAV files.
sidebar:
  order: 13
---

Use this procedure when Streambot misses a wake, rejects a candidate, executes
the wrong stage, or fails to deliver a reply. You need Streambot admin access,
an active playback session, Grafana access, and the private `seaweedfs` AWS
profile.

Captures can contain other people's speech, Discord IDs, transcripts, media
queries, and tool results. Keep downloaded files private and delete local
copies when the investigation ends.

## 1. Verify storage retention

Check the lifecycle before recording user audio:

```bash
AWS_PROFILE=seaweedfs aws s3api get-bucket-lifecycle-configuration \
  --bucket streambot-voice-captures
```

Continue only when the enabled `expire-streambot-voice-captures` rule reports
90 days for the `voice-captures/` prefix. The AWS profile supplies the private
endpoint and credentials; do not put either value on the command line.

## 2. Check readiness before testing a wake

Open the Grafana dashboard with UID `streambot-voice`. In **Readiness and
ingress**, confirm:

1. the playback session is active;
2. receive and required DAVE readiness are `1`;
3. packet age advances when someone speaks;
4. accepted packet and decoded-input counters move.

If packet age does not move, the problem is before wake detection. Follow the
session's Loki records for DAVE readiness, speaking mappings, and bounded packet
outcomes. Do not treat five quiet minutes as an outage: Streambot logs silence
once for diagnosis and logs recovery on the next packet, but silence alone does
not alert.

## 3. Capture a missed-wake window

Join the voice channel that owns the active playback session, then run:

```text
/stream voice-debug start duration:60
```

Say the failing phrase and command. The response includes the capture ID. Use
`/stream voice-debug status` while it runs or `/stream voice-debug stop` after
the reproduction. The window otherwise finalizes at its requested duration.

Only one manual window can run in the process. It records at most eight
speakers and 96 MiB of decoded audio. Crossing either limit finalizes the
capture as truncated instead of consuming more memory.

A wake that reaches candidate detection is captured automatically, so no
manual window is needed for a local-verifier rejection or any later failure.
Use the manual window when the wake detector emitted no candidate at all.

## 4. Find the failing stage

Use the dashboard from left to right:

| Last healthy signal              | Inspect next                                             |
| -------------------------------- | -------------------------------------------------------- |
| Receive packet and decoded input | Wake score and candidate rate                            |
| Wake candidate                   | Local-verifier outcome and verifier score                |
| Local acceptance                 | Endpoint reason, utterance length, and DTX duration      |
| Endpoint completion              | Cloud transcript/prefix outcome and OpenAI stage         |
| Cloud acceptance                 | Validated tool arguments, result, and permission outcome |
| Tool or no-command response      | Reply packets, bytes, duration, and duck state           |

Expand a record in **Correlated voice logs**. Use **Trace in Tempo** for the
candidate's complete stage timeline. Use **Capture in Loki** to filter all
records with the same capture ID. The manifest's `traceId` is the same key when
you start from storage instead of Grafana.

## 5. Retrieve and verify the capture

Object dates use UTC. List the capture prefix, then download it:

```bash
capture_date=YYYY/MM/DD
capture_id=<capture-id>

AWS_PROFILE=seaweedfs aws s3 ls \
  "s3://streambot-voice-captures/voice-captures/${capture_date}/${capture_id}/"

mkdir "${capture_id}"
AWS_PROFILE=seaweedfs aws s3 cp --recursive \
  "s3://streambot-voice-captures/voice-captures/${capture_date}/${capture_id}/" \
  "${capture_id}/"
```

Treat the capture as committed only when `manifest.json` exists. Compare each
WAV's SHA-256 with `audio[].sha256` in the manifest:

```bash
shasum -a 256 "${capture_id}"/*.wav
```

On macOS, play one speaker file with:

```bash
afplay "${capture_id}/speaker-001.wav"
```

For a wake candidate, the file is `speaker.wav`. A rejected candidate contains
the verifier window; an accepted candidate contains the endpointed utterance.

## 6. Clean up local copies

After recording the finding you need, move the downloaded capture to Trash.
Do not attach it to a public issue, pull request, or chat transcript. SeaweedFS
deletes the private objects automatically after 90 days.

## Related

- [Streambot voice assistant](/explanation/streambot-voice/) — architecture and privacy boundaries
- [Streambot voice reference](/reference/streambot-voice/) — manifest, metrics, limits, and configuration
- [Run the Streambot voice probe](/how-to/run-the-streambot-voice-probe/) — reproduce the cascade locally on macOS
