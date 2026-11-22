package com.shepherdjerred.thestorm.stats.domain;

import java.util.Locale;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/** Classifies connection bounces and sanitizes reason text to bounded, credential-free strings. */
public final class BounceClassifier {

  public static final int MAX_REASON_LENGTH = 240;

  private static final Pattern HEX_SECTION_COLOR = Pattern.compile("(?i)§x(?:§[0-9a-f]){6}");
  private static final Pattern SECTION_COLOR = Pattern.compile("(?i)§[0-9a-fk-or]");
  private static final Pattern MINI_MESSAGE_TAG = Pattern.compile("<[a-zA-Z!/#][^>]{0,64}>");
  private static final Pattern BEARER_SECRET = Pattern.compile("(?i)\\bBearer\\s+\\S+");
  private static final Pattern KEY_VALUE_SECRET =
      Pattern.compile("(?i)\\b(token|password|secret|apikey|api_key)\\s*[:=]\\s*\\S+");
  private static final Pattern PREFIXED_TOKEN =
      Pattern.compile(
          "\\b(phc_[A-Za-z0-9]+|sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_.-]+)");
  private static final Pattern LONG_OPAQUE_SECRET =
      Pattern.compile("\\b(?=[A-Za-z0-9_-]*\\d)[A-Za-z0-9_-]{28,}\\b");
  private static final Pattern WHITESPACE = Pattern.compile("\\s+");

  private BounceClassifier() {}

  public static BounceCategory classifyPreLogin(String resultName, @Nullable String rawReason) {
    var normalized = resultName.strip().toUpperCase(Locale.ROOT);
    return switch (normalized) {
      case "KICK_BANNED" -> BounceCategory.BANNED;
      case "KICK_WHITELIST" -> BounceCategory.ALLOWLIST;
      case "KICK_FULL" -> BounceCategory.FULL;
      default -> classifyMessage(rawReason, BounceCategory.OTHER);
    };
  }

  public static BounceCategory classifyKick(
      @Nullable String causeName, @Nullable String rawReason) {
    if (causeName != null) {
      var normalized = causeName.strip().toUpperCase(Locale.ROOT);
      if (normalized.equals("BANNED") || normalized.equals("IP_BANNED")) {
        return BounceCategory.BANNED;
      }
      if (normalized.equals("WHITELIST")) {
        return BounceCategory.ALLOWLIST;
      }
      if (normalized.equals("SERVER_FULL")) {
        return BounceCategory.FULL;
      }
    }
    return classifyMessage(rawReason, BounceCategory.KICKED);
  }

  private static BounceCategory classifyMessage(
      @Nullable String rawReason, BounceCategory fallback) {
    var clean = sanitizeReason(rawReason).toLowerCase(Locale.ROOT);
    if (clean.contains("maintenance") || clean.contains("preparing spawn")) {
      return BounceCategory.MAINTENANCE;
    }
    if (clean.contains("banned") || clean.contains("suspended")) {
      return BounceCategory.BANNED;
    }
    if (clean.contains("whitelist") || clean.contains("allowlist")) {
      return BounceCategory.ALLOWLIST;
    }
    if (clean.contains("server is full")) {
      return BounceCategory.FULL;
    }
    return fallback;
  }

  public static String sanitizeReason(@Nullable String rawReason) {
    if (rawReason == null || rawReason.isBlank()) {
      return "";
    }
    var clean = HEX_SECTION_COLOR.matcher(rawReason).replaceAll("");
    clean = SECTION_COLOR.matcher(clean).replaceAll("");
    clean = MINI_MESSAGE_TAG.matcher(clean).replaceAll("");
    clean = BEARER_SECRET.matcher(clean).replaceAll("Bearer [redacted]");
    clean = KEY_VALUE_SECRET.matcher(clean).replaceAll("$1=[redacted]");
    clean = PREFIXED_TOKEN.matcher(clean).replaceAll("[redacted]");
    clean = LONG_OPAQUE_SECRET.matcher(clean).replaceAll("[redacted]");
    clean = WHITESPACE.matcher(clean).replaceAll(" ").strip();
    if (clean.length() <= MAX_REASON_LENGTH) {
      return clean;
    }
    int endIndex =
        clean.offsetByCodePoints(
            0, Math.min(MAX_REASON_LENGTH, clean.codePointCount(0, clean.length())));
    while (endIndex > MAX_REASON_LENGTH) {
      endIndex = Character.isLowSurrogate(clean.charAt(endIndex - 1)) ? endIndex - 2 : endIndex - 1;
    }
    return clean.substring(0, endIndex).stripTrailing();
  }
}
