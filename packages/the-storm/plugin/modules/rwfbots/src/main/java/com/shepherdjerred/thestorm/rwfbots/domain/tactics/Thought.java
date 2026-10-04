package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.record.DecisionTrace;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;

/** The outcome of one think: the next state, the decision for the body, and the trace. */
public record Thought(TacticsState state, Decision decision, DecisionTrace trace) {}
