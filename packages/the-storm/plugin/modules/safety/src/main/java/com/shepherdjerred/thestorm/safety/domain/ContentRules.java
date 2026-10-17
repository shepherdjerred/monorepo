package com.shepherdjerred.thestorm.safety.domain;

import java.text.Normalizer;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Pattern;

/** High precision rules; a URL, caps, long text or ordinary profanity is never an offense. */
public final class ContentRules {
  private static final Pattern SLUR =
      Pattern.compile("(?<![a-z])n[i1!|]+[g69]{2,}[e3a4]+r?(?:s)?(?![a-z])");
  private static final Pattern LINK =
      Pattern.compile("(?i)(?:https?://|www\\.|discord\\.gg/|discord\\.com/invite/)\\S+");
  private static final Pattern SECRET =
      Pattern.compile(
          "(?i)(?:sk-(?:proj-|svcacct-)?[a-z0-9_-]{20,}|op://[^\\s\\\"]+|(?:bearer|password|api[_-]?key|token)\\s*[:=]\\s*[^\\s,;\\\"]{8,})");
  private static final Pattern AUTH_COMMAND =
      Pattern.compile(
          "(?i)/(?:[a-z0-9_.-]+:)?(?:login|register|changepassword|password|auth|discordlink|link)\\s+[^\\r\\n]*");

  private ContentRules() {}

  public static String normalized(String text) {
    return Normalizer.normalize(text, Normalizer.Form.NFKC)
        .toLowerCase(Locale.ROOT)
        .replaceAll("[\\p{Cf}\\p{Cc}]", "")
        .replaceAll("\\s+", " ")
        .strip();
  }

  public static Optional<String> obvious(String text, List<String> recent, boolean staffEvidence) {
    var normalized = normalized(text);
    if (!staffEvidence && SLUR.matcher(normalized).find()) return Optional.of("hate");
    var links = LINK.matcher(normalized).results().map(match -> match.group()).toList();
    if (!links.isEmpty()
        && recent.stream().filter(previous -> normalized(previous).equals(normalized)).count() >= 2)
      return Optional.of("spam");
    return Optional.empty();
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
    var result = new java.util.ArrayList<String>();
    for (var start = 0; start < points.length; start += 3744) {
      result.add(new String(points, start, Math.min(4000, points.length - start)));
      if (start + 4000 >= points.length) break;
    }
    return List.copyOf(result);
  }
}
