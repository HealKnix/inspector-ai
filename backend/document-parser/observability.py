"""Content-free JSON diagnostics at the authenticated parser boundary."""
import datetime
import json
import re
import sys
import uuid

UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)


def trace(headers):
    request_id = headers.get("X-Request-Id", "")
    correlation_id = headers.get("X-Correlation-Id", "")
    if not isinstance(request_id, str) or not UUID.fullmatch(request_id):
        request_id = str(uuid.uuid4())
    if not isinstance(correlation_id, str) or not UUID.fullmatch(correlation_id):
        correlation_id = request_id
    return {"request_id": request_id, "correlation_id": correlation_id}


def emit(context, status, duration_seconds, operation, stream=None):
    # Fixed codes only. No URL, headers, body, native exception or user identity.
    entry = {"schema_version": 1,
             "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
             "level": "ERROR" if status >= 500 else "WARNING" if status >= 400 else "INFO",
             "service": "parser", "message": "parser.request.finished",
             "request_id": context["request_id"], "correlation_id": context["correlation_id"],
             "user_id": None, "actor_kind": "service", "http_status": status,
             "duration_ms": max(0, duration_seconds * 1000),
             "operation": operation if operation in ("parse", "health", "progress", "cancel") else "other"}
    print(json.dumps(entry, ensure_ascii=True, separators=(",", ":")), file=stream or sys.stdout, flush=True)
