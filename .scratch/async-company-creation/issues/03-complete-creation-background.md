# 03: Complete Creation In The Background

**What to build:** After a creating company is accepted, the backend should run the CEO Agent in the background, write the Company Blueprint records on success, move the company to `draft`, and let the dashboard advance to the Department Workspace when the user is watching that creation.

**Blocked by:** 02: Start A Durable Creating Company.

**Status:** ready-for-agent

- [ ] The initial create request no longer waits for the CEO Agent to finish.
- [ ] A background Creation Attempt runs the CEO Agent for the creating company.
- [ ] Successful CEO Agent output is parsed and written as departments, objectives, key results, tasks, and task dependencies.
- [ ] Successful completion moves the company from `creating` to `draft`.
- [ ] Completion records a completed Creation Attempt and Company Event.
- [ ] When the dashboard is viewing that creation, completion causes it to fetch full company state and enter the Department Workspace.
- [ ] Creation completion does not activate the company or start task execution.
