// ============================================================
// API Client (Postman/Bruno style)
// ============================================================

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export interface ApiCollection {
  id: string;
  projectId: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateApiCollectionInput {
  name: string;
}

export interface UpdateApiCollectionInput {
  name?: string;
  sortOrder?: number;
}

export interface ApiRequest {
  id: string;
  collectionId: string;
  name: string;
  method: HttpMethod;
  url: string;
  headers: string; // JSON string of key-value pairs
  body: string;
  sortOrder: number;
  lastResponseStatus: number | null;
  lastResponseTime: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateApiRequestInput {
  collectionId: string;
  name: string;
  method?: HttpMethod;
  url?: string;
  headers?: string;
  body?: string;
}

export interface UpdateApiRequestInput {
  name?: string;
  method?: HttpMethod;
  url?: string;
  headers?: string;
  body?: string;
  sortOrder?: number;
  lastResponseStatus?: number | null;
  lastResponseTime?: number | null;
}

export interface ApiRequestExecuteInput {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface ApiRequestExecuteResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  timeMs: number;
}
