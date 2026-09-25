plugins { id("storm.module-conventions") }

// Mechanisms are gated by the Mechanic track's level permissions (tracks.app.Track).
dependencies { implementation(project(":tracks")) }
