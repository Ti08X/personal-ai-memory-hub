import argparse
import importlib.util
import io
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error
import urllib.parse
import urllib.request
import uuid
import hashlib
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("hub_skill", ROOT / "integrations/skills/personal-ai-memory-hub/scripts/hub_client.py")
HUB = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HUB)
KEY = "pmh_" + "a" * 64  # Synthetic fixture only.


def record(n=1, text="合成项目规划资料", version=1):
    return {"id": "rec_test" + str(n), "version": version, "record_type": "message", "source_platform": "synthetic", "sensitivity": "sensitive", "payload": {"title": "", "text": text}, "citation": {"record_id": "rec_test" + str(n), "version": version}}


class QueueTransport:
    def __init__(self, values):
        self.values, self.requests = list(values), []

    def __call__(self, request):
        self.requests.append(request)
        status, value = self.values.pop(0)
        return status, json.dumps(value).encode() if not isinstance(value, bytes) else value


class SkillClientTests(unittest.TestCase):
    def test_archive_contains_exact_current_skill_files_and_no_private_sources(self):
        names = ["SKILL.md", "agents/openai.yaml", "references/api.md", "references/setup.md", "scripts/hub_client.py"]
        source = ROOT / "integrations/skills/personal-ai-memory-hub"
        target = ROOT / "public/personal-ai-memory-hub-skill.zip"
        with zipfile.ZipFile(target) as archive:
            self.assertEqual(set(archive.namelist()), {"personal-ai-memory-hub/" + n for n in names})
            for name in names:
                raw = archive.read("personal-ai-memory-hub/" + name)
                self.assertEqual(hashlib.sha256(raw).digest(), hashlib.sha256((source / name).read_bytes()).digest())
                self.assertNotIn(KEY.encode(), raw)
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        self.assertTrue(target.with_suffix(".sha256").read_text().startswith(digest))

    def invoke(self, argv, queue, payload=None, key=KEY):
        output = io.StringIO()
        with patch.dict(os.environ, {"PMH_API_KEY": key, "PMH_BASE_URL": "https://hub.example/v1"}):
            code = HUB.main(argv, transport=queue, stdin=io.BytesIO(json.dumps(payload).encode()) if payload is not None else None, stdout=output)
        return code, json.loads(output.getvalue()), output.getvalue()

    def test_missing_and_placeholder_credentials_never_send_requests(self):
        for key in ("", "***", "YOUR_API_KEY", "Bearer " + KEY):
            q = QueueTransport([])
            code, value, _ = self.invoke(["check"], q, key=key)
            self.assertNotEqual(code, 0)
            self.assertFalse(value["ok"])
            self.assertEqual(q.requests, [])

    def test_authentication_error_is_failure_not_empty_search(self):
        q = QueueTransport([(401, {"error": "authentication_required", "details": {"leak": KEY}})])
        code, result, text = self.invoke(["search", "--query", "项目规划"], q)
        self.assertNotEqual(code, 0)
        self.assertEqual(result["error"]["code"], "authentication_required")
        self.assertNotIn("data", result)
        self.assertNotIn(KEY, text)

    def test_empty_candidate_page_is_followed_until_next_cursor_ends(self):
        q = QueueTransport([(200, {"records": [], "next_cursor": 100, "search_mode": "Exact substring index"}), (200, {"records": [record()], "next_cursor": None, "search_mode": "Exact substring index"})])
        code, result, _ = self.invoke(["search", "--query", "项目规划", "--mode", "keyword"], q)
        self.assertEqual(code, 0)
        self.assertEqual(result["data"]["count"], 1)
        self.assertTrue(result["data"]["complete"])
        self.assertIn("cursor=100", q.requests[1].full_url)

    def test_page_cap_reports_incomplete_not_absence(self):
        q = QueueTransport([(200, {"records": [], "next_cursor": 100, "search_mode": "Exact substring index"})])
        _, result, _ = self.invoke(["search", "--query", "项目规划", "--mode", "keyword", "--max-pages", "1"], q)
        self.assertFalse(result["data"]["complete"])
        self.assertEqual(result["data"]["next_cursor"], 100)

    def test_hybrid_degradation_restarts_explicit_keyword_pagination(self):
        q = QueueTransport([(200, {"records": [record()], "next_cursor": None, "search_mode": "keyword", "degraded": True, "reason": "model_daily_limit"}), (200, {"records": [record()], "next_cursor": 10, "search_mode": "Exact substring index"}), (200, {"records": [record(2)], "next_cursor": None, "search_mode": "Exact substring index"})])
        code, value, _ = self.invoke(["search", "--query", "项目规划"], q)
        self.assertEqual(code, 0)
        self.assertEqual(value["data"]["count"], 2)
        self.assertEqual(value["data"]["reasons"], ["model_daily_limit"])
        self.assertIn("mode=keyword", q.requests[1].full_url)
        self.assertIn("rerank=false", q.requests[1].full_url)

    def test_semantic_candidates_do_not_claim_full_history(self):
        q = QueueTransport([(200, {"records": [record()], "next_cursor": None, "search_mode": "semantic"})])
        _, value, _ = self.invoke(["search", "--query", "项目规划", "--mode", "semantic"], q)
        self.assertFalse(value["data"]["complete"])
        self.assertEqual(value["data"]["scope"], "ranked_candidates")

    def test_failure_after_a_page_is_explicitly_partial(self):
        q = QueueTransport([(200, {"records": [record()], "next_cursor": 20, "search_mode": "Exact substring index"}), (403, {"error": "record_policy_denied"})])
        code, value, _ = self.invoke(["search", "--query", "项目规划", "--mode", "keyword"], q)
        self.assertNotEqual(code, 0)
        self.assertEqual(value["error"]["details"]["pages_completed"], 1)
        self.assertFalse(value["error"]["details"]["complete"])

    def test_saved_but_unreadable_record_is_not_claimed_verified(self):
        q = QueueTransport([(201, {"id": "rec_test1", "version": 1}), (403, {"error": "insufficient_scope"})])
        code, value, _ = self.invoke(["save"], q, {"authorized": True, "text": "合成资料"})
        self.assertNotEqual(code, 0)
        self.assertTrue(value["persisted"])
        self.assertEqual(value["error"]["code"], "write_verification_failed")
        self.assertEqual(value["error"]["details"]["cause"], "insufficient_scope")

    def test_lost_write_response_reports_unknown_commit_state(self):
        q = QueueTransport([(200, b"malformed write response")])
        code, value, _ = self.invoke(["save"], q, {"authorized": True, "text": "合成资料"})
        self.assertNotEqual(code, 0)
        self.assertEqual(value["persisted"], "unknown")

    def test_empty_visible_import_message_verifies_server_placeholder(self):
        q = QueueTransport([(201, {"messages": [{"id": "rec_test1", "version": 1}], "conflicts": 0}), (200, record(text="[empty message]"))])
        code, value, _ = self.invoke(["import"], q, {"authorized": True, "messages": [{"role": "user", "content": ""}]})
        self.assertEqual(code, 0)
        self.assertEqual(value["data"]["verified_count"], 1)

    def test_import_201_with_conflicts_is_partial_not_total_success(self):
        q = QueueTransport([(201, {"messages": [{"id": "rec_test1", "version": 1}, {"status": "conflict", "id": "rec_test2"}], "conflicts": 1}), (200, record(text="合成资料"))])
        code, value, _ = self.invoke(["import"], q, {"authorized": True, "messages": [{"role": "user", "content": "合成资料"}, {"role": "assistant", "content": "合成候选"}]})
        self.assertNotEqual(code, 0)
        self.assertEqual(value["error"]["code"], "memory_conflict")
        self.assertEqual(value["persisted"], "partial")
        self.assertEqual(value["error"]["details"]["verified_count"], 1)

    def test_forbidden_uploads_and_no_consent_never_post(self):
        for operation, payload in [("save", {"authorized": False}), ("save", {"authorized": True, "text": KEY}), ("import", {"authorized": True, "messages": [{"role": "system"}]}), ("import", {"authorized": True, "messages": [{"role": "user", "content": "a", "raw": {"private": "x"}}]})]:
            q = QueueTransport([])
            code, value, _ = self.invoke([operation], q, payload)
            self.assertNotEqual(code, 0)
            self.assertEqual(q.requests, [])

    def test_redirect_bad_json_and_cursor_loop_are_failures(self):
        for response in [(302, {"error": "redirected"}), (200, b"not json"), (200, {"records": [], "next_cursor": 0, "search_mode": "Exact substring index"})]:
            q = QueueTransport([response])
            code, value, _ = self.invoke(["search", "--query", "项目规划", "--mode", "keyword"], q)
            self.assertNotEqual(code, 0)
            self.assertFalse(value["ok"])
            self.assertEqual(len(q.requests), 1)
        req = urllib.request.Request("https://hub.example")
        self.assertIsNone(HUB.NoRedirect().redirect_request(req, None, 302, "", {}, "https://other.example"))

    def test_response_size_url_and_output_secret_guards(self):
        for base in ("http://hub.example", "https://u:p@hub.example", "https://hub.example?key=x", "https://hub.example/mcp"):
            with self.assertRaises(HUB.HubError):
                HUB.HubClient(base, KEY)
        q = QueueTransport([(200, b"x" * (HUB.MAX_RESPONSE + 1))])
        _, value, _ = self.invoke(["check"], q)
        self.assertEqual(value["error"]["code"], "response_too_large")
        q = QueueTransport([(200, record(text="secret " + KEY))])
        code, value, text = self.invoke(["get", "--record-id", "rec_test1"], q)
        self.assertEqual(code, 0)
        self.assertNotIn(KEY, text)

    def test_search_excerpts_preserve_provenance_and_signal_truncation(self):
        q = QueueTransport([(200, {"records": [record(text="长" * 1000)], "next_cursor": None, "search_mode": "Exact substring index"})])
        _, value, _ = self.invoke(["search", "--query", "项目规划", "--mode", "keyword"], q)
        item = value["data"]["records"][0]
        self.assertTrue(item["truncated"])
        self.assertEqual(item["citation"]["record_id"], item["id"])
        self.assertEqual(len(item["payload"]["text"]), 800)


