package com.shepherdjerred.thestorm.agent.domain;

import java.util.List;
import java.util.regex.Pattern;

/**
 * The deterministic layer-one checks on chat. High-precision signals act without spending a brain
 * call; ambiguous ones ask the brain; everything else passes untouched, which is what keeps the
 * brain bill proportional to suspicion instead of chat volume.
 */
public final class Prefilters {

  private static final Pattern INVITE =
      Pattern.compile("discord\\.gg/\\S+|discord\\.com/invite/\\S+", Pattern.CASE_INSENSITIVE);
  private static final Pattern BARE_IP =
      Pattern.compile("\\b(?:\\d{1,3}\\.){3}\\d{1,3}(?::\\d{1,5})?\\b");
  private static final Pattern LINK =
      Pattern.compile("https?://\\S+|www\\.\\S+", Pattern.CASE_INSENSITIVE);
  private static final Pattern SHOUTING = Pattern.compile("([!?])\\1{4,}");

  private Prefilters() {}

  /**
   * Checks {@code current} against {@code recent}, the player's earlier lines. Only lines inside
   * the window count toward the rate and repeat trips; order does not matter.
   */
  public static PrefilterVerdict check(
      ChatSample current, List<ChatSample> recent, PrefilterLimits limits) {
    var text = current.text();
    if (text.length() > limits.maxLength()) {
      return new PrefilterVerdict.Act(Offense.SPAM, "flood");
    }
    if (INVITE.matcher(text).find() || BARE_IP.matcher(text).find()) {
      return new PrefilterVerdict.Act(Offense.ADVERTISING, "ad-pattern");
    }
    var windowStart = current.at().minusSeconds(limits.windowSeconds());
    var inWindow = recent.stream().filter(line -> !line.at().isBefore(windowStart)).toList();
    if (inWindow.size() + 1 > limits.maxLines()) {
      return new PrefilterVerdict.Act(Offense.SPAM, "rate");
    }
    var repeats = inWindow.stream().filter(line -> line.text().equals(text)).count();
    if (repeats + 1 > limits.maxRepeats()) {
      return new PrefilterVerdict.Act(Offense.SPAM, "repeat");
    }
    if (capsHeavy(text, limits)) {
      return new PrefilterVerdict.Check("caps");
    }
    if (LINK.matcher(text).find()) {
      return new PrefilterVerdict.Check("url");
    }
    if (SHOUTING.matcher(text).find()) {
      return new PrefilterVerdict.Check("punct");
    }
    return new PrefilterVerdict.Allow();
  }

  private static boolean capsHeavy(String text, PrefilterLimits limits) {
    if (text.length() < limits.capsMinLength()) {
      return false;
    }
    var letters = 0;
    var upper = 0;
    for (var i = 0; i < text.length(); i++) {
      var c = text.charAt(i);
      if (Character.isLetter(c)) {
        letters++;
        if (Character.isUpperCase(c)) {
          upper++;
        }
      }
    }
    return letters > 0 && upper * 100 >= limits.capsPercent() * letters;
  }
}
