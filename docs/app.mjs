import { apiUrl } from "./config.mjs?v=cos";
import { nutrients, zero, convert, totals, validAmounts, hasAmount, dateKey, validDate, grams } from "./domain.mjs";
import { goalData, goalOperation } from "./targets.mjs";

const $ = id => document.getElementById(id);
const storageKey = "daily-macros-preview";
const sessionKey = "daily-macros-session";
const state = {
  mode: "guest", day: dateKey(), today: dateKey(), ...goalData(null, null), records: [],
  foods: [], directFoods: [], ready: false, busy: false, reading: 0, session: "",
  method: "per100", foodId: null, recordId: null, pendingEntry: null, goalEditor: null
};

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function createFields(container, prefix, required) {
  for (const nutrient of nutrients) {
    const label = element("label", nutrient.label + " ");
    label.append(element("small", "克"));
    const input = element("input");
    Object.assign(input, {
      id: prefix + nutrient.key, type: "number", min: "0",
      step: "0.01", inputMode: "decimal", placeholder: "0", required
    });
    label.append(input);
    $(container).append(label);
  }
}

function readFields(prefix) {
  return Object.fromEntries(nutrients.map(({ key }) => [
    key, Math.round(Number($(prefix + key).value) * 100)
  ]));
}

function setFields(prefix, values) {
  for (const { key } of nutrients) $(prefix + key).value = values ? values[key] / 100 : "";
}

function showStatus(message = "", error = false, target = "status") {
  const node = $(target);
  node.textContent = message;
  node.dataset.error = String(error);
  node.hidden = !message;
}

function shortDate(value) {
  const [, month, day] = value.split("-");
  return Number(month) + " 月 " + Number(day) + " 日";
}

function render() {
  const signedIn = state.mode === "account";
  const active = state.mode !== "guest";
  const editable = state.ready && !state.busy;
  const isToday = state.day === state.today;
  $("login").hidden = signedIn;
  $("login").disabled = state.busy;
  $("logout").hidden = !active;
  $("logout").disabled = state.busy;
  $("logout").textContent = signedIn ? "退出" : "退出试用";
  $("account-label").hidden = !active;
  $("account-label").textContent = signedIn ? "已登录" : "本机试用";
  $("guest").hidden = signedIn;
  $("guest-copy").textContent = active
    ? "试用记录只存在当前浏览器。"
    : "登录后可查看你的私有记录，并在不同设备上继续记。";
  $("preview").hidden = active;
  $("date-actions").hidden = !active;
  $("date-label").textContent = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "long", day: "numeric", weekday: "long"
  }).format(new Date(state.day + "T12:00:00"));
  $("day-title").textContent = isToday ? "今日摄入" : "当日摄入";
  $("day").value = state.day;
  $("day").max = state.today;
  $("day").disabled = state.busy || $("goals-dialog").open;
  $("today").disabled = isToday || state.busy;
  $("close-goals").disabled = state.busy;
  $("goals-button").disabled = !editable;
  $("records-title").textContent = isToday ? "今日记录" : "当日记录";
  $("add").textContent = state.recordId ? "保存修改" : isToday ? "记入今天" : "记入 " + shortDate(state.day);
  $("save-food").textContent = state.foodId ? "更新常用食物" : "存为常用";
  renderSummary();
  renderGoalChoice(isToday);
  if ($("goals-dialog").open) renderGoalManager();
  renderLists();
  updateCalculation();
}

function renderSummary() {
  const consumed = totals(state.records);
  $("summary").replaceChildren(...nutrients.map(({ key, label, fullLabel, color }) => {
    const card = element("article", null, "metric " + color);
    const goal = state.goals?.[key];
    const balance = goal == null ? null : goal - consumed[key];
    const amount = element("strong", balance == null ? "—" : grams(Math.abs(balance)));
    if (balance != null) amount.append(element("small", " 克"));
    if (balance < 0) amount.classList.add("over");
    const used = goal == null ? "目标未设置" : "目标 " + grams(goal) + " 克";
    const details = state.ready
      ? (balance < 0 ? "已超目标 · " : "") + "已记 " + grams(consumed[key]) + " 克"
      : "—";
    const progress = element("progress");
    progress.max = goal || 1;
    progress.value = Math.min(consumed[key], goal || 1);
    progress.hidden = !goal;
    progress.setAttribute("aria-label", fullLabel + "摄入进度");
    card.append(element("h3", label), amount, element("p", details), element("p", used), progress);
    return card;
  }));
}