class IsolatedWorkerTests(unittest.TestCase):
    def test_real_worker_save_read_dedup_import_and_conflict(self):
        base = os.environ.get("HUB_URL", "")
        if urllib.parse.urlsplit(base).hostname not in ("localhost", "127.0.0.1"):
            self.skipTest("Isolated Worker integration requires local test runner")
        config = json.loads(Path(os.environ["CREDENTIAL_FILE"]).read_text())
        payload = {"name": "skill-isolated-" + uuid.uuid4().hex, "expires_days": 1, "scopes": ["memory:read", "memory:write", "conversation:import", "sensitive:read", "sensitive:write"], "policy": {"read_level": 2, "write_level": 2, "collections": ["chats", "memories", "projects", "accounts", "knowledge"]}}
        req = urllib.request.Request(base + "/v1/clients", data=json.dumps(payload).encode(), headers={"Authorization": "Bearer " + config["clients"]["admin"]["token"], "Content-Type": "application/json"})
        with urllib.request.urlopen(req) as r:
            token = json.load(r)["token"]
        def transport(request):
            url = urllib.parse.urlsplit(request.full_url)
            local = urllib.request.Request(base + url.path + ("?" + url.query if url.query else ""), data=request.data, headers=dict(request.header_items()), method=request.method)
            return HUB.http_transport(local)  # Test-only HTTPS mapping; CLI has no insecure mode.
        client = HUB.HubClient("https://isolated.example/v1", token, transport)
        self.assertTrue(client.check()["authenticated"])
        marker = "skill-test-" + uuid.uuid4().hex
        memory = {"authorized": True, "record_type": "memory", "source_record_id": marker, "source_platform": "skill-synthetic", "source_kind": "test", "timestamp": "2026-10-14T12:00:00+08:00", "text": marker + " 合成项目规划讨论", "sensitivity": "sensitive"}
        saved = client.write("save", memory)
        self.assertEqual(saved["verified_count"], 1)
        self.assertTrue(client.write("save", memory)["verified"][0]["deduplicated"])
        args = HUB.parser().parse_args(["search", "--query", marker, "--mode", "keyword"])
        self.assertEqual(client.search(args)["count"], 1)
        with self.assertRaises(HUB.HubError) as conflict:
            client.write("save", {**memory, "text": marker + " 合成冲突"})
        self.assertEqual(conflict.exception.code, "memory_conflict")
        self.assertEqual(client.get(saved["receipt"]["id"])["payload"]["text"], memory["text"])
        conversation = {"authorized": True, "source_platform": "skill-synthetic", "session_id": marker, "completeness": "partial", "messages": [{"id": "m1", "role": "user", "timestamp": memory["timestamp"], "content": "获授权合成文本", "sensitivity": "sensitive"}]}
        self.assertEqual(client.write("import", conversation)["verified_count"], 1)
        self.assertTrue(client.write("import", conversation)["verified"][0]["deduplicated"])


if __name__ == "__main__":
    unittest.main()
