import io
import json
import os
import unittest
from datetime import date
from unittest.mock import patch
from urllib.error import HTTPError

import pandas as pd

from services import todoist_service
from todoist_view import _migrate_local_tasks
from todoist_metrics import completed_tasks_frame


class _Response:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8") if self.payload is not None else b""


class TodoistServiceTests(unittest.TestCase):
    def setUp(self):
        self.token_patch = patch.dict(os.environ, {"TODOIST_API_TOKEN": "test-token"})
        self.token_patch.start()

    def tearDown(self):
        self.token_patch.stop()

    @patch("services.todoist_service.urlopen")
    def test_load_tasks_follows_pagination(self, mocked_open):
        mocked_open.side_effect = [
            _Response({"results": [{"id": "1"}], "next_cursor": "next"}),
            _Response({"results": [{"id": "2"}], "next_cursor": None}),
        ]

        self.assertEqual([task["id"] for task in todoist_service.load_tasks()], ["1", "2"])
        self.assertIn("cursor=next", mocked_open.call_args_list[1].args[0].full_url)

    @patch("services.todoist_service.urlopen")
    def test_create_task_sends_expected_payload(self, mocked_open):
        mocked_open.return_value = _Response({"id": "42"})

        result = todoist_service.create_task("Une tâche", project_id="project", priority=3)

        request = mocked_open.call_args.args[0]
        self.assertEqual(result["id"], "42")
        self.assertEqual(request.method, "POST")
        self.assertEqual(
            json.loads(request.data),
            {"content": "Une tâche", "priority": 3, "project_id": "project"},
        )
        self.assertEqual(request.headers["Authorization"], "Bearer test-token")

    @patch("services.todoist_service.urlopen")
    def test_invalid_token_has_safe_message(self, mocked_open):
        mocked_open.side_effect = HTTPError(
            "https://api.todoist.com/api/v1/tasks",
            401,
            "Unauthorized",
            {},
            io.BytesIO(),
        )

        with self.assertRaisesRegex(todoist_service.TodoistError, "invalide ou révoqué"):
            todoist_service.load_tasks()

    @patch("todoist_view.close_task")
    @patch("todoist_view.create_task")
    @patch("todoist_view.create_project")
    def test_migration_preserves_projects_completion_and_due_dates(
        self, mocked_create_project, mocked_create_task, mocked_close
    ):
        items = pd.DataFrame(
            [
                {
                    "id": 10,
                    "title": "Active",
                    "due_date": "2026-08-12",
                    "priority": "Haute",
                    "completed": 0,
                    "category_name": "Travail",
                },
                {
                    "id": 11,
                    "title": "Terminée",
                    "due_date": None,
                    "priority": "Normale",
                    "completed": 1,
                    "category_name": "Travail",
                },
            ]
        )
        mocked_create_project.return_value = {"id": "project-1", "name": "Travail"}
        mocked_create_task.side_effect = [{"id": "task-1"}, {"id": "task-2"}]
        marked = []

        migrated, failures = _migrate_local_tasks(items, [], lambda *args: marked.append(args))

        self.assertEqual((migrated, failures), (2, []))
        mocked_create_project.assert_called_once_with("Travail")
        self.assertEqual(mocked_create_task.call_args_list[0].args, ("Active", "2026-08-12", "project-1", 3))
        mocked_close.assert_called_once_with("task-2")
        self.assertEqual(marked, [(10, "task-1"), (11, "task-2")])

    @patch("services.todoist_service._request")
    def test_completed_tasks_are_paginated(self, mocked_request):
        mocked_request.side_effect = [
            {"items": [{"id": "done-1"}], "next_cursor": "next"},
            {"items": [{"id": "done-2"}], "next_cursor": None},
        ]

        tasks = todoist_service.load_completed_tasks(date(2026, 8, 1), date(2026, 8, 11))

        self.assertEqual([task["id"] for task in tasks], ["done-1", "done-2"])
        self.assertEqual(mocked_request.call_args_list[1].kwargs["params"]["cursor"], "next")

    def test_completed_timestamp_uses_paris_calendar_date(self):
        frame = completed_tasks_frame(
            [{"completed_at": "2026-08-09T22:30:00Z", "project_id": "p", "priority": 2}]
        )

        self.assertEqual(frame.iloc[0]["entry_date"], date(2026, 8, 10))


if __name__ == "__main__":
    unittest.main()
