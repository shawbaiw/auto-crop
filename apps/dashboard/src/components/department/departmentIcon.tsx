import { Code2, FlaskConical, LineChart, Megaphone, Package } from "lucide-react";
import type { ReactNode } from "react";

export function departmentIcon(departmentName: string): ReactNode {
  const normalizedName = departmentName.toLowerCase();

  if (normalizedName.includes("growth")) {
    return <LineChart size={18} aria-hidden="true" />;
  }
  if (normalizedName.includes("engineer")) {
    return <Code2 size={18} aria-hidden="true" />;
  }
  if (normalizedName.includes("research")) {
    return <FlaskConical size={18} aria-hidden="true" />;
  }
  if (normalizedName.includes("product")) {
    return <Package size={18} aria-hidden="true" />;
  }

  return <Megaphone size={18} aria-hidden="true" />;
}
