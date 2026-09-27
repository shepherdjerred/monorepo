package com.shepherdjerred.thestorm.core.result;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

final class ResultTest {

  @Test
  void mapTransformsOnlySuccess() {
    Result<Integer, String> ok = Result.ok(2);
    Result<Integer, String> err = Result.err("nope");

    assertThat(ok.map(value -> value * 3)).isEqualTo(Result.ok(6));
    assertThat(err.map(value -> value * 3)).isEqualTo(Result.err("nope"));
  }

  @Test
  void flatMapShortCircuitsOnError() {
    Result<Integer, String> ok = Result.ok(2);

    assertThat(ok.flatMap(value -> Result.<Integer, String>err("stop")))
        .isEqualTo(Result.err("stop"));
    assertThat(ok.flatMap(value -> Result.<Integer, String>ok(value + 1))).isEqualTo(Result.ok(3));
  }

  @Test
  void mapErrorAndFold() {
    Result<Integer, String> err = Result.err("bad");

    assertThat(err.mapError(String::length)).isEqualTo(Result.err(3));
    String folded = err.fold(value -> "ok", error -> "err:" + error);
    assertThat(folded).isEqualTo("err:bad");
    assertThat(err.isOk()).isFalse();
  }
}
