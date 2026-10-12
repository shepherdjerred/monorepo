package com.shepherdjerred.thestorm.towns.adapter.archive;

import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.towns.domain.land.BlockPos;
import com.shepherdjerred.thestorm.towns.domain.lock.Lock;
import com.shepherdjerred.thestorm.towns.domain.lock.LockGrant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
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
      if (version != 2) {
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

  /** Explicit version-one migration preserves the former single-owner lock wire format. */
  public record LegacyLock(
      UUID id,
      UUID owner,
      Set<BlockPos> blocks,
      Map<UUID, LockGrant> trusted,
      Lock.Options options) {
    Lock migrate() {
      return new Lock(id, owner, blocks, trusted, options, Lock.Restoration.NONE);
    }
  }

  public static final class LegacyContents {
    private final int version;
    private final byte[] shops;
    private final List<LegacyLock> locks;

    @com.fasterxml.jackson.annotation.JsonCreator
    public LegacyContents(
        @com.fasterxml.jackson.annotation.JsonProperty("version") int version,
        @com.fasterxml.jackson.annotation.JsonProperty("shops") byte[] shops,
        @com.fasterxml.jackson.annotation.JsonProperty("locks") List<LegacyLock> locks) {
      if (version != 1) throw new IllegalArgumentException("not a version-one plot archive");
      this.version = version;
      this.shops = shops.clone();
      this.locks = List.copyOf(locks);
    }

    @com.fasterxml.jackson.annotation.JsonProperty("version")
    public int version() {
      return version;
    }

    @com.fasterxml.jackson.annotation.JsonProperty("shops")
    public byte[] shops() {
      return shops.clone();
    }

    @com.fasterxml.jackson.annotation.JsonProperty("locks")
    public List<LegacyLock> locks() {
      return locks;
    }
  }

  public static byte[] encode(Contents contents) {
    return JSON.writeValueAsBytes(contents);
  }

  public static Contents decode(byte[] bytes) {
    var version = JSON.readTree(bytes).get("version");
    if (version == null || !version.isIntegralNumber()) {
      throw new IllegalStateException("plot auxiliary archive has no integer version");
    }
    if (version.intValue() == 1) {
      var legacy =
          StrictYaml.parseJson(
                  "version-one plot auxiliary",
                  new String(bytes, java.nio.charset.StandardCharsets.UTF_8),
                  LegacyContents.class)
              .fold(
                  contents -> contents,
                  problems -> {
                    throw new IllegalStateException(
                        "invalid version-one plot archive: " + problems);
                  });
      return new Contents(
          2, legacy.shops(), legacy.locks().stream().map(LegacyLock::migrate).toList());
    }
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
