package com.shepherdjerred.thestorm.chat.domain;

import com.shepherdjerred.thestorm.core.result.Result;
import java.util.List;
import java.util.Optional;

/**
 * Cleans a message and checks it against every rule. The caller gets the cleaned text or every
 * reason it was refused, never a partial answer.
 */
public final class MessageValidator {

  private final List<MessageRule> rules;

  public MessageValidator(List<MessageRule> rules) {
    this.rules = List.copyOf(rules);
  }

  /** The rules chat enforces, in the order their denials are reported. */
  public static MessageValidator standard(FilterSettings settings) {
    return new MessageValidator(
        List.of(
            new MessageRules.ChannelAccessRule(),
            new MessageRules.MuteRule(),
            new MessageRules.BlankRule(),
            new MessageRules.LengthRule(settings.maxLength()),
            new MessageRules.CapsRule(settings.maxCapsWords()),
            new MessageRules.RepeatRule(settings.repeatCooldown())));
  }

  /** The cleaned message, or why it may not be sent. */
  public Result<String, List<ChatDenial>> validate(ChatAttempt attempt, ChatFacts facts) {
    var cleaned = attempt.withText(ChatText.clean(attempt.text()));
    var denials =
        rules.stream().map(rule -> rule.check(cleaned, facts)).flatMap(Optional::stream).toList();
    return denials.isEmpty() ? Result.ok(cleaned.text()) : Result.err(denials);
  }
}
