#import "Greeter.h"

#import "MixedApp-Swift.h"

@implementation Greeter

- (NSString *)greetingFor:(NSString *)name {
  Tally *tally = [[Tally alloc] init];
  [tally add:name];
  return [NSString stringWithFormat:@"Hello, %@ (%ld)", name, (long)tally.count];
}

@end
