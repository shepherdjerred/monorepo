package com.shepherdjerred.thestorm.chat.domain;

import com.shepherdjerred.thestorm.core.result.Result;
import java.util.List;
import java.util.Optional;

/**
 * Cleans a message, calms shouting, and checks it against every rule. The caller gets the accepted
 * message or every reason it was refused, never a partial answer.
 */
public final class MessageValidator {

  private final List<MessageRule> rules;
  private final int maxCapsWords;

  /**
   * @param maxCapsWords more all-capital words than this are lowercased (unless the speaker
   *     bypasses filters)
   */
  public MessageValidator(List<MessageRule> rules, int maxCapsWords) {
    this.rules = List.copyOf(rules);
    this.maxCapsWords = maxCapsWords;
  }

  /** The rules chat enforces, in the order their denials are reported. */
  public static MessageValidator standard(FilterSettings settings) {
    return new MessageValidator(
        List.of(
            new MessageRules.MuteRule(),
            new MessageRules.BlankRule(),
            new MessageRules.LengthRule(settings.maxLength()),
            new MessageRules.RepeatRule(settings.repeatCooldown())),
        settings.maxCapsWords());
  }

  /** The accepted message, or why it may not be sent. */
  public Result<AcceptedMessage, List<ChatDenial>> validate(ChatAttempt attempt, ChatFacts facts) {
    var cleaned = ChatText.clean(attempt.text());
    var text = attempt.speaker().bypassFilters() ? cleaned : Shouting.calm(cleaned, maxCapsWords);
    var checked = attempt.withText(text);
    var denials =
        rules.stream().map(rule -> rule.check(checked, facts)).flatMap(Optional::stream).toList();
    return denials.isEmpty()
        ? Result.ok(new AcceptedMessage(text, attempt.at(), !text.equals(cleaned)))
        : Result.err(denials);
  }
}
