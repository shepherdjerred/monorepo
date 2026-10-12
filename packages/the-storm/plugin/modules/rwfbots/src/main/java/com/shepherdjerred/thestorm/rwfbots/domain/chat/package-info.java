/**
 * Bot chat: which bot, if any, says which of its personality's lines at a match moment, under
 * per-bot cooldowns, a global rate limit and no repeats within a match. Pure and seeded.
 *
 * <p>A new context (such as the lobby) is a new {@link
 * com.shepherdjerred.thestorm.rwfbots.domain.chat.ChatMoment} with its own line pool: the director
 * turns it into candidates in one switch arm, and every rule after that (eligibility, chance,
 * cooldown, no repeats, rate limit, placeholders) is shared.
 */
@NullMarked
package com.shepherdjerred.thestorm.rwfbots.domain.chat;

import org.jspecify.annotations.NullMarked;
