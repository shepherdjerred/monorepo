package com.shepherdjerred.castlecasters.engine.graphics.shader.code;

import lombok.AllArgsConstructor;
import lombok.ToString;
import lombok.extern.log4j.Log4j2;

import java.io.FileNotFoundException;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

@Log4j2
@ToString
@AllArgsConstructor
public class ClasspathFileShaderCodeLoader implements ShaderCodeLoader {

  private final String basePath;

  @Override
  public String getShaderCode(String shaderFileName) throws IOException {
    try (var stream = this.getClass().getResourceAsStream(basePath + shaderFileName)) {
      if (stream == null) {
        throw new FileNotFoundException(shaderFileName);
      }
      var bytes = stream.readAllBytes();
      return new String(bytes, StandardCharsets.UTF_8);
    }
  }
}
