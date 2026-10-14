package com.shepherdjerred.thestorm.rwf.adapter.paper;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import org.bukkit.event.entity.EntityDamageEvent;

/**
 * Keeps native successful-hit callbacks while applying RWF mitigation exactly once. Paper 26.2 has
 * no supported final-damage setter. Its deprecated modifier slots are therefore linked by exact
 * signature at startup, alongside the other pinned native weapon operations. Absorption stays in
 * the event so the server consumes it; a shield-blocked event is never rewritten.
 */
final class PaperNativeDamage {
  private PaperNativeDamage() {}

  static void verifyLinkage() {
    Objects.requireNonNull(Linked.BINDINGS);
  }

  static boolean blocked(EntityDamageEvent event) {
    return value(event, Linked.BINDINGS.blocking()) < 0;
  }

  static double beforeAbsorption(EntityDamageEvent event) {
    return event.getFinalDamage() - value(event, Linked.BINDINGS.absorption());
  }

  static void apply(EntityDamageEvent event, double damage, double absorption) {
    var b = Linked.BINDINGS;
    event.setDamage(damage);
    for (var modifier : b.modifiers()) {
      if (!modifier.equals(b.base()) && applicable(event, modifier)) {
        set(event, modifier, 0);
      }
    }
    if (applicable(event, b.absorption())) {
      set(event, b.absorption(), -Math.min(absorption, damage));
    }
  }

  private static final class Linked {
    private static final Bindings BINDINGS = bind();
  }

  private record Bindings(
      Method applicable,
      Method get,
      Method set,
      List<Object> modifiers,
      Object base,
      Object blocking,
      Object absorption) {}

  private static Bindings bind() {
    try {
      var modifier = Class.forName("org.bukkit.event.entity.EntityDamageEvent$DamageModifier");
      return new Bindings(
          EntityDamageEvent.class.getMethod("isApplicable", modifier),
          EntityDamageEvent.class.getMethod("getDamage", modifier),
          EntityDamageEvent.class.getMethod("setDamage", modifier, double.class),
          List.copyOf(Arrays.asList(Objects.requireNonNull(modifier.getEnumConstants()))),
          Objects.requireNonNull(modifier.getField("BASE").get(null)),
          Objects.requireNonNull(modifier.getField("BLOCKING").get(null)),
          Objects.requireNonNull(modifier.getField("ABSORPTION").get(null)));
    } catch (ReflectiveOperationException failure) {
      throw new IllegalStateException("Pinned Paper 26.2 final-damage linkage failed", failure);
    }
  }

  private static boolean applicable(EntityDamageEvent event, Object modifier) {
    return Boolean.TRUE.equals(call(Linked.BINDINGS.applicable(), event, modifier));
  }

  private static double value(EntityDamageEvent event, Object modifier) {
    if (!applicable(event, modifier)) {
      return 0;
    }
    return ((Number) call(Linked.BINDINGS.get(), event, modifier)).doubleValue();
  }

  private static void set(EntityDamageEvent event, Object modifier, double value) {
    try {
      Linked.BINDINGS.set().invoke(event, modifier, value);
    } catch (IllegalAccessException | InvocationTargetException failure) {
      throw new IllegalStateException("Pinned native damage write failed", failure);
    }
  }

  private static Object call(Method method, EntityDamageEvent event, Object modifier) {
    try {
      return Objects.requireNonNull(method.invoke(event, modifier));
    } catch (IllegalAccessException | InvocationTargetException failure) {
      throw new IllegalStateException("Pinned native damage read failed", failure);
    }
  }
}
