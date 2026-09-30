#include <iostream>
#include <string>
#include <vector>

int main() {
  std::vector<std::string> words{"Hello", "from", "C++", "on", "Windows"};
  for (const auto &word : words) {
    std::cout << word << ' ';
  }
  std::cout << '\n';
  return 0;
}
