// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/abilities/
// SacrificialAbility.java, onDamage); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.ability.KitCombat;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Sacrificial;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combat.DamageFormula;
import com.shepherdjerred.thestorm.rwf.domain.match.Combatant;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.Material;
import org.bukkit.Particle;
import org.bukkit.entity.Player;

/**
 * A Sacrificial's bonds in the damage path: damage meant for a bonded ally goes to the living
 * Sacrificial instead, at the amount the ally would have taken before their armor, through the
 * Sacrificial's own armor and kit, credited to whoever dealt it, with a death message naming the
 * ally. As Red Warfare showed it: emerald crumbs from the ally, lapis from the Sacrificial and a
 * red line between their eyes, drawn in full at most every 3 seconds and otherwise only near its
 * ends; and the ally flinches and stays hurt-proof for its usual half second. Main thread only.
 */
final class Sacrifices {

  /**
   * Damage meant for a bonded ally.
   *
   * @param type its kind
   * @param amount how much, before the ally's armour
   * @param credit who is credited with the hurt: the attacker, or a summon's or napalm's owner
   */
  record Meant(AttackType type, double amount, Optional<UUID> credit) {}

  /** How often Red Warfare drew the line in full ({@code LongParticles}). */
  private static final Duration LONG_LINE = Duration.ofSeconds(3);

  /** When each Sacrificial's line may next be drawn in full; main thread only. */
  private static final Map<UUID, Instant> LONG_LINES = new HashMap<>();

  private final MatchRunner runner;
  private final PaperContext context;
  private final CombatTracker tracker;

  Sacrifices(MatchRunner runner, PaperContext context, CombatTracker tracker) {
    this.runner = runner;
    this.context = context;
    this.tracker = tracker;
  }

  /** The living, fighting Sacrificial shielding {@code ally} from {@code type}, if one is. */
  Optional<Player> guardian(Player ally, AttackType type) {
    if (!Sacrificial.shields(type) || !runner.fighting(ally.getUniqueId())) {
      return Optional.empty();
    }
    var allyId = runner.memberOf(ally.getUniqueId()).map(Combatant::id);
    if (allyId.isEmpty()) {
      return Optional.empty();
    }
    return Sacrificial.guardian(runner.match().abilities(), allyId.orElseThrow())
        .flatMap(runner::entity)
        .filter(sac -> runner.fighting(sac.getUniqueId()))
        .filter(sac -> !sac.getUniqueId().equals(ally.getUniqueId()));
  }

  /**
   * Sends {@code hit}, meant for {@code ally}, to their Sacrificial. Returns whether one took it,
   * in which case the ally takes none.
   */
  boolean shield(Optional<Player> attacker, Player ally, DamageFormula.Hit hit) {
    return shield(attacker, attacker.map(Player::getUniqueId), ally, hit);
  }

  /**
   * The void's damage a tick (1.12's {@code Entity.ac()}: 4 every tick below the world), meant for
   * {@code ally} as {@code cause}: their Sacrificial takes it, credited to {@code credit}, unless
   * the plain void (nobody knocked them) or no Sacrificial shields them. Returns whether one did.
   */
  boolean shieldVoid(Player ally, AttackType cause, Optional<UUID> credit) {
    var sac = guardian(ally, cause);
    if (sac.isEmpty()) {
      return false;
    }
    take(Optional.empty(), ally, sac.orElseThrow(), new Meant(cause, VOID_DAMAGE, credit));
    return true;
  }

  /** What the void took each tick in Minecraft 1.12. */
  static final double VOID_DAMAGE = 4;

  /**
   * Sends {@code hit}, dealt for {@code owner} by something with no kit of its own (a summon,
   * napalm's fire), to {@code ally}'s Sacrificial. Returns whether one took it.
   */
  boolean shieldFor(UUID owner, Player ally, DamageFormula.Hit hit) {
    return shield(Optional.empty(), Optional.of(owner), ally, hit);
  }

