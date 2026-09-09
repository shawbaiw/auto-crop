# 01: Add Company Canonical Locale

**What to build:** A `Company.locale` field that records the one language the company's generated founder-facing content is authored in. Set once at creation. Existing companies default to `"en"`. The dashboard initializes its language toggle from it.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `Company` gains `locale: Locale` (`"en" | "zh"`) — core type and zod schema.
- [ ] DB column added with a migration that defaults existing rows to `"en"`; repository read/write maps it.
- [ ] The company-creation input and API accept `locale`; `createCompany` persists it on the `Company` record.
- [ ] The CEO intake UI lets the founder pick the company language (or captures the active `LanguageProvider` value at submit).
- [ ] `summarizeCompany` serializes `locale`; the dashboard initializes `LanguageProvider` from `company.locale` on company load, and the toggle still switches chrome afterward.
- [ ] Tests: creating a `zh` company stores and returns `"zh"`; a pre-existing company with no column value reads back as `"en"`.

**Implementation note:** No language detection from Founder Vision. No post-creation change, no per-department/per-task locale. ADR 0015 precedent: no deep migration of existing companies.
