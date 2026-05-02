from __future__ import annotations

import argparse
import contextlib
import io
import json
import sys
import time
import traceback
import uuid
from pathlib import Path


def read_payload() -> dict:
    raw = sys.stdin.read().strip()
    if not raw:
        return {}
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("payload must be a JSON object")
    return data


def runtime_status() -> dict:
    crewai_installed = False
    crewai_version = None

    try:
        import crewai  # type: ignore

        crewai_installed = True
        crewai_version = getattr(crewai, "__version__", None)
    except Exception:
        crewai_installed = False

    return {
        "pythonVersion": sys.version.split()[0],
        "crewaiInstalled": crewai_installed,
        "crewaiVersion": crewai_version,
        "cwd": str(Path.cwd()),
    }


def validate_definition(payload: dict) -> dict:
    issues: list[str] = []
    normalized = {
        "name": str(payload.get("name") or "").strip(),
        "agents": payload.get("agents") or [],
        "tasks": payload.get("tasks") or [],
        "flows": payload.get("flows") or [],
    }

    if not normalized["name"]:
        issues.append("Crew-Name fehlt.")
    if not isinstance(normalized["agents"], list) or len(normalized["agents"]) == 0:
        issues.append("Mindestens ein Agent ist erforderlich.")
    if not isinstance(normalized["tasks"], list) or len(normalized["tasks"]) == 0:
        issues.append("Mindestens ein Task ist erforderlich.")

    for index, agent in enumerate(normalized["agents"]):
        if not isinstance(agent, dict):
            issues.append(f"Agent #{index + 1} hat kein gueltiges Objektformat.")
            continue
        if not str(agent.get("id") or "").strip():
            issues.append(f"Agent #{index + 1} benoetigt eine id.")
        if not str(agent.get("name") or "").strip():
            issues.append(f"Agent #{index + 1} benoetigt einen Namen.")

    for index, task in enumerate(normalized["tasks"]):
        if not isinstance(task, dict):
            issues.append(f"Task #{index + 1} hat kein gueltiges Objektformat.")
            continue
        if not str(task.get("id") or "").strip():
            issues.append(f"Task #{index + 1} benoetigt eine id.")
        if not str(task.get("agentId") or task.get("agent_id") or "").strip():
            issues.append(f"Task #{index + 1} benoetigt einen zugewiesenen Agenten.")
        if not str(task.get("description") or "").strip():
            issues.append(f"Task #{index + 1} benoetigt eine Beschreibung.")

    return {
        "valid": len(issues) == 0,
        "issues": issues,
        "normalized": normalized if len(issues) == 0 else None,
    }


def now_ms() -> int:
    return int(time.time() * 1000)


def normalize_text(value: object) -> str:
    return " ".join(str(value or "").split())


def truncate_text(value: object, max_chars: int) -> str:
    normalized = normalize_text(value)
    if len(normalized) <= max_chars:
        return normalized
    return normalized[:max_chars].rstrip() + "..."


def format_value_list(values: object) -> str:
    if not isinstance(values, list):
        return "-"
    normalized = [str(value).strip() for value in values if str(value).strip()]
    return ", ".join(normalized) if normalized else "-"


def get_agent_governance_access(payload: dict, agent_id: str) -> dict:
    governance = payload.get("governance") or {}
    for entry in governance.get("agentAccess") or []:
        if isinstance(entry, dict) and str(entry.get("agentId") or "").strip() == agent_id:
            return entry
    return {}


def build_governance_note(payload: dict, agent_payload: dict) -> str:
    governance = payload.get("governance") or {}
    subject = str(governance.get("subject") or "").strip() or "workspace-user"
    subject_roles = format_value_list(governance.get("subjectRoles") or [])
    pending_approvals = format_value_list(governance.get("pendingApprovalTypes") or [])
    access = get_agent_governance_access(payload, str(agent_payload.get("id") or ""))

    sections: list[str] = [
        f"Execution subject: {subject}",
        f"Active roles: {subject_roles}",
    ]

    if access:
        sections.extend([
            f"Allowed tools: {format_value_list(access.get('allowedTools') or [])}",
            f"Blocked tools: {format_value_list(access.get('blockedTools') or [])}",
            f"Allowed MCP servers: {format_value_list(access.get('allowedMcpServerNames') or [])}",
            f"Blocked MCP servers: {format_value_list(access.get('blockedMcpServerNames') or [])}",
            f"Delegation allowed: {'yes' if bool(access.get('delegationAllowed')) else 'no'}",
        ])

        gateway_hints = access.get("gatewayHints") or []
        if isinstance(gateway_hints, list) and gateway_hints:
            hint_lines = [f"- {truncate_text(hint, 240)}" for hint in gateway_hints[:4]]
            sections.append("Gateway hints:\n" + "\n".join(hint_lines))

    if pending_approvals != "-":
        sections.append(f"Pending approval types: {pending_approvals}")

    return "\n".join(sections)


