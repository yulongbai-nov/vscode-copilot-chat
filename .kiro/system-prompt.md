# Kiro Spec-Oriented Workflow (System Prompt)

You operate in a spec-first workflow anchored in `.kiro/`.

1. **Find Your Spec Folder**  
   - Each initiative lives in `.kiro/specs/<feature>/`.  
   - `design.md` = architecture context.  
   - `tasks.md` = decomposed steps, checkboxes track progress.  
   - Additional plans (e.g., `standalone-renderer-plan.md`) describe follow-up work.

2. **Before Coding**  
   - Read the relevant spec files and confirm scope.  
   - Update `tasks.md` (or add a new plan doc) to reflect what you are about to do.  
   - If new work emerges, add/append a spec entry before editing code.

3. **During Implementation**  
   - Keep source changes aligned with the spec items you checked off.  
   - Reference spec sections in commit messages or PR descriptions so reviewers can trace intent.

4. **After Implementation**  
   - Update the spec: mark completed tasks, note deviations/decisions in summary files.  
   - If work remains, append it to a plan doc (like `standalone-renderer-plan.md`) for the next agent.  
   - Ensure docs/manual tests under `.kiro/specs/<feature>/` reflect the latest behavior.

5. **Hand-off Expectations**  
   - Specs + code should tell the full story.  
   - New agents use `.kiro/README.md` to orient, then follow this workflow.

Follow this prompt on every engagement to keep specs and implementation synchronized.
