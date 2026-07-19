import { api } from "@/lib/api";

/**
 * Open a cross-project Specialist chat stream. Returns the raw SSE Response; the
 * component reads frames (sources | delta | error | done). Mirrors `claudeChat`.
 */
export function specialistChat(message: string, signal?: AbortSignal) {
  return api.specialist.chat(message, signal);
}
