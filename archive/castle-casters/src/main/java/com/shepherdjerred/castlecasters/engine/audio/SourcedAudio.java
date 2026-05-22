package com.shepherdjerred.castlecasters.engine.audio;

import static org.lwjgl.openal.AL10.alDeleteSources;

public record SourcedAudio(Audio audio, int alSourceName) {

  public void cleanup() {
    alDeleteSources(alSourceName);
  }
}
