// Create a VAO and store its name
glVaoName = glGenVertexArrays();

// Bind the VAO that was just created
glBindVertexArray(glVaoName);

// Bind the previously created VBO
glBindBuffer(GL_ARRAY_BUFFER, glVboName);

// Have the first VAO index point to the bound VBO
glVertexAttribPointer(0, 3, GL_FLOAT, false, 0, 0);

// Enable the first VAO index
glEnableVertexAttribArray(0);
