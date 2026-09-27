plugins { id("storm.jooq-conventions") }

dependencies {
  // The agent senses chat, works tickets, and reads moderation history, all through app ports.
  implementation(project(":chat"))
  implementation(project(":essentials"))
  implementation(project(":tickets"))
}
