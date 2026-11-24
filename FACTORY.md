---
delivery: pr
branch: feat/<goal>
security: on
setup: 3
---

# Factory rules

Written by Gemba's repository setup; edit freely. Factory reads the lines between the `---` markers.

## Branches and pull requests

Put each plan's work on a feature branch named `feat/<goal>`, with `<goal>` a short kebab-case name for the plan's goal, and set it as the plan's branch. Factory merges every chunk there and never touches the branch the run started from. When every chunk has merged, factory pushes the branch to `origin` and opens a pull request into the branch the run started from; a person reviews and merges it.

## Running code

Agents may build the project and run its tests and scripts. Build and test with `npm ci`; test commands should use it.

## Other rules

Follow the repo's `AGENTS.md` or `CLAUDE.md` if it has one. Tests must not call external services.

## Security review

Every chunk gets a security review after the regular review and before it merges.
