package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwf.app.ActionRefusal;
import com.shepherdjerred.thestorm.rwf.app.CombatantActions;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combat.DamageFormula;
import com.shepherdjerred.thestorm.rwf.domain.combat.HitWindow;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import com.shepherdjerred.thestorm.rwf.domain.kit.RewindError;
import com.shepherdjerred.thestorm.rwf.domain.kit.Rewinder;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import java.util.Optional;
import org.bukkit.Material;
import org.bukkit.entity.AbstractArrow;
import org.bukkit.entity.Arrow;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;

/**
 * {@link CombatantActions} over the real server API. Each action checks what a human doing the same
 * would be checked for, then acts through Paper (an {@code attack}, a launched arrow, a teleport)
 * so the same listeners and rules apply. Bot actions are also written to the recording as intents.
 */
final class PaperCombatantActions implements CombatantActions {

  /** How far a player reaches a block or an entity. */
  static final double REACH = 5.0;

  /** How far a melee swing reaches, as the vanilla client allows. */
  static final double MELEE_REACH = 3.0;

  /** Vanilla's arrow speed at full draw. */
  static final double ARROW_SPEED = 3.0;

  private final MatchRunner runner;
  private final CombatTracker tracker;
  private final Recordings recordings;
  private final Keys keys;
  private final ServerHooks hooks;

  /**
   * What the actions need.
   *
   * @param runner the match
   * @param tracker hit bookkeeping
   * @param recordings where bot intents go
   * @param keys item tags
   * @param hooks the server operations tests replace
   */
  record Parts(
      MatchRunner runner,
      CombatTracker tracker,
      Recordings recordings,
      Keys keys,
      ServerHooks hooks) {}

  PaperCombatantActions(Parts parts) {
    this.runner = parts.runner();
    this.tracker = parts.tracker();
    this.recordings = parts.recordings();
    this.keys = parts.keys();
    this.hooks = parts.hooks();
  }

  private Result<Player, ActionRefusal> fighter(CombatantId id) {
    if (runner.member(id).isEmpty()) {
      return Result.err(ActionRefusal.NOT_A_MEMBER);
    }
    if (!runner.fighting(id.uuid())) {
      return Result.err(runner.live() ? ActionRefusal.NOT_ALIVE : ActionRefusal.NOT_LIVE);
    }
    return runner
        .entity(id)
        .<Result<Player, ActionRefusal>>map(Result::ok)
        .orElseGet(() -> Result.err(ActionRefusal.NO_ENTITY));
  }

  private void intent(CombatantId who, String kind, String target) {
    if (who.isBot()) {
      recordings.intent(runner.now(), who, kind, target);
    }
  }

  @Override
  public Optional<ActionRefusal> clickBomb(CombatantId id, String bombId) {
    return fighter(id)
        .fold(
            player -> {
              var site = runner.currentMap().definition().bomb(bombId);
              if (site.isEmpty()) {
                return Optional.of(ActionRefusal.UNKNOWN_BOMB);
              }
              var at = Places.center(player.getWorld(), site.orElseThrow().position());
              if (player.getEyeLocation().distance(at) > REACH) {
                return Optional.of(ActionRefusal.BOMB_OUT_OF_REACH);
              }
              var inventory = player.getInventory();
              var fuse = inventory.getItem(KitFactory.FUSE_SLOT);
              if (fuse == null || !keys.isFuse(fuse)) {
                return Optional.of(ActionRefusal.NO_FUSE);
              }
              inventory.setHeldItemSlot(KitFactory.FUSE_SLOT);
              intent(id, "bomb", bombId);
              return runner.clickBomb(id, bombId).map(ActionRefusal::of);
            },
            Optional::of);
  }

  @Override
  public Optional<ActionRefusal> useRewind(CombatantId id) {
    return fighter(id)
        .fold(
            player -> {
              var rewinder = runner.rewinder(id);
              if (rewinder.isEmpty()) {
                return Optional.of(ActionRefusal.NO_TIME_MACHINE);
              }
              return switch (rewinder.orElseThrow().use(runner.now())) {
                case Result.Err<Rewinder.Rewind, RewindError>(var error) ->
                    Optional.of(
                        error == RewindError.COOLING_DOWN
                            ? ActionRefusal.COOLING_DOWN
                            : ActionRefusal.NO_LANDING);
                case Result.Ok<Rewinder.Rewind, RewindError>(var rewind) -> {
                  runner.rewinder(id, rewind.next());
                  var target = Places.location(player.getWorld(), rewind.to());
                  target.setYaw(Places.at(player).getYaw());
                  target.setPitch(Places.at(player).getPitch());
                  player.teleport(target);
                  player.setFireTicks(0);
                  player.setFallDistance(0);
                  intent(id, "rewind", "");
                  yield Optional.empty();
                }
              };
            },
            Optional::of);
  }

