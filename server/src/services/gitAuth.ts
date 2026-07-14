import { getDb } from "../db";
import { tryDecrypt } from "../lib/crypto";
import type { MappedGitHubAccount } from "../lib/git-auth";

export function getMappedGitHubAccount(
  projectId: string,
  subPath: string = "",
): MappedGitHubAccount | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT a.token, a.username, a.email, a.name
       FROM project_github_mappings m
       JOIN github_accounts a ON m.githubAccountId = a.id
       WHERE m.projectId = ? AND m.subPath = ?`,
    )
    .get(projectId, subPath) as
    | { token: string; username: string | null; email: string | null; name: string }
    | undefined;

  if (!row) return null;

  // Graceful: a malformed/legacy/tampered token must not throw an uncaught 500.
  // Returning null makes git fall back to the user's ambient credentials.
  const token = tryDecrypt(row.token);
  if (token === null) return null;

  return {
    token,
    username: row.username,
    email: row.email,
    name: row.name,
  };
}
