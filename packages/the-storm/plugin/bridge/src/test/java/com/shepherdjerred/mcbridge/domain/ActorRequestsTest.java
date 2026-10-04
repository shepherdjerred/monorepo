package com.shepherdjerred.mcbridge.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class ActorRequestsTest {
  private static final BlockPos ORIGIN = new BlockPos(0, -60, 0);

  @Test
  void actorNamesFollowMinecraftPlayerNames() {
    assertThat(new ActorName("Alice_01").value()).isEqualTo("Alice_01");
    assertThatThrownBy(() -> new ActorName("")).isInstanceOf(BridgeException.class);
    assertThatThrownBy(() -> new ActorName("seventeen_chars_x"))
        .hasMessageContaining("[A-Za-z0-9_]{1,16}");
    assertThatThrownBy(() -> new ActorName("bad-name")).isInstanceOf(BridgeException.class);
  }

  @Test
  void gotoAppliesDefaultsAndBounds() {
    ActorRequests.Goto defaults = ActorRequests.Goto.of(ORIGIN, Optional.empty(), Optional.empty());
    assertThat(defaults.range()).isEqualTo(1.0);
    assertThat(defaults.timeout()).isEqualTo(ActorRequests.DEFAULT_GOTO_TIMEOUT);

    ActorRequests.Goto custom = ActorRequests.Goto.of(ORIGIN, Optional.of(2.5), Optional.of(5_000));
    assertThat(custom.range()).isEqualTo(2.5);
    assertThat(custom.timeout()).isEqualTo(Duration.ofSeconds(5));

    assertThatThrownBy(() -> ActorRequests.Goto.of(ORIGIN, Optional.of(0.1), Optional.empty()))
        .hasMessageContaining("range");
    assertThatThrownBy(() -> ActorRequests.Goto.of(ORIGIN, Optional.empty(), Optional.of(500)))
        .hasMessageContaining("timeoutMs");
    assertThatThrownBy(() -> ActorRequests.Goto.of(ORIGIN, Optional.empty(), Optional.of(120_001)))
        .hasMessageContaining("timeoutMs");
  }

  @Test
  void parsesExactWireEnums() {
    assertThat(ActorRequests.Mode.parse("CREATIVE")).isEqualTo(ActorRequests.Mode.CREATIVE);
    assertThatThrownBy(() -> ActorRequests.Mode.parse("creative"))
        .isInstanceOf(BridgeException.class);
    assertThat(ActorRequests.Slot.parse("offhand")).isEqualTo(ActorRequests.Slot.OFFHAND);
    assertThatThrownBy(() -> ActorRequests.Slot.parse("HAND")).isInstanceOf(BridgeException.class);
  }

  @Test
  void validatesEquipAndChat() {
    assertThat(new ActorRequests.Equip("minecraft:stone", 64, ActorRequests.Slot.HAND).count())
        .isEqualTo(64);
    assertThatThrownBy(() -> new ActorRequests.Equip("minecraft:stone", 0, ActorRequests.Slot.HAND))
        .hasMessageContaining("count");
    assertThatThrownBy(() -> new ActorRequests.Chat("")).hasMessageContaining("message");
    assertThatThrownBy(() -> new ActorRequests.Chat("x".repeat(257)))
        .hasMessageContaining("message");
  }

  @Test
  void attackNeedsExactlyOneTarget() {
    UUID id = UUID.fromString("00000000-0000-4000-8000-000000000001");
    assertThat(ActorRequests.attackTarget(Optional.of(id.toString()), Optional.empty()))
        .isEqualTo(new ActorRequests.AttackTarget.ById(id));
    assertThat(ActorRequests.attackTarget(Optional.empty(), Optional.of("minecraft:zombie")))
        .isEqualTo(new ActorRequests.AttackTarget.NearestOfType("minecraft:zombie"));
    assertThatThrownBy(() -> ActorRequests.attackTarget(Optional.empty(), Optional.empty()))
        .hasMessageContaining("exactly one");
    assertThatThrownBy(
            () ->
                ActorRequests.attackTarget(
                    Optional.of(id.toString()), Optional.of("minecraft:zombie")))
        .hasMessageContaining("exactly one");
    assertThatThrownBy(() -> ActorRequests.attackTarget(Optional.of("nope"), Optional.empty()))
        .hasMessageContaining("UUID");
  }

  @Test
  void ringReportsCursorAndRecentEventsPerPlayer() {
    EventRing ring = new EventRing(10, InstantSource.fixed(Instant.parse("2026-10-03T12:00:00Z")));
    assertThat(ring.cursor()).isZero();
    ring.add(EventType.ACTOR, "alice", "spawned");
    ring.add(EventType.CHAT, "bob", "hi");
    ring.add(EventType.BLOCK_BREAK, "alice", "minecraft:stone at 0,0,0");
    ring.add(EventType.COMMAND, "alice", "/spawn");

    assertThat(ring.cursor()).isEqualTo(4);
    assertThat(ring.recentFor("alice", 2))
        .extracting(BridgeEvent::text)
        .containsExactly("minecraft:stone at 0,0,0", "/spawn");
    assertThat(ring.recentFor("carol", 5)).isEmpty();
    assertThat(EventType.BLOCK_BREAK.wire()).isEqualTo("block_break");
  }
}
