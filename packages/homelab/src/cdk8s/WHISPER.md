# Whisper Subtitle Generation Setup

This document describes how to configure Bazarr to use the Whisper provider for AI-powered
subtitle generation via Groq's cloud API.

## Architecture

```text
Bazarr -> whisperbridge (port 9000) -> Groq Whisper API
```

The `whisperbridge` container acts as a proxy between Bazarr's Whisper provider and Groq's OpenAI-compatible Whisper API.

## Why Groq?

| Feature        | OpenAI    | Groq                       |
| -------------- | --------- | -------------------------- |
| Price          | $0.36/hr  | **$0.03/hr** (12x cheaper) |
| Speed          | Real-time | **172x real-time**         |
| File limit     | 25MB      | **100MB**                  |
| Duration limit | 25 min    | **None**                   |
| Model          | whisper-1 | **whisper-large-v3**       |

## Deployment

The whisperbridge is deployed as part of the media chart. After deploying:

```bash
# Verify the pod is running
kubectl get pods -n media | grep whisperbridge

# Check logs
kubectl logs -n media -l cdk8s.io/metadata.addr=media-whisperbridge-c85075a8
```

## Bazarr Configuration

1. Open Bazarr at <https://bazarr.tailnet-1a49.ts.net> (or your configured URL)

2. Go to **Settings** -> **Providers**

3. Click **Add Provider** and select **Whisper**

4. Configure the provider:
   - **Endpoint**: `http://media-whisperbridge-service:9000`
   - **Timeout**: `3600` (1 hour - increase for very long files)

5. Click **Save**

6. Go to **Settings** -> **Languages**
   - Enable **Deep analyze media file to get audio tracks language** for best results

7. Go to **Settings** -> **Subtitles**
   - Lower the **Minimum Score** if you want Whisper-generated subtitles to be automatically
     used. The field is a percentage, not a raw score (defaults: 90 episodes, 80 movies), so
     the raw Whisper ceilings translate to:
     - Episodes: approximately `61` (220/360 before the hearing-impaired bonus)
     - Movies: approximately `33` (60/180 before the hearing-impaired bonus)

## Language limitation

Whisper **transcribes** in the language of the audio track, and **translates only into
English**. It can transcribe Chinese audio, but cannot translate English audio into
Chinese. Generated subtitles do not meet the human-authored Simplified policy.

Practical consequences:

- Whisper can provide English transcription or translation, subject to matching thresholds.
- Whisper can transcribe other languages when an audio track in that language is present.
- Chinese subtitles for English audio must come from a text provider
  or from an embedded track via the `embeddedsubtitles` provider.

## Testing

1. Go to a movie or episode in Bazarr
2. Click the manual search button
3. Select Whisper as the provider
4. The transcription should complete quickly (Groq is 172x real-time)

## Troubleshooting

### Check whisperbridge logs

```bash
kubectl logs -n media deployment/media-whisperbridge
```

### Verify Groq API key is loaded

```bash
kubectl get onepassworditem -n media
```

### Test the endpoint directly

```bash
kubectl run -it --rm curl --image=curlimages/curl -n media -- \
  curl -X GET http://media-whisperbridge-service:9000/
```

### Common issues

- **Timeout errors**: Increase the timeout in Bazarr settings
- **API key errors**: Verify the 1Password item is synced correctly
- **Large files failing**: Groq has a 100MB limit on Dev tier; very large files may need compression

## Cost Estimation

At $0.03/hour:

- 1 hour movie: ~$0.03
- 22-min TV episode: ~$0.01
- 100 episodes: ~$1.00

## References

- [Bazarr Whisper Provider Setup](https://wiki.bazarr.media/Additional-Configuration/Whisper-Provider/)
- [bazarr-openai-whisperbridge](https://github.com/McCloudS/bazarr-openai-whisperbridge)
- [Groq Speech-to-Text Docs](https://console.groq.com/docs/speech-to-text)
