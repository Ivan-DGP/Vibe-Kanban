export function validateLogin(username: string, password: string): { ok: boolean; reason?: string } {
  if (!username) return { ok: false, reason: "missing username" };
  if (password.length < 8) return { ok: false, reason: "password too short" };
  return { ok: true };
}
