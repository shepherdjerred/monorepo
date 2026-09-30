plugins { id("storm.jooq-conventions") }

dependencies {
  // Ticket changes are posted through the discord module's relay port.
  implementation(project(":discord"))
}
