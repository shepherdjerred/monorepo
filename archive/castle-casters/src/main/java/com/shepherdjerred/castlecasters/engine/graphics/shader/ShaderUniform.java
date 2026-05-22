package com.shepherdjerred.castlecasters.engine.graphics.shader;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public enum ShaderUniform {
  TEXTURE_SAMPLER("texture_sampler"),
  PROJECTION_MATRIX("projectionMatrix"),
  MODEL_MATRIX("modelMatrix"),
  TEXT_COLOR("textColor");

  private final String name;
}
