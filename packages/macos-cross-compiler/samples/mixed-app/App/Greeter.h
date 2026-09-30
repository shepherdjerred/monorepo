#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Objective-C, called from Swift through the bridging header. It calls back
/// into Swift (`Tally`) through the generated MixedApp-Swift.h.
@interface Greeter : NSObject
- (NSString *)greetingFor:(NSString *)name;
@end

NS_ASSUME_NONNULL_END
