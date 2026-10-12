import type { DepartmentSummary } from "../../api/client";
import { useLanguage } from "../../ui/language";
import { departmentName } from "../../ui/language/localizedNames";

export function DepartmentRoleSummary({ department }: { department: DepartmentSummary }) {
  const { language, t } = useLanguage();

  return (
    <section className="department-role-summary" aria-label={t("department.role")}>
      <h3>{t("department.role")}</h3>
      <p>{departmentName(department, language)}</p>
    </section>
  );
}
