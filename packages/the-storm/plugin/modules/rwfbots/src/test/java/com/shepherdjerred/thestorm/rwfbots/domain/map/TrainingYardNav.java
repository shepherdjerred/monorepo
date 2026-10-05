package com.shepherdjerred.thestorm.rwfbots.domain.map;

import com.shepherdjerred.thestorm.core.result.Result;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * The shipped training yard's baked nav artifact ({@code rwf/maps/training-yard/nav.rwfnav}): a
 * walled 64 by 64 yard with two bases with one doorway each, eight 2 by 2 pillars and a nuke on a
 * pedestal in the middle. The build hands the path to tests as a system property.
 */
public final class TrainingYardNav {

  public static final NavArtifact NAV = load();

  private TrainingYardNav() {}

  private static NavArtifact load() {
    var path = Path.of(System.getProperty("thestorm.rwfbots.trainingYardNav"));
    try {
      return switch (NavCodec.decode(Files.readAllBytes(path))) {
        case Result.Ok<NavArtifact, NavCodec.CodecError>(var nav) -> nav;
        case Result.Err<NavArtifact, NavCodec.CodecError>(var error) ->
            throw new IllegalStateException("training yard nav does not decode: " + error);
      };
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }
}
