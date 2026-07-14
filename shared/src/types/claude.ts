// ============================================================
// Claude AI
// ============================================================

export interface ClaudeStatus {
  cliAvailable: boolean;
  apiKeyConfigured: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface InterviewQa {
  question: string;
  answer: string;
}
