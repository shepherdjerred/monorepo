package com.shepherdjerred.castlecasters.logic.turn.validator;

import com.google.common.collect.Sets;

import java.util.Set;
import java.util.function.BiConsumer;
import java.util.function.BinaryOperator;
import java.util.function.Function;
import java.util.function.Supplier;
import java.util.stream.Collector;

public class TurnValidationResultCollector implements
    Collector<TurnValidationResult, TurnValidationResult, TurnValidationResult> {

  @Override
  public Supplier<TurnValidationResult> supplier() {
    return TurnValidationResult::new;
  }

  @Override
  public BiConsumer<TurnValidationResult, TurnValidationResult> accumulator() {
    return TurnValidationResult::combine;
  }

  @Override
  public BinaryOperator<TurnValidationResult> combiner() {
    return TurnValidationResult::combine;
  }

  @Override
  public Function<TurnValidationResult, TurnValidationResult> finisher() {
    return (result) -> result;
  }

  @Override
  public Set<Characteristics> characteristics() {
    return Sets.immutableEnumSet(Characteristics.UNORDERED);
  }
}