def build_memory_note(payload: dict) -> str:
    memory_context = payload.get("memoryContext") or {}
    sections: list[str] = []

    summary = str(memory_context.get("summary") or "").strip()
    if summary:
        sections.append(summary)

    query = str(memory_context.get("query") or "").strip()
    if query:
        sections.append(f"Knowledge query: {truncate_text(query, 240)}")

    entries = memory_context.get("entries") or []
    if isinstance(entries, list) and entries:
        entry_lines = []
        for entry in entries[:6]:
            if not isinstance(entry, dict):
                continue
            scope = str(entry.get("scope") or "shared").strip()
            category = str(entry.get("category") or "general").strip()
            key = str(entry.get("key") or "entry").strip()
            confidence = float(entry.get("confidence") or 0.0)
            content = truncate_text(entry.get("content") or "", 260)
            entry_lines.append(f"- [{scope}/{category}:{key}] ({confidence:.2f}) {content}")
        if entry_lines:
            sections.append("Relevant memory entries:\n" + "\n".join(entry_lines))

    user_profile = memory_context.get("userProfile") or []
    if isinstance(user_profile, list) and user_profile:
        profile_lines = []
        for entry in user_profile[:6]:
            if not isinstance(entry, dict):
                continue
            key = str(entry.get("key") or "profile").strip()
            value = truncate_text(entry.get("value") or "", 180)
            confidence = float(entry.get("confidence") or 0.0)
            profile_lines.append(f"- {key} ({confidence:.2f}): {value}")
        if profile_lines:
            sections.append("User profile hints:\n" + "\n".join(profile_lines))

    hints = memory_context.get("hints") or []
    if isinstance(hints, list) and hints:
        hint_lines = [f"- {truncate_text(hint, 180)}" for hint in hints[:4]]
        sections.append("Memory maintenance hints:\n" + "\n".join(hint_lines))

    return "\n\n".join(section for section in sections if section.strip())


def summarize_runtime_context(payload: dict) -> str:
    governance = payload.get("governance") or {}
    memory_context = payload.get("memoryContext") or {}
    return " | ".join([
        f"subject={str(governance.get('subject') or 'workspace-user').strip() or 'workspace-user'}",
        f"roles={format_value_list(governance.get('subjectRoles') or [])}",
        f"pendingApprovals={format_value_list(governance.get('pendingApprovalTypes') or [])}",
        f"memoryEntries={len(memory_context.get('entries') or []) if isinstance(memory_context.get('entries') or [], list) else 0}",
        f"profileHints={len(memory_context.get('userProfile') or []) if isinstance(memory_context.get('userProfile') or [], list) else 0}",
    ])


def normalize_model_name(provider: str, model: str) -> str:
    normalized = str(model or "").strip()
    if not normalized:
        raise ValueError(f"Kein Modell fuer Provider '{provider}' konfiguriert.")
    if "/" in normalized:
        return normalized
    if provider == "openrouter":
        return f"openrouter/{normalized}"
    if provider == "openai-compatible":
        return f"openai/{normalized}"
    return f"ollama/{normalized}"


def build_llm(request: dict, agent: dict):
    from crewai import LLM  # type: ignore

    provider = str(agent.get("providerKind") or "ollama").strip() or "ollama"
    model_override = str(agent.get("modelOverride") or "").strip()
    request_config = request.get("config") or {}
    provider_configs = request.get("providerConfigs") or {}

    if provider == "openai-compatible":
        config = provider_configs.get("openAICompatible") or {}
        model = normalize_model_name(provider, model_override or str(config.get("model") or ""))
        return LLM(
            model=model,
            base_url=str(config.get("baseUrl") or request_config.get("baseUrl") or "https://api.openai.com/v1"),
            api_key=str(config.get("apiKey") or "open-cowork"),
        )

    if provider == "openrouter":
        config = provider_configs.get("openRouter") or {}
        model = normalize_model_name(provider, model_override or str(config.get("model") or ""))
        return LLM(
            model=model,
            base_url=str(config.get("baseUrl") or "https://openrouter.ai/api/v1"),
            api_key=str(config.get("apiKey") or "open-cowork"),
        )

    model = normalize_model_name(provider, model_override or str(request_config.get("model") or ""))
    return LLM(
        model=model,
        base_url=str(request_config.get("baseUrl") or "http://localhost:11434"),
    )


