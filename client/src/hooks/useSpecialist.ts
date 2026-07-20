import { api } from "@/lib/api";

/**
 * Open a cross-project Specialist chat stream. Returns the raw SSE Response; the
 * component reads frames (sources | delta | error | done). Mirrors `claudeChat`.
 * Pass the active `projectId` to float that project's sources first.
 */
export function specialistChat(message: string, projectId?: string, signal?: AbortSignal) {
  return api.specialist.chat(message, projectId, signal);
}