function summaryLine(amounts) {
  return nutrients.map(({ key, label }) => label + " " + grams(amounts[key]) + " 克").join(" · ");
}

function updateGoalChoice() {
  const select = $("day-goal-choice");
  $("apply-goal").disabled = !state.ready || state.busy || select.value === select.dataset.applied;
}

function renderGoalChoice(isToday) {
  const form = $("day-goal-form");
  form.hidden = !state.ready || (!state.goalProfiles.length && !state.dayGoal);
  if (form.hidden) return;
  $("day-goal-label").textContent = isToday ? "今日目标" : "当日目标";
  const select = $("day-goal-choice");
  const options = [new Option(state.defaultGoals ? "默认目标" : "默认目标（未设置）", ""),
    ...state.goalProfiles.map(profile => new Option(profile.name, profile.id))];
  const active = state.dayGoal;
  let applied = "";
  if (active) {
    const profile = state.goalProfiles.find(item => item.id === active.id);
    if (profile?.name === active.name && nutrients.every(({ key }) => profile.amounts[key] === active.amounts[key])) {
      applied = active.id;
    } else {
      applied = "saved";
      options.splice(1, 0, new Option(active.name + "（当日已保存）", applied));
    }
  }
  select.replaceChildren(...options);
  select.value = select.dataset.applied = applied;
  select.disabled = state.busy;
  updateGoalChoice();
}

function renderGoalManager() {
  const editing = Boolean(state.goalEditor);
  $("goal-overview").hidden = editing;
  $("goals-form").hidden = !editing;
  $("goals-form").inert = state.busy;
  $("edit-default-goal").disabled = state.busy;
  $("delete-default-goal").disabled = state.busy;
  $("delete-default-goal").hidden = !state.defaultGoals;
  $("add-goal-profile").disabled = state.busy;
  $("save-goal").disabled = state.busy;
  $("cancel-goal").disabled = state.busy;
  if (editing) return;
  $("goal-default-summary").textContent = state.defaultGoals ? summaryLine(state.defaultGoals) : "保存后每天自动沿用。";
  $("goal-profiles").replaceChildren(...state.goalProfiles.map(profile => {
    const row = element("div", null, "item");
    const info = element("div", null, "item-main");
    info.append(element("strong", profile.name), element("p", summaryLine(profile.amounts), "muted"));
    row.append(info, itemButton("修改", () => editGoal("goalProfile", profile), "修改方案 " + profile.name),
      itemButton("删除", () => deleteGoalProfile(profile), "删除方案 " + profile.name));
    return row;
  }));
}

function editGoal(type, profile) {
  state.goalEditor = { type, id: type === "goalProfile" ? profile?.id ?? crypto.randomUUID() : null };
  const isDefault = type === "goals";
  $("goal-editor-title").textContent = isDefault ? "编辑默认目标" : profile ? "修改方案" : "新增方案";
  $("goal-name-field").hidden = isDefault;
  $("goal-name").disabled = isDefault;
  $("goal-name").value = profile?.name ?? "";
  setFields("goal-", profile?.amounts ?? state.defaultGoals);
  showStatus("", false, "goal-status");
  renderGoalManager();
  $(isDefault ? "goal-carbs" : "goal-name").focus();
}

function closeGoalEditor() {
  const button = state.goalEditor?.type === "goals" ? "edit-default-goal" : "add-goal-profile";
  state.goalEditor = null;
  renderGoalManager();
  $(button).focus();
}

