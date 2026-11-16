export const nutrients = [
  { key: "carbs", label: "碳水", fullLabel: "碳水化合物", color: "amber" },
  { key: "protein", label: "蛋白质", fullLabel: "蛋白质", color: "green" },
  { key: "fat", label: "脂肪", fullLabel: "脂肪", color: "violet" }
];

export const zero = { carbs: 0, protein: 0, fat: 0 };
const formatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
export const grams = value => formatter.format(value / 100);

export function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}-${String(date.getDate()).padStart(2, "0")}`;
}

export function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function convert(perHundred, portionGrams) {
  const portion = Math.round(portionGrams * 100);
  return Object.fromEntries(nutrients.map(({ key }) => [
    key, Math.round(perHundred[key] * portion / 10000)
  ]));
}

export function totals(records) {
  const result = { ...zero };
  for (const record of records) {
    for (const { key } of nutrients) result[key] += record.amounts[key];
  }
  return result;
}

export function validAmounts(amounts, max, min = 0) {
  return Boolean(amounts && nutrients.every(({ key }) =>
    Number.isInteger(amounts[key]) && amounts[key] >= min && amounts[key] <= max
  ));
}

export function hasAmount(amounts) {
  return nutrients.some(({ key }) => amounts[key] > 0);
}
