import { z } from "zod";
import type { HomeAssistantConfig } from "#shared/config.ts";
import { normalizeBaseUrl } from "#shared/config.ts";
import { HaApiError, HaAuthError, HaNotFoundError } from "./errors.ts";
import {
  EntityState,
  FireEventResponse,
  HaConfig,
  HistoryResponse,
  ServiceCallResult,
} from "./schemas.ts";

export type CallServiceOptions = {
  returnResponse?: boolean;
};

export type HistoryOptions = {
  start?: Date;
  end?: Date;
  minimalResponse?: boolean;
  noAttributes?: boolean;
  significantChangesOnly?: boolean;
};

const RawJson = z.unknown();

export class HomeAssistantRestClient {
  private readonly baseUrl: string;
  private readonly token: string;

  public constructor(config: HomeAssistantConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.token = config.token;
  }

  public async getConfig(): Promise<HaConfig> {
    const body = await this.request("GET", "/api/config");
    return HaConfig.parse(body);
  }

  public async getStates(): Promise<EntityState[]> {
    const body = await this.request("GET", "/api/states");
    return z.array(EntityState).parse(body);
  }

  public async getState(entityId: string): Promise<EntityState> {
    const body = await this.request(
      "GET",
      `/api/states/${encodeURIComponent(entityId)}`,
      { notFoundResource: entityId },
    );
    return EntityState.parse(body);
  }

  public async callService(
    domain: string,
    service: string,
    data?: Record<string, unknown>,
    options?: CallServiceOptions,
  ): Promise<ServiceCallResult> {
    const path = this.buildServicePath(domain, service, options);
    const body = await this.request("POST", path, {
      body: data ?? {},
    });
    return ServiceCallResult.parse(body);
  }

  public async fireEvent(
    eventType: string,
    data?: Record<string, unknown>,
  ): Promise<FireEventResponse> {
    const body = await this.request(
      "POST",
      `/api/events/${encodeURIComponent(eventType)}`,
      { body: data ?? {} },
    );
    return FireEventResponse.parse(body);
  }

  public async renderTemplate(template: string): Promise<string> {
    const response = await this.rawRequest("POST", "/api/template", {
      template,
    });
    return response.text();
  }

  public async getHistory(
    entityIds: string[],
    options: HistoryOptions = {},
  ): Promise<HistoryResponse> {
    const start = options.start ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
    const params = new URLSearchParams();
    params.set("filter_entity_id", entityIds.join(","));
    if (options.end !== undefined) {
      params.set("end_time", options.end.toISOString());
    }
    if (options.minimalResponse === true) {
      params.set("minimal_response", "true");
    }
    if (options.noAttributes === true) {
      params.set("no_attributes", "true");
    }
    if (options.significantChangesOnly === true) {
      params.set("significant_changes_only", "true");
    }
    const path = `/api/history/period/${start.toISOString()}?${params.toString()}`;
    const body = await this.request("GET", path);
    return HistoryResponse.parse(body);
  }

  private buildServicePath(
    domain: string,
    service: string,
    options: CallServiceOptions | undefined,
  ): string {
    const base = `/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`;
    if (options?.returnResponse === true) {
      return `${base}?return_response`;
    }
    return base;
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    options: { body?: unknown; notFoundResource?: string } = {},
  ): Promise<unknown> {
    const response = await this.rawRequest(method, path, options.body);
    if (response.status === 401 || response.status === 403) {
      const text = await response.text();
      throw new HaAuthError(response.status, text);
    }
    if (response.status === 404) {
      const text = await response.text();
      throw new HaNotFoundError(options.notFoundResource ?? path, text);
    }
    if (!response.ok) {
      const text = await response.text();
      throw new HaApiError(
        `Home Assistant ${method} ${path} failed: ${String(response.status)} ${response.statusText}`,
        response.status,
        text,
      );
    }
    const text = await response.text();
    if (text === "") {
      return undefined;
    }
    return RawJson.parse(JSON.parse(text));
  }

  private rawRequest(
    method: "GET" | "POST",
    path: string,
    body: unknown,
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
    };
    const init: RequestInit = { method, headers };
    if (method === "POST") {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body ?? {});
    }
    return fetch(url, init);
  }
}
