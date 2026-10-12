package com.shepherdjerred.thestorm.towns.adapter.archive;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.towns.domain.land.BlockPos;
import com.shepherdjerred.thestorm.towns.domain.lock.Lock;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

/**
 * New ownership survives packing, and existing version-one recovery archives migrate explicitly.
 */
final class AuxiliaryArchiveTest {
  private static final UUID OWNER = UUID.fromString("a35bbf91-d274-4e26-bc64-09d8c06a3c9d");
  private static final UUID OTHER = UUID.fromString("9cee5afe-e1e3-4c7a-83b1-eaf5fdcc96a0");
  private static final BlockPos CHEST = new BlockPos("world", 99, 64, -88);

  @Test
  void jointOwnersAndProvenanceSurviveVersionTwo() {
    var lock =
        new Lock(
            UUID.randomUUID(),
            OWNER,
            Set.of(CHEST),
            Map.of(),
            Lock.Options.NONE,
            new Lock.Restoration(
                UUID.randomUUID(), "parcel:shared", Map.of(OWNER, "Anteron", OTHER, "Zah262")));
    var encoded =
        AuxiliaryArchive.encode(new AuxiliaryArchive.Contents(2, new byte[] {1, 2}, List.of(lock)));
    var actual = AuxiliaryArchive.decode(encoded);
    assertThat(actual.version()).isEqualTo(2);
    assertThat(actual.shops()).containsExactly(1, 2);
    assertThat(actual.locks()).containsExactly(lock);
  }

  @Test
  void validVersionOneMigratesWithoutInventingHistoricalOwnership() {
    var ordinary = Lock.of(UUID.randomUUID(), OWNER, Set.of(CHEST));
    var legacy =
        new AuxiliaryArchive.LegacyLock(
            ordinary.id(), OWNER, ordinary.blocks(), ordinary.trusted(), ordinary.options());
    var encoded =
        JsonMapper.builder()
            .build()
            .writeValueAsBytes(
                new AuxiliaryArchive.LegacyContents(1, new byte[] {3}, List.of(legacy)));
    var migrated = AuxiliaryArchive.decode(encoded);
    assertThat(migrated.version()).isEqualTo(2);
    assertThat(migrated.shops()).containsExactly(3);
    assertThat(migrated.locks()).containsExactly(ordinary);
  }

  @Test
  void missingUnknownAndIncompleteVersionsFail() {
    assertThatThrownBy(
            () -> AuxiliaryArchive.decode("{}".getBytes(java.nio.charset.StandardCharsets.UTF_8)))
        .isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(
            () ->
                AuxiliaryArchive.decode(
                    "{\"version\":3,\"shops\":\"\",\"locks\":[]}"
                        .getBytes(java.nio.charset.StandardCharsets.UTF_8)))
        .isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(
            () ->
                AuxiliaryArchive.decode(
                    "{\"version\":1,\"shops\":\"\",\"locks\":[{}]}"
                        .getBytes(java.nio.charset.StandardCharsets.UTF_8)))
        .isInstanceOf(IllegalStateException.class);
  }
}
