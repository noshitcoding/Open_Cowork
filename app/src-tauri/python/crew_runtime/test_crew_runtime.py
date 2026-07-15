from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path


RUNTIME_DIR = Path(__file__).resolve().parent
if str(RUNTIME_DIR) not in sys.path:
    sys.path.insert(0, str(RUNTIME_DIR))

import crew_tools
import main as crew_runtime


class CrewRuntimeStatusTests(unittest.TestCase):
    def test_status_requires_the_pinned_runtime_and_office_dependencies(self) -> None:
        status = crew_runtime.runtime_status()

        self.assertTrue(status["runtimeCompatible"])
        self.assertTrue(status["toolDependenciesInstalled"])
        self.assertEqual(status["crewaiVersion"], crew_runtime.EXPECTED_CREWAI_VERSION)
        self.assertEqual(status["runtimeSchemaVersion"], crew_runtime.RUNTIME_SCHEMA_VERSION)


class CrewRuntimeToolTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.request = {
            "cwd": str(self.root),
            "config": {
                "baseUrl": "http://127.0.0.1:11434",
                "model": "qwen3:4b",
                "timeoutMs": 30_000,
            },
            "governance": {
                "agentAccess": [
                    {
                        "agentId": "agent-test",
                        "allowedTools": [
                            "read_file",
                            "edit_file",
                            "create_directory",
                            "glob",
                            "grep",
                            "web_fetch",
                            "web_search",
                            "bash",
                            "office_workflow",
                        ],
                        "blockedTools": ["copy_path"],
                    }
                ]
            },
        }
        self.agent = {
            "id": "agent-test",
            "name": "Test Agent",
            "role": "executor",
            "goal": "Verify the runtime",
            "backstory": "A deterministic test agent.",
            "tools": [
                "read_file",
                "edit_file",
                "create_directory",
                "copy_path",
                "glob",
                "grep",
                "web_fetch",
                "web_search",
                "bash",
                "office_workflow",
            ],
            "maxIterations": 2,
        }

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _tools(self) -> dict[str, object]:
        return {
            tool.name: tool
            for tool in crew_tools.build_runtime_tools(self.request, self.agent)
        }

    def test_governance_binds_allowed_tools_and_omits_blocked_tools(self) -> None:
        tools = self._tools()

        self.assertIn("web_search", tools)
        self.assertIn("office_workflow", tools)
        self.assertNotIn("copy_path", tools)

        built_agent = crew_runtime.build_agent(self.request, self.agent)
        self.assertEqual(set(tools), {tool.name for tool in built_agent.tools})

    def test_file_tools_edit_read_glob_and_grep_inside_workspace(self) -> None:
        tools = self._tools()

        write_result = tools["edit_file"]._run("src/example.py", content="print('alpha')\n")
        read_result = tools["read_file"]._run("src/example.py")
        grep_result = tools["grep"]._run("alpha", path="src", file_pattern="*.py")
        glob_result = tools["glob"]._run("**/*.py")
        escape_result = tools["edit_file"]._run("../escape.txt", content="blocked")

        self.assertIn("Updated", write_result)
        self.assertIn("print('alpha')", read_result)
        self.assertIn("src/example.py:1", grep_result)
        self.assertIn("src/example.py", glob_result)
        self.assertIn("outside the authorized working directory", escape_result)
        self.assertFalse((self.root.parent / "escape.txt").exists())

    def test_web_fetch_blocks_private_network_destinations(self) -> None:
        result = self._tools()["web_fetch"]._run("http://127.0.0.1:11434/api/tags")

        self.assertIn("Private, loopback", result)

    def test_office_workflow_creates_a_real_powerpoint(self) -> None:
        sections = json.dumps([
            {"title": "Research", "bullets": ["Search works", "Sources included"]},
            {"title": "Coding", "body": "Files can be edited and verified."},
        ])

        result = self._tools()["office_workflow"]._run(
            "artifacts/runtime-proof.pptx",
            "Crew runtime proof",
            sections,
        )

        from pptx import Presentation

        output = self.root / "artifacts" / "runtime-proof.pptx"
        presentation = Presentation(output)
        self.assertIn("Created", result)
        self.assertTrue(output.is_file())
        self.assertGreater(output.stat().st_size, 10_000)
        self.assertEqual(len(presentation.slides), 3)


class CrewRuntimeTaskTests(unittest.TestCase):
    def test_tasks_are_stably_topologically_ordered(self) -> None:
        tasks = [
            {"id": "review", "context": ["implement"], "dependencies": []},
            {"id": "plan", "context": [], "dependencies": []},
            {"id": "implement", "context": [], "dependencies": ["plan"]},
        ]

        ordered = crew_runtime.order_task_payloads(tasks)

        self.assertEqual([task["id"] for task in ordered], ["plan", "implement", "review"])

    def test_parallel_batches_always_end_synchronously(self) -> None:
        tasks = [{"id": f"task-{index}"} for index in range(5)]

        process, normalized = crew_runtime.normalize_task_concurrency(tasks, "parallel", 2)

        self.assertEqual(process, "parallel")
        self.assertEqual(
            [task["asyncExecution"] for task in normalized],
            [True, False, True, False, False],
        )

    def test_single_task_parallel_run_is_synchronous(self) -> None:
        _, normalized = crew_runtime.normalize_task_concurrency([{"id": "only"}], "parallel", 4)

        self.assertFalse(normalized[0]["asyncExecution"])


