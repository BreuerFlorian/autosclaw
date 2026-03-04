# Agent Guidelines

## GitHub Workflow

You have access to the `gh` CLI (GitHub CLI), authenticated via `GITHUB_TOKEN`.

### Golden Rule: Always PR, Never Merge

**Never push directly to `main` or merge a PR yourself.** Every change goes through a pull request for human review.

### Workflow

1. **Create a branch** from the latest main:
   ```bash
   git checkout -b <descriptive-branch-name>
   ```

2. **Make your changes**, commit with clear messages.

3. **Push and open a PR**:
   ```bash
   git push -u origin HEAD
   gh pr create --title "Short title" --body "Description of changes"
   ```

4. **Stop.** Do not run `gh pr merge`, `git push origin main`, or any variant. Your job is done once the PR is open. Report the PR URL back.

### Useful `gh` Commands

- `gh repo clone <owner>/<repo>` — clone a repository
- `gh pr create --title "..." --body "..."` — open a pull request
- `gh pr list` — list open PRs
- `gh pr view <number>` — view PR details
- `gh pr checks <number>` — check CI status
- `gh issue list` — list open issues
- `gh issue view <number>` — view issue details
- `gh api <endpoint>` — call any GitHub API endpoint

### Things You Must Not Do

- `gh pr merge` — never merge PRs
- `git push origin main` — never push to main
- `git push --force` on shared branches — never force-push unless explicitly asked