async function deleteGoalProfile(profile) {
  if (!confirm("删除目标方案「" + profile.name + "」？")) return;
  if (await mutate({ type: "goalProfile", remove: profile.id }, "已删除方案。", "goal-status")) {
    $("add-goal-profile").focus();
  }
}

function itemButton(text, action, label = text) {
  const button = element("button", text, "text-button");
  button.type = "button";
  button.disabled = state.busy;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", action);
  return button;
}

function renderLists() {
  $("record-count").hidden = !state.ready;
  $("record-count").textContent = state.records.length + " 笔";
  $("records").replaceChildren();
  $("favorites").replaceChildren();
  if (!state.ready) {
    const message = state.mode === "guest" ? "登录后可查看。" : "等待加载数据…";
    $("records").append(element("p", message, "muted empty"));
    $("favorites").append(element("p", message, "muted empty"));
    return;
  }
  const favorites = [...state.foods, ...state.directFoods];
  if (!favorites.length) $("favorites").append(element("p", "保存一种食物后，它会出现在这里。", "muted empty"));
  if (!state.records.length) $("records").append(element("p", "这天还没有记录。", "muted empty"));
  for (const food of favorites) {
    const row = element("div", null, "item");
    const pick = element("button", null, "item-main item-pick");
    pick.type = "button";
    pick.disabled = state.busy;
    const method = food.perHundred ? "每 100 克" : "直接摄入";
    pick.append(element("strong", food.name), element("p", method + " · " + summaryLine(food.perHundred ?? food.amounts), "muted"));
    pick.addEventListener("click", () => pickFood(food));
    row.append(pick, itemButton("删除", () => remove("food", food), "删除常用食物 " + food.name + "（" + method + "）"));
    $("favorites").append(row);
  }
  for (const record of [...state.records].reverse()) {
    const row = element("div", null, "item");
    const info = element("div", null, "item-main");
    const name = record.name || "饮食记录";
    info.append(element("strong", name), element("p", summaryLine(record.amounts), "muted"));
    row.append(info, itemButton("修改", () => editRecord(record), "修改 " + name),
      itemButton("删除", () => remove("record", record), "删除 " + name));
    $("records").append(row);
  }
}

function setMethod(method) {
  state.method = method;
  const per100 = method === "per100";
  $("per100").setAttribute("aria-pressed", String(per100));
  $("direct").setAttribute("aria-pressed", String(!per100));
  $("portion-field").hidden = !per100;
  $("portion").required = per100;
  $("portion").disabled = !per100;
  $("amount-legend").textContent = per100 ? "每 100 克含量" : "这次摄入量";
  $("result-label").textContent = per100 ? "换算结果" : "摄入合计";
  for (const { key } of nutrients) $("amount-" + key).max = per100 ? "100" : "10000";
}

function updateCalculation() {
  const input = readFields("amount-");
  const per100 = state.method === "per100";
  const portion = $("portion").valueAsNumber;
  const fieldsValid = nutrients.every(({ key }) => $("amount-" + key).validity.valid);
  const baseValid = fieldsValid && validAmounts(input, per100 ? 10000 : 1000000);
  const actual = baseValid && (!per100 || (Number.isFinite(portion) && $("portion").validity.valid))
    ? (per100 ? convert(input, portion) : input) : null;
  $("calculated").replaceChildren(...nutrients.map(({ key, label }) => {
    const line = element("span", label + " ");
    line.append(element("b", actual ? grams(actual[key]) + " 克" : "—"));
    return line;
  }));
  $("add").disabled = !state.ready || state.busy || !actual || !hasAmount(actual);
  $("save-food").disabled = !state.ready || state.busy || !baseValid || !hasAmount(input) || Boolean(state.recordId);
  $("form-note").textContent = state.recordId ? "保存后会重新计算当日的剩余量。"
    : per100 ? "只想临时算一下，直接看换算结果即可。" : "只填这次摄入的营养素即可。";
  return actual;
}

