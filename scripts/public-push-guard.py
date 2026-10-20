#!/usr/bin/env python3
"""Check Git objects before publication. Python standard library only."""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys


class Refusal(Exception):
    pass


def git(*args, optional=False):
    result = subprocess.run(
        ["git", "--no-replace-objects", *args],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False
    )
    if result.returncode and not optional:
        raise Refusal("Git inspection failed; refusing to proceed.")
    return result.stdout if result.returncode == 0 else None


def digest(data):
    return hashlib.sha256(data.replace(b"\r\n", b"\n")).hexdigest()


def is_zero(value):
    return bool(value) and set(value) == {"0"}


PRIVATE_PART = re.compile(
    r"^(?:agents|claude|autonomy|status|decisions|notes)(?:[._-].*)?$|"
    r"^(?:\.env(?:[._-].*)?|\.agents|\.codex|\.claude|\.superpowers|"
    r"private|internal|chats?|conversations?|transcripts?|sessions?|"
    r"distribution|marketing|strategy|strategies|campaigns?|social|"
    r"prompts?|prototypes?|captures?|screenshots?|renders?|proofs|"
    r"runs|dist|node_modules|data)$",
    re.I,
)
PRIVATE_REF = re.compile(
    r"(?:private|internal|chats?|conversations?|transcripts?|sessions?|"
    r"distribution|marketing|strategy|strategies|campaigns?|social)(?:[._-].*)?$",
    re.I,
)
# These are warning signs, not a semantic privacy classifier. Never print a match.
CONTENT_RULES = (
    ("chat transcript", re.compile(
        r"(?im)^\s*(?:#{1,6}\s*)?(?:user|assistant|system|developer)\s*:"
        r"|<\|(?:im_start|start_header_id|start|endoftext)\|>"
        r"|<in-app-browser-context|<send_user_message_question_reply>"
        r"|\"(?:role|type)\"\s*:\s*\"(?:user|assistant|session_meta|response_item)\""
    )),
    ("private draft or planning section", re.compile(
        r"(?im)^\s*(?:#{1,6}\s*)?(?:"
        r"(?:linkedin|instagram|threads|twitter|tiktok|social(?: media)?)\s+(?:post|caption|thread|draft|strategy|plan)"
        r"|(?:distribution|marketing|launch|growth|campaign|content)\s+(?:strategy|plan|calendar|draft)"
        r"|(?:private|internal|confidential)\s+(?:notes|strategy|draft|discussion|plan)"
        r"|(?:chat|conversation|session)\s+(?:transcript|summary|notes)"
        r")\b"
    )),
    ("personal filesystem path", re.compile(
        r"/(?:home|Users)/[A-Za-z0-9_.-]+/|[A-Za-z]:\\Users\\[^\\\s]+\\"
    )),
    ("credential material", re.compile(
        r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"
        r"|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b"
        r"|\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b"
    )),
)
TEXT_SUFFIXES = {
    ".js", ".mjs", ".cjs", ".json", ".html", ".css", ".md", ".txt",
    ".py", ".sh", ".yml", ".yaml", ".svg",
}
SOURCE_PATH = "scripts/public-push-guard.py"
POLICY_PATH = "scripts/public-files.json"
TEST_PATH = "scripts/test-public-push-guard.py"
CONTROL_PATHS = {SOURCE_PATH, POLICY_PATH}