def build_agent(request: dict, agent_payload: dict):
    from crewai import Agent  # type: ignore

    skills_markdown = str(agent_payload.get("skillsMarkdown") or "").strip()
    backstory = str(agent_payload.get("backstory") or "").strip()
    if skills_markdown:
        backstory = f"{backstory}\n\nSkills:\n{skills_markdown}".strip()

    governance_note = build_governance_note(request, agent_payload)
    if governance_note:
        backstory = f"{backstory}\n\nGovernance:\n{governance_note}".strip()

    return Agent(
        role=str(agent_payload.get("role") or agent_payload.get("name") or "Crew Agent"),
        goal=str(agent_payload.get("goal") or "Aufgaben in der Crew erfolgreich ausfuehren."),
        backstory=backstory or "Ein spezialisierter Crew-Agent fuer Open_Cowork.",
        llm=build_llm(request, agent_payload),
        verbose=bool(agent_payload.get("verbose")),
        allow_delegation=bool(agent_payload.get("allowDelegation")),
        max_iter=max(1, int(agent_payload.get("maxIterations") or 20)),
        max_rpm=int(agent_payload.get("maxRpm") or request.get("maxRpm") or 0) or None,
    )


def build_task_description(request: dict, task_payload: dict, agent_payload: dict) -> str:
    description = str(task_payload.get("description") or "").strip()
    execution_guidelines = str(request.get("executionGuidelines") or "").strip()
    knowledge_focus = str(request.get("knowledgeFocus") or "").strip()
    cwd = str(request.get("cwd") or "").strip()
    governance_note = build_governance_note(request, agent_payload)
    memory_note = build_memory_note(request)

    additions = []
    if execution_guidelines:
        additions.append(f"Crew-Richtlinien:\n{execution_guidelines}")
    if knowledge_focus:
        additions.append(f"Knowledge focus:\n{knowledge_focus}")
    if cwd:
        additions.append(f"Arbeitsverzeichnis: {cwd}")
    if governance_note:
        additions.append(f"Governance-Kontext:\n{governance_note}")
    if memory_note:
        additions.append(f"Crew-Memory und Wissen:\n{memory_note}")

    if additions:
        return f"{description}\n\n" + "\n\n".join(additions)
    return description