function clearForm(method = state.method) {
  $("intake-form").reset();
  state.recordId = null;
  state.foodId = null;
  state.pendingEntry = null;
  setMethod(method);
  $("calc-title").textContent = "添加摄入";
  $("calc-help").textContent = method === "per100" ? "按配料表换算实际吃下的营养素。" : "输入这次实际摄入的克数。";
  render();
}

function pickFood(food) {
  const per100 = Boolean(food.perHundred);
  clearForm(per100 ? "per100" : "direct");
  state.foodId = food.id;
  $("food-name").value = food.name;
  setFields("amount-", food.perHundred ?? food.amounts);
  render();
  $(per100 ? "portion" : "add").focus();
}

function editRecord(record) {
  clearForm("direct");
  state.recordId = record.id;
  $("calc-title").textContent = "修改摄入";
  $("food-name").value = record.name;
  setFields("amount-", record.amounts);
  render();
  $("food-name").focus();
}

async function request(path, body, session = state.session) {
  const headers = { Accept: "application/json" };
  if (session) headers.Authorization = "Bearer " + session;
  if (body) headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await fetch(apiUrl + path, { method: body ? "POST" : "GET", headers, body: body && JSON.stringify(body) });
  } catch {
    throw new Error("连接同步服务失败，请检查网络后重试。");
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && session && session === state.session) leave();
  if (!response.ok) throw new Error(data.error || "同步服务暂时不可用，请稍后再试。");
  return data;
}

function localData() {
  return JSON.parse(localStorage.getItem(storageKey) || "null") || { goals: null, foods: [], days: {} };
}

function applyLocal(date, operation) {
  const data = localData();
  let directFoods = data.directFoods ?? [];
  const records = data.days[date] || [];
  let settings = { defaultGoals: data.goals, goalProfiles: data.goalProfiles };
  let dayGoal = data.dayGoals?.[date] ?? null;
  const goal = operation && goalOperation(operation);
  if (goal?.key === "settings") {
    settings = goal.apply(settings);
    data.goals = settings.defaultGoals;
    data.goalProfiles = settings.goalProfiles;
  }
  if (goal?.key === "dayGoal") {
    dayGoal = goal.apply(dayGoal, settings);
    data.dayGoals ??= {};
    if (dayGoal) data.dayGoals[date] = dayGoal;
    else delete data.dayGoals[date];
  }
  if (operation?.type === "record") data.days[date] = changeList(records, operation);
  if (operation?.type === "food") {
    if (operation.remove || operation.value.perHundred) data.foods = changeList(data.foods, operation);
    if (operation.remove || operation.value.amounts) {
      directFoods = data.directFoods = changeList(directFoods, operation);
    }
  }
  if (operation) localStorage.setItem(storageKey, JSON.stringify(data));
  return { ...goalData(settings, dayGoal), records: data.days[date] || [], foods: data.foods, directFoods };
}

function changeList(list, { value, remove }) {
  if (remove) return list.filter(item => item.id !== remove);
  if (list.some(item => item.id === value.id)) return list.map(item => item.id === value.id ? value : item);
  return [...list, value];
}

async function load() {
  if (state.mode === "guest") return;
  const generation = ++state.reading;
  const day = state.day;
  try {
    const data = state.mode === "demo" ? applyLocal(day) : await request("/api/day?date=" + day);
    if (generation !== state.reading) return;
    Object.assign(state, data, { ready: true });
    render();
  } catch (error) {
    if (generation === state.reading || state.mode === "guest") showStatus(error.message, true);
  }
}

async function mutate(operation, message, target = "status") {
  if (!state.ready || state.busy) return false;
  state.busy = true;
  state.reading++;
  $("intake-form").inert = true;
  render();
  showStatus("正在保存…", false, target);
  try {
    const data = state.mode === "demo" ? applyLocal(state.day, operation)
      : await request("/api/change", { date: state.day, ...operation });
    Object.assign(state, data);
    showStatus(message, false, target);
    return true;
  } catch (error) {
    showStatus(error.message, true, state.mode === "guest" ? "status" : target);
    return false;
  } finally {
    state.busy = false;
    $("intake-form").inert = false;
    render();
  }
}

