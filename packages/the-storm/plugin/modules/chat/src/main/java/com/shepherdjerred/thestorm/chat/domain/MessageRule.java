package com.shepherdjerred.thestorm.chat.domain;

import java.util.Optional;

/** One chat rule. {@link MessageValidator} runs every rule and collects the denials. */
@FunctionalInterface
public interface MessageRule {

  /** The reason {@code attempt} breaks this rule, if it does. The text is already cleaned. */
  Optional<ChatDenial> check(ChatAttempt attempt, ChatFacts facts);
}
