package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.record.DecisionTrace;
import com.shepherdjerred.thestorm.rwfbots.domain.team.TeamNote;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;

/**
 * The outcome of one think: the next state, the decision for the body, the trace, and what the bot
 * tells its team (its cover claim, its target and its path).
 */
public record Thought(TacticsState state, Decision decision, DecisionTrace trace, TeamNote note) {}