function remove(type, entry) {
  if (!confirm("删除「" + (entry.name || "这条摄入记录") + "」？")) return;
  void (async () => {
    if (!await mutate({ type, remove: entry.id }, "已删除。")) return;
    if (state.recordId === entry.id || state.foodId === entry.id) clearForm();
  })();
}

function chooseDay(day) {
  if (!validDate(day) || day > state.today || state.busy || day === state.day) return;
  Object.assign(state, { day, ready: false, dayGoal: null, goals: null, records: [] });
  clearForm();
  showStatus();
  void load();
}

function leave() {
  try {
    if (state.session && localStorage.getItem(sessionKey) === state.session) localStorage.removeItem(sessionKey);
  } catch { /* in-memory state is also cleared */ }
  try { sessionStorage.removeItem(sessionKey); } catch { /* in-memory state is also cleared */ }
  Object.assign(state, {
    mode: "guest", ready: false, session: "", day: dateKey(),
    today: dateKey(), ...goalData(null, null), records: [], foods: [], directFoods: [], reading: state.reading + 1
  });
  $("goals-dialog").close();
  clearForm("per100");
  showStatus();
}

function openLogin() {
  if (!apiUrl) {
    showStatus("云同步尚未配置。你可以先在本机试用。", true);
    return;
  }
  $("login-form").reset();
  showStatus("", false, "login-status");
  $("login-dialog").showModal();
}

async function loadAccount(session) {
  Object.assign(state, { mode: "account", session, ready: false, ...goalData(null, null), records: [], foods: [], directFoods: [] });
  clearForm("per100");
  showStatus();
  await load();
}

async function signIn(event) {
  event.preventDefault();
  const submit = $("submit-login");
  if (submit.disabled) return;
  submit.disabled = $("close-login").disabled = true;
  const passphraseField = $("passphrase");
  passphraseField.readOnly = true;
  showStatus("正在登录…", false, "login-status");
  try {
    const { session } = await request("/auth/login", { passphrase: passphraseField.value }, "");
    if (typeof session !== "string" || !session) throw new Error("登录服务响应异常，请稍后再试。");
    try { localStorage.setItem(sessionKey, session); } catch {
      try { sessionStorage.setItem(sessionKey, session); } catch { /* the current tab can still use the session */ }
    }
    $("login-form").reset();
    $("login-dialog").close();
    await loadAccount(session);
  } catch (error) {
    showStatus(error.message, true, "login-status");
  } finally {
    submit.disabled = $("close-login").disabled = false;
    passphraseField.readOnly = false;
  }
}

function restoreSession() {
  if (!apiUrl) return;
  let session;
  try { session = localStorage.getItem(sessionKey); } catch { /* fall back to tab storage */ }
  if (!session) {
    try { session = sessionStorage.getItem(sessionKey); } catch { /* the current tab can still log in */ }
  }
  if (session) void loadAccount(session);
}

