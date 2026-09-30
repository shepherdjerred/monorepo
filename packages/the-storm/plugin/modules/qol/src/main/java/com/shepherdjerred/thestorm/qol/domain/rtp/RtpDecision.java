package com.shepherdjerred.thestorm.qol.domain.rtp;

import java.time.Duration;

/** Whether a random teleport may happen, and what it costs. */
public sealed interface RtpDecision {

  /** Still inside the free window. */
  record Free() implements RtpDecision {}

  /** Costs {@code crystals}. */
  record Priced(long crystals) implements RtpDecision {}

  /** The cooldown has not elapsed. */
  record CoolingDown(Duration remaining) implements RtpDecision {}
}
