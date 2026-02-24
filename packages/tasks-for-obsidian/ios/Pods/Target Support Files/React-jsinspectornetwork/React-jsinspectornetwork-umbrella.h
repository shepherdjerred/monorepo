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

#import "jsinspector-modern/network/BoundedRequestBuffer.h"
#import "jsinspector-modern/network/CdpNetwork.h"
#import "jsinspector-modern/network/HttpUtils.h"
#import "jsinspector-modern/network/NetworkHandler.h"

FOUNDATION_EXPORT double jsinspector_modern_networkVersionNumber;
FOUNDATION_EXPORT const unsigned char jsinspector_modern_networkVersionString[];

