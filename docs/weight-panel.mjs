import { validDate } from "./domain.mjs";
import { validWeight, weightDates, weightHistory } from "./weight.mjs";

const kg = grams => (grams / 1000).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const shortDate = date => date.slice(5).replace("-", "/");

function drawTrend(canvas, dates, entries) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height || !entries.length) return;
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d");
  if (!context) return;
  context.scale(canvas.width / width, canvas.height / height);
  const left = 44, right = width - 16, top = 28, bottom = height - 31;
  const values = entries.map(entry => entry.grams / 1000);
  const low = Math.min(...values), high = Math.max(...values);
  const targetStep = Math.max(0.1, (high - low) / 3);
  const magnitude = 10 ** Math.floor(Math.log10(targetStep));
  const step = ([1, 2, 5, 10].find(value => value * magnitude >= targetStep)) * magnitude;
  const start = Math.max(0, Math.floor((low - step / 2) / step) * step);
  const end = Math.ceil((high + step / 2) / step) * step;
  const x = index => left + (right - left) * index / Math.max(1, dates.length - 1);
  const y = value => bottom - (bottom - top) * (value - start) / (end - start);
  context.font = "12px system-ui, sans-serif";
  context.fillStyle = "#585e50";
  context.fillText("kg", 0, 14);
  context.textAlign = "right";
  context.textBaseline = "middle";
  context.strokeStyle = "#e6e6da";
  for (let index = 0; index <= Math.round((end - start) / step); index++) {
    const value = start + index * step;
    context.fillText(kg(value * 1000), left - 7, y(value));
    context.beginPath();
    context.moveTo(left, y(value));
    context.lineTo(right, y(value));
    context.stroke();
  }
  const last = dates.length - 1;
  for (const index of new Set([0, Math.floor(last / 2), last])) {
    context.textAlign = index === 0 ? "left" : index === last ? "right" : "center";
    context.fillText(shortDate(dates[index]), x(index), bottom + 17);
  }
  const points = entries.map(entry => [x(dates.indexOf(entry.date)), y(entry.grams / 1000)]);
  context.strokeStyle = context.fillStyle = "#3b6145";
  context.lineWidth = 2.5;
  context.lineJoin = "round";
  context.beginPath();
  points.forEach(([px, py], index) => index ? context.lineTo(px, py) : context.moveTo(px, py));
  context.stroke();
  for (const [px, py] of points) {
    context.beginPath();
    context.arc(px, py, 3.5, 0, Math.PI * 2);
    context.fill();
  }
}

export function createWeightPanel({ request, localData, saveLocal, showStatus }) {
  const $ = id => document.getElementById(id);
  const date = $("weight-date");
  const amount = $("weight-amount");
  const canvas = $("weight-chart");
  let mode = "guest", today = "", day = "", active = false;
  let entries = [], period = 7, sequence = 0, busy = false, ready = false;

  function trend() {
    const dates = weightDates(day, period);
    const points = entries.filter(item => item.date >= dates[0] && item.date <= day);
    return { dates, points };
  }

  function render() {
    if (!active) return;
    date.max = today;
    date.value = day;
    date.disabled = mode === "guest" || busy;
    amount.disabled = !ready || busy;
    $("weight-save").disabled = amount.disabled || !amount.validity.valid;
    $("weight-today").hidden = day === today || mode === "guest";
    $("weight-today").disabled = busy;
    for (const toggle of $("weight-period").querySelectorAll("button")) {
      toggle.setAttribute("aria-pressed", String(Number(toggle.dataset.days) === period));
    }

    const { dates, points } = trend();
    const last = points.at(-1);
    const difference = last ? last.grams - points[0].grams : 0;
    const range = `${shortDate(dates[0])} – ${shortDate(day)}`;
    const delta = points.length > 1 ? ` · 变化 ${difference > 0 ? "+" : ""}${kg(difference)} kg` : "";
    $("weight-summary").textContent = last ? `${range} · 最近 ${kg(last.grams)} kg${delta}` : range;
    canvas.setAttribute("aria-label", `${period} 日体重趋势，${points.length} 条记录${delta}`);
    $("weight-chart-wrap").hidden = !points.length;
    $("weight-empty").hidden = Boolean(points.length);
    $("weight-empty").textContent = mode === "guest" ? "登录或在本机试用后，可以记录体重。"
      : busy ? "加载中…" : ready ? "这段时间还没有体重记录。" : "体重记录暂未加载。";
    $("weight-list").replaceChildren(...points.slice().reverse().map(entry => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      const value = document.createElement("strong");
      button.type = "button";
      button.className = "text-button";
      button.disabled = busy;
      value.textContent = `${kg(entry.grams)} kg`;
      button.append(entry.date, value);
      button.addEventListener("click", () => choose(entry.date));
      item.append(button);
      return item;
    }));
    drawTrend(canvas, dates, points);
  }

  async function load(grams) {
    const id = ++sequence;
    const writing = grams !== undefined;
    busy = true;
    render();
    showStatus(writing ? "正在保存…" : "", false, "weight-status");
    try {
      let result;
      if (mode === "demo") {
        const data = localData();
        const weights = data.weights ?? {};
        if (writing) {
          weights[day] = grams;
          saveLocal({ ...data, weights });
        }
        result = { entries: weightHistory(weights, weightDates(day)) };
      } else {
        result = writing ? await request("/api/weight", { date: day, grams }) : await request(`/api/weight?date=${day}`);
      }
      if (id !== sequence) return;
      entries = result.entries;
      ready = true;
      const saved = entries.find(item => item.date === day);
      amount.value = saved ? String(saved.grams / 1000) : "";
      if (writing) showStatus("已保存体重。", false, "weight-status");
    } catch (error) {
      if (id === sequence) showStatus(error.message, true, "weight-status");
    } finally {
      if (id === sequence) {
        busy = false;
        render();
      }
    }
  }

  function choose(value) {
    if (busy || !validDate(value) || value > today || value === day) {
      date.value = day;
      return;
    }
    day = value;
    ready = false;
    amount.value = "";
    entries = [];
    void load();
  }

  date.addEventListener("change", () => choose(date.value));
  $("weight-today").addEventListener("click", () => choose(today));
  amount.addEventListener("input", () => { $("weight-save").disabled = !amount.validity.valid; });
  $("weight-form").addEventListener("submit", event => {
    event.preventDefault();
    const grams = Math.round(amount.valueAsNumber * 1000);
    if (ready && !busy && validWeight(grams) && amount.validity.valid) void load(grams);
  });
  $("weight-period").addEventListener("click", event => {
    const days = Number(event.target.dataset.days);
    if (days !== 7 && days !== 30) return;
    period = days;
    render();
  });
  new ResizeObserver(() => {
    if (!active) return;
    const { dates, points } = trend();
    drawTrend(canvas, dates, points);
  }).observe($("weight-chart-wrap"));

  return {
    sync(next) {
      const opened = next.active && !active;
      const reset = next.mode !== mode;
      const midnight = today !== next.today && day === today;
      active = next.active;
      mode = next.mode;
      today = next.today;
      if (reset || midnight) {
        day = today;
        sequence++;
        ready = busy = false;
        entries = [];
        amount.value = "";
        showStatus("", false, "weight-status");
      }
      if (active && mode !== "guest" && !busy && (opened || reset || midnight)) void load();
      else render();
    }
  };
}
