package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Levers;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;

/**
 * What the think step needs that does not change during a match.
 *
 * @param nav the baked map
 * @param levers the bot's levers
 * @param style the bot's play style
 * @param hasGapples whether the kit can heal
 * @param hasRewind whether the kit has the rewind clock
 */
public record TacticsContext(
    NavArtifact nav, Levers levers, Style style, boolean hasGapples, boolean hasRewind) {}
