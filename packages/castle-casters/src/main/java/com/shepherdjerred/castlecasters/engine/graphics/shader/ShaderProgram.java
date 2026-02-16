package com.shepherdjerred.castlecasters.engine.graphics.shader;

import com.shepherdjerred.castlecasters.engine.graphics.shader.code.ShaderCodeLoader;
import com.shepherdjerred.castlecasters.engine.resource.Resource;
import lombok.Getter;
import lombok.extern.log4j.Log4j2;
import org.joml.Matrix4f;
import org.lwjgl.system.MemoryStack;

import java.io.IOException;
import java.nio.FloatBuffer;
import java.util.HashMap;
import java.util.Map;

import static org.lwjgl.opengl.GL20.*;

@Log4j2
public class ShaderProgram implements Resource {

  @Getter
  private final ShaderProgramName shaderProgramName;
  private final ShaderCodeLoader shaderCodeLoader;
  private final Map<ShaderUniform, Integer> uniformIdMap;
  private final int shaderProgramId;
  private int vertexShaderId;
  private int fragmentShaderId;

  public ShaderProgram(ShaderProgramName shaderProgramName, ShaderCodeLoader shaderCodeLoader) {
    this.shaderProgramName = shaderProgramName;
    this.shaderCodeLoader = shaderCodeLoader;
    shaderProgramId = glCreateProgram();
    if (shaderProgramId == 0) {
      throw new RuntimeException("Could not create ShaderCode");
    }
    uniformIdMap = new HashMap<>();
  }

  public void createUniform(ShaderUniform uniform) {
    int uniformId = glGetUniformLocation(shaderProgramId, uniform.getName());
    if (uniformId < 0) {
      throw new RuntimeException("Could not create uniform:" + uniform);
    }
    uniformIdMap.put(uniform, uniformId);
  }

  public void setUniform(ShaderUniform uniform, int value) {
    glUniform1i(uniformIdMap.get(uniform), value);
  }

  public void setUniform(ShaderUniform uniform, Matrix4f value) {
    try (MemoryStack stack = MemoryStack.stackPush()) {
      FloatBuffer fb = stack.mallocFloat(16);
      value.get(fb);
      glUniformMatrix4fv(uniformIdMap.get(uniform), false, fb);
    }
  }

  public void setUniform(ShaderUniform uniform, float[] value) {
    glUniform3f(uniformIdMap.get(uniform), value[0], value[1], value[2]);
  }

  private String loadShaderCode(String shaderName) throws IOException {
    return shaderCodeLoader.getShaderCode(shaderName);
  }

  public void createVertexShader(String shaderName) throws Exception {
    vertexShaderId = createShader(shaderName, GL_VERTEX_SHADER);
  }

  public void createFragmentShader(String shaderName) throws Exception {
    fragmentShaderId = createShader(shaderName, GL_FRAGMENT_SHADER);
  }

  private int createShader(String shaderName, int shaderType) throws Exception {
    var shaderCode = loadShaderCode(shaderName);
    int shaderId = glCreateShader(shaderType);
    if (shaderId == 0) {
      throw new RuntimeException("Error creating shader. Type: " + shaderType);
    }

    glShaderSource(shaderId, shaderCode);
    glCompileShader(shaderId);

    if (glGetShaderi(shaderId, GL_COMPILE_STATUS) == 0) {
      throw new RuntimeException(
          "Error compiling ShaderCode code: " + glGetShaderInfoLog(shaderId, 1024));
    }

    glAttachShader(shaderProgramId, shaderId);

    return shaderId;
  }

  public void link() {
    glLinkProgram(shaderProgramId);
    if (glGetProgrami(shaderProgramId, GL_LINK_STATUS) == 0) {
      throw new RuntimeException(
          "Error linking ShaderCode code: " + glGetProgramInfoLog(shaderProgramId, 1024));
    }

    if (vertexShaderId != 0) {
      glDetachShader(shaderProgramId, vertexShaderId);
    }
    if (fragmentShaderId != 0) {
      glDetachShader(shaderProgramId, fragmentShaderId);
    }

    glValidateProgram(shaderProgramId);
    if (glGetProgrami(shaderProgramId, GL_VALIDATE_STATUS) == 0) {
      log.warn("Warning validating ShaderCode code: {}", glGetProgramInfoLog(shaderProgramId, 1024));
    }
  }

  public void bind() {
    glUseProgram(shaderProgramId);
  }

  public void unbind() {
    glUseProgram(0);
  }

  public void cleanup() {
    unbind();
    glDeleteShader(vertexShaderId);
    glDeleteShader(fragmentShaderId);
    glDeleteProgram(shaderProgramId);
  }
}
