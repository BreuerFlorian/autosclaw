import type { MouseEvent } from "react";
import { useApp } from "../../context/AppContext";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { useTableSort, sortItems, sortIndicator } from "../../hooks/useTableSort";
import { formatDate } from "../../utils";
import type { Schedule } from "../../types";
import ScheduleCard from "./ScheduleCard";
import "./ScheduleTable.css";

type ColKey = "name" | "cron" | "status" | "nextRun";

const colGetters: Record<ColKey, (s: Schedule) => string | number> = {
  name: (s) => s.name.toLowerCase(),
  cron: (s) => s.cron_expression,
  status: (s) => s.status,
  nextRun: (s) => s.next_run_at ?? "",
};

export default function ScheduleTable() {
  const { state, selectSchedule, wsSend, openModal, userRole, userId } = useApp();
  const { confirm, ConfirmDialogElement } = useConfirmDialog();
  const { schedules } = state;
  const { sort, toggle } = useTableSort<ColKey>("name");

  const sorted = sortItems(schedules, sort, colGetters);
  const canCreate = userRole === "admin" || userRole === "member";

  const canModify = (schedule: Schedule): boolean => {
    if (userRole === "viewer") return false;
    if (userRole === "admin") return true;
    return schedule.created_by === userId;
  };

  const handlePauseResume = (e: MouseEvent, schedule: Schedule) => {
    e.stopPropagation();
    if (schedule.status === "active") {
      wsSend({ type: "pause_schedule", scheduleId: schedule.id });
    } else {
      wsSend({ type: "resume_schedule", scheduleId: schedule.id });
    }
  };

  const handleDelete = async (e: MouseEvent, schedule: Schedule) => {
    e.stopPropagation();
    const ok = await confirm({
      title: "Delete Schedule",
      message: `Are you sure you want to delete schedule '${schedule.name}'? This action cannot be undone.`,
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (ok) wsSend({ type: "delete_schedule", scheduleId: schedule.id });
  };

  const th = (key: ColKey, label: string) => (
    <th className="dash-sortable" onClick={() => toggle(key)}>
      {label}{sortIndicator(sort, key)}
    </th>
  );

  return (
    <div className="dash-section">
      <div className="dash-section-header">
        <h3>Schedules</h3>
        {canCreate && (
          <button
            className="dash-new-schedule-btn"
            onClick={() => openModal("newSchedule")}
          >
            + New Schedule
          </button>
        )}
      </div>
      <div className="dash-table-wrap">
        {schedules.length === 0 ? (
          <div className="dash-empty">No schedules yet</div>
        ) : (
          <table className="dash-table">
            <thead>
              <tr>
                {th("name", "Schedule")}
                {th("cron", "Cron")}
                {th("status", "Status")}
                {th("nextRun", "Next Run")}
                <th className="dash-actions-th">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((schedule) => (
                <tr
                  key={schedule.id}
                  className="dash-schedule-row"
                  onClick={() => selectSchedule(schedule.id)}
                >
                  <td>{schedule.name}</td>
                  <td>
                    <code>{schedule.cron_expression}</code>
                  </td>
                  <td>
                    <span
                      className={`dash-schedule-badge ${schedule.status}`}
                    >
                      {schedule.status}
                    </span>
                  </td>
                  <td>{formatDate(schedule.next_run_at)}</td>
                  <td className="dash-actions-cell">
                    {canModify(schedule) && (
                      <>
                        {schedule.status === "active" ? (
                          <button
                            className="dash-action-btn pause"
                            onClick={(e) => handlePauseResume(e, schedule)}
                          >
                            Pause
                          </button>
                        ) : (
                          <button
                            className="dash-action-btn resume"
                            onClick={(e) => handlePauseResume(e, schedule)}
                          >
                            Resume
                          </button>
                        )}
                        <button
                          className="dash-action-btn delete"
                          onClick={(e) => handleDelete(e, schedule)}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="dash-card-list">
        {sorted.map((schedule) => (
          <ScheduleCard
            key={schedule.id}
            schedule={schedule}
            onSelect={() => selectSchedule(schedule.id)}
          />
        ))}
        {schedules.length === 0 && (
          <div className="dash-empty">No schedules yet</div>
        )}
      </div>
      {ConfirmDialogElement}
    </div>
  );
}
