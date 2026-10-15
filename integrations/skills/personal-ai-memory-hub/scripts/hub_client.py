#!/usr/bin/env python3
"""Personal Memory Hub: environment-held credentials, explicit results, verified writes."""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

MAX_INPUT = 256 * 1024
MAX_RESPONSE = 8 * 1024 * 1024
SECRET = re.compile(r"pmh_[a-fA-F0-9]{64}|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~-]{16,}")


class HubError(Exception):
    def __init__(self, code, status=None, details=None, persisted=False, receipt=None):
        self.code, self.status, self.details = code, status, details or {}
        self.persisted, self.receipt = persisted, receipt


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def http_transport(request):
    opener = urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(request, timeout=30) as response:
            return response.status, response.read(MAX_RESPONSE + 1)
    except urllib.error.HTTPError as error:
        return error.code, error.read(MAX_RESPONSE + 1)
    except (urllib.error.URLError, TimeoutError, OSError):
        raise HubError("network_error") from None


def safe_details(value):
    if not isinstance(value, dict):
        return {}
    result = {}
    for k in ("id", "record_id", "conflict_id", "current_version", "version", "required"):
        v = value.get(k)
        if isinstance(v, int) and not isinstance(v, bool):
            result[k] = v
        elif isinstance(v, str) and re.fullmatch(r"(?:rec_|con_)[A-Za-z0-9_-]{1,100}|(?:memory|sensitive|conversation):[a-z]+|admin", v):
            result[k] = v
    return result


def scrub(value, key):
    if isinstance(value, str):
        return SECRET.sub("[credential hidden]", value.replace(key, "[credential hidden]"))
    if isinstance(value, list):
        return [scrub(x, key) for x in value]
    if isinstance(value, dict):
        return {scrub(k, key): scrub(v, key) for k, v in value.items()}
    return value


def brief(record):
    if not isinstance(record, dict) or not isinstance(record.get("id"), str):
        raise HubError("invalid_response")
    result = {k: record[k] for k in ("id", "version", "record_type", "source_platform", "source_kind", "source_timestamp", "session_id", "logical_key", "sensitivity", "citation", "classification") if k in record}
    payload = record.get("payload", {})
    if not isinstance(payload, dict) or not isinstance(payload.get("text", ""), str):
        raise HubError("invalid_response")
    text = payload.get("text", "")
    result["payload"] = {"title": payload.get("title", ""), "text": text[:800]}
    result["truncated"] = len(text) > 800 or bool(payload.get("data")) or bool(record.get("truncated"))
    return result


