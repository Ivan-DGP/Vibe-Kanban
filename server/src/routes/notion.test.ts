import { describe, test, expect } from "bun:test";
import {
  extractTitle,
  extractIcon,
  richTextToMarkdown,
  blocksToMarkdown,
  simplifyProperties,
  type NotionObject,
  type NotionRichText,
  type NotionBlock,
  type NotionProperty,
} from "./notion";

// Helper to create a minimal NotionObject
function makeObj(overrides: Partial<NotionObject> = {}): NotionObject {
  return {
    id: "obj-1",
    object: "page",
    url: "https://notion.so/page",
    last_edited_time: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// Helper to create a NotionRichText element
function makeRichText(
  plain_text: string,
  opts: {
    bold?: boolean;
    italic?: boolean;
    code?: boolean;
    strikethrough?: boolean;
    href?: string;
  } = {},
): NotionRichText {
  const rt: NotionRichText = { plain_text };
  const { bold, italic, code, strikethrough, href } = opts;
  if (bold || italic || code || strikethrough) {
    rt.annotations = {};
    if (bold) rt.annotations.bold = true;
    if (italic) rt.annotations.italic = true;
    if (code) rt.annotations.code = true;
    if (strikethrough) rt.annotations.strikethrough = true;
  }
  if (href) rt.href = href;
  return rt;
}

// Helper to create a NotionBlock
function makeBlock(type: string, content: Record<string, unknown> = {}): NotionBlock {
  return { type, [type]: content } as NotionBlock;
}

// ─── extractTitle ───────────────────────────────────────────────────────────

describe("extractTitle", () => {
  test("returns title from rich text array on title field", () => {
    const obj = makeObj({
      title: [{ plain_text: "Hello " }, { plain_text: "World" }],
    });
    expect(extractTitle(obj)).toBe("Hello World");
  });

  test("returns title from a single rich text element", () => {
    const obj = makeObj({
      title: [{ plain_text: "My Page" }],
    });
    expect(extractTitle(obj)).toBe("My Page");
  });

  test("returns title when title is a string", () => {
    const obj = makeObj({ title: "String Title" });
    expect(extractTitle(obj)).toBe("String Title");
  });

  test("returns title from properties.title.title", () => {
    const obj = makeObj({
      properties: {
        title: {
          type: "title",
          title: [{ plain_text: "From Props Title" }],
        },
      },
    });
    expect(extractTitle(obj)).toBe("From Props Title");
  });

  test("returns title from properties.Name.title", () => {
    const obj = makeObj({
      properties: {
        Name: {
          type: "title",
          title: [{ plain_text: "Name Prop" }],
        },
      },
    });
    expect(extractTitle(obj)).toBe("Name Prop");
  });

  test("returns title from any property with type=title", () => {
    const obj = makeObj({
      properties: {
        CustomField: {
          type: "title",
          title: [{ plain_text: "Custom Title" }],
        },
      },
    });
    expect(extractTitle(obj)).toBe("Custom Title");
  });

  test("returns 'Untitled' when title array is empty strings", () => {
    const obj = makeObj({
      title: [{ plain_text: "" }],
    });
    expect(extractTitle(obj)).toBe("Untitled");
  });

  test("returns 'Untitled' when no title is available", () => {
    const obj = makeObj();
    expect(extractTitle(obj)).toBe("Untitled");
  });

  test("returns 'Untitled' when properties exist but none have title type", () => {
    const obj = makeObj({
      properties: {
        Status: { type: "select", select: { name: "Done" } },
      },
    });
    expect(extractTitle(obj)).toBe("Untitled");
  });

  test("prefers obj.title over properties", () => {
    const obj = makeObj({
      title: [{ plain_text: "Direct Title" }],
      properties: {
        Name: {
          type: "title",
          title: [{ plain_text: "Properties Title" }],
        },
      },
    });
    expect(extractTitle(obj)).toBe("Direct Title");
  });
});

// ─── extractIcon ────────────────────────────────────────────────────────────

describe("extractIcon", () => {
  test("returns emoji when icon type is emoji", () => {
    const obj = makeObj({ icon: { type: "emoji", emoji: "🚀" } });
    expect(extractIcon(obj)).toBe("🚀");
  });

  test("returns null when icon type is not emoji", () => {
    const obj = makeObj({ icon: { type: "external" } });
    expect(extractIcon(obj)).toBeNull();
  });

  test("returns null when no icon", () => {
    const obj = makeObj();
    expect(extractIcon(obj)).toBeNull();
  });

  test("returns null when icon is emoji type but emoji is undefined", () => {
    const obj = makeObj({ icon: { type: "emoji" } });
    expect(extractIcon(obj)).toBeNull();
  });
});

// ─── richTextToMarkdown ─────────────────────────────────────────────────────

describe("richTextToMarkdown", () => {
  test("renders plain text", () => {
    expect(richTextToMarkdown([makeRichText("hello")])).toBe("hello");
  });

  test("renders bold text", () => {
    expect(richTextToMarkdown([makeRichText("bold", { bold: true })])).toBe("**bold**");
  });

  test("renders italic text", () => {
    expect(richTextToMarkdown([makeRichText("italic", { italic: true })])).toBe("*italic*");
  });

  test("renders code text", () => {
    expect(richTextToMarkdown([makeRichText("code", { code: true })])).toBe("`code`");
  });

  test("renders strikethrough text", () => {
    expect(richTextToMarkdown([makeRichText("deleted", { strikethrough: true })])).toBe(
      "~~deleted~~",
    );
  });

  test("renders linked text", () => {
    expect(richTextToMarkdown([makeRichText("click", { href: "https://example.com" })])).toBe(
      "[click](https://example.com)",
    );
  });

  test("renders bold + italic combined", () => {
    expect(richTextToMarkdown([makeRichText("strong em", { bold: true, italic: true })])).toBe(
      "***strong em***",
    );
  });

  test("renders bold + code combined", () => {
    expect(richTextToMarkdown([makeRichText("x", { bold: true, code: true })])).toBe("`**x**`");
  });

  test("renders bold link", () => {
    expect(richTextToMarkdown([makeRichText("link", { bold: true, href: "https://a.com" })])).toBe(
      "[**link**](https://a.com)",
    );
  });

  test("concatenates multiple rich text segments", () => {
    expect(
      richTextToMarkdown([
        makeRichText("Hello "),
        makeRichText("world", { bold: true }),
        makeRichText("!"),
      ]),
    ).toBe("Hello **world**!");
  });

  test("handles empty array", () => {
    expect(richTextToMarkdown([])).toBe("");
  });

  test("handles empty plain_text", () => {
    expect(richTextToMarkdown([makeRichText("")])).toBe("");
  });
});

// ─── blocksToMarkdown ───────────────────────────────────────────────────────

describe("blocksToMarkdown", () => {
  test("renders a paragraph", () => {
    const blocks = [makeBlock("paragraph", { rich_text: [makeRichText("Hello")] })];
    expect(blocksToMarkdown(blocks)).toBe("Hello");
  });

  test("renders heading 1", () => {
    const blocks = [makeBlock("heading_1", { rich_text: [makeRichText("Title")] })];
    expect(blocksToMarkdown(blocks)).toBe("# Title");
  });

  test("renders heading 2", () => {
    const blocks = [makeBlock("heading_2", { rich_text: [makeRichText("Subtitle")] })];
    expect(blocksToMarkdown(blocks)).toBe("## Subtitle");
  });

  test("renders heading 3", () => {
    const blocks = [makeBlock("heading_3", { rich_text: [makeRichText("Section")] })];
    expect(blocksToMarkdown(blocks)).toBe("### Section");
  });

  test("renders bulleted list item", () => {
    const blocks = [makeBlock("bulleted_list_item", { rich_text: [makeRichText("item")] })];
    expect(blocksToMarkdown(blocks)).toBe("- item");
  });

  test("renders numbered list item", () => {
    const blocks = [makeBlock("numbered_list_item", { rich_text: [makeRichText("first")] })];
    expect(blocksToMarkdown(blocks)).toBe("1. first");
  });

  test("renders unchecked to_do", () => {
    const blocks = [makeBlock("to_do", { rich_text: [makeRichText("task")], checked: false })];
    expect(blocksToMarkdown(blocks)).toBe("- [ ] task");
  });

  test("renders checked to_do", () => {
    const blocks = [makeBlock("to_do", { rich_text: [makeRichText("done")], checked: true })];
    expect(blocksToMarkdown(blocks)).toBe("- [x] done");
  });

  test("renders code block with language", () => {
    const blocks = [
      makeBlock("code", { rich_text: [makeRichText("const x = 1;")], language: "typescript" }),
    ];
    expect(blocksToMarkdown(blocks)).toBe("```typescript\nconst x = 1;\n```");
  });

  test("renders code block without language", () => {
    const blocks = [makeBlock("code", { rich_text: [makeRichText("echo hi")] })];
    expect(blocksToMarkdown(blocks)).toBe("```\necho hi\n```");
  });

  test("renders quote", () => {
    const blocks = [makeBlock("quote", { rich_text: [makeRichText("wise words")] })];
    expect(blocksToMarkdown(blocks)).toBe("> wise words");
  });

  test("renders divider", () => {
    const blocks = [makeBlock("divider")];
    expect(blocksToMarkdown(blocks)).toBe("---");
  });

  test("renders callout with emoji", () => {
    const blocks = [
      makeBlock("callout", {
        rich_text: [makeRichText("Important note")],
        icon: { emoji: "💡" },
      }),
    ];
    expect(blocksToMarkdown(blocks)).toBe("> 💡 Important note");
  });

  test("renders callout without emoji", () => {
    const blocks = [
      makeBlock("callout", {
        rich_text: [makeRichText("Note")],
      }),
    ];
    expect(blocksToMarkdown(blocks)).toBe(">  Note");
  });

  test("renders image with external url", () => {
    const blocks = [
      makeBlock("image", {
        external: { url: "https://img.com/pic.png" },
        caption: [makeRichText("A picture")],
      }),
    ];
    expect(blocksToMarkdown(blocks)).toBe("![A picture](https://img.com/pic.png)");
  });

  test("renders image with file url", () => {
    const blocks = [
      makeBlock("image", {
        file: { url: "https://s3.aws/file.jpg" },
        caption: [],
      }),
    ];
    expect(blocksToMarkdown(blocks)).toBe("![](https://s3.aws/file.jpg)");
  });

  test("skips unknown block types", () => {
    const blocks = [
      makeBlock("paragraph", { rich_text: [makeRichText("before")] }),
      makeBlock("unsupported_type", { rich_text: [makeRichText("skip me")] }),
      makeBlock("paragraph", { rich_text: [makeRichText("after")] }),
    ];
    expect(blocksToMarkdown(blocks)).toBe("before\n\nafter");
  });

  test("handles empty blocks array", () => {
    expect(blocksToMarkdown([])).toBe("");
  });

  test("renders multiple blocks together", () => {
    const blocks = [
      makeBlock("heading_1", { rich_text: [makeRichText("Title")] }),
      makeBlock("paragraph", { rich_text: [makeRichText("Some text.")] }),
      makeBlock("bulleted_list_item", { rich_text: [makeRichText("Item A")] }),
      makeBlock("bulleted_list_item", { rich_text: [makeRichText("Item B")] }),
    ];
    expect(blocksToMarkdown(blocks)).toBe("# Title\n\nSome text.\n\n- Item A\n- Item B");
  });

  test("renders toggle block", () => {
    const blocks = [makeBlock("toggle", { rich_text: [makeRichText("Details")] })];
    expect(blocksToMarkdown(blocks)).toBe("<details><summary>Details</summary></details>");
  });
});

// ─── simplifyProperties ─────────────────────────────────────────────────────

describe("simplifyProperties", () => {
  test("simplifies title property", () => {
    const props: Record<string, NotionProperty> = {
      Name: { type: "title", title: [{ plain_text: "My Task" }] },
    };
    expect(simplifyProperties(props)).toEqual({ Name: "My Task" });
  });

  test("simplifies title with multiple segments", () => {
    const props: Record<string, NotionProperty> = {
      Name: { type: "title", title: [{ plain_text: "Hello " }, { plain_text: "World" }] },
    };
    expect(simplifyProperties(props)).toEqual({ Name: "Hello World" });
  });

  test("simplifies empty title to empty string", () => {
    const props: Record<string, NotionProperty> = {
      Name: { type: "title", title: [] },
    };
    expect(simplifyProperties(props)).toEqual({ Name: "" });
  });

  test("simplifies rich_text property", () => {
    const props: Record<string, NotionProperty> = {
      Description: { type: "rich_text", rich_text: [{ plain_text: "Some description" }] },
    };
    expect(simplifyProperties(props)).toEqual({ Description: "Some description" });
  });

  test("simplifies number property", () => {
    const props: Record<string, NotionProperty> = {
      Priority: { type: "number", number: 42 },
    };
    expect(simplifyProperties(props)).toEqual({ Priority: 42 });
  });

  test("simplifies number property with zero", () => {
    const props: Record<string, NotionProperty> = {
      Count: { type: "number", number: 0 },
    };
    expect(simplifyProperties(props)).toEqual({ Count: 0 });
  });

  test("simplifies select property", () => {
    const props: Record<string, NotionProperty> = {
      Status: { type: "select", select: { name: "In Progress" } },
    };
    expect(simplifyProperties(props)).toEqual({ Status: "In Progress" });
  });

  test("simplifies select property with no selection", () => {
    const props: Record<string, NotionProperty> = {
      Status: { type: "select" },
    };
    expect(simplifyProperties(props)).toEqual({ Status: null });
  });

  test("simplifies multi_select property", () => {
    const props: Record<string, NotionProperty> = {
      Tags: { type: "multi_select", multi_select: [{ name: "bug" }, { name: "urgent" }] },
    };
    expect(simplifyProperties(props)).toEqual({ Tags: ["bug", "urgent"] });
  });

  test("simplifies empty multi_select", () => {
    const props: Record<string, NotionProperty> = {
      Tags: { type: "multi_select", multi_select: [] },
    };
    expect(simplifyProperties(props)).toEqual({ Tags: [] });
  });

  test("simplifies status property", () => {
    const props: Record<string, NotionProperty> = {
      Stage: { type: "status", status: { name: "Done" } },
    };
    expect(simplifyProperties(props)).toEqual({ Stage: "Done" });
  });

  test("simplifies status property with no value", () => {
    const props: Record<string, NotionProperty> = {
      Stage: { type: "status" },
    };
    expect(simplifyProperties(props)).toEqual({ Stage: null });
  });

  test("simplifies date property", () => {
    const props: Record<string, NotionProperty> = {
      Due: { type: "date", date: { start: "2025-06-15" } },
    };
    expect(simplifyProperties(props)).toEqual({ Due: "2025-06-15" });
  });

  test("simplifies date property with no value", () => {
    const props: Record<string, NotionProperty> = {
      Due: { type: "date" },
    };
    expect(simplifyProperties(props)).toEqual({ Due: null });
  });

  test("simplifies checkbox property true", () => {
    const props: Record<string, NotionProperty> = {
      Done: { type: "checkbox", checkbox: true },
    };
    expect(simplifyProperties(props)).toEqual({ Done: true });
  });

  test("simplifies checkbox property false", () => {
    const props: Record<string, NotionProperty> = {
      Done: { type: "checkbox", checkbox: false },
    };
    expect(simplifyProperties(props)).toEqual({ Done: false });
  });

  test("simplifies url property", () => {
    const props: Record<string, NotionProperty> = {
      Link: { type: "url", url: "https://example.com" },
    };
    expect(simplifyProperties(props)).toEqual({ Link: "https://example.com" });
  });

  test("simplifies email property", () => {
    const props: Record<string, NotionProperty> = {
      Email: { type: "email", email: "user@example.com" },
    };
    expect(simplifyProperties(props)).toEqual({ Email: "user@example.com" });
  });

  test("simplifies phone_number property", () => {
    const props: Record<string, NotionProperty> = {
      Phone: { type: "phone_number", phone_number: "+1234567890" },
    };
    expect(simplifyProperties(props)).toEqual({ Phone: "+1234567890" });
  });

  test("simplifies people property", () => {
    const props: Record<string, NotionProperty> = {
      Assignee: {
        type: "people",
        people: [
          { name: "Alice", id: "u1" },
          { name: "Bob", id: "u2" },
        ],
      },
    };
    expect(simplifyProperties(props)).toEqual({ Assignee: ["Alice", "Bob"] });
  });

  test("simplifies people property falling back to id", () => {
    const props: Record<string, NotionProperty> = {
      Assignee: {
        type: "people",
        people: [{ id: "u1" }],
      },
    };
    expect(simplifyProperties(props)).toEqual({ Assignee: ["u1"] });
  });

  test("simplifies unknown property type", () => {
    const props: Record<string, NotionProperty> = {
      Formula: { type: "formula" },
    };
    expect(simplifyProperties(props)).toEqual({ Formula: "[formula]" });
  });

  test("simplifies multiple properties at once", () => {
    const props: Record<string, NotionProperty> = {
      Name: { type: "title", title: [{ plain_text: "Task" }] },
      Status: { type: "select", select: { name: "Active" } },
      Done: { type: "checkbox", checkbox: false },
      Priority: { type: "number", number: 3 },
    };
    expect(simplifyProperties(props)).toEqual({
      Name: "Task",
      Status: "Active",
      Done: false,
      Priority: 3,
    });
  });

  test("handles empty properties object", () => {
    expect(simplifyProperties({})).toEqual({});
  });
});