  private boolean shield(
      Optional<Player> attacker, Optional<UUID> credit, Player ally, DamageFormula.Hit hit) {
    var sac = guardian(ally, hit.attack());
    var allySide = runner.kits().side(ally.getUniqueId());
    if (sac.isEmpty() || allySide.isEmpty()) {
      return false;
    }
    var random = runner.match().random(runner.now());
    var attackerSide = attacker.flatMap(a -> runner.kits().side(a.getUniqueId()));
    var preArmor =
        DamageFormula.finalDamage(
            KitCombat.adjusted(hit, attackerSide, allySide.orElseThrow(), random)
                .against(List.of()));
    take(attacker, ally, sac.orElseThrow(), new Meant(hit.attack(), preArmor, credit));
    return true;
  }

  /** {@code sac} takes {@code meant}, sacrificed for {@code ally}; the ally flinches. */
  void take(Optional<Player> attacker, Player ally, Player sac, Meant meant) {
    var amount = meant.amount();
    var sacSide = runner.kits().side(sac.getUniqueId());
    if (sacSide.isEmpty()) {
      return;
    }
    context.guarded("show a sacrifice", () -> show(ally, sac));
    ally.setNoDamageTicks(ally.getMaximumNoDamageTicks());
    context.guarded("remember a bonded ally's hurt", () -> ally.setLastDamage(amount));
    context.guarded("flinch a bonded ally", () -> ally.playHurtAnimation(0));
    if (amount <= 0) {
      return;
    }
    var allyTeam = runner.memberOf(ally.getUniqueId()).flatMap(Combatant::team);
    var attack =
        allyTeam
            .map(team -> Sacrificial.sacrificed(meant.type(), ally.getName(), team))
            .orElseGet(meant::type);
    var random = runner.match().random(runner.now());
    var attackerSide = attacker.flatMap(a -> runner.kits().side(a.getUniqueId()));
    var computed =
        KitCombat.damage(
            DamageFormula.Hit.of(attack, amount, KitFactory.armor(sac)),
            attackerSide,
            sacSide.orElseThrow(),
            random);
    var dealt = PaperKitResistance.apply(sac, computed, attack);
    tracker.hit(sac, dealt, meant.credit(), attack);
    sac.setHealth(Math.max(0, sac.getHealth() - dealt));
    attacker.ifPresent(a -> runner.kits().hit(a, sac, attack, dealt));
  }

  /** Red Warfare's bond particles between {@code ally} and {@code sac}. */
  private void show(Player ally, Player sac) {
    var everyone = ally.getServer().getOnlinePlayers();
    Classic.particle(
        Classic.Puff.of(Particle.BLOCK, 7)
            .spread(0.4, 0.4, 0.4)
            .with(Material.EMERALD_BLOCK.createBlockData()),
        Places.at(ally).add(0, 1, 0),
        Classic.NORMAL,
        everyone);
    Classic.particle(
        Classic.Puff.of(Particle.BLOCK, 7)
            .spread(0.4, 0.4, 0.4)
            .with(Material.LAPIS_BLOCK.createBlockData()),
        Places.at(sac).add(0, 1, 0),
        Classic.NORMAL,
        everyone);
    var now = runner.now();
    var next = LONG_LINES.get(sac.getUniqueId());
    var full = next == null || now.isAfter(next);
    if (full) {
      LONG_LINES.put(sac.getUniqueId(), now.plus(LONG_LINE));
    }
    if (Places.at(ally).distance(Places.at(sac)) <= 1) {
      return;
    }
    var from = ally.getEyeLocation().subtract(0, 0.3, 0);
    var to = sac.getEyeLocation().subtract(0, 0.3, 0);
    var step = to.toVector().subtract(from.toVector()).normalize().multiply(0.4);
    from.add(step);
    to.subtract(step);
    var drawn = 0;
    for (var point : KitDisplays.line(from, to, 0.4)) {
      var nearEnd = point.distance(from) <= 4 || point.distance(to) <= 4;
      if ((!full || drawn++ % 2 != 0) && !nearEnd) {
        continue;
      }
      Classic.particle(
          Classic.Puff.of(Particle.DUST, 1).with(Classic.RED_DUST), point, Classic.SHORT, everyone);
    }
  }
}
