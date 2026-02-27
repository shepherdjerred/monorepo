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

#import "PrivateSentrySDKOnly.h"
#import "PrivatesHeader.h"
#import "Sentry.h"
#import "SentryAppStartMeasurement.h"
#import "SentryAttachment.h"
#import "SentryBaggage.h"
#import "SentryBreadcrumb.h"
#import "SentryCrashExceptionApplication.h"
#import "SentryDebugMeta.h"
#import "SentryDefines.h"
#import "SentryError.h"
#import "SentryEvent.h"
#import "SentryException.h"
#import "SentryFrame.h"
#import "SentryGeo.h"
#import "SentryHttpStatusCodeRange.h"
#import "SentryId.h"
#import "SentryLevel.h"
#import "SentryMeasurementUnit.h"
#import "SentryMechanism.h"
#import "SentryMechanismContext.h"
#import "SentryMessage.h"
#import "SentryNSError.h"
#import "SentryProfilingConditionals.h"
#import "SentryReplayApi.h"
#import "SentryRequest.h"
#import "SentrySampleDecision.h"
#import "SentrySamplingContext.h"
#import "SentryScope.h"
#import "SentrySerializable.h"
#import "SentrySessionReplayHybridSDK.h"
#import "SentrySpanContext.h"
#import "SentrySpanId.h"
#import "SentrySpanProtocol.h"
#import "SentrySpanStatus.h"
#import "SentryStacktrace.h"
#import "SentryThread.h"
#import "SentryTraceContext.h"
#import "SentryTraceHeader.h"
#import "SentryTransactionContext.h"
#import "SentryUser.h"
#import "SentryWithoutUIKit.h"

FOUNDATION_EXPORT double SentryVersionNumber;
FOUNDATION_EXPORT const unsigned char SentryVersionString[];

