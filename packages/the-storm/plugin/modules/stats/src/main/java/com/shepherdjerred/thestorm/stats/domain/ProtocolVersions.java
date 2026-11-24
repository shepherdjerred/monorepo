package com.shepherdjerred.thestorm.stats.domain;

/** Maps protocol numbers to human-readable Minecraft release strings without external libraries. */
public final class ProtocolVersions {

  private ProtocolVersions() {}

  public static String clientVersion(Platform platform, int protocolVersion) {
    if (protocolVersion <= 0) {
      return platform == Platform.BEDROCK ? "bedrock" : "unknown";
    }
    if (protocolVersion >= 775) {
      return "26.3";
    }
    return switch (protocolVersion) {
      case 774 -> "1.21.11";
      case 773 -> "1.21.9";
      case 772 -> "1.21.7";
      case 771 -> "1.21.6";
      case 770 -> "1.21.5";
      case 769 -> "1.21.4";
      case 768 -> "1.21.2";
      case 767 -> "1.21.1";
      case 766 -> "1.20.5";
      case 765 -> "1.20.3";
      case 764 -> "1.20.2";
      case 763 -> "1.20";
      default -> "protocol-" + protocolVersion;
    };
  }
}
