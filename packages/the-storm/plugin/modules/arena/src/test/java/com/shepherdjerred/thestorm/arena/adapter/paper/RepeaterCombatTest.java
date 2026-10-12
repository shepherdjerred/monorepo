package com.shepherdjerred.thestorm.arena.adapter.paper;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.shepherdjerred.thestorm.arena.domain.survival.LegendaryWeapon;
import com.shepherdjerred.thestorm.arena.domain.survival.SupplyBank;
import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalClass;
import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalGame;
import com.shepherdjerred.thestorm.arena.domain.survival.Survivor;
import com.shepherdjerred.thestorm.arena.testing.FakeClock;
import com.shepherdjerred.thestorm.arena.testing.Samples;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import java.time.Duration;
import java.util.Map;
import java.util.Optional;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Server;
import org.bukkit.entity.Arrow;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;
import org.bukkit.util.Vector;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

final class RepeaterCombatTest {
  @Test
  void earlyFiveTickBoundariesDoNotHalveTheFiringCadence() {
    var fixture = new Fixture();
    for (var millis :
        new long[] {
          50, 100, 150, 200, 250, 299, 350, 400, 450, 500, 550, 600, 650, 700, 750, 799, 850, 900,
          950, 1000, 1050
        }) {
      fixture.tickAt(millis);
    }
    fixture.shots(4);
  }

  @Test
  void anEarlyPulseWaitsOnlyUntilTheNextTickAndChargesEachShotOnce() {
    var fixture = new Fixture();
    fixture.pulseAt(50);
    fixture.shots(1);
    fixture.pulseAt(299);
    fixture.shots(1);
    fixture.pulseAt(300);
    fixture.shots(2);
    fixture.pulseAt(549);
    fixture.shots(2);
    fixture.pulseAt(550);
    fixture.shots(3);
    fixture.pulseAt(799);
    fixture.shots(3);
    fixture.pulseAt(800);
    fixture.shots(4);
    verify(fixture.items, never()).refund(any(), any());
  }

  @Test
  void aLatePulseDoesNotCatchUpWithAnArrowBurst() {
    var fixture = new Fixture();
    fixture.pulseAt(50);
    fixture.pulseAt(1050);
    fixture.pulseAt(1050);
    fixture.shots(2);
    fixture.pulseAt(1299);
    fixture.shots(2);
    fixture.pulseAt(1300);
    fixture.shots(3);
  }

  @Test
  void releasingBeforeTheDeadlineStopsWithoutAnotherPayment() {
    var fixture = new Fixture();
    fixture.pulseAt(50);
    when(fixture.player.isHandRaised()).thenReturn(false);
    fixture.pulseAt(299);
    fixture.pulseAt(550);
    fixture.shots(1);
    verify(fixture.task).cancel();
  }

  @Test
  void switchingHeldSlotsStopsBeforeTheNextShot() {
    var fixture = new Fixture();
    fixture.pulseAt(50);
    when(fixture.inventory.getHeldItemSlot()).thenReturn(1);
    fixture.pulseAt(300);
    fixture.pulseAt(550);
    fixture.shots(1);
    verify(fixture.task).cancel();
  }

  private static final class Fixture {
    private final FakeClock clock = new FakeClock(Samples.T0);
    private final Player player = mock();
    private final PlayerInventory inventory = mock();
    private final SurvivalItems items = mock();
    private final Cancellable task = mock();
    private final Runnable pulse;
    private final long periodTicks;
    private long nextTick;
    private long ticks;
    private long elapsed;

    Fixture() {
      var runner = mock(SurvivalRunner.class);
      var context = mock(PaperContext.class);
      var server = mock(Server.class);
      var scheduler = mock(Scheduler.class);
      var weapon = mock(ItemStack.class);
      var arrow = mock(Arrow.class);
      var location = mock(Location.class);
      var game = mock(SurvivalGame.class);
      var payment =
          new SurvivalItems.Payment(
              Samples.ALICE,
              1,
              Samples.ALICE,
              new SupplyBank.Payment(Map.of("ARROW", 1), Map.of()));
      when(runner.context()).thenReturn(context);
      when(context.server()).thenReturn(server);
      when(context.time()).thenReturn(clock);
      when(context.scheduler()).thenReturn(scheduler);
      when(server.getPlayer(Samples.ALICE)).thenReturn(player);
      when(player.getUniqueId()).thenReturn(Samples.ALICE);
      when(player.getInventory()).thenReturn(inventory);
      when(player.isOnline()).thenReturn(true);
      when(player.isHandRaised()).thenReturn(true);
      when(player.getEyeLocation()).thenReturn(location);
      when(location.getDirection()).thenReturn(new Vector(0, 0, 1));
      when(player.launchProjectile(eq(Arrow.class), any(Vector.class))).thenReturn(arrow);
      when(arrow.isValid()).thenReturn(true);
      when(inventory.getItemInMainHand()).thenReturn(weapon);
      when(weapon.clone()).thenReturn(weapon);
      when(weapon.isSimilar(weapon)).thenReturn(true);
      when(runner.isFighter(Samples.ALICE)).thenReturn(true);
      when(runner.items()).thenReturn(items);
      when(items.legendary(weapon)).thenReturn(Optional.of(LegendaryWeapon.REPEATER));
      when(items.count(player, Material.ARROW)).thenReturn(32);
      when(items.reserve(player, Map.of("ARROW", 1))).thenReturn(Optional.of(payment));
      when(items.multiplier(weapon)).thenReturn(1.0);
      when(runner.game()).thenReturn(game);
      when(game.player(Samples.ALICE))
          .thenReturn(
              Optional.of(
                  new Survivor(
                      Samples.ALICE,
                      "Alice",
                      SurvivalClass.FIGHTER,
                      Survivor.Status.STANDING,
                      true,
                      false,
                      Optional.empty())));
      when(runner.actions()).thenReturn(mock(SurvivalActions.class));
      when(runner.talents()).thenReturn(mock(SurvivalTalents.class));
      when(runner.combat()).thenReturn(mock(SurvivalCombat.class));
      when(runner.legendary()).thenReturn(mock(LegendaryCombat.class));
      when(scheduler.repeatOnMainThread(any(), any(), any())).thenReturn(task);
      new RepeaterCombat(runner).begin(player);
      var callback = ArgumentCaptor.forClass(Runnable.class);
      var delay = ArgumentCaptor.forClass(Duration.class);
      var period = ArgumentCaptor.forClass(Duration.class);
      verify(scheduler).repeatOnMainThread(delay.capture(), period.capture(), callback.capture());
      pulse = callback.getValue();
      nextTick = delay.getValue().toMillis() / 50;
      periodTicks = period.getValue().toMillis() / 50;
    }

    void tickAt(long millis) {
      clock.advance(Duration.ofMillis(millis - elapsed));
      elapsed = millis;
      ticks++;
      if (ticks >= nextTick) {
        pulse.run();
        nextTick += periodTicks;
      }
    }

    void pulseAt(long millis) {
      clock.advance(Duration.ofMillis(millis - elapsed));
      elapsed = millis;
      pulse.run();
    }

    void shots(int count) {
      verify(player, times(count)).launchProjectile(eq(Arrow.class), any(Vector.class));
      verify(items, times(count)).reserve(player, Map.of("ARROW", 1));
      verify(items, times(count)).commit(any());
    }
  }
}
