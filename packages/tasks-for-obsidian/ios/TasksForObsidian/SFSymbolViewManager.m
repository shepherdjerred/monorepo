#import <React/RCTViewManager.h>

@interface RCT_EXTERN_MODULE(SFSymbolViewManager, RCTViewManager)
RCT_EXPORT_VIEW_PROPERTY(symbolName, NSString)
RCT_EXPORT_VIEW_PROPERTY(symbolSize, CGFloat)
RCT_EXPORT_VIEW_PROPERTY(symbolWeight, NSString)
RCT_EXPORT_VIEW_PROPERTY(tintColorHex, NSString)
@end
