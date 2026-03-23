import type { FastifyPluginAsync } from "fastify";
import { getDb } from "../db";
import { log } from "../lib/logger";
import type {
  NotionDatabase,
  NotionPage,
  NotionPageContent,
  NotionSearchResult,
} from "@vibe-kanban/shared";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

function getNotionToken(db: any): string | null {
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
): Promise<any> {
  const res = await fetch(`${NOTION_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Notion API ${res.status}: ${body}`);
  }
  return res.json();
}

function extractTitle(obj: any): string {
  if (obj.title) {
    if (Array.isArray(obj.title)) {
      return obj.title.map((t: any) => t.plain_text || "").join("") || "Untitled";
    }
    if (typeof obj.title === "string") return obj.title;
  }
  if (obj.properties?.title?.title) {
    return obj.properties.title.title
      .map((t: any) => t.plain_text || "")
      .join("") || "Untitled";
  }
  if (obj.properties?.Name?.title) {
    return obj.properties.Name.title
      .map((t: any) => t.plain_text || "")
      .join("") || "Untitled";
  }
  // Try all properties for a title type
  if (obj.properties) {
    for (const prop of Object.values(obj.properties) as any[]) {
      if (prop.type === "title" && prop.title) {
        return prop.title.map((t: any) => t.plain_text || "").join("") || "Untitled";
      }
    }
  }
  return "Untitled";
}

function extractIcon(obj: any): string | null {
  if (!obj.icon) return null;
  if (obj.icon.type === "emoji") return obj.icon.emoji;
  return null;
}

function richTextToMarkdown(richText: any[]): string {
  return richText
    .map((rt: any) => {
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

function blocksToMarkdown(blocks: any[]): string {
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
      case "to_do":
        const checked = block.to_do?.checked ? "x" : " ";
        lines.push(`- [${checked}] ${richTextToMarkdown(block.to_do?.rich_text || [])}`);
        break;
      case "toggle":
        lines.push(`<details><summary>${richTextToMarkdown(block.toggle?.rich_text || [])}</summary></details>`);
        lines.push("");
        break;
      case "code":
        const lang = block.code?.language || "";
        lines.push(`\`\`\`${lang}`);
        lines.push(richTextToMarkdown(block.code?.rich_text || []));
        lines.push("```");
        lines.push("");
        break;
      case "quote":
        lines.push(`> ${richTextToMarkdown(block.quote?.rich_text || [])}`);
        lines.push("");
        break;
      case "divider":
        lines.push("---");
        lines.push("");
        break;
      case "callout":
        const icon = block.callout?.icon?.emoji || "";
        lines.push(`> ${icon} ${richTextToMarkdown(block.callout?.rich_text || [])}`);
        lines.push("");
        break;
      case "image":
        const url =
          block.image?.file?.url ||
          block.image?.external?.url ||
          "";
        const caption = richTextToMarkdown(block.image?.caption || []);
        lines.push(`![${caption}](${url})`);
        lines.push("");
        break;
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
  fastify.get("/notion/status", async (_request, reply) => {
    const token = getNotionToken(db);
    if (!token) {
      return { connected: false, user: null };
    }
    try {
      const me = await notionFetch(token, "/users/me");
      return { connected: true, user: me.name || me.bot?.owner?.user?.name || "Notion Bot" };
    } catch (err: any) {
      log("warn", "server", `Notion connection check failed: ${err.message}`);
      return { connected: false, user: null, error: err.message };
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
      const body: any = {};
      if (query) body.query = query;
      if (filter) body.filter = { value: filter, property: "object" };
      body.page_size = 50;

      const data = await notionFetch(token, "/search", {
        method: "POST",
        body: JSON.stringify(body),
      });

      const results: NotionSearchResult[] = data.results.map((r: any) => ({
        id: r.id,
        title: extractTitle(r),
        type: r.object === "database" ? "database" : "page",
        url: r.url,
        icon: extractIcon(r),
        lastEditedTime: r.last_edited_time,
      }));

      return { results };
    } catch (err: any) {
      log("error", "server", `Notion search failed: ${err.message}`);
      return reply.code(502).send({ error: err.message });
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

      const databases: NotionDatabase[] = data.results.map((r: any) => ({
        id: r.id,
        title: extractTitle(r),
        url: r.url,
        icon: extractIcon(r),
        lastEditedTime: r.last_edited_time,
      }));

      return { databases };
    } catch (err: any) {
      log("error", "server", `Notion list databases failed: ${err.message}`);
      return reply.code(502).send({ error: err.message });
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

      const pages: NotionPage[] = data.results.map((r: any) => ({
        id: r.id,
        title: extractTitle(r),
        url: r.url,
        icon: extractIcon(r),
        lastEditedTime: r.last_edited_time,
        properties: simplifyProperties(r.properties),
      }));

      return { pages };
    } catch (err: any) {
      log("error", "server", `Notion query database failed: ${err.message}`);
      return reply.code(502).send({ error: err.message });
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

      const markdown = blocksToMarkdown(blocksData.results || []);

      const result: NotionPageContent = {
        id: page.id,
        title: extractTitle(page),
        url: page.url,
        markdown,
      };

      return result;
    } catch (err: any) {
      log("error", "server", `Notion get page failed: ${err.message}`);
      return reply.code(502).send({ error: err.message });
    }
  });
};

function simplifyProperties(props: Record<string, any>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(props)) {
    const v = val as any;
    switch (v.type) {
      case "title":
        result[key] = v.title?.map((t: any) => t.plain_text).join("") || "";
        break;
      case "rich_text":
        result[key] = v.rich_text?.map((t: any) => t.plain_text).join("") || "";
        break;
      case "number":
        result[key] = v.number;
        break;
      case "select":
        result[key] = v.select?.name || null;
        break;
      case "multi_select":
        result[key] = v.multi_select?.map((s: any) => s.name) || [];
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
        result[key] = v.people?.map((p: any) => p.name || p.id) || [];
        break;
      default:
        result[key] = `[${v.type}]`;
        break;
    }
  }
  return result;
}

export default notionRoutes;
