"""HTTP API bridge for Vibe-Kanban integration.

When Claude Code runs a QA test (spawned by Vibe-Kanban), it can call back
to this API to report results. This module provides:

1. A lightweight HTTP server that receives QA results
2. Helper functions for building Kanban-compatible payloads
3. The prompt builder for QA test sessions spawned from Kanban

Vibe-Kanban integration flow:
    Kanban task (type: "qa-test")
      -> terminalService spawns Claude CLI with MCP server
      -> Claude runs QA test via MCP tools
      -> Claude curls PATCH /api/tasks/:id with verdict
      -> Kanban UI shows PASS/FAIL badge

This module does NOT start a server by itself. It provides the payload
builders that the MCP server or the patrol loop can use to report back
to Vibe-Kanban's existing task API.
"""

from __future__ import annotations

import json
import os
import sys
import time
from typing import Any
from urllib.parse import urljoin


def build_qa_test_prompt(
    task_title: str,
    scenario_name: str = "",
    target_url: str = "",
    task_description: str = "",
    project_path: str = "",
    kanban_api_base: str = "",
    task_id: str = "",
) -> str:
    """Build the full prompt for a QA test session spawned from Vibe-Kanban.

    This is the Python equivalent of Vibe-Kanban's `buildAiResolvePrompt` but
    specialized for QA testing.

    Args:
        task_title: Kanban task title (e.g., "QA: Test login flow")
        scenario_name: qa-agent scenario name (if available)
        target_url: URL of the site under test
        task_description: Detailed task description from Kanban
        project_path: Path to the project being tested
        kanban_api_base: Base URL of the Kanban API (e.g., http://localhost:3001)
        task_id: Kanban task ID for status callbacks

    Returns:
        Complete prompt string for Claude Code session.
    """
    # Load the QA system prompt
    prompt_path = os.path.join(
        os.path.dirname(__file__), "..", "..", "prompts", "qa-mcp-system.md"
    )
    prompt_path = os.path.normpath(prompt_path)
    if os.path.isfile(prompt_path):
        with open(prompt_path, encoding="utf-8") as f:
            system_prompt = f.read()
    else:
        system_prompt = "You are an autonomous QA testing agent. Use the qa-agent MCP tools."

    parts = [system_prompt, ""]

    # Test parameters
    parts.append("## Test Parameters")
    parts.append(f"- Task: {task_title}")
    if scenario_name:
        parts.append(f"- Scenario: {scenario_name}")
    if target_url:
        parts.append(f"- Target URL: {target_url}")
    if task_description:
        parts.append(f"- Description: {task_description}")
    parts.append("- Headless: true")
    parts.append("")

    # Instructions
    if scenario_name:
        parts.append(
            f"Begin by calling `start_qa_session` with scenario_name='{scenario_name}' headless=true."
        )
    elif target_url:
        task_text = task_description or task_title
        parts.append(
            f"Begin by calling `start_qa_session` with url='{target_url}' "
            f"task='{task_text}' headless=true."
        )
    parts.append("Execute the test, then call `generate_report` and `stop_browser`.")
    parts.append("")

    # Kanban callback instructions
    if kanban_api_base and task_id:
        callback_url = f"{kanban_api_base.rstrip('/')}/api/tasks/{task_id}"
        parts.append("## CRITICAL — Report Results When Finished")
        parts.append("")
        parts.append("After generating the report, you MUST update the Kanban task:")
        parts.append("```bash")
        parts.append(
            f'curl -s -X PATCH {callback_url} '
            f'-H "Content-Type: application/json" '
            f'-d \'{{"status": "done", "description": "<verdict: PASS or FAIL, findings count>"}}\''
        )
        parts.append("```")
        parts.append("")
        parts.append("Replace <verdict...> with the actual test results summary.")

    return "\n".join(parts)


def build_mcp_server_config(project_path: str = "") -> dict[str, Any]:
    """Build the MCP server configuration for Claude CLI.

    Returns a dict suitable for the MCP_SERVERS environment variable
    or Claude's --mcp-config flag.
    """
    python_exe = sys.executable
    cwd = project_path or os.getcwd()

    return {
        "qa-agent": {
            "command": python_exe,
            "args": ["-m", "qa_agent.mcp_server"],
            "cwd": cwd,
        }
    }


