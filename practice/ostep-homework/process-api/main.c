#include <printf.h>
#include <libc.h>
#include <unistd.h>

int main() {
   printf("hello world\n");
   int value = 100;
   int file = open("myfile", O_CREAT, S_IRWXU);
   if (file < 0) {
       printf("error opening file\n");
       return 1;
   }
   long result = write(file, "hello", 5);
   if (result < 0) {
       printf("error writing to file\n");
       return 1;
   }
   int code = fork();
   if (code < 0) {
       // fork failed
   } else if (code == 0) {
       // child
       printf("im a kiddo\n");
       printf("child sees: %i\n", value);
   } else {
       //parent
       printf("parent\n");
       printf("parent sees: %i\n", value);
   }
}