#include <stdio.h>
#include <windows.h>

int main(void) {
  printf("Hello from C on Windows (process %lu)\n", GetCurrentProcessId());
  return 0;
}
