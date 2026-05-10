import type { z } from "zod";
import type {
  TargetSchema,
  PanelSchema,
  DashboardSearchResultSchema,
  DashboardDetailSchema,
  DatasourceSchema,
  FieldSchema,
  FrameSchema,
  PromQueryResultSchema,
  AlertRuleSchema,
  AnnotationSchema,
  CreateAnnotationResponseSchema,
  PrometheusLabelResponseSchema,
} from "./schemas.ts";

export type Target = z.infer<typeof TargetSchema>;
export type Panel = z.infer<typeof PanelSchema>;
export type DashboardSearchResult = z.infer<typeof DashboardSearchResultSchema>;
export type DashboardDetail = z.infer<typeof DashboardDetailSchema>;
export type Datasource = z.infer<typeof DatasourceSchema>;
export type Field = z.infer<typeof FieldSchema>;
export type Frame = z.infer<typeof FrameSchema>;
export type PromQueryResult = z.infer<typeof PromQueryResultSchema>;
export type AlertRule = z.infer<typeof AlertRuleSchema>;
export type Annotation = z.infer<typeof AnnotationSchema>;
export type CreateAnnotationResponse = z.infer<
  typeof CreateAnnotationResponseSchema
>;
export type PrometheusLabelResponse = z.infer<
  typeof PrometheusLabelResponseSchema
>;
