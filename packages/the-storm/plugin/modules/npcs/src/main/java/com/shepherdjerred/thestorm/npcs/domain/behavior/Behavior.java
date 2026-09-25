package com.shepherdjerred.thestorm.npcs.domain.behavior;

import java.util.Comparator;
import java.util.List;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.function.ToDoubleFunction;
import java.util.stream.IntStream;

/**
 * A behavior-tree node over a context {@code C}. Trees are stateless and re-evaluated from the root
 * on every tick ("reactive" trees): a higher-priority branch interrupts a running lower one as soon
 * as its condition holds. Keep any memory in the context.
 *
 * @param <C> what the tree reads and writes while it decides
 */
@FunctionalInterface
public interface Behavior<C> {

  /** The result of ticking a node. */
  enum Status {
    SUCCESS,
    FAILURE,
    RUNNING
  }

  Status tick(C context);

  /** Succeeds when {@code test} holds, fails otherwise. */
  static <C> Behavior<C> condition(Predicate<? super C> test) {
    return context -> test.test(context) ? Status.SUCCESS : Status.FAILURE;
  }

  /** Runs {@code effect}, which reports its own status. */
  static <C> Behavior<C> action(Function<? super C, Status> effect) {
    return effect::apply;
  }

  /**
   * Ticks children in order until one does not succeed, and returns that status; succeeds when all
   * do. "Do all of these."
   */
  static <C> Behavior<C> sequence(List<Behavior<C>> children) {
    var nodes = List.copyOf(children);
    requireChildren(nodes);
    return context -> {
      for (var child : nodes) {
        var status = child.tick(context);
        if (status != Status.SUCCESS) {
          return status;
        }
      }
      return Status.SUCCESS;
    };
  }

  /**
   * Ticks children in order until one does not fail, and returns that status; fails when all do.
   * "Do the first of these that works."
   */
  static <C> Behavior<C> selector(List<Behavior<C>> children) {
    var nodes = List.copyOf(children);
    requireChildren(nodes);
    return context -> firstNotFailing(nodes, context);
  }

  /** Swaps success and failure; running stays running. */
  static <C> Behavior<C> inverter(Behavior<C> child) {
    return context ->
        switch (child.tick(context)) {
          case SUCCESS -> Status.FAILURE;
          case FAILURE -> Status.SUCCESS;
          case RUNNING -> Status.RUNNING;
        };
  }

  /**
   * A utility selector: scores every option, then ticks them from highest to lowest score (ties in
   * declaration order) until one does not fail. Options scoring zero or less are skipped; fails
   * when none is left.
   */
  static <C> Behavior<C> utility(List<Scored<C>> options) {
    var scored = List.copyOf(options);
    if (scored.isEmpty()) {
      throw new IllegalArgumentException("a utility selector needs at least one option");
    }
    return context -> {
      var scores =
          scored.stream().mapToDouble(option -> option.score().applyAsDouble(context)).toArray();
      var order =
          IntStream.range(0, scored.size())
              .filter(index -> scores[index] > 0)
              .boxed()
              .sorted(Comparator.comparingDouble((Integer index) -> -scores[index]))
              .map(index -> scored.get(index).behavior())
              .toList();
      return firstNotFailing(order, context);
    };
  }

  /** An option for {@link #utility}: a behavior and how much it is wanted right now. */
  record Scored<C>(ToDoubleFunction<? super C> score, Behavior<C> behavior) {}

  private static <C> Status firstNotFailing(List<Behavior<C>> nodes, C context) {
    for (var child : nodes) {
      var status = child.tick(context);
      if (status != Status.FAILURE) {
        return status;
      }
    }
    return Status.FAILURE;
  }

  private static void requireChildren(List<?> children) {
    if (children.isEmpty()) {
      throw new IllegalArgumentException("a composite node needs at least one child");
    }
  }
}
