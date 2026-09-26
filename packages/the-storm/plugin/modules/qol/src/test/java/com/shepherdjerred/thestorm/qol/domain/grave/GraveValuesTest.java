package com.shepherdjerred.thestorm.qol.domain.grave;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalInt;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class GraveValuesTest {

  static final GravePos DEATH = new GravePos("world", 10, 64, -3);
  static final GravePos SAFE = new GravePos("world", 12, 70, -1);
  static final GravePos SPAWN = new GravePos("world", 0, 64, 0);

  static ItemBytes item(int b) {
    return ItemBytes.of(new byte[] {(byte) b, 1, 2});
  }

  @Test
  void aNormalDeathTriesTheDeathSpotThenTheLastSafeSpotThenSpawn() {
    assertThat(new DeathSite(DEATH, false, Optional.of(SAFE), SPAWN).origins())
        .containsExactly(DEATH, SAFE, SPAWN);
  }

  @Test
  void aVoidOrLavaDeathSkipsTheDeathSpot() {
    assertThat(new DeathSite(DEATH, true, Optional.of(SAFE), SPAWN).origins())
        .containsExactly(SAFE, SPAWN);
    assertThat(new DeathSite(DEATH, true, Optional.empty(), SPAWN).origins())
        .containsExactly(SPAWN);
  }

  @Test
  void spawnIsNotTriedTwice() {
    assertThat(new DeathSite(SPAWN, false, Optional.empty(), SPAWN).origins())
        .containsExactly(SPAWN);
  }

  @Test
  void dropsRememberTheSlotTheyCameFrom() {
    var sword = item(1);
    var dirt = item(2);
    var extra = item(3);
    var inventory = Map.of(0, sword, 5, dirt, 9, dirt, 39, item(4));

    var filled = GraveFilling.fill(List.of(dirt, sword, dirt, extra), inventory);

    assertThat(filled)
        .containsExactly(
            new GraveItem(0, OptionalInt.of(5), dirt),
            new GraveItem(1, OptionalInt.of(0), sword),
            new GraveItem(2, OptionalInt.of(9), dirt),
            new GraveItem(3, OptionalInt.empty(), extra));
  }

  @Test
  void moreCopiesDroppedThanHeldGetNoSlot() {
    var dirt = item(2);
    assertThat(GraveFilling.fill(List.of(dirt, dirt), Map.of(7, dirt)))
        .containsExactly(
            new GraveItem(0, OptionalInt.of(7), dirt), new GraveItem(1, OptionalInt.empty(), dirt));
  }

  static final Grave GRAVE =
      new Grave(
          UUID.randomUUID(), UUID.randomUUID(), "Alice", DEATH, Instant.EPOCH, "minecraft:air");

  @Test
  void contentsWithoutTakenStacksKeepTheRest() {
    var contents =
        new GraveContents(
            GRAVE,
            List.of(
                new GraveItem(0, OptionalInt.empty(), item(1)),
                new GraveItem(1, OptionalInt.empty(), item(2)),
                new GraveItem(2, OptionalInt.empty(), item(3))));

    var rest = contents.without(Set.of(0, 2));

    assertThat(rest.items()).extracting(GraveItem::index).containsExactly(1);
    assertThat(rest.isEmpty()).isFalse();
    assertThat(rest.without(Set.of(1)).isEmpty()).isTrue();
  }

  @Test
  void contentsRejectDuplicateIndexes() {
    var twice =
        List.of(
            new GraveItem(0, OptionalInt.empty(), item(1)),
            new GraveItem(0, OptionalInt.empty(), item(2)));
    assertThatThrownBy(() -> new GraveContents(GRAVE, twice)).hasMessageContaining("duplicate");
  }

  @Test
  void itemBytesAreCopiedAndComparedByValue() {
    var raw = new byte[] {1, 2, 3};
    var bytes = ItemBytes.of(raw);
    raw[0] = 9;
    assertThat(bytes.bytes()).containsExactly(1, 2, 3);
    bytes.bytes()[1] = 9;
    assertThat(bytes.bytes()).containsExactly(1, 2, 3);
    assertThat(bytes)
        .isEqualTo(ItemBytes.of(new byte[] {1, 2, 3}))
        .hasSameHashCodeAs(ItemBytes.of(new byte[] {1, 2, 3}));
    assertThat(bytes).isNotEqualTo(ItemBytes.of(new byte[] {1, 2}));
    assertThat(bytes).hasToString("ItemBytes[010203, 3 bytes]");
    assertThat(ItemBytes.of(new byte[10])).hasToString("ItemBytes[0000000000000000..., 10 bytes]");
    assertThatThrownBy(() -> ItemBytes.of(new byte[0])).hasMessageContaining("zero");
  }

  @Test
  void valuesRejectNonsense() {
    assertThatThrownBy(() -> new GravePos(" ", 0, 0, 0)).hasMessageContaining("world");
    assertThatThrownBy(() -> new GraveItem(-1, OptionalInt.empty(), item(1)))
        .hasMessageContaining("index");
    assertThatThrownBy(() -> new GraveItem(0, OptionalInt.of(-1), item(1)))
        .hasMessageContaining("slot");
    assertThatThrownBy(
            () ->
                new Grave(
                    UUID.randomUUID(),
                    UUID.randomUUID(),
                    "",
                    DEATH,
                    Instant.EPOCH,
                    "minecraft:air"))
        .hasMessageContaining("ownerName");
    assertThatThrownBy(
            () -> new Grave(UUID.randomUUID(), UUID.randomUUID(), "Al", DEATH, Instant.EPOCH, " "))
        .hasMessageContaining("replaced");
  }

  @Test
  void positionsDescribeAndMove() {
    assertThat(DEATH.describe()).isEqualTo("10, 64, -3 in world");
    assertThat(DEATH.offset(1, -1, 2)).isEqualTo(new GravePos("world", 11, 63, -1));
  }
}
