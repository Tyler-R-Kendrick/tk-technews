---
name: Daily Agentic Source Generation
description: Refresh TK TechNews monitored sources, regenerate daily article artifacts, validate them, and commit generated changes directly to main.
on:
  workflow_dispatch:
  schedule:
    - cron: "30 6 * * *"
      timezone: "America/Chicago"
permissions:
  contents: read
  actions: read
engine: copilot
network: defaults
runtimes:
  node:
    version: "24"
tools:
  bash:
    - "cat"
    - "git status"
    - "git diff"
    - "npm test"
    - "npm run build"
    - "npm run daily:agentic"
safe-outputs:
  noop:
    report-as-issue: false
  missing-tool:
    create-issue: false
  missing-data:
    create-issue: false
concurrency:
  group: daily-agentic-source-generation
  cancel-in-progress: false
jobs:
  generate_daily_artifacts:
    name: Generate and commit daily artifacts
    runs-on: ubuntu-latest
    timeout-minutes: 90
    permissions:
      contents: write
    concurrency:
      group: daily-agentic-source-generation-main
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@v6
        with:
          ref: main
          persist-credentials: true
      - uses: actions/setup-node@v6
        with:
          node-version: "24"
          cache: npm
      - name: Run guarded daily generation
        env:
          GITHUB_TOKEN: ${{ github.token }}
        run: npm run daily:agentic
---

# Daily Agentic Source Generation

You are the read-only agentic supervisor for the deterministic daily generation job.

The `generate_daily_artifacts` job refreshes monitored sources, generates narrated daily article artifacts, validates them, runs the repo checks, and commits only allowed generated JSON files directly to `main`.

Inspect the repository and workflow context. Confirm that the deterministic job completed successfully, and keep your final response concise. Do not edit files, create pull requests, or attempt a second commit. If the deterministic job failed, explain the likely failure point and the safest next action for a maintainer.
