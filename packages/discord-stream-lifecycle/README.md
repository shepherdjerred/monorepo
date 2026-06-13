# @shepherdjerred/discord-stream-lifecycle

Shared XState v5 lifecycle machines for Discord Go-Live streaming services.

This package intentionally sits above `@shepherdjerred/discord-video-stream`.
The video package owns the low-level Discord media transport and ffmpeg helpers;
this package owns state-machine modeling for joining voice, preparing encoders,
streaming, stopping, retrying, reacting to Discord topology events, and
reconciling desired stream state.

## Diagrams

```mermaid
stateDiagram-v2
  [*] --> idle
  idle --> joining: START
  joining --> preparing: join done
  joining --> stopping: STOP / external terminal
  preparing --> streaming: encoder ready
  preparing --> stopping: error / STOP
  streaming --> stopping: STOP / moved / detach / error
  stopping --> idle: clean stop
  stopping --> failed: stream error
  stopping --> terminated: detach / guild removed / channel deleted / shutdown
  failed --> joining: retry delay
  failed --> idle: retry exhausted / STOP
  failed --> terminated: terminal event
  idle --> terminated: terminal event
```

```mermaid
stateDiagram-v2
  [*] --> desiredDown
  desiredDown --> desiredUp: SET_DESIRED true
  desiredUp --> desiredDown: SET_DESIRED false
  desiredUp --> desiredDown: terminal child snapshot
  note right of desiredUp
    Child idle + desired=true sends START.
    Child streaming + desired=false sends STOP.
    START/STOP during child transitions converge by snapshot reconciliation.
  end note
```
