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

#import "jsinspector-modern/tracing/ConsoleTimeStamp.h"
#import "jsinspector-modern/tracing/EventLoopReporter.h"
#import "jsinspector-modern/tracing/InstanceTracingProfile.h"
#import "jsinspector-modern/tracing/PerformanceTracer.h"
#import "jsinspector-modern/tracing/ProfileTreeNode.h"
#import "jsinspector-modern/tracing/RuntimeSamplingProfile.h"
#import "jsinspector-modern/tracing/RuntimeSamplingProfileTraceEventSerializer.h"
#import "jsinspector-modern/tracing/TargetTracingAgent.h"
#import "jsinspector-modern/tracing/Timing.h"
#import "jsinspector-modern/tracing/TraceEvent.h"
#import "jsinspector-modern/tracing/TraceEventProfile.h"
#import "jsinspector-modern/tracing/TraceEventSerializer.h"
#import "jsinspector-modern/tracing/TraceRecordingState.h"
#import "jsinspector-modern/tracing/TraceRecordingStateSerializer.h"
#import "jsinspector-modern/tracing/TracingMode.h"
#import "jsinspector-modern/tracing/TracingState.h"

FOUNDATION_EXPORT double jsinspector_modern_tracingVersionNumber;
FOUNDATION_EXPORT const unsigned char jsinspector_modern_tracingVersionString[];

