package com.shepherdjerred.thestorm.spells.adapter.paper;

import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import java.util.EnumMap;
import java.util.Map;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.SoundCategory;

/** Each spell's particles and sound, resolved from {@code spells.yml} at enable. */
public final class Fx {

  /**
   * One spell's resolved effects.
   *
   * @param particle a particle that needs no data
   * @param sound the cast sound
   */
  public record Resolved(Particle particle, Sound sound) {}

  private final Map<SpellKind, Resolved> bySpell;

  public Fx(Map<SpellKind, Resolved> bySpell) {
    var copy = new EnumMap<SpellKind, Resolved>(SpellKind.class);
    copy.putAll(bySpell);
    for (var kind : SpellKind.values()) {
      if (!copy.containsKey(kind)) {
        throw new IllegalArgumentException("no effects resolved for " + kind);
      }
    }
    this.bySpell = copy;
  }

  private Resolved of(SpellKind kind) {
    var resolved = bySpell.get(kind);
    if (resolved == null) {
      throw new IllegalStateException("no effects resolved for " + kind);
    }
    return resolved;
  }

  /** The spell's sound and a puff of its particles at {@code where}. */
  public void cast(SpellKind kind, Location where) {
    sound(kind, where);
    burst(kind, where, 24, 0.5);
  }

  public void sound(SpellKind kind, Location where) {
    where.getWorld().playSound(where, of(kind).sound(), SoundCategory.PLAYERS, 1.0f, 1.0f);
  }

  /** {@code count} particles spread up to {@code spread} blocks around {@code where}. */
  public void burst(SpellKind kind, Location where, int count, double spread) {
    where.getWorld().spawnParticle(of(kind).particle(), where, count, spread, spread, spread, 0.02);
  }

  /** A line of particles from {@code from} to {@code to}, one every half block. */
  public void line(SpellKind kind, Location from, Location to) {
    var particle = of(kind).particle();
    var delta = to.toVector().subtract(from.toVector());
    var steps = Math.max(1, (int) Math.ceil(delta.length() * 2));
    var step = delta.multiply(1.0 / steps);
    var point = from.clone();
    for (var index = 0; index <= steps; index++) {
      point.getWorld().spawnParticle(particle, point, 1, 0, 0, 0, 0);
      point.add(step);
    }
  }

  /** A horizontal ring of particles of {@code radius} around {@code centre}. */
  public void ring(SpellKind kind, Location centre, double radius) {
    var particle = of(kind).particle();
    var points = Math.max(12, (int) Math.ceil(radius * 8));
    for (var index = 0; index < points; index++) {
      var angle = 2 * Math.PI * index / points;
      var point = centre.clone().add(Math.cos(angle) * radius, 0.2, Math.sin(angle) * radius);
      centre.getWorld().spawnParticle(particle, point, 1, 0, 0, 0, 0);
    }
  }
}
