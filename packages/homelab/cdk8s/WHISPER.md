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
   - Lower the **Minimum Score** if you want Whisper-generated subtitles to be automatically used:
     - Episodes: below 241/360 (~67%)
     - Movies: below 61/120 (~51%)

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
kubectl get secret -n media media-groq-secrets -o yaml
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
