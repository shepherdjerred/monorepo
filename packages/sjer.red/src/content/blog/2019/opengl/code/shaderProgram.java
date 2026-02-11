// Create IDs for a shader program and vertex shader
glShaderProgramName = glCreateProgram();
glVertexShaderName = glCreateShader(GL_VERTEX_SHADER);

// Associate the shader with a string containing its source code
glShaderSource(glVertexShaderName, vertexShaderSource);

// Compile the stored source for the shader
glCompileShader(glVertexShaderName);

// Associate a shader with a shader program
glAttachShader(glShaderProgramName, glVertexShaderName);

// Create an executable from the attached shaders
glLinkProgram(glShaderProgramName);

// Set OpenGL to use the shader program when rendering
glUseProgram(glShaderProgramName);