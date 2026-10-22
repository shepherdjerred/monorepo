package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.util.Set;
import org.bukkit.GameRules;
import org.bukkit.WorldCreator;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityRegainHealthEvent;
import org.bukkit.event.entity.FoodLevelChangeEvent;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;
import org.mockbukkit.mockbukkit.world.WorldMock;

/** A bot body regenerates as vanilla regenerates any player. */
final class NaturalRegenerationTest {
  private ServerMock server;
  private WorldMock world;
  private PlayerMock body;
  private final NaturalRegeneration regeneration = new NaturalRegeneration();

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    world = new WorldMock(new WorldCreator("rwf"));
    server.addWorld(world);
    world.setGameRule(GameRules.NATURAL_HEALTH_REGENERATION, true);
    body = new HealingPlayerMock(server);
    server.addPlayer(body);
    body.teleport(world.getSpawnLocation());
    body.setFoodLevel(20);
    body.setExhaustion(0);
    // rwf turns hunger off by cancelling every drop in a member's food.
    server.getPluginManager().registerEvents(new HungerOff(), MockBukkit.createMockPlugin());
  }

  /** Paper's heal, absent from MockBukkit: the regain event, then health up to the maximum. */
  private static final class HealingPlayerMock extends TraversalPlayerMock {
    HealingPlayerMock(ServerMock server) {
      super(server, "Bot", java.util.UUID.randomUUID());
    }

    @Override
    public void heal(double amount, EntityRegainHealthEvent.RegainReason reason) {
      var event = new EntityRegainHealthEvent(this, amount, reason);
      if (getHealth() > 0 && event.callEvent())
        setHealth(Math.min(getMaxHealth(), getHealth() + event.getAmount()));
    }
  }

  /** rwf's hunger rule: a member's food never drops. */
  public static final class HungerOff implements Listener {
    @EventHandler
    public void hold(FoodLevelChangeEvent event) {
      event.setCancelled(true);
    }
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  private void ticks(int count) {
    for (var tick = 0; tick < count; tick++) regeneration.tick(body);
  }

  @Test
  void aFedBodyWithoutSaturationHealsAHeartHalfEveryFourSeconds() {
    body.setHealth(0.5);
    body.setSaturation(0);
    ticks(79);
    assertThat(body.getHealth()).isEqualTo(0.5);
    ticks(1);
    assertThat(body.getHealth()).isEqualTo(1.5);
    assertThat(body.getExhaustion()).isEqualTo(6);
    ticks(80 * 3);
    assertThat(body.getHealth()).isEqualTo(4.5);
  }

  @Test
  void saturationHealsFasterAndIsSpentByTheExhaustion() {
    body.setHealth(10);
    body.setSaturation(5);
    ticks(10);
    assertThat(body.getHealth()).isCloseTo(10 + 5.0 / 6, within(1e-6));
    assertThat(body.getExhaustion()).isEqualTo(5);
    ticks(1);
    assertThat(body.getSaturation()).isEqualTo(4);
    assertThat(body.getExhaustion()).isEqualTo(1);
  }

  @Test
  void aFullBodyOrAWorldWithoutRegenerationDoesNotHeal() {
    body.setSaturation(0);
    ticks(200);
    assertThat(body.getHealth()).isEqualTo(20);
    body.setHealth(5);
    world.setGameRule(GameRules.NATURAL_HEALTH_REGENERATION, false);
    ticks(200);
    assertThat(body.getHealth()).isEqualTo(5);
  }

  @Test
  void hungerGoesThroughTheFoodEventThatRwfCancels() {
    body.setSaturation(0);
    body.setExhaustion(4.5f);
    ticks(1);
    assertThat(body.getFoodLevel()).isEqualTo(20);
    assertThat(body.getExhaustion()).isCloseTo(0.5f, within(1e-6f));
    regeneration.retain(Set.of());
  }
}