def build_kanban_result_payload(
    verdict: str,
    unexpected_count: int,
    expected_count: int,
    steps_count: int,
    duration_seconds: float,
    report_path: str = "",
    findings_summary: list[str] | None = None,
) -> dict[str, Any]:
    """Build a payload for updating a Kanban task with QA results.

    This payload is designed to be sent via:
        PATCH /api/tasks/:id
    on the Vibe-Kanban API.
    """
    summary_parts = [
        f"QA Verdict: {verdict}",
        f"Unexpected: {unexpected_count}, Expected: {expected_count}",
        f"Steps: {steps_count}, Duration: {duration_seconds:.1f}s",
    ]

    if findings_summary:
        summary_parts.append("Findings:")
        for f in findings_summary[:5]:
            summary_parts.append(f"  - {f}")

    description = "\n".join(summary_parts)

    return {
        "status": "done",
        "description": description,
        "prompt": "",  # Clear the prompt (task is complete)
        "metadata": {
            "qa_verdict": verdict,
            "qa_unexpected_count": unexpected_count,
            "qa_expected_count": expected_count,
            "qa_steps_count": steps_count,
            "qa_duration_seconds": round(duration_seconds, 1),
            "qa_report_path": report_path,
            "qa_timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        },
    }


# ---------------------------------------------------------------------------
# Vibe-Kanban integration documentation
# ---------------------------------------------------------------------------

KANBAN_INTEGRATION_GUIDE = """
# Vibe-Kanban + QA Agent Integration Guide

## Overview

Vibe-Kanban can spawn Claude Code sessions that run QA tests via the qa-agent
MCP server. Results are reported back to the Kanban board.

## Setup

### 1. Register the MCP server

In the Vibe-Kanban project, add the qa-agent MCP config to the terminal
service's environment:

```typescript
// server/src/services/terminalService.ts
const QA_MCP_CONFIG = {
    "qa-agent": {
        command: "python",
        args: ["-m", "qa_agent.mcp_server"],
        cwd: "/path/to/qa-agent",  // Path to the qa-agent project
    }
};
```

### 2. Add QA task type

In `terminalService.ts`, handle `type: "qa-test"` alongside existing types:

```typescript
case "ai-resolve":
    spawnAiResolve(session, prompt, safeEnv, opts);
    break;
case "qa-test":
    spawnQaTest(session, prompt, safeEnv, opts);
    break;
```

### 3. Build the QA prompt

Create a `buildQaTestPrompt` function in `aiResolvePrompt.ts`:

```typescript
export async function buildQaTestPrompt(
    task: Task,
    projectId: string,
    port: number
): Promise<string> {
    const scenario = task.metadata?.qa_scenario || "";
    const targetUrl = task.metadata?.qa_target_url || "";

    // The Python side provides the prompt builder:
    // from qa_agent.mcp_api import build_qa_test_prompt
    // But since we're in TypeScript, we inline it:

    return `
# QA Testing Agent

You are an autonomous QA testing agent with browser tools via MCP.

## Test Parameters
- Task: ${task.title}
- Scenario: ${scenario}
- Target URL: ${targetUrl}
- Headless: true

Begin by calling start_qa_session with the parameters above.
Execute the test, then call generate_report and stop_browser.

## Report Results
After testing, update this task:
curl -s -X PATCH http://localhost:${port}/api/tasks/${task.id}
    -H "Content-Type: application/json"
    -d '{"status": "done", "description": "<QA verdict and summary>"}'
`;
}
```

### 4. Spawn with MCP

```typescript
function spawnQaTest(
    session: PtySession,
    prompt: string,
    safeEnv: Record<string, string>,
    opts: CreateSessionOptions,
): void {
    const claudeCmd = resolveClaudeCmd(safeEnv);
    const mcpConfig = JSON.stringify({
        "qa-agent": {
            command: "python",
            args: ["-m", "qa_agent.mcp_server"],
            cwd: opts.cwd,
        }
    });

    const pty = runtimeSpawnPty(claudeCmd, [
        "--dangerously-skip-permissions",
        prompt,
    ], {
        cwd: opts.cwd,
        env: { ...safeEnv, MCP_SERVERS: mcpConfig },
        cols: opts.cols ?? 80,
        rows: opts.rows ?? 24,
    });
    // ... attach callbacks same as spawnAiResolve
}
```

### 5. Chain QA after AI Resolve

In `terminalService.ts`, after a successful AI resolve:

```typescript
// After AI resolve succeeds
if (success && task.metadata?.auto_qa) {
    const qaPrompt = await buildQaTestPrompt(task, projectId, port);
    await createSession({
        type: "qa-test",
        projectId,
        taskId: task.id,
        name: `QA: ${task.title}`,
        prompt: qaPrompt,
        autoTest: false,
    });
}
```

### 6. Display results in UI

The QA results are stored in task.metadata (qa_verdict, qa_unexpected_count, etc.)
and in task.description. The Kanban UI can display:
- PASS/FAIL badge based on qa_verdict
- Findings count from qa_unexpected_count
- Link to full report from qa_report_path

## API Endpoints

### Create QA Task
```
POST /api/tasks
{
    "title": "QA: Test login flow",
    "status": "todo",
    "metadata": {
        "qa_scenario": "login-test",
        "qa_target_url": "https://staging.example.com",
        "auto_qa": true
    }
}
```

### QA Result Callback (from Claude)
```
PATCH /api/tasks/:id
{
    "statuis": "done",
    "description": "QA Verdict: PASS\\nUnexpected: 0, Expected: 2\\nSteps: 8, Duration: 45.2s"
}
```
"""
