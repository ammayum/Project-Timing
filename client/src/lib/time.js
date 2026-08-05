export function calculateHours(fromTime, toTime) {
  if (!fromTime || !toTime) {
    return 0;
  }
  const [fromHour, fromMinute] = fromTime.split(":").map(Number);
  const [toHour, toMinute] = toTime.split(":").map(Number);
  const start = fromHour * 60 + fromMinute;
  const end = toHour * 60 + toMinute;
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    return 0;
  }
  return Number(((end - start) / 60).toFixed(2));
}

export function validateRowOverlap(rows) {
  const intervals = rows
    .filter((row) => row.from_time && row.to_time)
    .map((row, index) => ({
      index,
      from: row.from_time,
      to: row.to_time,
    }))
    .sort((left, right) => left.from.localeCompare(right.from));

  const conflicts = new Set();
  for (let index = 1; index < intervals.length; index += 1) {
    if (intervals[index].from < intervals[index - 1].to) {
      conflicts.add(intervals[index].index);
      conflicts.add(intervals[index - 1].index);
    }
  }
  return conflicts;
}