createFields("intake-fields", "amount-", false);
createFields("goal-fields", "goal-", true);
for (const { key } of nutrients) $("goal-" + key).max = "10000";
setMethod("per100");
$("login").addEventListener("click", openLogin);
$("login-form").addEventListener("submit", signIn);
$("close-login").addEventListener("click", () => $("login-dialog").close());
$("login-dialog").addEventListener("cancel", event => {
  if ($("submit-login").disabled) event.preventDefault();
});
$("logout").addEventListener("click", leave);
$("preview").addEventListener("click", () => {
  state.mode = "demo";
  showStatus();
  render();
  void load();
});
$("today").addEventListener("click", () => chooseDay(state.today));
$("day").addEventListener("change", event => chooseDay(event.target.value));
$("per100").addEventListener("click", () => {
  if (!state.busy && state.method !== "per100") clearForm("per100");
});
$("direct").addEventListener("click", () => {
  if (!state.busy && state.method !== "direct") clearForm("direct");
});
$("reset-food").addEventListener("click", () => { if (!state.busy) clearForm(); });
$("intake-form").addEventListener("input", updateCalculation);
$("intake-form").addEventListener("submit", async event => {
  event.preventDefault();
  const amounts = updateCalculation();
  if (!amounts || !hasAmount(amounts)) return;
  const name = $("food-name").value.trim();
  const fingerprint = JSON.stringify({ name, amounts });
  if (state.pendingEntry?.fingerprint !== fingerprint) {
    state.pendingEntry = { fingerprint, id: state.recordId || crypto.randomUUID() };
  }
  const value = { id: state.pendingEntry.id, name, amounts };
  const message = state.recordId ? "已修改摄入记录。" : "已记入 " + shortDate(state.day) + "。";
  if (await mutate({ type: "record", value }, message)) clearForm();
});
$("save-food").addEventListener("click", async () => {
  const name = $("food-name").value.trim();
  if (!name) {
    $("food-name").setCustomValidity("请输入常用食物的名称。");
    $("food-name").reportValidity();
    $("food-name").setCustomValidity("");
    return;
  }
  const per100 = state.method === "per100";
  const favorites = per100 ? state.foods : state.directFoods;
  const amountsKey = per100 ? "perHundred" : "amounts";
  const existing = favorites.find(food => food.name === name);
  const id = existing?.id || state.foodId || crypto.randomUUID();
  state.foodId = id;
  if (await mutate({ type: "food", value: { id, name, [amountsKey]: readFields("amount-") } }, "已保存常用食物。")) {
    state.foodId = id;
    render();
  }
});
$("goals-button").addEventListener("click", () => {
  state.goalEditor = null;
  showStatus("", false, "goal-status");
  renderGoalManager();
  $("goals-dialog").showModal();
});
$("edit-default-goal").addEventListener("click", () => editGoal("goals"));
$("delete-default-goal").addEventListener("click", async () => {
  if (confirm("删除默认目标？") &&
      await mutate({ type: "goals", amounts: null }, "已删除默认目标。", "goal-status")) {
    $("edit-default-goal").focus();
  }
});
$("add-goal-profile").addEventListener("click", () => editGoal("goalProfile"));
$("cancel-goal").addEventListener("click", () => {
  showStatus("", false, "goal-status");
  closeGoalEditor();
});
$("close-goals").addEventListener("click", () => $("goals-dialog").close());
$("goals-dialog").addEventListener("cancel", event => { if (state.busy) event.preventDefault(); });
$("goals-dialog").addEventListener("close", render);
$("goals-form").addEventListener("submit", async event => {
  event.preventDefault();
  const editor = state.goalEditor;
  if (!editor) return;
  const amounts = readFields("goal-");
  const isDefault = editor.type === "goals";
  const operation = isDefault ? { type: "goals", amounts }
    : { type: "goalProfile", value: { id: editor.id, name: $("goal-name").value, amounts } };
  if (await mutate(operation, isDefault ? "已保存默认目标。" : "已保存目标方案。", "goal-status")) {
    closeGoalEditor();
  }
});
$("day-goal-choice").addEventListener("change", updateGoalChoice);
$("day-goal-form").addEventListener("submit", async event => {
  event.preventDefault();
  const profileId = $("day-goal-choice").value;
  if (profileId === "saved" || $("apply-goal").disabled) return;
  await mutate({ type: "dayGoal", profileId: profileId || null }, profileId ? "已应用到当日。" : "当日已改用默认目标。");
});

function refreshDay() {
  const today = dateKey();
  if (state.busy) return;
  if (state.today !== today) {
    const viewingToday = state.day === state.today;
    state.today = today;
    if (viewingToday) {
      chooseDay(today);
      return;
    }
  }
  render();
  if (state.mode !== "guest") void load();
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshDay();
});
setInterval(() => { if (dateKey() !== state.today) refreshDay(); }, 15000);
render();
void restoreSession();
