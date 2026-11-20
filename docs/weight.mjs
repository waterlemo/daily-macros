import { validDate } from "./domain.mjs";

const dayMs = 86400000;
export const weightWindow = 30;
export const validWeight = grams => Number.isInteger(grams) && grams >= 100 && grams <= 1000000 && grams % 10 === 0;

export function weightDates(end, days = weightWindow) {
  const finalDay = Date.parse(end + "T00:00:00Z");
  return Array.from({ length: days }, (_, index) =>
    new Date(finalDay - (days - 1 - index) * dayMs).toISOString().slice(0, 10)
  ).filter(validDate);
}

export function weightHistory(values, dates) {
  return dates.flatMap(date => validWeight(values[date]) ? [{ date, grams: values[date] }] : []);
}