class HubClient:
    def __init__(self, base_url, key, transport=http_transport):
        base = base_url.rstrip("/")
        u = urllib.parse.urlsplit(base)
        if u.scheme != "https" or not u.hostname or u.username or u.password or u.query or u.fragment or u.path not in ("", "/v1"):
            raise HubError("invalid_base_url")
        if not key:
            raise HubError("missing_api_key")
        if not re.fullmatch(r"pmh_[a-fA-F0-9]{64}", key):
            raise HubError("invalid_api_key_format")
        self.base = base if u.path else base + "/v1"
        self.key, self.transport = key, transport

    def request(self, path, payload=None):
        data, headers = None, {"Authorization": "Bearer " + self.key, "Accept": "application/json"}
        if payload is not None:
            if not isinstance(payload, dict) or payload.get("authorized") is not True:
                raise HubError("authorization_required")
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            if len(data) > MAX_INPUT:
                raise HubError("payload_too_large")
            if SECRET.search(data.decode("utf-8")):
                raise HubError("credential_like_content_rejected")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(self.base + path, data=data, headers=headers, method="POST" if data is not None else "GET")
        status, raw = self.transport(req)
        if len(raw) > MAX_RESPONSE:
            raise HubError("response_too_large", status)
        try:
            value = json.loads(raw)
        except (ValueError, UnicodeError):
            raise HubError("invalid_response", status) from None
        if not isinstance(value, dict):
            raise HubError("invalid_response", status)
        if not 200 <= status < 300 or "error" in value:
            code = value.get("error")
            if not isinstance(code, str) or not re.fullmatch(r"[a-z_]{1,80}", code):
                code = "http_error"
            raise HubError(code, status, safe_details(value.get("details")))
        return value

    def check(self):
        result = self.request("/profile")
        if not isinstance(result.get("records"), list):
            raise HubError("invalid_response")
        return {"authenticated": True, "transport": "rest", "profile_records": len(result["records"]), "visibility": "current_key_permissions_only"}

    def get(self, record_id):
        if not re.fullmatch(r"rec_[A-Za-z0-9_-]{1,100}", record_id or ""):
            raise HubError("invalid_record_id")
        result = self.request("/records/" + record_id)
        if result.get("id") != record_id or not isinstance(result.get("payload"), dict):
            raise HubError("invalid_response")
        return result

    def search(self, args):
        cursor, mode, pages = args.cursor, args.mode, 0
        records, seen, degraded, reasons = [], set(), False, []
        next_cursor = cursor
        complete, actual = False, mode
        while pages < args.max_pages:
            query = {"query": args.query, "mode": mode, "rerank": str(args.rerank and mode != "keyword").lower(), "limit": args.limit, "cursor": cursor}
            if getattr(args, "category", None):
                query["category"] = args.category
            if args.collection:
                query["collection"] = args.collection
            if args.record_type:
                query["record_type"] = args.record_type
            try:
                value = self.request("/search?" + urllib.parse.urlencode(query))
                if not isinstance(value.get("records"), list) or "next_cursor" not in value:
                    raise HubError("invalid_response")
                raw_mode = value.get("search_mode", "")
                actual = "keyword" if raw_mode.startswith("Exact substring") else raw_mode
                if actual not in ("keyword", "semantic", "hybrid"):
                    raise HubError("invalid_response")
                if value.get("degraded"):
                    degraded = True
                    reason = value.get("reason")
                    if isinstance(reason, str) and re.fullmatch(r"[a-z_]{1,80}", reason) and reason not in reasons:
                        reasons.append(reason)
                # Hybrid fallback discards its keyword cursor. Start an explicit
                # keyword scan so capped candidates aren't mistaken for complete history.
                if mode != "keyword" and actual == "keyword":
                    mode = "keyword"
                    continue
                for record in value["records"]:
                    item = brief(record)
                    if item["id"] not in seen:
                        seen.add(item["id"])
                        records.append(item)
                pages += 1
                next_cursor = value["next_cursor"]
                if actual != "keyword":
                    complete = False
                    break
                if next_cursor is None:
                    complete = True
                    break
                if not isinstance(next_cursor, int) or isinstance(next_cursor, bool) or next_cursor <= cursor:
                    raise HubError("invalid_response")
                cursor = next_cursor
            except HubError as error:
                error.details.update({"pages_completed": pages, "returned_count": len(records), "complete": False})
                raise
        return {"records": records, "count": len(records), "search_mode": actual, "requested_mode": args.mode, "degraded": degraded, "reasons": reasons, "pages": pages, "complete": complete, "next_cursor": next_cursor, "visibility": "current_key_permissions_only", "scope": "keyword_matches" if actual == "keyword" else "ranked_candidates"}

    def write(self, operation, payload):
        if not isinstance(payload, dict) or payload.get("authorized") is not True:
            raise HubError("authorization_required")
        paths = {"save": "/memories", "import": "/conversations/import", "save-account": "/social-accounts", "summary": "/summaries/generate", "classify": "/classifications"}
        if operation == "import":
            messages = payload.get("messages")
            if not isinstance(messages, list) or not 1 <= len(messages) <= 10:
                raise HubError("invalid_import_batch")
            allowed = {"id", "role", "timestamp", "content", "sensitivity", "expected_version", "conflict_id"}
            if any(not isinstance(m, dict) or m.get("role") not in ("user", "assistant") or set(m) - allowed for m in messages):
                raise HubError("visible_messages_only")
        try:
            receipt = self.request(paths[operation], payload)
        except HubError as error:
            # A missing/malformed response doesn't prove that an idempotent write
            # wasn't committed. Import messages are saved independently.
            if error.code in ("network_error", "invalid_response", "response_too_large", "http_error") or (error.status is not None and error.status >= 500) or (operation == "import" and error.code == "record_policy_denied"):
                error.persisted = "unknown"
            raise
        results = receipt.get("messages") if operation == "import" else [receipt]
        if not isinstance(results, list) or not results or (operation == "import" and len(results) != len(payload["messages"])):
            raise HubError("write_verification_failed", persisted=True, receipt=receipt)
        verified = []
        conflict = False
        for i, result in enumerate(results):
            if not isinstance(result, dict):
                raise HubError("write_verification_failed", persisted=True, receipt=receipt)
            if result.get("status") == "conflict":
                conflict = True
                continue
            try:
                current = self.get(result.get("id"))
                expected = (payload["messages"][i]["content"] or "[empty message]") if operation == "import" else payload.get("text")
                if current.get("version") != result.get("version") or (expected is not None and current["payload"].get("text") != expected):
                    raise HubError("verification_mismatch")
                verified.append({"id": result["id"], "version": result["version"], "deduplicated": bool(result.get("deduplicated"))})
            except (HubError, KeyError) as error:
                details = {"verified_count": len(verified)}
                if isinstance(error, HubError):
                    details["cause"] = error.code
                raise HubError("write_verification_failed", details=details, persisted=True, receipt=receipt) from None
        if conflict or receipt.get("conflicts", 0):
            raise HubError("memory_conflict", status=409, details={"verified_count": len(verified)}, persisted="partial" if verified else False, receipt=receipt)
        return {"receipt": receipt, "verified": verified, "verified_count": len(verified)}


