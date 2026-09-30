#include "Words.h"

#include <sstream>
#include <string>

unsigned long mixed_word_count(const char *text) {
  std::istringstream stream{std::string(text)};
  std::string word;
  unsigned long count = 0;
  while (stream >> word) ++count;
  return count;
}
