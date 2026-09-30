package com.shepherdjerred.thestorm.npcs.domain.content;

import com.shepherdjerred.thestorm.npcs.domain.content.ContentCompiler.Located;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.function.Supplier;

/** Collects content problems as the compiler goes. */
final class Problems {

  private final List<ContentProblem> problems = new ArrayList<>();

  /** Records a problem at {@code rest} inside {@code located} (empty for the entry itself). */
  void add(Located<?> located, String rest, String message) {
    var path = rest.isEmpty() ? located.path() : located.path() + "." + rest;
    problems.add(new ContentProblem(located.source(), path, message));
  }

  /**
   * Builds a value whose constructor validates itself; a rejected value becomes a problem instead
   * of an exception.
   */
  <T> Optional<T> attempt(Located<?> located, String rest, Supplier<T> build) {
    try {
      return Optional.of(build.get());
    } catch (IllegalArgumentException e) {
      add(located, rest, Objects.requireNonNullElse(e.getMessage(), "invalid value"));
      return Optional.empty();
    }
  }

  boolean isEmpty() {
    return problems.isEmpty();
  }

  List<ContentProblem> all() {
    return List.copyOf(problems);
  }
}
