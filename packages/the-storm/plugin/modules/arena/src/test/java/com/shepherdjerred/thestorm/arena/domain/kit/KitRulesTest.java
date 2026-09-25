package com.shepherdjerred.thestorm.arena.domain.kit;

import static com.shepherdjerred.thestorm.arena.testing.Samples.item;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;

final class KitRulesTest {

  private static ItemSpec spec(
      String material, int amount, @Nullable String potion, @Nullable Slot slot) {
    return new ItemSpec(
        material,
        amount,
        Optional.empty(),
        Map.of(),
        Optional.ofNullable(potion),
        Optional.ofNullable(slot));
  }

  private static ArenaClass kit(boolean advanced) {
    return new ArenaClass("Knight", advanced, List.of(item("IRON_SWORD")), List.of(), Map.of(), 0);
  }

  @Test
  void itemsAreChecked() {
    assertThat(spec("SPLASH_POTION", 3, "strong_healing", null).potion())
        .contains("strong_healing");
    assertThat(spec("TIPPED_ARROW", 16, "poison", null).amount()).isEqualTo(16);
    assertThatThrownBy(() -> spec("iron_sword", 1, null, null)).hasMessageContaining("material");
    assertThatThrownBy(() -> spec("IRON_SWORD", 0, null, null)).hasMessageContaining("amount");
    assertThatThrownBy(() -> spec("IRON_SWORD", 65, null, null)).hasMessageContaining("amount");
    assertThatThrownBy(() -> spec("IRON_SWORD", 1, "strong_healing", null))
        .hasMessageContaining("cannot hold a potion");
    assertThatThrownBy(() -> spec("POTION", 1, "Strong Healing", null))
        .hasMessageContaining("potion key");
    assertThatThrownBy(() -> spec("ARROW", 16, null, Slot.OFF_HAND))
        .hasMessageContaining("amount 1");
    assertThatThrownBy(
            () ->
                new ItemSpec(
                    "IRON_SWORD",
                    1,
                    Optional.of(" "),
                    Map.of(),
                    Optional.empty(),
                    Optional.empty()))
        .hasMessageContaining("name");
    assertThatThrownBy(
            () ->
                new ItemSpec(
                    "IRON_SWORD",
                    1,
                    Optional.empty(),
                    Map.of("Sharpness", 1),
                    Optional.empty(),
                    Optional.empty()))
        .hasMessageContaining("enchantment key");
    assertThatThrownBy(
            () ->
                new ItemSpec(
                    "IRON_SWORD",
                    1,
                    Optional.empty(),
                    Map.of("sharpness", 0),
                    Optional.empty(),
                    Optional.empty()))
        .hasMessageContaining("level");
  }

  @Test
  void aClassWearsOneItemPerSlot() {
    var helmet = spec("IRON_HELMET", 1, null, Slot.HEAD);
    var cap = spec("LEATHER_HELMET", 1, null, Slot.HEAD);

    assertThatThrownBy(
            () -> new ArenaClass("Knight", false, List.of(helmet, cap), List.of(), Map.of(), 0))
        .hasMessageContaining("HEAD");
  }

  @Test
  void classesAreChecked() {
    assertThatThrownBy(
            () -> new ArenaClass(" ", false, List.of(item("IRON_SWORD")), List.of(), Map.of(), 0))
        .hasMessageContaining("name");
    assertThatThrownBy(() -> new ArenaClass("Knight", false, List.of(), List.of(), Map.of(), 0))
        .hasMessageContaining("item");
    assertThatThrownBy(
            () ->
                new ArenaClass(
                    "Knight", false, List.of(item("IRON_SWORD")), List.of(), Map.of(), 11))
        .hasMessageContaining("wolves");
    assertThatThrownBy(
            () ->
                new ArenaClass(
                    "Knight", false, List.of(item("IRON_SWORD")), List.of(), Map.of("Speed", 0), 0))
        .hasMessageContaining("effect key");
    assertThatThrownBy(
            () ->
                new ArenaClass(
                    "Knight",
                    false,
                    List.of(item("IRON_SWORD")),
                    List.of(),
                    Map.of("speed", -1),
                    0))
        .hasMessageContaining("amplifier");
  }

  @Test
  void theBookFindsClassesAndNamesTheirPermission() {
    var book = new ClassBook(Map.of("knight", kit(false), "vanguard", kit(true)));

    assertThat(book.find("knight")).isPresent();
    assertThat(book.find("wizard")).isEmpty();
    assertThat(book.require("vanguard").advanced()).isTrue();
    assertThatThrownBy(() -> book.require("wizard")).isInstanceOf(IllegalArgumentException.class);
    assertThat(ClassBook.permission("vanguard")).isEqualTo("thestorm.arena.class.vanguard");
  }

  @Test
  void theBookNeedsAnOpenClassAndKebabIds() {
    assertThatThrownBy(() -> new ClassBook(Map.of())).hasMessageContaining("at least one");
    assertThatThrownBy(() -> new ClassBook(Map.of("vanguard", kit(true))))
        .hasMessageContaining("open to everyone");
    assertThatThrownBy(() -> new ClassBook(Map.of("Knight", kit(false))))
        .hasMessageContaining("kebab-case");
  }
}
