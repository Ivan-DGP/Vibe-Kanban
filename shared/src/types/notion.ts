// ============================================================
// Notion
// ============================================================

export interface NotionDatabase {
  id: string;
  title: string;
  url: string;
  icon: string | null;
  lastEditedTime: string;
}

export interface NotionPage {
  id: string;
  title: string;
  url: string;
  icon: string | null;
  lastEditedTime: string;
  properties: Record<string, unknown>;
}

export interface NotionPageContent {
  id: string;
  title: string;
  url: string;
  markdown: string;
}

export interface NotionSearchResult {
  id: string;
  title: string;
  type: "page" | "database";
  url: string;
  icon: string | null;
  lastEditedTime: string;
}
