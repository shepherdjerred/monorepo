package com.shepherdjerred.thestorm.safety.domain;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Pattern;

/** High precision rules; a URL, caps, long text or ordinary profanity is never an offense. */
public final class ContentRules {
  private static final String CREDENTIAL_REASON =
      "Remove credential-shaped content before publishing. No misconduct strike was recorded.";
  private static final String FLOOD_REASON =
      "Please slow down; ordinary conversation resumes shortly.";
  private static final String LINK_SPAM_REASON = "Clear repeated-link spam or explicit slur.";

  private static final Pattern PUNCTUATION_BETWEEN_TOKENS =
      Pattern.compile("(?<=[a-z0-9\\s])[._\\-*~+|'`]+(?=[a-z0-9\\s])");

  private static final List<Pattern> HATE_PATTERNS =
      List.of(
          Pattern.compile(
              "(?<![a-z0-9])n+[i1!|]+[g69]{2,}(?:[e3]+r+|[a4@]+|u+h+)[sz5]*(?![a-z0-9])"),
          Pattern.compile(
              "(?<![a-z0-9])n+\\s+[i1!|]+\\s+[g69]+\\s+[g69]+\\s+(?:[e3]+\\s+r+|[a4@]+|u+\\s+h+)"
                  + "(?:\\s+[sz5]+)?(?![a-z0-9])"),
          Pattern.compile("(?<![a-z0-9])f+[a4@]+[g69]{1,3}[o0]+[t7]+[sz5]*(?![a-z0-9])"),
          Pattern.compile(
              "(?<![a-z0-9])f+\\s+[a4@]+\\s+[g69]+(?:\\s+[g69]+)?\\s+[o0]+\\s+[t7]+"
                  + "(?:\\s+[sz5]+)?(?![a-z0-9])"),
          Pattern.compile("(?<![a-z0-9])k+[i1!|]+k+[e3]+[sz5]*(?![a-z0-9])"),
          Pattern.compile("(?<![a-z0-9])k+\\s+[i1!|]+\\s+k+\\s+[e3]+(?:\\s+[sz5]+)?(?![a-z0-9])"),
          Pattern.compile("(?<![a-z0-9])t+r+[a4@]+n+n+(?:[y1!|]+|[i1!|]+[e3]+[sz5]*)(?![a-z0-9])"),
          Pattern.compile(
              "(?<![a-z0-9])t+\\s+r+\\s+[a4@]+\\s+n+\\s+n+\\s+(?:[y1!|]+|[i1!|]+\\s+[e3]+)"
                  + "(?:\\s+[sz5]+)?(?![a-z0-9])"),
          Pattern.compile("(?<![a-z0-9])c+h+[i1!|]+n+k+[sz5]*(?![a-z0-9])"),
          Pattern.compile(
              "(?<![a-z0-9])c+\\s+h+\\s+[i1!|]+\\s+n+\\s+k+(?:\\s+[sz5]+)?(?![a-z0-9])"),
          Pattern.compile("(?<![a-z0-9])s+p+[i1!|]+c+[sz5]*(?![a-z0-9])"),
          Pattern.compile("(?<![a-z0-9])s+\\s+p+\\s+[i1!|]+\\s+c+(?:\\s+[sz5]+)?(?![a-z0-9])"),
          Pattern.compile("(?<![a-z0-9])w+[e3]+t+b+[a4@]+c+k+[sz5]*(?![a-z0-9])"),
          Pattern.compile("(?<![a-z0-9])g+[o0]{2,}k+[sz5]*(?![a-z0-9])"),
          Pattern.compile("(?<![a-z0-9])g+\\s+[o0]+\\s+[o0]+\\s+k+(?:\\s+[sz5]+)?(?![a-z0-9])"),
          Pattern.compile("(?<![a-z0-9])r+[a4@]+g+h+[e3]+[a4@]+d+[sz5]*(?![a-z0-9])"),
          Pattern.compile(
              "(?<![a-z0-9])(?:heil\\s+hitler|sieg\\s+heil|gas\\s+the\\s+jews"
                  + "|kill\\s+all\\s+(?:jews|blacks|muslims|gays|trans)"
                  + "|hitler\\s+did\\s+nothing\\s+wrong|1488)(?![a-z0-9])"));

  private static final List<Pattern> SELF_HARM_AND_DOXXING_PATTERNS =
      List.of(
          Pattern.compile("(?<![a-z0-9])k+y+s+(?![a-z0-9])"),
          Pattern.compile("(?<![a-z0-9])k+\\s+y+\\s+s+(?![a-z0-9])"),
          Pattern.compile(
              "(?<![a-z0-9])(?:go\\s+)?(?:kill\\s+your\\s*self|hang\\s+your\\s*self"
                  + "|shoot\\s+your\\s*self|slit\\s+your\\s+wrists?"
                  + "|drink\\s+bleach\\s+and\\s+die)(?![a-z0-9])"),
          Pattern.compile(
              "(?<![a-z0-9])ssn\\s*[:=]?\\s*\\d{3}[-\\s]?\\d{2}[-\\s]?\\d{4}(?![a-z0-9])"),
          Pattern.compile(
              "(?<![a-z0-9])(?:dox+ing\\s+you|swat+ing\\s+you"
                  + "|here\\s+is\\s+your\\s+(?:home\\s+)?address)(?![a-z0-9])"));

  private static final List<Pattern> CSAM_PATTERNS =
      List.of(
          Pattern.compile(
              "(?<![a-z0-9])(?:child\\s*p[o0]rn(?:ography)?|kiddie\\s*p[o0]rn|pedo\\s*p[o0]rn"
                  + "|preteen\\s*nudes?|underage\\s*nudes?"
                  + "|send\\s+(?:me\\s+)?nudes?\\s+(?:kid|little\\s+(?:boy|girl)))(?![a-z0-9])"));

