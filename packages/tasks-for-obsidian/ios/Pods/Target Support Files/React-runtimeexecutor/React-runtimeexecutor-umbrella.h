#ifdef __OBJC__
#import <UIKit/UIKit.h>
#else
#ifndef FOUNDATION_EXPORT
#if defined(__cplusplus)
#define FOUNDATION_EXPORT extern "C"
#else
#define FOUNDATION_EXPORT extern
#endif
#endif
#endif

#import "ReactCommon/RuntimeExecutor.h"
#import "ReactCommon/RuntimeExecutorSyncUIThreadUtils.h"

FOUNDATION_EXPORT double React_runtimeexecutorVersionNumber;
FOUNDATION_EXPORT const unsigned char React_runtimeexecutorVersionString[];

