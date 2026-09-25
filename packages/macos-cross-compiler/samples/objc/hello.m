#import <Foundation/Foundation.h>

int main(void) {
  @autoreleasepool {
    NSString *name = [[NSProcessInfo processInfo] operatingSystemVersionString];
    printf("Hello from Objective-C on %s\n", name.UTF8String);
  }
  return 0;
}
