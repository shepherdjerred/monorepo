package com.shepherdjerred.thestorm.client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class SessionTest {
  @TempDir Path dir;

  private Session read(String server, @Nullable String target) throws Exception {
    var file = dir.resolve("session.json");
    var extra = target == null ? "" : ",\"target\":\"" + target + "\"";
    Files.writeString(
        file,
        "{\"socket\":\""
            + dir.resolve("client.sock")
            + "\",\"artifacts\":\""
            + dir
            + "\",\"server\":\""
            + server
            + "\""
            + extra
            + "}");
    return Session.read(file);
  }

  @Test
  void acceptsOnlyExplicitProductionAndSandboxLoopback() throws Exception {
    assertThat(read("127.0.0.1:25565", null).live()).isFalse();
    assertThat(read("ts-mc.net:25565", "live").live()).isTrue();
    assertThatThrownBy(() -> read("ts-mc.net:25565", null))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> read("example.com:25565", "live"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> read("127.0.0.1:25565", "live"))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