  @Override
  public Optional<ActionRefusal> melee(CombatantId attacker, CombatantId target) {
    return fighter(attacker)
        .fold(
            attackerEntity ->
                fighter(target)
                    .fold(
                        targetEntity -> swing(attacker, attackerEntity, target, targetEntity),
                        Optional::of),
            Optional::of);
  }

  private Optional<ActionRefusal> swing(
      CombatantId attacker, Player attackerEntity, CombatantId target, Player targetEntity) {
    var teams =
        runner
            .member(attacker)
            .flatMap(a -> a.team())
            .equals(runner.member(target).flatMap(t -> t.team()));
    if (teams) {
      return Optional.of(ActionRefusal.SAME_TEAM);
    }
    var eye = attackerEntity.getEyeLocation();
    if (eye.distance(targetEntity.getBoundingBox().getCenter().toLocation(targetEntity.getWorld()))
        > MELEE_REACH) {
      return Optional.of(ActionRefusal.OUT_OF_REACH);
    }
    if (!hooks.lineOfSight().test(attackerEntity, targetEntity)) {
      return Optional.of(ActionRefusal.NO_LINE_OF_SIGHT);
    }
    var hit = CombatListener.hit(AttackType.MELEE, attackerEntity, targetEntity, 0);
    var damage = DamageFormula.finalDamage(hit);
    if (HitWindow.resolve(damage, AttackType.MELEE, tracker.guard(targetEntity))
        instanceof HitWindow.Resolution.Blocked) {
      return Optional.of(ActionRefusal.HIT_WINDOW);
    }
    intent(attacker, "attack", recordings.pseudonym(target).orElse(""));
    attackerEntity.swingMainHand();
    // The server's damage event fires with the attacker as damager, and the combat listener
    // replaces the amount with the rules' own, exactly as for a human's swing.
    targetEntity.damage(damage, attackerEntity);
    return Optional.empty();
  }

  @Override
  public Optional<ActionRefusal> shootBow(CombatantId id, Vec3 direction, double force) {
    return fighter(id)
        .fold(
            player -> {
              if (!(force > 0 && force <= 1)) {
                return Optional.of(ActionRefusal.BAD_FORCE);
              }
              var bow = player.getInventory().getItemInMainHand();
              if (bow.getType() != Material.BOW || !hasArrows(player, bow)) {
                return Optional.of(ActionRefusal.NO_BOW);
              }
              var velocity = Places.vector(direction).normalize().multiply(force * ARROW_SPEED);
              var arrow = player.launchProjectile(Arrow.class, velocity);
              arrow.setPickupStatus(AbstractArrow.PickupStatus.DISALLOWED);
              arrow.setCritical(force >= 1);
              if (KitFactory.enchantmentLevel(bow, "infinity") == 0) {
                player.getInventory().removeItem(ItemStack.of(Material.ARROW, 1));
              }
              intent(id, "shoot", String.format("%.2f", force));
              return Optional.empty();
            },
            Optional::of);
  }

  private static boolean hasArrows(Player player, ItemStack bow) {
    return KitFactory.enchantmentLevel(bow, "infinity") > 0
        || player.getInventory().contains(Material.ARROW);
  }

  @Override
  public Optional<ActionRefusal> consume(CombatantId id, int slot) {
    return fighter(id)
        .fold(
            player -> {
              if (slot < 0 || slot > 8) {
                return Optional.of(ActionRefusal.NOTHING_TO_CONSUME);
              }
              var item = player.getInventory().getItem(slot);
              if (item == null || item.isEmpty()) {
                return Optional.of(ActionRefusal.NOTHING_TO_CONSUME);
              }
              intent(id, "eat", item.getType().name());
              return switch (item.getType()) {
                case COOKED_BEEF -> CombatListener.eatSteak(player, item);
                case GOLDEN_APPLE -> {
                  goldenApple(player);
                  item.subtract();
                  yield Optional.empty();
                }
                default -> Optional.of(ActionRefusal.NOTHING_TO_CONSUME);
              };
            },
            Optional::of);
  }

  /** Vanilla's golden apple: Regeneration II for five seconds and Absorption I for two minutes. */
  private static void goldenApple(Player player) {
    player.addPotionEffect(new PotionEffect(PotionEffectType.REGENERATION, 100, 1));
    player.addPotionEffect(new PotionEffect(PotionEffectType.ABSORPTION, 2400, 0));
  }

  @Override
  public Optional<ActionRefusal> pickKit(CombatantId id, String kitId) {
    if (runner.member(id).isEmpty()) {
      return Optional.of(ActionRefusal.NOT_A_MEMBER);
    }
    intent(id, "kit", kitId);
    return runner.handle(new MatchEvent.PickKit(id, kitId)).map(ActionRefusal::of);
  }
}
