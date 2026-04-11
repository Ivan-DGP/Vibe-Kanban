Review the current git diff for code quality issues.

1. Run `git diff` to see staged and unstaged changes
2. Check for:
   - Type safety issues (any types, missing null checks)
   - Unused imports or variables
   - Security concerns (hardcoded secrets, injection risks)
   - Missing error handling
   - Consistency with existing patterns in the codebase
3. Provide actionable feedback with file paths and line numbers
