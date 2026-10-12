package com.shepherdjerred.thestorm.arena.domain.survival;

import com.shepherdjerred.thestorm.arena.domain.geometry.Point;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

/** Locked aim and mandatory phase casts keep burst damage from skipping fights. */
public final class BossMechanics {
  public enum Shape {
    WIND_LANES("Wind lanes"),
    VORTEX("Vortex"),
    WIND_BARRAGE("Wind barrage"),
    FANG_CROSS("Fang cross"),
    RITUAL("Dark ritual"),
    WARDED_ADDS("Summon guards"),
    CHARGE("Siege charge"),
    SLAM("Ground slam"),
    DEBRIS("Falling debris"),
    ROOTS("Grasping roots"),
    HEART_SHIFT("Heart pulse"),
    ENTANGLE("Entangle"),
    SONIC_ZONE("Sonic beam"),
    SONIC_RIPPLES("Echo rings"),
    SILENCE("Silence"),
    HEATED_FLOOR("Heated floor"),
    SLAG("Molten slag"),
    COOLANT("Steam burst");

    private final String label;

    Shape(String label) {
      this.label = label;
    }

    public String label() {
      return label;
    }
  }

  public record Cast(Shape shape, Point origin, Point aim, Instant impact, int phase) {
    public boolean hits(Point point) {
      if (Math.abs(point.y() - aim.y()) > 8) return false;
      var dx = point.x() - origin.x();
      var dz = point.z() - origin.z();
      var length = Math.hypot(aim.x() - origin.x(), aim.z() - origin.z());
      var ux = length < 0.01 ? 1 : (aim.x() - origin.x()) / length;
      var uz = length < 0.01 ? 0 : (aim.z() - origin.z()) / length;
      var along = dx * ux + dz * uz;
      var across = Math.abs(dx * uz - dz * ux);
      return directional(along, across, length) || area(point, ux, uz);
    }

    private boolean directional(double along, double across, double length) {
      return switch (shape) {
        case WIND_LANES, HEATED_FLOOR ->
            along >= 0 && along <= 24 && (across <= 1.5 || Math.abs(across - 6) <= 1.5);
        case CHARGE -> along >= 0 && along <= Math.min(24, length + 2) && across < 2;
        case SONIC_ZONE -> along >= 0 && along <= 28 && across < 1.25;
        default -> false;
      };
    }

    private boolean area(Point point, double ux, double uz) {
      var fromAim = Math.hypot(point.x() - aim.x(), point.z() - aim.z());
      var fromOrigin = Math.hypot(point.x() - origin.x(), point.z() - origin.z());
      return switch (shape) {
        case FANG_CROSS -> cross(point, origin, 16);
        case ENTANGLE -> cross(point, aim, 10);
        case ROOTS -> fromAim < 4;
        case RITUAL, SILENCE -> fromAim < 6;
        case SLAG -> fromAim < 3;
        case SLAM -> fromOrigin < 5;
        case VORTEX, SONIC_RIPPLES -> fromAim >= 2 && fromAim < 6;
        case COOLANT -> fromAim >= 2 && fromAim < 7;
        case WARDED_ADDS -> fromOrigin >= 3 && fromOrigin < 8;
        case HEART_SHIFT -> fromOrigin >= 4 && fromOrigin < 8;
        case WIND_BARRAGE, DEBRIS -> impacts(point, ux, uz);
        default -> false;
      };
    }

    private boolean impacts(Point point, double ux, double uz) {
      for (var offset = -5; offset <= 5; offset += 5) {
        if (Math.hypot(point.x() - aim.x() + uz * offset, point.z() - aim.z() - ux * offset) < 2)
          return true;
      }
      return false;
    }

    private static boolean cross(Point point, Point center, double radius) {
      var dx = point.x() - center.x();
      var dz = point.z() - center.z();
      return Math.hypot(dx, dz) <= radius && (Math.abs(dx) < 1.5 || Math.abs(dz) < 1.5);
    }
  }

  private final List<Shape> attacks;
  private Instant next;
  private Optional<Cast> cast = Optional.empty();
  private int phase = 1;
  private int sequence;
  private boolean resolvedPhase;

  public BossMechanics(String boss, Instant now) {
    attacks =
        switch (boss) {
          case "gale-sovereign" -> List.of(Shape.WIND_LANES, Shape.VORTEX, Shape.WIND_BARRAGE);
          case "hexmaster" -> List.of(Shape.FANG_CROSS, Shape.RITUAL, Shape.WARDED_ADDS);
          case "ravager" -> List.of(Shape.CHARGE, Shape.SLAM, Shape.DEBRIS);
          case "heartwood" -> List.of(Shape.ROOTS, Shape.HEART_SHIFT, Shape.ENTANGLE);
          case "warden" -> List.of(Shape.SONIC_ZONE, Shape.SONIC_RIPPLES, Shape.SILENCE);
          case "furnace-colossus" -> List.of(Shape.HEATED_FLOOR, Shape.SLAG, Shape.COOLANT);
          default -> throw new IllegalArgumentException("Unknown survival boss " + boss);
        };
    next = now.plusSeconds(5);
  }

  public Optional<Cast> cast() {
    return cast;
  }

  public int phase(double healthFraction) {
    var boundary = phase == 1 ? .66 : .33;
    if (phase < 3 && resolvedPhase && cast.isEmpty() && healthFraction <= boundary + .000001) {
      phase++;
      sequence = 0;
      resolvedPhase = false;
      next = Instant.MIN;
    }
    return phase;
  }

  /** Damage stops at a phase boundary, or at one HP until the final phase has resolved a cast. */
  public double damageLimit(double health, double maximum) {
    var floor =
        switch (phase) {
          case 1 -> maximum * .66;
          case 2 -> maximum * .33;
          case 3 -> resolvedPhase ? 0 : 1;
          default -> throw new IllegalStateException("Invalid boss phase");
        };
    return Math.max(0, health - floor);
  }

  public boolean begin(Instant now, Point origin, Point target, double healthFraction) {
    phase(healthFraction);
    if (cast.isPresent() || now.isBefore(next)) {
      return false;
    }
    var shape = attacks.get((phase - 1 + sequence) % attacks.size());
    cast = Optional.of(new Cast(shape, origin, target, now.plusSeconds(3), phase));
    return true;
  }

  public Optional<Cast> impact(Instant now) {
    var due = cast.filter(c -> !now.isBefore(c.impact()));
    if (due.isPresent()) {
      resolvedPhase = true;
      sequence++;
      cast = Optional.empty();
      next = now.plusSeconds(Math.max(4, 10 - phase * 2));
    }
    return due;
  }

  public boolean interrupt(Instant now) {
    if (cast.isEmpty()) {
      return false;
    }
    resolvedPhase = true;
    sequence++;
    cast = Optional.empty();
    next = now.plusSeconds(10);
    return true;
  }

  public static double damage(int round, int phase) {
    if (round < 5 || phase < 1 || phase > 3)
      throw new IllegalArgumentException("Invalid boss cast");
    return Math.min(14, 4 + phase * 2 + Math.max(0, round - 5) / 15.0);
  }
}
