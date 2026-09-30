package com.shepherdjerred.thestorm.core.result;

import java.util.function.Function;

/**
 * The outcome of an operation that can fail in an expected way.
 *
 * <p>Expected failures (bad input, insufficient funds, a denied action) are values, not exceptions.
 * Exceptions are reserved for broken invariants.
 *
 * @param <T> the success value
 * @param <E> the error value
 */
public sealed interface Result<T, E> {

  /** A successful result. */
  record Ok<T, E>(T value) implements Result<T, E> {}

  /** A failed result. */
  record Err<T, E>(E error) implements Result<T, E> {}

  static <T, E> Result<T, E> ok(T value) {
    return new Ok<>(value);
  }

  static <T, E> Result<T, E> err(E error) {
    return new Err<>(error);
  }

  default boolean isOk() {
    return this instanceof Ok<T, E>;
  }

  default <U> Result<U, E> map(Function<? super T, ? extends U> mapper) {
    return switch (this) {
      case Ok<T, E>(var value) -> ok(mapper.apply(value));
      case Err<T, E>(var error) -> err(error);
    };
  }

  default <U> Result<U, E> flatMap(Function<? super T, Result<U, E>> mapper) {
    return switch (this) {
      case Ok<T, E>(var value) -> mapper.apply(value);
      case Err<T, E>(var error) -> err(error);
    };
  }

  default <F> Result<T, F> mapError(Function<? super E, ? extends F> mapper) {
    return switch (this) {
      case Ok<T, E>(var value) -> ok(value);
      case Err<T, E>(var error) -> err(mapper.apply(error));
    };
  }

  default <R> R fold(
      Function<? super T, ? extends R> onOk, Function<? super E, ? extends R> onErr) {
    return switch (this) {
      case Ok<T, E>(var value) -> onOk.apply(value);
      case Err<T, E>(var error) -> onErr.apply(error);
    };
  }
}
