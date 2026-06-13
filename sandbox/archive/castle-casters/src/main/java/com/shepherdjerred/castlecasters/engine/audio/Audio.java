package com.shepherdjerred.castlecasters.engine.audio;

import com.shepherdjerred.castlecasters.engine.resource.Resource;

import static org.lwjgl.openal.AL10.alDeleteBuffers;

public record Audio(AudioName audioName, int alBufferName, int channels, int sampleRate) implements Resource {

  @Override
  public void cleanup() {
    alDeleteBuffers(alBufferName);
  }
}
