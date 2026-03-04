import { formatDate } from "../../utils";
import type { Schedule } from "../../types";
import "./ScheduleCard.css";

type ScheduleCardProps = {
  schedule: Schedule;
  onSelect: () => void;
};

export default function ScheduleCard({ schedule, onSelect }: ScheduleCardProps) {
  return (
    <div className="schedule-card" onClick={onSelect}>
      <div className="schedule-card-top">
        <span className="schedule-card-name">{schedule.name}</span>
        <span className={`dash-schedule-badge ${schedule.status}`}>{schedule.status}</span>
      </div>
      <div className="schedule-card-details">
        <code>{schedule.cron_expression}</code>
        {schedule.next_run_at && (
          <span className="schedule-card-next">Next: {formatDate(schedule.next_run_at)}</span>
        )}
      </div>
    </div>
  );
}