@unittest.skipUnless(
    os.environ.get("OPEN_COWORK_RUN_CREW_INTEGRATION") == "1",
    "Set OPEN_COWORK_RUN_CREW_INTEGRATION=1 to run the live Ollama/tool smoke test.",
)
class CrewRuntimeIntegrationTests(unittest.TestCase):
    def test_live_research_coding_and_powerpoint_run(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            selected_task = os.environ.get("OPEN_COWORK_CREW_TEST_TASK", "all").strip().lower()
            agents = [
                {
                    "id": "researcher",
                    "name": "Researcher",
                    "role": "researcher",
                    "goal": "Find verifiable sources.",
                    "backstory": "A careful web researcher.",
                    "providerKind": "ollama",
                    "tools": ["web_search", "web_fetch"],
                    "allowDelegation": False,
                    "maxIterations": 3,
                },
                {
                    "id": "coder",
                    "name": "Coder",
                    "role": "executor",
                    "goal": "Create and verify working code.",
                    "backstory": "A precise software engineer.",
                    "providerKind": "ollama",
                    "tools": ["read_file", "edit_file", "bash"],
                    "allowDelegation": False,
                    "maxIterations": 4,
                },
                {
                    "id": "presenter",
                    "name": "Presenter",
                    "role": "writer",
                    "goal": "Create real presentation artifacts.",
                    "backstory": "A concise presentation author.",
                    "providerKind": "ollama",
                    "tools": ["office_workflow"],
                    "allowDelegation": False,
                    "maxIterations": 4,
                },
            ]
            tasks = [
                {
                    "id": "research",
                    "description": "/no_think\nUse web_search for 'CrewAI official documentation'. Return at least two source URLs from the tool result.",
                    "expectedOutput": "At least two real source URLs.",
                    "agentId": "researcher",
                    "context": [],
                    "dependencies": [],
                    "asyncExecution": False,
                },
                {
                    "id": "code",
                    "description": "/no_think\nUse edit_file to create artifacts/proof.py containing exactly print('crew tools work'), then use bash to execute it.",
                    "expectedOutput": "The created file path and successful command output.",
                    "agentId": "coder",
                    "context": [],
                    "dependencies": [],
                    "asyncExecution": False,
                },
                {
                    "id": "presentation",
                    "description": "/no_think\nUse office_workflow to create artifacts/proof.pptx with title 'Crew Tools Work' and two content slides.",
                    "expectedOutput": "The exact path of a valid PPTX artifact.",
                    "agentId": "presenter",
                    "context": [],
                    "dependencies": [],
                    "asyncExecution": False,
                },
            ]
            if selected_task != "all":
                tasks = [task for task in tasks if task["id"] == selected_task]
                if not tasks:
                    self.fail(f"Unknown OPEN_COWORK_CREW_TEST_TASK: {selected_task}")
            used_agent_ids = {task["agentId"] for task in tasks}
            agents = [agent for agent in agents if agent["id"] in used_agent_ids]
            allowed_by_agent = {agent["id"]: agent["tools"] for agent in agents}
            payload = {
                "id": "integration-smoke",
                "name": "Integration Smoke Crew",
                "description": "Verify research, coding, and PowerPoint tools.",
                "executionGuidelines": "/no_think\nCall the required tool; do not answer from memory. Finish immediately after the required tool result is verified.",
                "knowledgeFocus": "Runtime verification",
                "outputMode": "standard",
                "retryCount": 0,
                "process": "sequential",
                "maxParallelTasks": 1,
                "maxRpm": 0,
                "verbose": False,
                "cwd": str(root),
                "config": {
                    "baseUrl": "http://127.0.0.1:11434",
                    "model": os.environ.get("OPEN_COWORK_CREW_TEST_MODEL", "qwen3:4b"),
                    "timeoutMs": 60_000,
                },
                "providerConfigs": {},
                "agents": agents,
                "tasks": tasks,
                "governance": {
                    "subject": "integration-test",
                    "subjectRoles": ["owner"],
                    "pendingApprovalTypes": [],
                    "agentAccess": [
                        {
                            "agentId": agent_id,
                            "allowedTools": tools,
                            "blockedTools": [],
                            "allowedMcpServerNames": [],
                            "blockedMcpServerNames": [],
                            "delegationAllowed": False,
                            "gatewayHints": [],
                        }
                        for agent_id, tools in allowed_by_agent.items()
                    ],
                },
                "memoryContext": {},
            }

            response = crew_runtime.execute_definition(payload)

            self.assertEqual(response["status"], "completed", response.get("error"))
            if selected_task in {"all", "code"}:
                self.assertTrue((root / "artifacts" / "proof.py").is_file())
                self.assertEqual(
                    (root / "artifacts" / "proof.py").read_text(encoding="utf-8").strip(),
                    "print('crew tools work')",
                )
            if selected_task in {"all", "presentation"}:
                presentation = root / "artifacts" / "proof.pptx"
                self.assertTrue(presentation.is_file())
                self.assertGreater(presentation.stat().st_size, 10_000)
            if selected_task in {"all", "research"}:
                research_output = next(item["output"] for item in response["taskResults"] if item["taskId"] == "research")
                self.assertGreaterEqual(str(research_output).count("https://"), 2)


if __name__ == "__main__":
    unittest.main()
