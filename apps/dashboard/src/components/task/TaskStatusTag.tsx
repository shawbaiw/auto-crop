import { StatusTag } from "../ice-mist";
import { useLanguage } from "../../ui/language";
import { taskStatusTone, taskStatusToneIcon, taskStatusToneLabelKey, taskStatusToneTag } from "./taskStatusTone";

/** A task's status as the 24px Ice Mist tag: its group's tone, icon and name. Only running spins. */
export function TaskStatusTag({ className, status }: { className?: string; status: string }) {
  const { t } = useLanguage();
  const tone = taskStatusTone(status);
  return (
    <StatusTag className={className} icon={tone === "running" ? undefined : taskStatusToneIcon[tone]} tone={taskStatusToneTag[tone]}>
      {t(taskStatusToneLabelKey[tone])}
    </StatusTag>
  );
}
