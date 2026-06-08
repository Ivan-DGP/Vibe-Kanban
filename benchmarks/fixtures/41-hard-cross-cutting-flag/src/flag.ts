export function isQuietInfo(): boolean {
  return process.env.VK_QUIET_INFO === "1";
}
