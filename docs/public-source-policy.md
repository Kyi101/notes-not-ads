# Public source boundary

Public source contains the extension, its required assets, build and test
tools, and documentation needed to use, contribute to, or maintain it.

Keep distribution material, social drafts, videos, captions, marketing and
business strategy, conversations, session summaries, personal preferences,
agent working instructions, plans, and working memory outside public Git.
Do not paste that material into source comments, documentation, tests, commit
or tag messages, branch names, pull requests, issues, or release descriptions.
Only a narrowly relevant technical explanation belongs in public documentation.

## Before committing or pushing

Python 3 and Git are required for the local publication checks. No Python
packages are needed. Install the hooks once in each checkout:

```sh
python3 scripts/public-push-guard.py install
python3 scripts/test-public-push-guard.py
```

The pre-commit hook inspects the actual index. The pre-push hook checks every
ref being sent and every commit since the fixed, previously published baseline.
Adding a private file and deleting it in a later commit still blocks the push.
Annotated tag messages are checked; arbitrary object and notes refs are refused.
The destination must match an explicitly approved repository URL.

`scripts/public-files.json` is an exact list, with no directory wildcards.
A new file requires a public-purpose review before adding it. Symlinks,
submodules, unapproved binary formats, large blobs, and recognizable chat,
draft, credential, or personal-path content are refused.

The installed hooks and frozen policy live in Git metadata, so switching to
an old branch cannot remove them. Changes to the policy or guard source need
separate owner review before running:

```sh
python3 scripts/public-push-guard.py install --reviewed-update
```

Never auto-expand the list or advance the baseline just to make a check pass.
Do not use `--no-verify`, disable hooks, or upload through an API to bypass a
refusal. Other clones need their own installation. Review attachments and
GitHub API operations separately; Git hooks cannot intercept them.

## Review and history

Before publication, review the complete outgoing diff and messages for
necessity and privacy. Pattern checks cannot recognize every private idea in
ordinary prose or inspect the meaning of an approved image.

The baseline identifies history already published, not permission to include
its private working files in new commits. Removing a file from the current
tree does not remove older published copies. Historical cleanup is a separate,
explicitly authorized operation.

CI repeats the check as a regression guard. Local hooks are the protection
before transfer; CI runs after GitHub has already received a push.
