// Minute-based business calendars support IANA timezones, weekdays, holidays and paused clocks.
export function calendar(settings) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: settings.timezone || "Asia/Kolkata",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const schedule = settings.businessHours || {
    days: [1, 2, 3, 4, 5],
    start: "09:00",
    end: "18:00",
    holidays: [],
  };
  return (date) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(date).map((part) => [part.type, part.value]),
    );
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
        parts.weekday,
      ),
      day = `${parts.year}-${parts.month}-${parts.day}`,
      time = `${parts.hour}:${parts.minute}`;
    return (
      schedule.days.includes(weekday) &&
      !(schedule.holidays || []).includes(day) &&
      time >= schedule.start &&
      time < schedule.end
    );
  };
}
export function dueAt(start, minutes, settings) {
  if (!settings.sla?.businessHours)
    return new Date(new Date(start).getTime() + minutes * 60000);
  const open = calendar(settings);
  let current = new Date(start),
    left = minutes,
    iterations = 0;
  while (left > 0) {
    if (++iterations > 1500000)
      throw new Error("Business calendar has no reachable SLA deadline");
    if (open(current)) left--;
    current = new Date(current.getTime() + 60000);
  }
  return current;
}
export function remainingMinutes(start, end, settings) {
  if (!end || new Date(end) <= new Date(start)) return 0;
  if (!settings.sla?.businessHours)
    return Math.ceil((new Date(end) - new Date(start)) / 60000);
  const open = calendar(settings);
  let count = 0;
  for (
    let date = new Date(start), i = 0;
    date < new Date(end) && i < 1500000;
    date = new Date(date.getTime() + 60000), i++
  )
    if (open(date)) count++;
  return count;
}
export function initialSLA(now, settings) {
  const policy = settings.sla;
  return {
    firstDue: dueAt(now, policy.firstResponse, settings),
    resolutionDue: dueAt(now, policy.resolution, settings),
  };
}
export function transitionSLA(ticket, status, settings, now = new Date()) {
  const sla = ticket.sla;
  settings = { ...settings, sla: sla.policy || settings.sla };
  if (settings.pauseStatuses.includes(status) && !sla.pausedAt) {
    sla.remaining = Object.fromEntries(
      ["firstDue", "nextDue", "resolutionDue"].map((key) => [
        key,
        remainingMinutes(now, sla[key], settings),
      ]),
    );
    sla.pausedAt = now;
  } else if (!settings.pauseStatuses.includes(status) && sla.pausedAt) {
    for (const key of ["firstDue", "nextDue", "resolutionDue"])
      if (sla[key]) sla[key] = dueAt(now, sla.remaining?.[key] || 0, settings);
    sla.pausedAt = undefined;
    sla.remaining = undefined;
  }
  if (["Resolved", "Closed"].includes(status)) sla.resolvedAt = now;
  else sla.resolvedAt = undefined;
}
