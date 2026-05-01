import { getDb } from "../db";
import { decrypt } from "./crypto";

export interface MappedGitHubAccount {
  token: string;
  username: string | null;
  email: string | null;
  name: string;
}

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

  return {
    token: decrypt(row.token),
    username: row.username,
    email: row.email,
    name: row.name,
  };
}

/**
 * Returns args to inject before "git <subcommand>" so HTTPS pushes/pulls to
 * github.com authenticate with the mapped account's token. SSH remotes ignore
 * this and continue to use the system SSH agent.
 */
export function gitAuthArgs(token: string): string[] {
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return [
    "-c",
    `http.https://github.com/.extraheader=Authorization: Basic ${basic}`,
  ];
}

/**
 * Returns args for "git commit" so the recorded author/committer matches the
 * mapped account. Falls back to the user's system git config when the account
 * has no fetched identity yet.
 */
export function gitCommitIdentityArgs(account: MappedGitHubAccount): string[] {
  const args: string[] = [];
  const name = account.username ?? account.name;
  if (name) {
    args.push("-c", `user.name=${name}`);
  }
  if (account.email) {
    args.push("-c", `user.email=${account.email}`);
  }
  return args;
}
