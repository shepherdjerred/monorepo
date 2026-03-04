import { z } from "zod";
import { grafanaRequest, grafanaPost } from "./client.ts";
import { AnnotationSchema, CreateAnnotationResponseSchema } from "./schemas.ts";
import type { Annotation, CreateAnnotationResponse } from "./types.ts";

export type ListAnnotationsOptions = {
  dashboardId?: number | undefined;
  from?: number | undefined;
  to?: number | undefined;
  tags?: string[] | undefined;
  limit?: number | undefined;
};

export async function listAnnotations(
  options: ListAnnotationsOptions = {},
): Promise<Annotation[]> {
  const params: Record<string, string> = {};

  if (options.dashboardId != null) {
    params["dashboardId"] = String(options.dashboardId);
  }

  if (options.from != null) {
    params["from"] = String(options.from);
  }

  if (options.to != null) {
    params["to"] = String(options.to);
  }

  if (options.tags != null && options.tags.length > 0) {
    // Grafana API expects tags as repeated query params, but we can pass comma-separated
    params["tags"] = options.tags.join(",");
  }

  if (options.limit != null) {
    params["limit"] = String(options.limit);
  }

  const result = await grafanaRequest(
    "/api/annotations",
    z.array(AnnotationSchema),
    params,
  );

  if (!result.success || result.data == null) {
    throw new Error(result.error ?? "Failed to fetch annotations");
  }

  return result.data;
}

export type CreateAnnotationOptions = {
  text: string;
  dashboardUID?: string | undefined;
  panelId?: number | undefined;
  time?: number | undefined;
  timeEnd?: number | undefined;
  tags?: string[] | undefined;
};

export async function createAnnotation(
  options: CreateAnnotationOptions,
): Promise<CreateAnnotationResponse> {
  const body: Record<string, unknown> = {
    text: options.text,
  };

  if (options.dashboardUID != null) {
    body["dashboardUID"] = options.dashboardUID;
  }

  if (options.panelId != null) {
    body["panelId"] = options.panelId;
  }

  if (options.time != null) {
    body["time"] = options.time;
  }

  if (options.timeEnd != null) {
    body["timeEnd"] = options.timeEnd;
  }

  if (options.tags != null && options.tags.length > 0) {
    body["tags"] = options.tags;
  }

  const result = await grafanaPost(
    "/api/annotations",
    CreateAnnotationResponseSchema,
    body,
  );

  if (!result.success || result.data == null) {
    throw new Error(result.error ?? "Failed to create annotation");
  }

  return result.data;
}
