package com.shepherdjerred.thestorm.spells.domain;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.function.Function;

/**
 * Filters a spell's candidates (blocks or creatures) through a permission check. A spell acts only
 * on what the check allows; when it allows nothing, the first denial is what the caster is told.
 */
public final class Screening {

  private Screening() {}

  /**
   * Splits {@code candidates} by {@code check}, which returns a denial reason or empty when the
   * candidate is allowed.
   */
  public static <T, R> Screened<T, R> screen(
      List<T> candidates, Function<? super T, Optional<R>> check) {
    var allowed = new ArrayList<T>();
    Optional<R> firstDenial = Optional.empty();
    for (var candidate : candidates) {
      var denial = check.apply(candidate);
      if (denial.isEmpty()) {
        allowed.add(candidate);
      } else if (firstDenial.isEmpty()) {
        firstDenial = denial;
      }
    }
    return new Screened<>(allowed, firstDenial);
  }

  /**
   * The outcome of {@link #screen}.
   *
   * @param allowed the candidates the check allowed, in their original order
   * @param firstDenial the first reason a candidate was denied, if any was
   */
  public record Screened<T, R>(List<T> allowed, Optional<R> firstDenial) {

    public Screened {
      allowed = List.copyOf(allowed);
    }

    /** True when nothing may be acted on. */
    public boolean isEmpty() {
      return allowed.isEmpty();
    }
  }
}
