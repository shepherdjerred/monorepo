package com.shepherdjerred.thestorm.towns.adapter.archive;

import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.towns.domain.lock.Lock;
import java.util.List;
import tools.jackson.databind.json.JsonMapper;

/** Native shop definitions and lock permissions accompany the schematic. */
public final class AuxiliaryArchive {
  private static final JsonMapper JSON = JsonMapper.builder().build();

  public static final class Contents {
    private final int version;
    private final byte[] shops;
    private final List<Lock> locks;

    @com.fasterxml.jackson.annotation.JsonCreator
    public Contents(
        @com.fasterxml.jackson.annotation.JsonProperty("version") int version,
        @com.fasterxml.jackson.annotation.JsonProperty("shops") byte[] shops,
        @com.fasterxml.jackson.annotation.JsonProperty("locks") List<Lock> locks) {
      if (version != 1) {
        throw new IllegalArgumentException("unknown plot auxiliary archive version");
      }
      this.version = version;
      this.shops = shops.clone();
      this.locks = List.copyOf(locks);
    }

    @com.fasterxml.jackson.annotation.JsonProperty("shops")
    public byte[] shops() {
      return shops.clone();
    }

    @com.fasterxml.jackson.annotation.JsonProperty("version")
    public int version() {
      return version;
    }

    @com.fasterxml.jackson.annotation.JsonProperty("locks")
    public List<Lock> locks() {
      return locks;
    }
  }

  private AuxiliaryArchive() {}

  public static byte[] encode(Contents contents) {
    return JSON.writeValueAsBytes(contents);
  }

  public static Contents decode(byte[] bytes) {
    return StrictYaml.parseJson(
            "plot auxiliary",
            new String(bytes, java.nio.charset.StandardCharsets.UTF_8),
            Contents.class)
        .fold(
            contents -> contents,
            problems -> {
              throw new IllegalStateException("invalid plot auxiliary archive: " + problems);
            });
  }
}
