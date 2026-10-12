package com.shepherdjerred.thestorm.rwfbots.app;

import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;

/**
 * What the think loop last decided for one bot: the standing decision, the latest percept the
 * reflex layer resolves targets against, and the life the decision was made for.
 *
 * @param decision the standing decision
 * @param percept the latest percept
 * @param lifeEpoch the bot's life epoch when the decision was made
 */
public record BotThought(Decision decision, Percept percept, int lifeEpoch) {}
