#!/usr/bin/env python3
"""URL + API Key REST client. No authorization file or third-party dependencies."""
import argparse
import getpass
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward Bearer or private request bodies to a redirect.


def build_request(args, key, payload=None):
    base = args.base_url.rstrip("/")
    parsed = urllib.parse.urlsplit(base)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username
            or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in ("", "/v1")):
        raise ValueError("Base URL must be an HTTPS Hub origin or /v1 address")
    if not re.fullmatch(r"pmh_[a-fA-F0-9]{64}", key):
        raise ValueError("Invalid client API Key format")
    if not parsed.path:
        base += "/v1"
    paths = {"handoff": "/handoff", "profile": "/profile", "context": "/context",
             "search": "/search", "accounts": "/social-accounts",
             "save": "/memories", "import": "/conversations/import"}
    path = paths.get(args.command)
    if args.command == "get":
        if not re.fullmatch(r"rec_[a-zA-Z0-9_-]{1,100}", args.record_id or ""):
            raise ValueError("get requires a valid --record-id")
        path = "/records/" + args.record_id
    if args.command == "search":
        if not args.query:
            raise ValueError("search requires --query")
        path += "?" + urllib.parse.urlencode({"query": args.query, "mode": args.mode,
                                              "rerank": "true", "limit": args.limit})
    elif args.command == "context":
        path += "?" + urllib.parse.urlencode({"limit": args.limit})
    headers = {"Authorization": "Bearer " + key, "Accept": "application/json"}
    data = None
    if args.command in ("save", "import"):
        if not isinstance(payload, dict) or payload.get("authorized") is not True:
            raise ValueError("Write JSON requires authorized:true")
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        if len(data) > 256 * 1024:
            raise ValueError("Split input into batches smaller than 256 KiB")
        headers["Content-Type"] = "application/json"
    return urllib.request.Request(base + path, data=data, headers=headers,
                                  method="POST" if data is not None else "GET")


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("command", choices=["handoff", "profile", "context", "search", "get", "accounts", "save", "import"])
    p.add_argument("--base-url", default=os.environ.get("PMH_BASE_URL", "https://pw.zgatri.com/v1"))
    p.add_argument("--query")
    p.add_argument("--record-id")
    p.add_argument("--mode", choices=["keyword", "semantic", "hybrid"], default="hybrid")
    p.add_argument("--limit", type=int, choices=range(1, 51), default=10)
    args = p.parse_args(argv)
    try:
        payload = None
        if args.command in ("save", "import"):
            raw = sys.stdin.buffer.read(256 * 1024 + 1)
            if len(raw) > 256 * 1024:
                raise ValueError("Write input exceeds 256 KiB")
            payload = json.loads(raw)
        key = os.environ.get("PMH_API_KEY")
        if not key:
            if not sys.stderr.isatty():
                raise ValueError("Noninteractive use requires injected PMH_API_KEY")
            key = getpass.getpass("Hub API Key (hidden): ")
        request = build_request(args, key, payload)
        opener = urllib.request.build_opener(NoRedirect())
        with opener.open(request, timeout=30) as response:
            raw = response.read(8 * 1024 * 1024 + 1)
            if len(raw) > 8 * 1024 * 1024:
                raise ValueError("Response too large")
            result = json.loads(raw)
        json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")
        return 0
    except urllib.error.HTTPError as error:
        # Do not include response bodies, request headers, or submitted text in logs.
        print("Hub request failed (HTTP " + str(error.code) + "). Check authorization and input; do not retry conflicting writes blindly.", file=sys.stderr)
        return 1
    except urllib.error.URLError:
        print("Hub network connection failed.", file=sys.stderr)
        return 1
    except (ValueError, OSError):
        print("Invalid input, configuration, or JSON response. Use --help; credentials are never command-line arguments.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