  private static final Pattern LINK =
      Pattern.compile("(?i)(?:https?://|www\\.|discord\\.gg/|discord\\.com/invite/)\\S+");
  private static final Pattern SECRET =
      Pattern.compile(
          "(?i)(?:sk-(?:proj-|svcacct-)?[a-z0-9_-]{20,}|op://[^\\s\\\"]+|(?:bearer|password|api[_-]?key|token)\\s*[:=]\\s*[^\\s,;\\\"]{8,})");
  private static final Pattern AUTH_COMMAND =
      Pattern.compile(
          "(?i)/(?:[a-z0-9_.-]+:)?(?:login|register|changepassword|password|auth|discordlink|link)\\s+[^\\r\\n]*");

  public record InstantBlock(String category, String reason, boolean applyStrike) {}

  public record RecentWindow(List<String> recentAudienceTexts, int recentChatCount20s) {
    public static final RecentWindow EMPTY = new RecentWindow(List.of(), 0);

    public RecentWindow {
      recentAudienceTexts = List.copyOf(recentAudienceTexts);
    }
  }

  private ContentRules() {}

  public static String normalized(String text) {
    return Normalizer.normalize(text, Normalizer.Form.NFKC)
        .toLowerCase(Locale.ROOT)
        .replaceAll("[\\p{Cf}\\p{Cc}]", "")
        .replaceAll("\\s+", " ")
        .strip();
  }

  /** Collapses intra-token punctuation obfuscation while preserving word boundaries. */
  static String deobfuscated(String normalized) {
    return PUNCTUATION_BETWEEN_TOKENS
        .matcher(normalized)
        .replaceAll("")
        .replaceAll("\\s+", " ")
        .strip();
  }

  public static Optional<InstantBlock> instantBlock(
      String text, String authorName, RecentWindow window, boolean staffEvidence) {
    if (!redact(text).equals(text) || !redact(authorName).equals(authorName)) {
      return Optional.of(new InstantBlock("none", CREDENTIAL_REASON, false));
    }
    if (!staffEvidence) {
      var severe = egregiousCategory(text).or(() -> egregiousCategory(authorName));
      if (severe.isPresent()) {
        return Optional.of(severe.orElseThrow());
      }
    }
    var normalized = normalized(text);
    if (repeatedLinkSpam(normalized, window.recentAudienceTexts())) {
      return Optional.of(new InstantBlock("spam", LINK_SPAM_REASON, true));
    }
    if (!staffEvidence && window.recentChatCount20s() >= 24) {
      return Optional.of(new InstantBlock("spam", FLOOD_REASON, false));
    }
    return Optional.empty();
  }

  public static Optional<String> obvious(String text, List<String> recent, boolean staffEvidence) {
    var normalized = normalized(text);
    if (!staffEvidence) {
      var severe = egregiousCategory(text);
      if (severe.isPresent()) return Optional.of(severe.orElseThrow().category());
    }
    if (repeatedLinkSpam(normalized, recent)) return Optional.of("spam");
    return Optional.empty();
  }

  private static Optional<InstantBlock> egregiousCategory(String raw) {
    var normalized = normalized(raw);
    var candidate = deobfuscated(normalized);
    if (matchesAny(HATE_PATTERNS, normalized) || matchesAny(HATE_PATTERNS, candidate)) {
      return Optional.of(
          new InstantBlock("hate", "Explicit hate speech or slur is not permitted.", true));
    }
    if (matchesAny(CSAM_PATTERNS, normalized) || matchesAny(CSAM_PATTERNS, candidate)) {
      return Optional.of(
          new InstantBlock("threat", "Explicit child-exploitation content is prohibited.", true));
    }
    if (matchesAny(SELF_HARM_AND_DOXXING_PATTERNS, normalized)
        || matchesAny(SELF_HARM_AND_DOXXING_PATTERNS, candidate)) {
      return Optional.of(
          new InstantBlock(
              "harassment", "Explicit self-harm encouragement or doxxing is not permitted.", true));
    }
    return Optional.empty();
  }

  private static boolean matchesAny(List<Pattern> patterns, String text) {
    for (var pattern : patterns) {
      if (pattern.matcher(text).find()) return true;
    }
    return false;
  }

  private static boolean repeatedLinkSpam(String normalized, List<String> recentAudienceTexts) {
    var links = extractLinks(normalized);
    if (links.isEmpty()) return false;
    var matches =
        recentAudienceTexts.stream()
            .filter(previous -> {
              var prior = normalized(previous);
              if (prior.equals(normalized)) return true;
              var priorLinks = extractLinks(prior);
              return links.stream().anyMatch(priorLinks::contains);
            })
            .count();
    return matches >= 2;
  }

  private static List<String> extractLinks(String normalized) {
    var matches = new ArrayList<String>();
    var matcher = LINK.matcher(normalized);
    while (matcher.find()) {
      matches.add(matcher.group());
    }
    return matches;
  }

  /** Credential-shaped strings are neither retained nor forwarded to an external classifier. */
  public static String redact(String text) {
    return SECRET
        .matcher(AUTH_COMMAND.matcher(text).replaceAll("[authentication command redacted]"))
        .replaceAll("[credential redacted]");
  }

  /** Overlapping windows preserve cross-boundary offenses without silently truncating books. */
  public static List<String> windows(String text) {
    var points = text.codePoints().toArray();
    var result = new ArrayList<String>();
    for (var start = 0; start < points.length; start += 3744) {
      result.add(new String(points, start, Math.min(4000, points.length - start)));
      if (start + 4000 >= points.length) break;
    }
    return List.copyOf(result);
  }
}
