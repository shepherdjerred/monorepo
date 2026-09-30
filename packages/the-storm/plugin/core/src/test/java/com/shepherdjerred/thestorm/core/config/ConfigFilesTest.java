package com.shepherdjerred.thestorm.core.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class ConfigFilesTest {

  record Motd(String line) {}

  @Test
  void loadsAValidFile(@TempDir Path directory) throws Exception {
    var file = directory.resolve("messages.yml");
    Files.writeString(file, "line: Welcome back\n");

    assertThat(ConfigFiles.load(file, Motd.class)).isEqualTo(new Motd("Welcome back"));
  }

  @Test
  void missingFileFails(@TempDir Path directory) {
    assertThatThrownBy(() -> ConfigFiles.load(directory.resolve("absent.yml"), Motd.class))
        .isInstanceOf(UncheckedIOException.class);
  }

  @Test
  void invalidFileListsProblems(@TempDir Path directory) throws Exception {
    var file = directory.resolve("messages.yml");
    Files.writeString(file, "line: x\ncolour: teal\n");

    assertThatThrownBy(() -> ConfigFiles.load(file, Motd.class))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("colour");
  }
}