class Guard:
    def __init__(self, policy_path):
        if git("rev-parse", "--is-shallow-repository").strip() != b"false":
            raise Refusal("Full Git history is required; refusing a shallow checkout.")
        self.policy_path = policy_path
        self.policy = json.loads(policy_path.read_text(encoding="utf-8"))
        self.allowed = set(self.policy["files"])
        self.baselines = self.policy["published_baselines"]
        self.errors = []
        self.checked = set()
        lock_path = policy_path.with_name("locked.json")
        self.locks = json.loads(lock_path.read_text()) if lock_path.exists() else {}
        if len(self.allowed) != len(self.policy["files"]) or not self.baselines:
            raise Refusal("Invalid public file policy.")
        for name in self.allowed:
            if (
                not name or name.startswith("/") or "\\" in name
                or any(p in ("", ".", "..") for p in name.split("/"))
                or any(c in name for c in "*?[\n\r\t")
            ):
                raise Refusal("Public policy must contain exact relative file paths.")
            if any(PRIVATE_PART.fullmatch(p) for p in name.split("/")):
                raise Refusal("Public policy contains a private path.")
        for base in self.baselines:
            if not re.fullmatch(r"[0-9a-f]{40,64}", base):
                raise Refusal("Published baseline must be a full commit ID.")
            if git("cat-file", "-t", base).strip() != b"commit":
                raise Refusal("Published baseline is missing. Fetch full history first.")

    def error(self, reason, context):
        # Only paths / object IDs / reason codes; never expose matching text.
        if len(self.errors) < 30:
            self.errors.append(f"{context!r}: {reason}")

    def scan_text(self, data, context):
        try:
            value = data.decode("utf-8")
        except UnicodeDecodeError:
            self.error("text must be UTF-8", context)
            return
        for label, pattern in CONTENT_RULES:
            if pattern.search(value):
                self.error(label, context)

    def entry(self, mode, object_id, name, context):
        if name not in self.allowed:
            self.error("file is not explicitly approved for public source", name)
            return
        if mode not in ("100644", "100755"):
            self.error("symlinks and submodules are not public source", name)
            return
        key = (object_id, name)
        if key in self.checked:
            return
        self.checked.add(key)
        size = int(git("cat-file", "-s", object_id))
        if size > self.policy.get("max_blob_bytes", 8_000_000):
            self.error("file exceeds public source size limit", name)
            return
        data = git("cat-file", "blob", object_id)
        if name in self.locks:
            accepted = self.locks[name]
            if isinstance(accepted, str):
                accepted = [accepted]
            if digest(data) not in accepted:
                self.error("guard policy/code changed; separate owner review required", name)
        # The guard and its tests contain the signatures they are testing.
        # Exact allowlisting and the installed code lock protect the guard itself.
        if name == SOURCE_PATH:
            return
        suffix = PurePosixPath(name).suffix.lower()
        if suffix in TEXT_SUFFIXES or name in (".gitignore", "LICENSE", ".github/CODEOWNERS"):
            if b"\0" in data:
                self.error("binary content in a text source file", name)
            else:
                self.scan_text(data, f"{context}:{name}")
        elif suffix == ".png" and data.startswith(b"\x89PNG\r\n\x1a\n"):
            pass
        elif suffix == ".woff2" and data.startswith(b"wOF2"):
            pass
        else:
            self.error("unreviewed binary format", name)

    def tree(self, revision):
        seen = set()
        for entry in git("ls-tree", "-rz", "--full-tree", revision).split(b"\0"):
            if not entry:
                continue
            header, path = entry.split(b"\t", 1)
            mode, kind, object_id = header.decode().split()
            name = path.decode("utf-8")
            seen.add(name)
            self.entry(mode, object_id, name, revision)
        self.required(seen, revision)

    def required(self, seen, context):
        for name in sorted(CONTROL_PATHS - seen):
            self.error("required public source guard file is missing", f"{context}:{name}")

    def index(self):
        seen = set()
        for entry in git("ls-files", "--stage", "-z").split(b"\0"):
            if not entry:
                continue
            header, path = entry.split(b"\t", 1)
            mode, object_id, stage = header.decode().split()
            name = path.decode("utf-8")
            seen.add(name)
            if stage != "0":
                self.error("unmerged index entry", path.decode("utf-8"))
                continue
            self.entry(mode, object_id, name, "index")
        self.required(seen, "index")

    def revision(self, revision):
        object_id = git("rev-parse", "--verify", revision).decode().strip()
        while git("cat-file", "-t", object_id).strip() == b"tag":
            tag = git("cat-file", "tag", object_id)
            header, _, message = tag.partition(b"\n\n")
            self.scan_text(message, f"tag {object_id}")
            object_id = header.splitlines()[0].split()[1].decode()
        if git("cat-file", "-t", object_id).strip() != b"commit":
            raise Refusal("Only commits and version tags pointing to commits may be pushed.")
        # Inspect the tip even when it is an already-published baseline.
        self.tree(object_id)
        # Never trust the advertised remote tip to hide unreviewed ancestry.
        revisions = git("rev-list", object_id, "--not", *self.baselines).decode().splitlines()
        for commit in revisions:
            raw = git("cat-file", "commit", commit)
            self.scan_text(raw.partition(b"\n\n")[2], f"commit message {commit}")
            self.tree(commit)

    def push(self, remote_url, updates):
        if remote_url not in self.policy["remotes"]:
            raise Refusal("Destination is not approved for this public source. Push blocked.")
        for row in updates.splitlines():
            parts = row.split()
            if len(parts) != 4:
                raise Refusal("Malformed pre-push input.")
            _, local_oid, remote_ref, _ = parts
            if is_zero(local_oid):
                continue
            if not re.fullmatch(r"refs/heads/[A-Za-z0-9._/-]+|refs/tags/v\d+\.\d+\.\d+(?:[-+.][A-Za-z0-9.-]+)?", remote_ref):
                raise Refusal("Only source branches and version tags may be pushed.")
            if any(PRIVATE_PART.fullmatch(p) or PRIVATE_REF.fullmatch(p)
                   for p in remote_ref.split("/")[2:]):
                raise Refusal("Private-purpose ref name. Push blocked.")
            self.revision(local_oid)
        self.finish()

    def finish(self):
        if self.errors:
            raise Refusal(
                "Public source guard blocked the operation:\n- "
                + "\n- ".join(self.errors)
                + "\nKeep private material local. Do not bypass the hook or broaden the policy to silence it."
            )


