package com.shepherdjerred.thestorm.rwfbots.domain.chat;

import com.shepherdjerred.thestorm.rwfbots.domain.personality.Lines;
import java.time.Instant;
import java.util.UUID;

/**
 * One line a bot will say.
 *
 * @param speaker the bot
 * @param name the bot's name as players see it
 * @param team the bot's team display name
 * @param moment which pool the line came from
 * @param template the line as authored, placeholders intact
 * @param text the line with its placeholders filled
 * @param at when to say it
 */
public record Utterance(
    UUID speaker,
    String name,
    String team,
    Lines.Moment moment,
    String template,
    String text,
    Instant at) {}
