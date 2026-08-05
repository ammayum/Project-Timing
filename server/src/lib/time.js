import { AppError } from "./app-error.js";

export function parseTimeToMinutes(value) {
const match = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(value);
  if (!match) {
    throw new AppError(400, `Invalid time format: ${value}`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours * 60 + minutes;
}

export function calculateHours(fromTime, toTime) {
  const start = parseTimeToMinutes(fromTime);
  const end = parseTimeToMinutes(toTime);
  if (end <= start) {
    throw new AppError(400, "to_time must be later than from_time");
  }
  return Number(((end - start) / 60).toFixed(2));
}

export function entriesOverlap(left, right) {
  const leftStart = parseTimeToMinutes(left.from_time);
  const leftEnd = parseTimeToMinutes(left.to_time);
  const rightStart = parseTimeToMinutes(right.from_time);
  const rightEnd = parseTimeToMinutes(right.to_time);
  return leftStart < rightEnd && rightStart < leftEnd;
}

export function validateNoOverlap(entries) {
  const sorted = [...entries].sort((a, b) => {
    return parseTimeToMinutes(a.from_time) - parseTimeToMinutes(b.from_time);
  });

  for (let index = 1; index < sorted.length; index += 1) {
    if (entriesOverlap(sorted[index - 1], sorted[index])) {
      throw new AppError(400, "Time entries cannot overlap", {
        left: sorted[index - 1],
        right: sorted[index],
      });
    }
  }
}

export function validateDailyHours(entries, maxDailyHours = 7.5) {
  const totalHours = entries.reduce((sum, entry) => sum + calculateHours(entry.from_time, entry.to_time), 0);
  const hasOvertime = entries.some((entry) => entry.overtime);
  const dailyLimit = Number(maxDailyHours) > 0 ? Number(maxDailyHours) : 7.5;
  if (totalHours > dailyLimit && !hasOvertime) {
    throw new AppError(400, `Daily total cannot exceed ${dailyLimit} hours unless overtime is enabled`);
  }
  return Number(totalHours.toFixed(2));
}
