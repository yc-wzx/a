const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

// Use the same time zone and punctuation in server HTML and browser hydration.
export function displayDateTime(value: string | Date) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "时间不可用";
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}
