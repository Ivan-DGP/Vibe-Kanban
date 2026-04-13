import type { FastifyPluginAsync } from "fastify";
import { getDb } from "../db";
import { log } from "../lib/logger";
import type { DatabaseHandle } from "../lib/runtime";
import type {
  NotionDatabase,
  NotionPage,
  NotionPageContent,
  NotionSearchResult,
} from "@vibe-kanban/shared";

// Lightweight types for Notion API responses
export interface NotionRichText {
  plain_text: string;
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    code?: boolean;
    strikethrough?: boolean;
  };
  href?: string;
}

export interface NotionBlockContent {
  rich_text?: NotionRichText[];
  checked?: boolean;
  language?: string;
  icon?: { emoji?: string };
  caption?: NotionRichText[];
  file?: { url: string };
  external?: { url: string };
}

export type NotionBlock = {
  type: string;
} & Record<string, NotionBlockContent | undefined>;

export interface NotionObject {
  id: string;
  object: string;
  url: string;
  last_edited_time: string;
  icon?: { type: string; emoji?: string };
  title?: NotionRichText[] | string;
  properties?: Record<string, NotionProperty>;
}

export interface NotionProperty {
  type: string;
  title?: NotionRichText[];
  rich_text?: NotionRichText[];
  number?: number;
  select?: { name: string };
  multi_select?: { name: string }[];
  status?: { name: string };
  date?: { start: string };
  checkbox?: boolean;
  url?: string;
  email?: string;
  phone_number?: string;
  people?: { name?: string; id: string }[];
}

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

function getNotionToken(db: DatabaseHandle): string | null {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get("notionApiKey") as { value: string } | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value);
    return parsed || null;
  } catch {
    return null;
  }
}

async function notionFetch(
  token: string,
  path: string,
  options: RequestInit = {},
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any>> {
  const res = await fetch(`${NOTION_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...options.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Notion API ${res.status}: ${body}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return res.json() as Promise<Record<string, any>>;
}

export function extractTitle(obj: NotionObject): string {
  if (obj.title) {
    if (Array.isArray(obj.title)) {
      return obj.title.map((t) => t.plain_text || "").join("") || "Untitled";
    }
    if (typeof obj.title === "string") return obj.title;
  }
  if (obj.properties?.title?.title) {
    return obj.properties.title.title
      .map((t) => t.plain_text || "")
      .join("") || "Untitled";
  }
  if (obj.properties?.Name?.title) {
    return obj.properties.Name.title
      .map((t) => t.plain_text || "")
      .join("") || "Untitled";
  }
  // Try all properties for a title type
  if (obj.properties) {
    for (const prop of Object.values(obj.properties)) {
      if (prop.type === "title" && prop.title) {
        return prop.title.map((t) => t.plain_text || "").join("") || "Untitled";
      }
    }
  }
  return "Untitled";
}

export function extractIcon(obj: NotionObject): string | null {
  if (!obj.icon) return null;
  if (obj.icon.type === "emoji") return obj.icon.emoji ?? null;
  return null;
}

export function richTextToMarkdown(richText: NotionRichText[]): string {
  return richText
    .map((rt) => {
      let text = rt.plain_text || "";
      if (rt.annotations?.bold) text = `**${text}**`;
      if (rt.annotations?.italic) text = `*${text}*`;
      if (rt.annotations?.code) text = `\`${text}\``;
      if (rt.annotations?.strikethrough) text = `~~${text}~~`;
      if (rt.href) text = `[${text}](${rt.href})`;
      return text;
    })
    .join("");
}

export function blocksToMarkdown(blocks: NotionBlock[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    const type = block.type;
    switch (type) {
      case "paragraph":
        lines.push(richTextToMarkdown(block.paragraph?.rich_text || []));
        lines.push("");
        break;
      case "heading_1":
        lines.push(`# ${richTextToMarkdown(block.heading_1?.rich_text || [])}`);
        lines.push("");
        break;
      case "heading_2":
        lines.push(`## ${richTextToMarkdown(block.heading_2?.rich_text || [])}`);
        lines.push("");
        break;
      case "heading_3":
        lines.push(`### ${richTextToMarkdown(block.heading_3?.rich_text || [])}`);
        lines.push("");
        break;
      case "bulleted_list_item":
        lines.push(`- ${richTextToMarkdown(block.bulleted_list_item?.rich_text || [])}`);
        break;
      case "numbered_list_item":
        lines.push(`1. ${richTextToMarkdown(block.numbered_list_item?.rich_text || [])}`);
        break;
      case "to_do": {
        const checked = block.to_do?.checked ? "x" : " ";
        lines.push(`- [${checked}] ${richTextToMarkdown(block.to_do?.rich_text || [])}`);
        break;
      }
      case "toggle":
        lines.push(`<details><summary>${richTextToMarkdown(block.toggle?.rich_text || [])}</summary></details>`);
        lines.push("");
        break;
      case "code": {
        const lang = block.code?.language || "";
        lines.push(`\`\`\`${lang}`);
        lines.push(richTextToMarkdown(block.code?.rich_text || []));
        lines.push("```");
        lines.push("");
        break;
      }
      case "quote":
        lines.push(`> ${richTextToMarkdown(block.quote?.rich_text || [])}`);
        lines.push("");
        break;
      case "divider":
        lines.push("---");
        lines.push("");
        break;
      case "callout": {
        const icon = block.callout?.icon?.emoji || "";
        lines.push(`> ${icon} ${richTextToMarkdown(block.callout?.rich_text || [])}`);
        lines.push("");
        break;
      }
      case "image": {
        const url =
          block.image?.file?.url ||
          block.image?.external?.url ||
          "";
        const caption = richTextToMarkdown(block.image?.caption || []);
        lines.push(`![${caption}](${url})`);
        lines.push("");
        break;
      }
      default:
        // Skip unsupported block types
        break;
    }
  }
  return lines.join("\n").trim();
}

const notionRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getDb();

  // Check connection / validate token
  fastify.get("/notion/status", async (_request, _reply) => {
    const token = getNotionToken(db);
    if (!token) {
      return { connected: false, user: null };
    }
    try {
      const me = await notionFetch(token, "/users/me");
      return { connected: true, user: me.name || me.bot?.owner?.user?.name || "Notion Bot" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log("warn", "server", `Notion connection check failed: ${message}`);
      return { connected: false, user: null, error: message };
    }
  });

  // Search databases and pages
  fastify.post("/notion/search", async (request, reply) => {
    const token = getNotionToken(db);
    if (!token) return reply.code(400).send({ error: "Notion API key not configured" });

    const { query, filter } = request.body as {
      query?: string;
      filter?: "database" | "page";
    };

    try {
      const body: Record<string, unknown> = { page_size: 50 };
      if (query) body.query = query;
      if (filter) body.filter = { value: filter, property: "object" };

      const data = await notionFetch(token, "/search", {
        method: "POST",
        body: JSON.stringify(body),
      });

      const results: NotionSearchResult[] = (data.results as NotionObject[]).map((r) => ({
        id: r.id,
        title: extractTitle(r),
        type: r.object === "database" ? "database" : "page",
        url: r.url,
        icon: extractIcon(r),
        lastEditedTime: r.last_edited_time,
      }));

      return { results };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log("error", "server", `Notion search failed: ${message}`);
      return reply.code(502).send({ error: message });
    }
  });

  // List databases
  fastify.get("/notion/databases", async (_request, reply) => {
    const token = getNotionToken(db);
    if (!token) return reply.code(400).send({ error: "Notion API key not configured" });

    try {
      const data = await notionFetch(token, "/search", {
        method: "POST",
        body: JSON.stringify({
          filter: { value: "database", property: "object" },
          page_size: 100,
        }),
      });

      const databases: NotionDatabase[] = (data.results as NotionObject[]).map((r) => ({
        id: r.id,
        title: extractTitle(r),
        url: r.url,
        icon: extractIcon(r),
        lastEditedTime: r.last_edited_time,
      }));

      return { databases };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log("error", "server", `Notion list databases failed: ${message}`);
      return reply.code(502).send({ error: message });
    }
  });

  // Query database pages
  fastify.get("/notion/databases/:databaseId/pages", async (request, reply) => {
    const token = getNotionToken(db);
    if (!token) return reply.code(400).send({ error: "Notion API key not configured" });

    const { databaseId } = request.params as { databaseId: string };

    try {
      const data = await notionFetch(token, `/databases/${databaseId}/query`, {
        method: "POST",
        body: JSON.stringify({ page_size: 100 }),
      });

      const pages: NotionPage[] = (data.results as NotionObject[]).map((r) => ({
        id: r.id,
        title: extractTitle(r),
        url: r.url,
        icon: extractIcon(r),
        lastEditedTime: r.last_edited_time,
        properties: simplifyProperties(r.properties ?? {}),
      }));

      return { pages };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log("error", "server", `Notion query database failed: ${message}`);
      return reply.code(502).send({ error: message });
    }
  });

  // Get page content as markdown
  fastify.get("/notion/pages/:pageId", async (request, reply) => {
    const token = getNotionToken(db);
    if (!token) return reply.code(400).send({ error: "Notion API key not configured" });

    const { pageId } = request.params as { pageId: string };

    try {
      // Fetch page metadata and blocks in parallel
      const [page, blocksData] = await Promise.all([
        notionFetch(token, `/pages/${pageId}`),
        notionFetch(token, `/blocks/${pageId}/children?page_size=100`),
      ]);

      const markdown = blocksToMarkdown((blocksData.results || []) as NotionBlock[]);

      const result: NotionPageContent = {
        id: page.id as string,
        title: extractTitle(page as unknown as NotionObject),
        url: page.url as string,
        markdown,
      };

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log("error", "server", `Notion get page failed: ${message}`);
      return reply.code(502).send({ error: message });
    }
  });
};

export function simplifyProperties(props: Record<string, NotionProperty>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(props)) {
    switch (v.type) {
      case "title":
        result[key] = v.title?.map((t) => t.plain_text).join("") || "";
        break;
      case "rich_text":
        result[key] = v.rich_text?.map((t) => t.plain_text).join("") || "";
        break;
      case "number":
        result[key] = v.number;
        break;
      case "select":
        result[key] = v.select?.name || null;
        break;
      case "multi_select":
        result[key] = v.multi_select?.map((s) => s.name) || [];
        break;
      case "status":
        result[key] = v.status?.name || null;
        break;
      case "date":
        result[key] = v.date?.start || null;
        break;
      case "checkbox":
        result[key] = v.checkbox;
        break;
      case "url":
        result[key] = v.url;
        break;
      case "email":
        result[key] = v.email;
        break;
      case "phone_number":
        result[key] = v.phone_number;
        break;
      case "people":
        result[key] = v.people?.map((p) => p.name || p.id) || [];
        break;
      default:
        result[key] = `[${v.type}]`;
        break;
    }
  }
  return result;
}

export default notionRoutes;
