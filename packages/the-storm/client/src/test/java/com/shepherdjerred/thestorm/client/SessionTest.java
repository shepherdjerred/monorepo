package com.shepherdjerred.thestorm.client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class SessionTest {
  @TempDir Path directory;

  @Test
  void acceptsLiveAndLoopbackOnly() throws IOException {
    var file = directory.resolve("session.json");
    for (var server : new String[] {"mc.ts-mc.net:30000", "127.0.0.1:25565"}) {
      writeSession(file, server);
      assertThat(Session.read(file).server()).isEqualTo(server);
    }
    for (var server : new String[] {"example.com:25565", "127.0.0.1:65536"}) {
      writeSession(file, server);
      assertThatThrownBy(() -> Session.read(file)).isInstanceOf(IllegalArgumentException.class);
    }
  }

  private void writeSession(Path file, String server) throws IOException {
    Files.writeString(
        file,
        Protocol.JSON.writeValueAsString(
            java.util.Map.of(
                "socket", directory.resolve("client.sock").toString(),
                "artifacts", directory.toString(),
                "server", server)));
  }
}
