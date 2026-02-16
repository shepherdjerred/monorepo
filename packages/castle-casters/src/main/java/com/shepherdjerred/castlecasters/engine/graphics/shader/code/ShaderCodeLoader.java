package com.shepherdjerred.castlecasters.engine.graphics.shader.code;

import java.io.IOException;

public interface ShaderCodeLoader {

  String getShaderCode(String shaderName) throws IOException;
}
