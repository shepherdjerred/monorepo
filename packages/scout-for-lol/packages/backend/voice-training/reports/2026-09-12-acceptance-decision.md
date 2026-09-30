# Acceptance decision: 2026-09-12

## Automated corpus/soak result

`2026-09-12-threshold-0.35.json` — **failed** the automated pass gate:

- Clean-positive recall 88.1% (native) / 87.5% (wasm) — target 100%
- Stress recall (≥10dB SNR) 72.5% — target ≥95%
- Near-match-negative false accepts: 7/60 (the bare-"scout" bucket)
- 2-hour negative soak: 28 (native) / 46 (wasm) activations — target 0
- Endpoint-delay violations on 153/192 activated clips (median ~510-520ms, below
  the 650ms floor)

Two follow-up attempts adjusting `HEY_SCOUT`/`SCOUT` fragment tails (0→350→900ms)
were tried to fix the endpoint-delay violations. Both left the delay essentially
unchanged (~510-540ms median) while recall fell further (88%→72%→39%) — the tail
value is not the lever that controls this delay in the range tested, and the
recall collapse at high tail values points at a different constraint (likely
clip trailing-audio length or a VAD/timeout interaction in the synthetic-corpus
harness) that hasn't been traced yet. Tail values were reverted to the original
`{HEY_SCOUT: 0, SCOUT: 0, HEY: 500}` — see the dated comment in
`../../assets/voice/fragment-tails.json` and
`../../src/voice-assistant/constants.ts`.

## Live operator review

A manual microphone probe (`scripts/smoke/voice-probe.ts`, Studio Display mic,
same trained assets and threshold, reverted tail values) was run against real
continuous speech rather than the fixed-length synthetic clips. Five spoken
wake attempts: four accepted (local-verifier scores 0.630-0.952), one rejected
at low confidence (0.069) immediately followed by a clean acceptance of the
same phrase — consistent with a normal false start, not a systemic miss.
Transcripts were accurate and tool grounding was correct (Cho'Gath R, Pyke R)
for fact questions; a meta/best-effort question ("what should I build next as
Warwick?") was handled without forcing an ungrounded lookup, as designed.

**Decision (Jerred, operator): accepted.** The live probe result is treated as
the controlling acceptance signal over the synthetic-corpus numbers, per this
repo's "measured, not CI-gated" review model — the corpus/soak harness likely
undercounts recall and overcounts endpoint violations due to its fixed-length
clip generation (clips may lack sufficient trailing audio for the pipeline's
buffering behavior), a hypothesis not yet confirmed by tracing
`audio-lifecycle.ts`'s VAD-completion path. This is a known gap worth revisiting
if the corpus-eval methodology is used for future phrase acceptance, but it does
not block shipping "hey scout" with the current trained assets.

Bare-"scout" false-trigger risk (the soak's 28-46 activations) was not
separately re-validated live in this session beyond the five positive
attempts above.

The formal human holdout (3 speakers × 10 clips, `voice:human:evaluate
--phrase hey-scout`) was explicitly not run — Jerred reviewed the live probe
result and confirmed it as sufficient acceptance evidence on its own.

## Addendum: real-audio false-accept validation (2026-09-12)

Codex's follow-up review correctly flagged that the above acceptance never
independently re-checked the soak's failing false-accept numbers against
anything but the synthetic corpus. `2026-09-12-real-audio-soak.md` closes that
gap: ~2.5 hours of real public LoL Esports broadcast commentary (two leagues,
different casting teams), fed through the same continuous-session mechanism as
the synthetic soak, produced **0 false wakes over the full 2-hour comparison
window on both native and wasm runtimes** — versus 28 (native) / 46 (wasm) on
the synthetic near-match corpus over the same window.

This is direct measured evidence, not a hypothesis: the synthetic near-match
corpus's adversarial "scout"-adjacent TTS/procedural phrasings do not reflect
how the word is actually said in natural broadcast speech, even in a domain
that says "scout" constantly. The bare-"scout" false-trigger risk this PR was
blocked on is not corroborated by real audio at the tested scale.

**Decision (Jerred, operator): the acceptance stands, now on real-audio
evidence for the previously-unaddressed side of the review.** Existing
mitigations (cloud-verification rate limiting, per-key spend ceiling) continue
to bound residual risk from the synthetic-corpus-measured rate. The
corpus/soak harness's external-validity gap (synthetic-only audio) remains a
known limitation worth tracking if this methodology is reused for future
phrase acceptance, but it no longer blocks this PR.
