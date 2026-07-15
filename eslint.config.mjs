import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";

// Files that already contain `any` at the time the rule was tightened.
// New files get the strict rule; this list ratchets — when a file here
// has its anys cleaned up, drop it from the list.
const ANY_DEBT = [
  "client/src/components/api-client/RequestBuilder.tsx",
  "client/src/components/dashboard/AddProjectDialog.tsx",
  "client/src/components/kanban/KanbanBoard.tsx",
  "client/src/components/layout/TerminalPanel.tsx",
  "client/src/components/tasks/TaskCard.tsx",
  "client/src/components/tasks/TaskEditorDialog.tsx",
  "client/src/components/tasks/TaskViewerDialog.tsx",
  "client/src/components/terminal/IntegratedTerminal.tsx",
  "client/src/components/terminal/TerminalView.tsx",
  "client/src/components/ui/badge.tsx",
  "client/src/components/ui/button.tsx",
  "client/src/components/ui/tabs.tsx",
  "client/src/components/ui/toggle.tsx",
  "client/src/hooks/useConfirm.tsx",
  "client/src/hooks/useProjectStats.ts",
  "client/src/routes/ApiClient.tsx",
  "client/src/routes/Logs.tsx",
  "client/src/routes/Settings.tsx",
  "server/src/app.test.ts",
  "server/src/db/fresh-migrations.test.ts",
  "server/src/db/index.ts",
  "server/src/lib/logger.test.ts",
  "server/src/lib/runtime.test.ts",
  "server/src/lib/runtime.ts",
  "server/src/mcp/auth.test.ts",
  "server/src/mcp/auth.ts",
  "server/src/mcp/tools.test.ts",
  "server/src/mcp/tools.ts",
  "server/src/routes/api-client.integration.test.ts",
  "server/src/routes/api-client.ts",
  "server/src/routes/claude.integration.test.ts",
  "server/src/routes/claude.isolated.ts",
  "server/src/routes/claude.ts",
  "server/src/routes/files.test.ts",
  "server/src/routes/files.ts",
  "server/src/routes/git.test.ts",
  "server/src/routes/git.ts",
  "server/src/routes/github-accounts.integration.test.ts",
  "server/src/routes/github-accounts.ts",
  "server/src/routes/logs.ts",
  "server/src/routes/mcp.integration.test.ts",
  "server/src/routes/mcp.ts",
  "server/src/routes/milestones.ts",
  "server/src/routes/notion.integration.test.ts",
  "server/src/routes/projects.integration.test.ts",
  "server/src/routes/projects.ts",
  "server/src/routes/reports.test.ts",
  "server/src/routes/reports.ts",
  "server/src/routes/settings-todos-logs.integration.test.ts",
  "server/src/routes/settings.ts",
  "server/src/routes/sync.test.ts",
  "server/src/routes/sync.ts",
  "server/src/routes/tasks.integration.test.ts",
  "server/src/routes/tasks.ts",
  "server/src/routes/terminal.test.ts",
  "server/src/routes/terminal.ts",
  "server/src/routes/terminalWs.test.ts",
  "server/src/routes/terminalWs.ts",
  "server/src/routes/todos.ts",
  "server/src/services/aiResolvePrompt.builders.test.ts",
  "server/src/services/aiResolvePrompt.builders.ts",
  "server/src/services/aiResolvePrompt.helpers.ts",
  "server/src/services/aiResolvePrompt.test.ts",
  "server/src/services/mcpConfigWriter.test.ts",
  "server/src/services/snapshot.test.ts",
  "server/src/services/snapshot.ts",
  "server/src/services/taskSpawner.ts",
  "server/src/services/terminalRegistry.ts",
  "server/src/services/terminalRegistry.test.ts",
  "server/src/services/terminalService.coverage.isolated.ts",
  "server/src/services/terminalService.isolated.ts",
  "server/src/services/terminalService.test.ts",
  "server/src/services/terminalService.ts",
];

// Components must reach the backend through hooks/ (TanStack Query) so cache
// invalidation stays centralized — they may not import the raw api client.
// This list ratchets: files here predate the rule and still import @/lib/api;
// migrate each to a hook and drop it from the list.
const API_IMPORT_DEBT = [
  "client/src/components/dashboard/AddProjectDialog.tsx",
  "client/src/components/editor/CodeEditorPanel.tsx",
  "client/src/components/settings/DataExportSection.tsx",
];

export default tseslint.config(
  { ignores: ["**/dist/", "**/node_modules/", "data/", "**/*.js"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ANY_DEBT,
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: ["client/src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    files: ["server/src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["client/src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/api",
              message:
                "Don't import the raw api client in components. Use a hook in @/hooks (TanStack Query) so cache invalidation stays centralized.",
            },
          ],
          patterns: [
            {
              group: ["**/lib/api", "**/lib/api/*"],
              message:
                "Don't import the raw api client in components. Use a hook in @/hooks (TanStack Query) so cache invalidation stays centralized.",
            },
          ],
        },
      ],
    },
  },
  {
    files: API_IMPORT_DEBT,
    rules: {
      "no-restricted-imports": "off",
    },
  },
  prettier,
);
