#!/bin/bash
cd "$(dirname "$0")"
GITHUB_USER="miladreihanpour-programmer"
REPO_NAME="${1:-fatamorgana}"
BRANCH_NAME="$(git branch --show-current)"
SSH_KEY_PATH="${SSH_KEY_PATH:-/c/Users/$USERNAME/.ssh/id_ed25519_milad}"

if [ -z "$BRANCH_NAME" ]; then
	BRANCH_NAME="main"
fi

REMOTE_URL="git@github.com:${GITHUB_USER}/${REPO_NAME}.git"

if git remote get-url origin >/dev/null 2>&1; then
	git remote set-url origin "$REMOTE_URL"
else
	git remote add origin "$REMOTE_URL"
fi

GIT_SSH_COMMAND="ssh -i $SSH_KEY_PATH -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" git pull origin "$BRANCH_NAME"
