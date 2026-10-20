package com.shepherdjerred.thestorm.creative.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;

final class CreativeLoggingTest {

  private static final Path PATCH = Path.of("../../../server/patches/coreprotect.json");

  private static CreativeLogging enabled() {
    return new CreativeLogging(true, true, true, true, true, true);
  }

  @Test
  void anEnabledWorldIsAccepted() {
    assertThatCode(() -> enabled().requireFor("creative")).doesNotThrowAnyException();
  }

  @Test
  void aBlankWorldNameIsRejected() {
    assertThatThrownBy(() -> enabled().requireFor(" "))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void disabledHistoryNamesEveryMissingFlag() {
    assertThatThrownBy(
            () -> new CreativeLogging(false, true, false, true, true, false).requireFor("creative"))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("creative")
        .hasMessageContaining("block-place")
        .hasMessageContaining("sign-text")
        .hasMessageContaining("worldedit")
        .satisfies(
            error -> {
              var message = error.getMessage();
              assertThat(message).doesNotContain("block-break");
              assertThat(message).doesNotContain("buckets");
              assertThat(message).doesNotContain("entity-change");
            });
  }

  @Test
  void theOwnedPatchKeepsCreativeHistoryOn() throws IOException {
    var patch = Files.readString(PATCH);

    assertThat(patch).contains("\"file\": \"/data/plugins/CoreProtect/config.yml\"");
    for (var key :
        List.of(
            "block-place", "block-break", "sign-text", "buckets", "entity-change", "worldedit")) {
      assertThat(patch).contains("\"key\": \"" + key + "\", \"value\": true");
      assertThat(count(patch, "\"key\": \"" + key + "\"")).isOne();
    }
    assertThat(patch).doesNotContain("creative");
  }

  private static int count(String text, String needle) {
    var found = 0;
    var from = 0;
    while (true) {
      var at = text.indexOf(needle, from);
      if (at < 0) {
        return found;
      }
      found++;
      from = at + needle.length();
    }
  }
}
