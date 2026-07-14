export interface MappedGitHubAccount {
  token: string;
  username: string | null;
  email: string | null;
  name: string;
}

// The DB-backed lookup lives in the service layer (services/gitAuth) so this
// "lib" module stays free of an upward dependency on db. Re-exported here to
// preserve the existing "../lib/git-auth" import surface.
export { getMappedGitHubAccount } from "../services/gitAuth";

/**
 * Returns args to inject before "git <subcommand>" so HTTPS pushes/pulls to
 * github.com authenticate with the mapped account's token. SSH remotes ignore
 * this and continue to use the system SSH agent.
 */
export function gitAuthArgs(token: string): string[] {
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return ["-c", `http.https://github.com/.extraheader=Authorization: Basic ${basic}`];
}

/**
 * Same effect as gitAuthArgs but injected via GIT_CONFIG_* environment variables
 * (git >= 2.31) instead of `-c` on the command line. This keeps the token out of
 * the process table (`ps`/`/proc/<pid>/cmdline`) and out of any error echo of argv.
 * Pass the returned object as the child's env.
 */
export function gitAuthEnv(token: string): Record<string, string> {
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
  };
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
