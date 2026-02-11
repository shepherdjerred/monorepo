// Initialize GLFW
glfwInit();

// Create a new window with a given width, height, and title
long window = glfwCreateWindow(300, 300, "Hello World!", NULL, NULL);

// Set the newly created window at the current OpenGL context
glfwMakeContextCurrent(window);

// Show the window
glfwShowWindow(window);

// Creates OpenGL bindings using the current context
GL.createCapabilities();
