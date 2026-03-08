# Key references

- **Plugin–Server API contract (source of truth):** https://raw.githubusercontent.com/brush701/tektite-server/refs/heads/main/API.md
  - Also available locally if tektite-server is checked out: `~/dev/tektite-server/API.md`
  - All types in `src/types.ts` must match this contract exactly
- **Technical spec:** `SPEC.md` (architecture, design decisions)

# General workflow
Feature development and bug fixes should be tracked with Backlog.md tasks. This ensures that work is visible, organized, and can be properly reviewed and tested. Features should be built in a feature branch and merged into main via pull request, with a link to the corresponding Backlog task (and if applicable, github issue). This allows for code review and testing before changes are merged. IMPORTANT: pre-existing issues/bugs are still bugs and should be resolved immediately. All checkins should be bug free and not cause regressions. If you encounter a bug, fix it immediately and create a task to track the work if necessary.

# Agent Teams
When working on a task, you may need to collaborate with other agents. If and when you feel appropriate, use agent teams to create a team and manage other agents to collaborate on the task. This allows for better coordination and communication between agents working on the same task.

<CRITICAL_INSTRUCTION>

## BACKLOG WORKFLOW INSTRUCTIONS

This project uses Backlog.md MCP for all task and project management activities.

**CRITICAL GUIDANCE**

- If your client supports MCP resources, read `backlog://workflow/overview` to understand when and how to use Backlog for this project.
- If your client only supports tools or the above request fails, call `backlog.get_workflow_overview()` tool to load the tool-oriented overview (it lists the matching guide tools).

- **First time working here?** Read the overview resource IMMEDIATELY to learn the workflow
- **Already familiar?** You should have the overview cached ("## Backlog.md Overview (MCP)")
- **When to read it**: BEFORE creating tasks, or when you're unsure whether to track work

These guides cover:
- Decision framework for when to create tasks
- Search-first workflow to avoid duplicates
- Links to detailed guides for task creation, execution, and finalization
- MCP tools reference

You MUST read the overview resource to understand the complete workflow. The information is NOT summarized here.

</CRITICAL_INSTRUCTION>
