plugins { id("storm.jooq-conventions") }

// Level milestones are announced through the discord module's relay port.
dependencies { implementation(project(":discord")) }
