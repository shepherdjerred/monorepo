package com.shepherdjerred.thestorm.arena.domain.survival;

import com.shepherdjerred.thestorm.arena.domain.geometry.Point;
import java.time.Instant;
import java.util.Optional;

/** Cast warnings lock their aim before impact; movement during the cast can avoid every spell. */
public final class BossMechanics {
  public enum Shape {
    WIND_LANES,
    FANG_CROSS,
    CHARGE,
    ROOTS,
    SONIC_ZONE
  }

  public record Cast(Shape shape, Point origin, Point aim, Instant impact, int phase) {
    public boolean hits(Point point) {
      var dx = point.x() - origin.x();
      var dz = point.z() - origin.z();
      var length = Math.hypot(aim.x() - origin.x(), aim.z() - origin.z());
      var ux = length < 0.01 ? 1 : (aim.x() - origin.x()) / length;
      var uz = length < 0.01 ? 0 : (aim.z() - origin.z()) / length;
      var along = dx * ux + dz * uz;
      var across = Math.abs(dx * uz - dz * ux);
      return switch (shape) {
        case WIND_LANES ->
            along >= 0 && along <= 24 && (across <= 1.5 || Math.abs(across - 6) <= 1.5);
        case FANG_CROSS -> Math.hypot(dx, dz) <= 16 && (Math.abs(dx) < 1.5 || Math.abs(dz) < 1.5);
        case CHARGE -> along >= 0 && along <= Math.min(24, length + 2) && across < 2;
        case ROOTS, SONIC_ZONE -> Math.hypot(point.x() - aim.x(), point.z() - aim.z()) < 4;
      };
    }
  }

  private final Shape shape;
  private Instant next;
  private Optional<Cast> cast = Optional.empty();

  public BossMechanics(String boss, Instant now) {
    shape =
        switch (boss) {
          case "gale-sovereign" -> Shape.WIND_LANES;
          case "hexmaster" -> Shape.FANG_CROSS;
          case "ravager" -> Shape.CHARGE;
          case "heartwood" -> Shape.ROOTS;
          case "warden" -> Shape.SONIC_ZONE;
          default -> throw new IllegalArgumentException("Unknown survival boss " + boss);
        };
    next = now.plusSeconds(5);
  }

  public Optional<Cast> cast() {
    return cast;
  }

  public int phase(double healthFraction) {
    return healthFraction > 0.66 ? 1 : healthFraction > 0.33 ? 2 : 3;
  }

  public boolean begin(Instant now, Point origin, Point target, double healthFraction) {
    if (cast.isPresent() || now.isBefore(next)) {
      return false;
    }
    cast = Optional.of(new Cast(shape, origin, target, now.plusSeconds(3), phase(healthFraction)));
    return true;
  }

  public Optional<Cast> impact(Instant now) {
    var due = cast.filter(c -> !now.isBefore(c.impact()));
    if (due.isPresent()) {
      cast = Optional.empty();
      next = now.plusSeconds(Math.max(4, 10 - due.orElseThrow().phase() * 2));
    }
    return due;
  }

  public boolean interrupt(Instant now) {
    if (cast.isEmpty()) {
      return false;
    }
    cast = Optional.empty();
    next = now.plusSeconds(10);
    return true;
  }
}
