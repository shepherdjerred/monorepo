package com.shepherdjerred.thestorm.e2e;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.text.ParseException;
import java.util.HashMap;
import jdk.jfr.Configuration;
import org.junit.jupiter.api.Test;

final class DiagnosticJfrSettingsTest {
  private static final String CONFIG =
      """
      <?xml version="1.0" encoding="UTF-8"?>
      <configuration version="2.0" label="fixture" description="fixture" provider="test">
        <event name="jdk.ObjectCount"><setting name="enabled">true</setting><setting name="period">everyChunk</setting></event>
        <event name="jdk.ObjectCountAfterGC"><setting name="enabled">false</setting></event>
        <event name="jdk.ExecutionSample"><setting name="enabled">true</setting><setting name="period">10 ms</setting></event>
        <event name="jdk.InitialEnvironmentVariable"><setting name="enabled">false</setting></event>
      </configuration>
      """;

  @Test
  void changesOnlyTheTwoAuditedSettings() throws Exception {
    var original = Configuration.create(new StringReader(CONFIG)).getSettings();
    var expected = new HashMap<>(original);
    expected.put("jdk.ObjectCount#enabled", "false");
    expected.put("storm.BotThink#enabled", "true");
    var actual = parse(CONFIG);

    assertEquals(expected, actual.values());
    assertEquals("everyChunk", actual.values().get("jdk.ObjectCount#period"));
    assertEquals(64, actual.appliedSha256().length());
    assertThrows(UnsupportedOperationException.class, () -> actual.values().put("x", "y"));
  }

  @Test
  void rejectsWrongHashBeforeParsing() {
    assertThrows(
        IOException.class, () -> DiagnosticJfrSettings.parse(stream(CONFIG), "0".repeat(64)));
  }

  @Test
  void rejectsMissingServerResource() {
    assertThrows(
        IOException.class, () -> DiagnosticJfrSettings.fromServer(DiagnosticJfrSettingsTest.class));
  }

  @Test
  void rejectsMalformedConfigurationEvenWithMatchingHash() {
    assertThrows(ParseException.class, () -> parse("not a configuration"));
  }

  private static DiagnosticJfrSettings.Settings parse(String xml) throws Exception {
    return DiagnosticJfrSettings.parse(
        stream(xml), DiagnosticJfrSettings.sha256(xml.getBytes(StandardCharsets.UTF_8)));
  }

  private static ByteArrayInputStream stream(String xml) {
    return new ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8));
  }
}
