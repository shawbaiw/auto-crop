# Localized Playbook Content

Status: ready-for-agent
Blocked by: 02

## Goal

Convert deterministic playbook-authored business content from single English strings to Localized Business Content.

## Scope

- Localize AI SaaS playbook department names and responsibilities.
- Localize objective titles, key result titles, target/current display values where user-facing, task titles, task descriptions, proof schema descriptions, review criteria, and handoff contracts.
- Preserve stable internal keys such as task template keys, proof schema IDs, metric names, capability tags, and playbook IDs.
- Ensure deterministic company creation can persist or expose localized playbook content.

## Acceptance Criteria

- A company created from the deterministic AI SaaS playbook can render first tasks and departments in English or Chinese after locale switching.
- Internal dependency creation still uses stable keys and does not depend on translated department display names.
- Slug/workspace creation remains stable and does not break when Chinese names exist.

## Tests

- Update playbook tests to assert localized fields exist for English and Chinese.
- Update company creation tests to assert departments, objectives, and tasks expose localized display content.
- Add a regression test proving dependency mapping does not rely on translated display names.

## Notes

This ticket may need to separate department identity from department display name if the current code still maps tasks by display name.

