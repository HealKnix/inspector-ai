"""No models/customer data: exercise the safe Python diagnostic contract."""
import io
import json
from pathlib import Path
import sys
import unittest
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from observability import emit, trace


class ObservationTests(unittest.TestCase):
    def test_context_keeps_valid_identifiers_but_never_user_or_headers(self):
        request, correlation = str(uuid.uuid4()), str(uuid.uuid4())
        context = trace({"X-Request-Id": request, "X-Correlation-Id": correlation,
                         "Authorization": "Bearer SECRET", "X-User-Id": "forged"})
        stream = io.StringIO()
        emit(context, 503, .12, "SECRET-URL", stream)
        line = stream.getvalue()
        event = json.loads(line)
        self.assertEqual(event["request_id"], request)
        self.assertEqual(event["correlation_id"], correlation)
        self.assertEqual(event["user_id"], None)
        self.assertEqual(event["operation"], "other")
        self.assertEqual(event["http_status"], 503)
        self.assertNotIn("SECRET", line)
        self.assertNotIn("forged", line)

    def test_invalid_context_is_replaced_without_copying_input(self):
        context = trace({"X-Request-Id": "SENSITIVE-DOCUMENT", "X-Correlation-Id": "secret"})
        uuid.UUID(context["request_id"])
        self.assertEqual(context["request_id"], context["correlation_id"])


if __name__ == "__main__":
    unittest.main()
