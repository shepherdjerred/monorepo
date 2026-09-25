package com.shepherdjerred.thestorm.chat.domain;

import java.time.Instant;

/**
 * A message that passed every rule.
 *
 * @param text the cleaned text, with shouting lowercased
 * @param at when it was sent
 * @param calmed whether too many capitals were lowercased, so the sender can be told
 */
public record AcceptedMessage(String text, Instant at, boolean calmed) {}
