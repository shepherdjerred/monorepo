package com.shepherdjerred.thestorm.rwfbots.adapter.content;

import com.shepherdjerred.thestorm.rwfbots.domain.learning.Feature;
import com.shepherdjerred.thestorm.rwfbots.domain.learning.ObservationContract;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;

/** Loads the same contract file used by the Python dataset and trainer. */
public final class LearningContract {
  private LearningContract() {}

  public static ObservationContract load() {
    var stream = LearningContract.class.getResourceAsStream("/" + ObservationContract.ID + ".tsv");
    if (stream == null) throw new IllegalStateException("missing learning observation contract");
    try (var reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
      return new ObservationContract(
          reader
              .lines()
              .map(
                  line -> {
                    var fields = line.split("\t", -1);
                    if (fields.length != 2)
                      throw new IllegalArgumentException("invalid feature contract row");
                    return new ObservationContract.Field(
                        Feature.valueOf(fields[0]), Double.parseDouble(fields[1]));
                  })
              .toList());
    } catch (IOException error) {
      throw new UncheckedIOException(error);
    }
  }
}
