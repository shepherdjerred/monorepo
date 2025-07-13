pub fn reply(guess: Int) -> String {
  case guess {
    42 -> "Correct"
    i if i <= 43 && i >= 41  -> "So close"
    i if i < 42 -> "Too low"
    i if i > 42 -> "Too high"
    _ -> "Impossible"
  }
}
