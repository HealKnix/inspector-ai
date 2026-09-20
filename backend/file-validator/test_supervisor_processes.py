"""Real Linux process regression; run Docker with --init for orphan reaping."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

import validator


def process_identity(pid):
    try:
        fields = Path(f"/proc/{pid}/stat").read_text().rsplit(") ", 1)[1].split()
    except (FileNotFoundError, ProcessLookupError):
        return None
    return {"pid": pid, "state": fields[0], "group": int(fields[2]),
            "session": int(fields[3]), "start_ticks": int(fields[19])}


def same_live_process(expected):
    current = process_identity(expected["pid"])
    return (current is not None
            and current["start_ticks"] == expected["start_ticks"]
            and current["state"] not in ("Z", "X", "x"))


def same_process_exists(expected):
    current = process_identity(expected["pid"])
    return (current is not None
            and current["start_ticks"] == expected["start_ticks"])


GRANDCHILD = r'''
import json
import os
from pathlib import Path
import sys
import time

def identity(pid):
    fields = Path(f"/proc/{pid}/stat").read_text().rsplit(") ", 1)[1].split()
    return {"pid": pid, "state": fields[0], "group": int(fields[2]),
            "session": int(fields[3]), "start_ticks": int(fields[19])}

Path(sys.argv[1]).write_text(json.dumps({
    "worker": identity(os.getppid()), "grandchild": identity(os.getpid())
}))
print("ready", flush=True)
time.sleep(60)
'''


@unittest.skipUnless(sys.platform == "linux" and Path("/proc/self/stat").exists(),
                     "Process-group and identity assertions require Linux /proc")
class RealSupervisorProcessTests(unittest.TestCase):
    def exercise(self, mode):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "pids.json"
            worker = Path(directory) / "synthetic_worker.py"
            worker.write_text(
                "import os, subprocess, sys, time\n"
                f"code = {GRANDCHILD!r}\n"
                "child = subprocess.Popen([sys.executable, '-c', code, sys.argv[1]], "
                "stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)\n"
                "assert child.stdout.readline() == b'ready\\n'\n"
                + ("os._exit(23)\n" if mode == "crash" else "time.sleep(60)\n")
            )
            real_popen = subprocess.Popen
            processes = []
            identities = None

            def launch(*args, **kwargs):
                process = real_popen(*args, **kwargs)
                processes.append(process)
                return process

            try:
                # Only shorten this test's supervisor deadline to 3 seconds
                # (TIMEOUT_SECONDS + 5). Production config still enforces 25..300.
                # Popen, communicate, killpg and wait themselves remain real.
                with patch.object(validator, "__file__", str(worker)), \
                        patch.object(validator, "TIMEOUT_SECONDS", -2), \
                        patch.object(validator.subprocess, "Popen", side_effect=launch):
                    if mode == "timeout":
                        with self.assertRaises(subprocess.TimeoutExpired) as raised:
                            validator.worker_response(str(marker))
                    else:
                        with self.assertRaisesRegex(RuntimeError, "Validator worker failed") as raised:
                            validator.worker_response(str(marker))

                self.assertEqual(len(processes), 1)
                process = processes[0]
                self.assertTrue(marker.exists(), "Grandchild handshake never completed")
                identities = json.loads(marker.read_text())
                self.assertEqual(identities["worker"]["pid"], process.pid)
                for identity in identities.values():
                    self.assertEqual(identity["group"], process.pid)
                    self.assertEqual(identity["session"], process.pid)

                # SIGKILL delivery and init's orphan reaping are asynchronous.
                # A zombie still occupies a PID, so require the original /proc
                # identity to disappear, not merely transition to state Z.
                until = time.monotonic() + 1
                while any(same_process_exists(item) for item in identities.values()):
                    if time.monotonic() >= until:
                        break
                    time.sleep(0.01)
                observed = {name: process_identity(item["pid"])
                            for name, item in identities.items()}
                print(json.dumps({"scenario": mode, "created": identities,
                                  "after_supervisor": observed,
                                  "exception": type(raised.exception).__name__,
                                  "timeout_seconds": getattr(raised.exception, "timeout", None),
                                  "worker_returncode": process.returncode}), flush=True)
                for name, identity in identities.items():
                    self.assertFalse(same_process_exists(identity),
                                     f"{name} survived or was not reaped: {observed}; "
                                     "run the container with --init")
                self.assertEqual(process.returncode,
                                 -signal.SIGKILL if mode == "timeout" else 23)
                # Reaping the direct worker is separate from killing descendants.
                with self.assertRaises(ChildProcessError):
                    os.waitpid(process.pid, os.WNOHANG)
            finally:
                # A failing regression must not leak sleepers. PID start time
                # prevents signalling a recycled PID; cleanup is after assertions.
                if identities is None and marker.exists():
                    identities = json.loads(marker.read_text())
                for identity in (identities or {}).values():
                    if same_live_process(identity):
                        try:
                            os.kill(identity["pid"], signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                for process in processes:
                    if process.poll() is None:
                        process.kill()
                    process.wait(timeout=1)

    def test_timeout_kills_real_worker_and_grandchild(self):
        self.exercise("timeout")

    def test_worker_crash_still_kills_real_grandchild(self):
        self.exercise("crash")


if __name__ == "__main__":
    unittest.main()
