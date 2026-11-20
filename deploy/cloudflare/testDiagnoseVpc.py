import contextlib
import io
import json
import unittest
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError, URLError

import diagnoseVpc as diag

ACCOUNT = "a"*32
API = "11111111-1111-1111-1111-111111111111"
DEPLOY = "22222222-2222-2222-2222-222222222222"


class DiagnosticTests(unittest.TestCase):
    def test_probes_match_effective_config(self):
        config = {"name": "todocal", "vpc_services": [
            {"binding": "TODOCAL_API", "service_id": API},
            {"binding": "TODOCAL_DEPLOY", "service_id": DEPLOY}]}
        checks = dict((label, path) for label, path, _ in diag.probes(ACCOUNT, config))
        prefix = "/accounts/" + ACCOUNT + "/connectivity/directory/services"
        self.assertEqual(checks["TODOCAL_API"], prefix + "/" + API)
        self.assertEqual(checks["TODOCAL_DEPLOY"], prefix + "/" + DEPLOY)
        self.assertEqual(checks["List VPC services"], prefix)

    def test_allowlist_excludes_sensitive_fields(self):
        raw = json.dumps({"success": False, "errors": [
            {"code": 10196, "message": "SECRET@example.invalid"},
            {"code": "SECRET"}, {"code": True}],
            "result": {"status": "SECRET", "bindings": ["SECRET"]}}).encode()
        line = diag.inspect_response(403, raw, True)
        self.assertEqual(line, "HTTP 403; success=false; error_codes=10196; token_status=unknown")
        self.assertEqual(diag.inspect_response(200, b'{"success":true,"result":{"status":"active"}}', True),
                         "HTTP 200; success=true; error_codes=none; token_status=active")

    def test_non_json_body_not_printed(self):
        self.assertEqual(diag.inspect_response(502, b"SECRET"),
                         "HTTP 502; response=unparseable")

    def test_network_failure_is_sanitized(self):
        with patch.object(diag, "build_opener") as factory, contextlib.redirect_stdout(io.StringIO()) as out:
            factory.return_value.open.side_effect = URLError("SECRET")
            diag.probe("Worker settings", "/test", "SECRET")
        self.assertNotIn("SECRET", out.getvalue())
        self.assertIn("request failed", out.getvalue())

    def test_http_error_is_sanitized_and_bearer_sent_only_to_cloudflare(self):
        body = io.BytesIO(b'{"success":false,"errors":[{"code":10000,"message":"SECRET"}]}')
        error = HTTPError(diag.BASE+"/test", 403, "SECRET", {}, body)
        with patch.object(diag, "build_opener") as factory, contextlib.redirect_stdout(io.StringIO()) as out:
            factory.return_value.open.side_effect = error
            diag.probe("Worker settings", "/test", "SECRET")
            request = factory.return_value.open.call_args.args[0]
            self.assertEqual(request.full_url, diag.BASE+"/test")
            self.assertEqual(request.get_method(), "GET")
            self.assertEqual(request.get_header("Authorization"), "Bearer SECRET")
        self.assertEqual(out.getvalue(), "Worker settings: HTTP 403; success=false; error_codes=10000\n")

    def test_redirect_rejected(self):
        self.assertIsNone(diag.NoRedirect().redirect_request())

    def test_missing_binding_not_requested(self):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            checks = list(diag.probes(ACCOUNT, {"name":"todocal", "vpc_services":[]}))
        self.assertIn("TODOCAL_DEPLOY: missing", out.getvalue())
        self.assertFalse(any(x[0] == "TODOCAL_DEPLOY" for x in checks))


if __name__ == "__main__":
    unittest.main()