def install(policy_path, reviewed_update):
    # Copies live in Git metadata so switching to an old branch cannot remove
    # the hooks or replace their policy with an older/permissive version.
    common = Path(git("rev-parse", "--git-common-dir").decode().strip()).resolve()
    configured = git("config", "--get", "core.hooksPath", optional=True)
    if configured:
        raise Refusal("An existing core.hooksPath needs manual integration; not overwritten.")
    guard_dir = common / "public-push-guard"
    hooks_dir = common / "hooks"
    guard_dir.mkdir(exist_ok=True)
    hooks_dir.mkdir(exist_ok=True)
    script = Path(__file__).read_bytes()
    policy = policy_path.read_bytes()
    targets = {"guard.py": script, "public-files.json": policy}
    for name, data in targets.items():
        target = guard_dir / name
        if target.exists() and target.read_bytes() != data and not reviewed_update:
            raise Refusal("Installed guard differs. Owner review is required before --reviewed-update.")
    marker = "# public-source-guard-v1"
    hooks = {}
    for name, command in (("pre-commit", "check-index"), ("pre-push", "pre-push")):
        body = (
            "#!/bin/sh\n" + marker + "\n"
            'common=$(git rev-parse --git-common-dir) || exit 1\n'
            f'exec python3 "$common/public-push-guard/guard.py" {command} "$@"\n'
        )
        target = hooks_dir / name
        if target.exists() and marker not in target.read_text():
            raise Refusal(f"Existing {name} hook needs manual integration; not overwritten.")
        hooks[target] = body
    # Construct/validate before writing any hook.
    Guard(policy_path)
    for name, data in targets.items():
        (guard_dir / name).write_bytes(data)
    lock_path = guard_dir / "locked.json"
    locks = json.loads(lock_path.read_text()) if lock_path.exists() else {}
    for name, data in ((SOURCE_PATH, script), (POLICY_PATH, policy)):
        previous = locks.get(name, [])
        if isinstance(previous, str):
            previous = [previous]
        # Retain reviewed versions so an approved upgrade does not reject the
        # older guard in an earlier commit of the same outgoing history.
        locks[name] = sorted(set(previous) | {digest(data)})
    lock_path.write_text(json.dumps(locks, indent=2) + "\n")
    for path, body in hooks.items():
        path.write_text(body)
        path.chmod(0o755)
    print("Installed pre-commit and pre-push guards with a frozen local policy.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--policy", type=Path, default=Path(__file__).with_name("public-files.json"))
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check-index")
    check = sub.add_parser("check")
    check.add_argument("revision", nargs="?", default="HEAD")
    push = sub.add_parser("pre-push")
    push.add_argument("remote_name")
    push.add_argument("remote_url")
    setup = sub.add_parser("install")
    setup.add_argument("--reviewed-update", action="store_true")
    args = parser.parse_args()
    try:
        if args.command == "install":
            install(args.policy, args.reviewed_update)
        else:
            guard = Guard(args.policy)
            if args.command == "check-index":
                guard.index()
            elif args.command == "check":
                guard.revision(args.revision)
            else:
                guard.push(args.remote_url, sys.stdin.read())
            guard.finish()
            print("Public source guard passed.")
    except (Refusal, OSError, ValueError, KeyError, UnicodeError) as error:
        # Do not echo arbitrary Git output or file contents on failure.
        print(str(error) if isinstance(error, Refusal) else "Guard inspection failed; operation blocked.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