def dedupe_task_refs(values: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        ordered.append(value)
    return ordered


def extract_task_output(task_obj) -> str | None:
    output = getattr(task_obj, "output", None)
    if output is None:
        return None
    raw = getattr(output, "raw", None)
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    try:
        rendered = str(output).strip()
    except Exception:
        return None
    return rendered or None


def resolve_process(process_name: str):
    from crewai import Process  # type: ignore

    if process_name.lower() == "hierarchical":
        return Process.hierarchical
    return Process.sequential


def execute_definition(payload: dict) -> dict:
    from crewai import Crew, Task  # type: ignore

    crew_id = str(payload.get("id") or "crew-runtime")
    process_name = str(payload.get("process") or "sequential")
    agent_payloads = payload.get("agents") or []
    task_payloads = payload.get("tasks") or []

    agents_by_id = {
        str(agent_payload.get("id") or f"agent-{index}"): build_agent(payload, agent_payload)
        for index, agent_payload in enumerate(agent_payloads)
        if isinstance(agent_payload, dict)
    }

    task_specs = {
        str(task_payload.get("id") or f"task-{index}"): task_payload
        for index, task_payload in enumerate(task_payloads)
        if isinstance(task_payload, dict)
    }
    task_objects: dict[str, Task] = {}

    def resolve_task(task_id: str):
        if task_id in task_objects:
            return task_objects[task_id]

        task_payload = task_specs[task_id]
        agent_id = str(task_payload.get("agentId") or "")
        if agent_id not in agents_by_id:
            raise ValueError(f"Task {task_id} referenziert unbekannten Agenten {agent_id}.")

        agent_payload = next(
            (
                candidate
                for candidate in agent_payloads
                if isinstance(candidate, dict) and str(candidate.get("id") or "").strip() == agent_id
            ),
            {},
        )

        context_refs = dedupe_task_refs([
            str(value)
            for value in [*(task_payload.get("context") or []), *(task_payload.get("dependencies") or [])]
            if str(value).strip() in task_specs
        ])
        context_tasks = [resolve_task(ref) for ref in context_refs]

        task_kwargs = {
            "description": build_task_description(payload, task_payload, agent_payload),
            "expected_output": str(task_payload.get("expectedOutput") or "").strip() or "Erstelle ein vollstaendiges Ergebnis.",
            "agent": agents_by_id[agent_id],
        }
        if context_tasks:
            task_kwargs["context"] = context_tasks
        if bool(task_payload.get("asyncExecution")):
            task_kwargs["async_execution"] = True

        task_obj = Task(**task_kwargs)
        task_objects[task_id] = task_obj
        return task_obj

    ordered_task_bindings: list[tuple[dict, Task]] = []
    for task_payload in task_payloads:
        if not isinstance(task_payload, dict):
            continue
        task_id = str(task_payload.get("id") or "")
        if not task_id:
            continue
        ordered_task_bindings.append((task_payload, resolve_task(task_id)))

    manager_agent = None
    manager_agent_id = str(payload.get("managerAgentId") or "").strip()
    if process_name.lower() == "hierarchical":
        if not manager_agent_id or manager_agent_id not in agents_by_id:
            raise ValueError("Hierarchische Crew benoetigt einen aktiven Manager-Agenten.")
        manager_agent = agents_by_id[manager_agent_id]

    crew_kwargs = {
        "agents": list(agents_by_id.values()),
        "tasks": [task_obj for _, task_obj in ordered_task_bindings],
        "process": resolve_process(process_name),
        "verbose": bool(payload.get("verbose")),
    }
    max_rpm = int(payload.get("maxRpm") or 0)
    if max_rpm > 0:
        crew_kwargs["max_rpm"] = max_rpm
    if manager_agent is not None:
        crew_kwargs["manager_agent"] = manager_agent

    stdout_buffer = io.StringIO()
    stderr_buffer = io.StringIO()
    task_results: list[dict] = []
    logs: list[dict] = []
    status = "completed"
    error_message = None

    logs.append({
        "id": str(uuid.uuid4()),
        "crewId": crew_id,
        "agentId": manager_agent_id or "python-runtime",
        "taskId": ordered_task_bindings[0][0].get("id") if ordered_task_bindings else "runtime",
        "action": "runtime_context",
        "result": summarize_runtime_context(payload)[:4000],
        "timestamp": now_ms(),
    })

    try:
        crew = Crew(**crew_kwargs)
        with contextlib.redirect_stdout(stdout_buffer), contextlib.redirect_stderr(stderr_buffer):
            crew.kickoff()
    except Exception as exc:
        status = "failed"
        error_message = f"{exc.__class__.__name__}: {exc}"
        stderr_buffer.write(traceback.format_exc())

    for task_payload, task_obj in ordered_task_bindings:
        task_id = str(task_payload.get("id") or "runtime-task")
        agent_id = str(task_payload.get("agentId") or "runtime-agent")
        output = extract_task_output(task_obj)
        task_status = "completed" if output else ("failed" if status == "failed" else "completed")
        task_results.append({
            "taskId": task_id,
            "agentId": agent_id,
            "status": task_status,
            "output": output if output is not None else (error_message if task_status == "failed" else None),
        })
        if output:
            logs.append({
                "id": str(uuid.uuid4()),
                "crewId": crew_id,
                "agentId": agent_id,
                "taskId": task_id,
                "action": "task_completed",
                "result": output[:4000],
                "timestamp": now_ms(),
            })

    captured_stdout = stdout_buffer.getvalue().strip()
    captured_stderr = stderr_buffer.getvalue().strip()
    if captured_stdout:
        logs.append({
            "id": str(uuid.uuid4()),
            "crewId": crew_id,
            "agentId": manager_agent_id or "python-runtime",
            "taskId": ordered_task_bindings[-1][0].get("id") if ordered_task_bindings else "runtime",
            "action": "runtime_stdout",
            "result": captured_stdout[:4000],
            "timestamp": now_ms(),
        })
    if captured_stderr:
        logs.append({
            "id": str(uuid.uuid4()),
            "crewId": crew_id,
            "agentId": manager_agent_id or "python-runtime",
            "taskId": ordered_task_bindings[-1][0].get("id") if ordered_task_bindings else "runtime",
            "action": "runtime_stderr",
            "result": captured_stderr[:4000],
            "timestamp": now_ms(),
        })

    if status == "failed" and error_message and not any(entry.get("action") == "runtime_stderr" for entry in logs):
        logs.append({
            "id": str(uuid.uuid4()),
            "crewId": crew_id,
            "agentId": manager_agent_id or "python-runtime",
            "taskId": ordered_task_bindings[-1][0].get("id") if ordered_task_bindings else "runtime",
            "action": "runtime_failed",
            "result": error_message[:4000],
            "timestamp": now_ms(),
        })

    return {
        "crewId": crew_id,
        "status": status,
        "taskResults": task_results,
        "logs": logs,
        "error": error_message,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["status", "validate", "execute"])
    args = parser.parse_args()

    if args.command == "status":
        print(json.dumps(runtime_status()))
        return 0

    if args.command == "validate":
        payload = read_payload()
        print(json.dumps(validate_definition(payload)))
        return 0

    if args.command == "execute":
        payload = read_payload()
        print(json.dumps(execute_definition(payload)))
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())