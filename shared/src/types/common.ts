// ============================================================
// Common (cross-cutting)
// ============================================================

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}