class JsonParser(argparse.ArgumentParser):
    def error(self, message):
        raise HubError("invalid_arguments")


def parser():
    p = JsonParser(description=__doc__)
    p.add_argument("command", choices=["check", "handoff", "profile", "context", "search", "get", "accounts", "save", "import", "save-account", "summary", "overview", "classify", "strategy"])
    p.add_argument("--query")
    p.add_argument("--record-id")
    p.add_argument("--mode", choices=["keyword", "semantic", "hybrid"], default="hybrid")
    p.add_argument("--limit", type=int, choices=range(1, 51), default=10)
    p.add_argument("--cursor", type=int, default=0)
    p.add_argument("--max-pages", type=int, choices=range(1, 21), default=3)
    p.add_argument("--collection", choices=["chats", "memories", "projects", "accounts", "knowledge"])
    p.add_argument("--record-type", choices=["memory", "profile", "event", "context", "summary", "message", "project", "task"])
    p.add_argument("--category", choices=["personal", "development", "other", "unclassified"])
    p.add_argument("--detail", choices=["brief", "full"], default="brief")
    p.add_argument("--section", choices=["all", "personal", "projects", "mainline", "next_actions"], default="all")
    p.add_argument("--since")
    p.add_argument("--session-id")
    p.add_argument("--include-conversation", action="store_true")
    flags = p.add_mutually_exclusive_group()
    flags.add_argument("--rerank", dest="rerank", action="store_true")
    flags.add_argument("--no-rerank", dest="rerank", action="store_false")
    p.set_defaults(rerank=True)
    return p


def main(argv=None, transport=http_transport, stdin=None, stdout=None):
    operation, key = "unknown", os.environ.get("PMH_API_KEY", "")
    stdout = stdout or sys.stdout
    try:
        args = parser().parse_args(argv)
        operation = args.command
        client = HubClient(os.environ.get("PMH_BASE_URL", "https://pw.zgatri.com/v1"), key, transport)
        if args.cursor < 0 or (args.command == "search" and (not args.query or not 2 <= len(args.query) <= 120)):
            raise HubError("invalid_arguments")
        if operation == "check":
            data = client.check()
        elif operation == "search":
            data = client.search(args)
        elif operation == "get":
            data = client.get(args.record_id)
        elif operation in ("save", "import", "save-account", "summary", "classify"):
            raw = (stdin or sys.stdin.buffer).read(MAX_INPUT + 1)
            if len(raw) > MAX_INPUT:
                raise HubError("payload_too_large")
            try:
                payload = json.loads(raw)
            except (ValueError, UnicodeError):
                raise HubError("invalid_input_json") from None
            if operation == "classify":
                receipt = client.request("/classifications", payload)
                record = client.get(receipt.get("id"))
                current = record.get("classification", {})
                if current.get("revision") != receipt.get("revision") or current.get("categories") != receipt.get("categories"):
                    raise HubError("write_verification_failed", persisted=True, receipt=receipt)
                data = {"receipt": receipt, "verified": True}
            else:
                data = client.write(operation, payload)
        else:
            path = {"handoff": "/handoff", "profile": "/profile", "context": "/context", "accounts": "/social-accounts", "overview": "/overview", "strategy": "/strategy"}[operation]
            if operation == "strategy":
                path += "?" + urllib.parse.urlencode({"detail": args.detail})
            if operation == "overview":
                path += "?" + urllib.parse.urlencode({"detail": args.detail, "section": args.section})
            if operation == "context":
                query = {"limit": args.limit, "include_conversation": str(args.include_conversation).lower()}
                if args.since:
                    query["since"] = args.since
                if args.session_id:
                    query["session_id"] = args.session_id
                path += "?" + urllib.parse.urlencode(query)
            data = client.request(path)
            if operation in ("profile", "context", "accounts"):
                if not isinstance(data.get("records"), list):
                    raise HubError("invalid_response")
                data["records"] = [brief(r) for r in data["records"]]
                if operation == "profile":
                    data.pop("fields", None)
        result = {"ok": True, "operation": operation, "data": data}
        exit_code = 0
    except HubError as error:
        result = {"ok": False, "operation": operation, "error": {"code": error.code, "http_status": error.status, "details": error.details}, "persisted": error.persisted}
        if error.receipt is not None:
            result["receipt"] = error.receipt
        exit_code = 2
    except Exception:
        result = {"ok": False, "operation": operation, "error": {"code": "client_error"}, "persisted": False}
        exit_code = 2
    json.dump(scrub(result, key) if key else result, stdout, ensure_ascii=False, indent=2)
    stdout.write("\n")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
