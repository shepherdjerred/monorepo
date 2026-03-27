import { z } from "zod";

export const TargetSchema = z.object({
  refId: z.string(),
  expr: z.string().optional(),
  datasource: z
    .object({
      type: z.string(),
      uid: z.string(),
    })
    .optional(),
});

export const PanelSchema = z.object({
  id: z.number().optional(),
  title: z.string().optional(),
  type: z.string(),
  description: z.string().optional(),
  targets: z.array(TargetSchema).optional(),
});

export const DashboardSearchResultSchema = z.object({
  id: z.number(),
  uid: z.string(),
  title: z.string(),
  uri: z.string(),
  url: z.string(),
  type: z.string(),
  tags: z.array(z.string()),
  folderTitle: z.string().optional(),
  folderUid: z.string().optional(),
});

export const DashboardDetailSchema = z.object({
  dashboard: z.object({
    id: z.number(),
    uid: z.string(),
    title: z.string(),
    description: z.string().optional(),
    tags: z.array(z.string()),
    panels: z.array(PanelSchema),
  }),
  meta: z.object({
    slug: z.string(),
    url: z.string(),
    folderTitle: z.string().optional(),
    folderUid: z.string().optional(),
  }),
});

export const DatasourceSchema = z.object({
  id: z.number(),
  uid: z.string(),
  name: z.string(),
  type: z.string(),
  url: z.string(),
  isDefault: z.boolean(),
  jsonData: z.record(z.string(), z.unknown()).optional(),
});

export const FieldSchema = z.object({
  name: z.string(),
  type: z.string().optional(),
  labels: z.record(z.string(), z.string()).optional(),
});

export const FrameSchema = z.object({
  schema: z.object({
    name: z.string().optional(),
    fields: z.array(FieldSchema),
  }),
  data: z.object({
    values: z.array(z.array(z.unknown())),
  }),
});

export const PromQueryResultSchema = z.object({
  results: z.record(
    z.string(),
    z.object({
      frames: z.array(FrameSchema),
    }),
  ),
});

export const AlertRuleSchema = z.object({
  uid: z.string(),
  title: z.string(),
  condition: z.string(),
  data: z.array(z.unknown()),
  ruleGroup: z.string(),
  folderUID: z.string(),
  labels: z.record(z.string(), z.string()).optional(),
  annotations: z.record(z.string(), z.string()).optional(),
  for: z.string().optional(),
});

export const AnnotationSchema = z.object({
  id: z.number(),
  dashboardId: z.number(),
  panelId: z.number(),
  time: z.number(),
  timeEnd: z.number(),
  text: z.string(),
  tags: z.array(z.string()),
});

export const CreateAnnotationResponseSchema = z.object({
  id: z.number(),
  message: z.string(),
});

export const PrometheusLabelResponseSchema = z.object({
  status: z.string(),
  data: z.array(z.string()),
});
