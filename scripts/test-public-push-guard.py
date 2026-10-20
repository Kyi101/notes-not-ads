#!/usr/bin/env python3
"""Exercise the real hooks against temporary local repositories; no network."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("public-push-guard.py")


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="public-source-test-")
        self.root = Path(self.temp.name) / "work"
        self.root.mkdir()
        self.env = os.environ.copy()
        # Isolate tests from a parent hook's repository/index environment.
        for key in tuple(self.env):
            if key.startswith("GIT_"):
                self.env.pop(key)
        self.env.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull)
        self.run_git("init", "-q", "-b", "main")
        self.run_git("config", "user.name", "Guard Test")
        self.run_git("config", "user.email", "guard@example.invalid")
        self.write("README.md", "Public documentation.\n")
        self.commit("Initial published source")
        self.base = self.run_git("rev-parse", "HEAD").stdout.strip()
        self.remote = Path(self.temp.name) / "remote.git"
        self.run_git("init", "--bare", "-q", str(self.remote))
        self.run_git("remote", "add", "origin", str(self.remote))
        self.run_git("push", "-q", "origin", "main")
        self.write("scripts/public-push-guard.py", SCRIPT.read_text())
        self.policy = {
            "files": ["README.md", "source.js", "image.png", "shared/capture-math.js",
                      "scripts/public-push-guard.py", "scripts/public-files.json"],
            "published_baselines": [self.base],
            "remotes": [str(self.remote)],
            "max_blob_bytes": 100000,
        }
        self.write_policy()
        self.guard("install")
        self.commit("Install publication guard")

    def tearDown(self):
        self.temp.cleanup()

    def run_git(self, *args, ok=True, input=None):
        result = subprocess.run(["git", *args], cwd=self.root, env=self.env,
                                input=input, text=True, capture_output=True)
        if ok:
            self.assertEqual(result.returncode, 0, result.stderr)
        return result

    def write(self, path, text):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)

    def write_policy(self):
        self.write("scripts/public-files.json", json.dumps(self.policy) + "\n")

    def guard(self, *args, ok=True):
        result = subprocess.run(
            ["python3", "scripts/public-push-guard.py", *args],
            cwd=self.root, env=self.env, text=True, capture_output=True,
        )
        if ok:
            self.assertEqual(result.returncode, 0, result.stderr)
        return result

    def commit(self, message, bypass=False, ok=True):
        self.run_git("add", ".")
        args = ["commit", "-qm", message]
        if bypass:
            args.insert(1, "--no-verify")
        return self.run_git(*args, ok=ok)

    def assert_push_blocked(self, ref="HEAD:main"):
        before = self.run_git("--git-dir", str(self.remote), "show-ref").stdout
        result = self.run_git("push", "origin", ref, ok=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.run_git("--git-dir", str(self.remote), "show-ref").stdout, before)
        return result

    def test_normal_source_commit_and_push(self):
        self.write("source.js", "export const version = 1;\n")
        self.commit("Update source")
        self.run_git("push", "-q", "origin", "HEAD:main")

    def test_capture_helper_is_product_source(self):
        self.write("shared/capture-math.js", "export const size = 1;\n")
        self.commit("Add capture helper")
        self.run_git("push", "-q", "origin", "HEAD:main")

    def test_unlisted_file_is_blocked_at_commit(self):
        self.write("scripts/extra.py", "print('unreviewed')\n")
        self.assertNotEqual(self.commit("Add file", ok=False).returncode, 0)

    def test_private_file_forced_past_ignore_is_blocked(self):
        self.write(".git/info/exclude", "strategy/\n")
        self.write("strategy/plan.md", "Planning material\n")
        self.run_git("add", "-f", "strategy/plan.md")
        self.assertNotEqual(self.run_git("commit", "-qm", "Add file", ok=False).returncode, 0)

    def test_staged_content_cannot_be_hidden_by_worktree_edit(self):
        self.write("README.md", "User" + ": private conversation\n")
        self.run_git("add", "README.md")
        self.write("README.md", "Public documentation.\n")
        result = self.run_git("commit", "-qm", "Update documentation", ok=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("private conversation", result.stderr)

    def test_private_section_inside_allowed_document_is_blocked(self):
        self.write("README.md", "# Distribution" + " strategy\nA campaign draft.\n")
        self.assertNotEqual(self.commit("Update documentation", ok=False).returncode, 0)

    def test_added_then_deleted_file_still_blocks_push(self):
        self.write("draft.txt", "Private draft\n")
        self.commit("Add a file", bypass=True)
        (self.root / "draft.txt").unlink()
        self.commit("Remove a file")
        self.assert_push_blocked()

    def test_non_head_branch_is_inspected(self):
        self.run_git("switch", "-qc", "other")
        self.write("draft.txt", "Private draft\n")
        self.commit("Add a file", bypass=True)
        self.run_git("switch", "-q", "main")
        self.assert_push_blocked("other:other")

    def test_private_commit_message_is_blocked(self):
        self.write("source.js", "export const version = 2;\n")
        self.commit("User" + ": private discussion")
        self.assert_push_blocked()

    def test_annotated_tag_message_is_inspected(self):
        self.run_git("tag", "-a", "v1.2.3", "-m", "Assistant" + ": private discussion")
        self.assert_push_blocked("refs/tags/v1.2.3")

    def test_version_tag_passes(self):
        self.run_git("tag", "-a", "v1.2.3", "-m", "Release 1.2.3")
        self.run_git("push", "-q", "origin", "refs/tags/v1.2.3")

    def test_blob_and_notes_refs_are_blocked(self):
        blob = self.run_git("hash-object", "-w", "--stdin", input="Secret").stdout.strip()
        self.assert_push_blocked(blob + ":refs/tags/v1.2.3")
        self.assert_push_blocked("HEAD:refs/notes/test")

    def test_symlink_is_blocked(self):
        (self.root / "source.js").symlink_to("README.md")
        self.assertNotEqual(self.commit("Add source", ok=False).returncode, 0)

    def test_disguised_binary_is_blocked(self):
        (self.root / "image.png").write_bytes(b"PK\x03\x04archive")
        self.assertNotEqual(self.commit("Add image", ok=False).returncode, 0)

    def test_policy_expansion_needs_separate_review(self):
        self.policy["files"].append("extra.md")
        self.write_policy()
        self.assertNotEqual(self.commit("Expand public files", ok=False).returncode, 0)
        self.assertNotEqual(self.guard("install", ok=False).returncode, 0)

    def test_guard_edit_is_blocked(self):
        with (self.root / "scripts/public-push-guard.py").open("a") as handle:
            handle.write("\n# changed\n")
        self.assertNotEqual(self.commit("Change guard", ok=False).returncode, 0)

    def test_reviewed_policy_update_keeps_earlier_reviewed_versions(self):
        self.policy["files"].append("extra.md")
        self.write_policy()
        self.guard("install", "--reviewed-update")
        self.write("extra.md", "Additional public documentation.\n")
        self.commit("Add reviewed documentation")
        self.run_git("push", "-q", "origin", "HEAD:main")

    def test_private_branch_name_is_blocked(self):
        self.assert_push_blocked("HEAD:refs/heads/codex/marketing-plan")

    def test_replacement_object_cannot_hide_private_ancestor(self):
        safe = self.run_git("rev-parse", "HEAD").stdout.strip()
        self.write("draft.txt", "Private material")
        self.commit("Add file", bypass=True)
        private = self.run_git("rev-parse", "HEAD").stdout.strip()
        (self.root / "draft.txt").unlink()
        self.commit("Remove file")
        self.run_git("replace", private, safe)
        self.assert_push_blocked()

    def test_shallow_history_is_refused(self):
        head = self.run_git("rev-parse", "HEAD").stdout.strip()
        self.write(".git/shallow", head + "\n")
        self.assertNotEqual(self.guard("check", ok=False).returncode, 0)

    def test_guard_deletion_and_old_branch_cannot_remove_hook(self):
        self.run_git("switch", "-qc", "old", self.base)
        self.write("draft.txt", "Private material")
        self.assertNotEqual(self.commit("Add draft", ok=False).returncode, 0)
        self.assert_push_blocked("HEAD:old")

    def test_unapproved_destination_is_blocked(self):
        second = Path(self.temp.name) / "other.git"
        self.run_git("init", "--bare", "-q", str(second))
        result = self.run_git("push", str(second), "HEAD:main", ok=False)
        self.assertNotEqual(result.returncode, 0)

    def test_missing_baseline_fails_closed(self):
        self.policy["published_baselines"] = ["1" * 40]
        self.write_policy()
        self.assertNotEqual(self.guard("check", ok=False).returncode, 0)

    def test_multiple_refs_inspected_atomically(self):
        self.run_git("branch", "clean")
        self.write("draft.txt", "Private")
        self.commit("Add file", bypass=True)
        result = self.run_git("push", "origin", "clean:clean", "HEAD:main", ok=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("refs/heads/clean", self.run_git("--git-dir", str(self.remote), "show-ref").stdout)

    def test_different_existing_hook_is_preserved(self):
        hook = self.root / ".git/hooks/pre-commit"
        original = "#!/bin/sh\nexit 0\n"
        hook.write_text(original)
        self.assertNotEqual(self.guard("install", ok=False).returncode, 0)
        self.assertEqual(hook.read_text(), original)


if __name__ == "__main__":
    unittest.main(verbosity=2)
