package com.shepherdjerred.thestorm.e2e;

import java.io.IOException;
import java.io.InputStream;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.text.ParseException;
import java.util.HexFormat;
import java.util.Map;
import java.util.TreeMap;
import jdk.jfr.Configuration;

/** Exact Paper recording settings, with only the two audited diagnostic changes. */
final class DiagnosticJfrSettings {
  static final String PAPER_SHA256 =
      "7cf2a220574ade30738da8b50b9fc470331331911e84a99abacb06c5857176c9";

  record Settings(
      String originalSha256,
      String appliedSha256,
      String originalXml,
      Map<String, String> values) {}

  private DiagnosticJfrSettings() {}

  static Settings fromServer(Class<?> serverClass) throws IOException, ParseException {
    try (var input = serverClass.getResourceAsStream("/flightrecorder-config.jfc")) {
      if (input == null) throw new IOException("Paper flightrecorder-config.jfc is missing");
      return parse(input, PAPER_SHA256);
    }
  }

  static Settings parse(InputStream input, String expectedSha256)
      throws IOException, ParseException {
    var bytes = input.readAllBytes();
    var originalSha256 = sha256(bytes);
    if (!originalSha256.equals(expectedSha256))
      throw new IOException("Paper flightrecorder-config.jfc SHA256 mismatch");
    var original =
        Configuration.create(new StringReader(new String(bytes, StandardCharsets.UTF_8)))
            .getSettings();
    var applied = new TreeMap<>(original);
    applied.put("jdk.ObjectCount#enabled", "false");
    applied.put("storm.BotThink#enabled", "true");
    var encoded = new StringBuilder();
    applied.forEach((key, value) -> encoded.append(key).append('=').append(value).append('\n'));
    return new Settings(
        originalSha256,
        sha256(encoded.toString().getBytes(StandardCharsets.UTF_8)),
        new String(bytes, StandardCharsets.UTF_8),
        Map.copyOf(applied));
  }

  static String sha256(byte[] bytes) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    } catch (NoSuchAlgorithmException failure) {
      throw new IllegalStateException("JDK lacks required SHA-256", failure);
    }
  }
}
