import { validAmounts } from "./domain.mjs";

export const entryIdPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const maxGoal = 1000000;

export class GoalError extends Error {}

function settingsFrom(value) {
  if (validAmounts(value, maxGoal)) return { defaultGoals: value, goalProfiles: [] };
  return { defaultGoals: value?.defaultGoals ?? null, goalProfiles: value?.goalProfiles ?? [] };
}

export function goalData(settings, dayGoal) {
  const current = settingsFrom(settings);
  return { ...current, dayGoal, goals: dayGoal?.amounts ?? current.defaultGoals };
}

export function goalOperation(body) {
  if (body.type === "goals") {
    if (body.amounts !== null && !validAmounts(body.amounts, maxGoal)) throw new GoalError("请检查目标克数。");
    return { key: "settings", apply: settings => ({ ...settingsFrom(settings), defaultGoals: body.amounts }) };
  }

  if (body.type === "dayGoal") {
    const { profileId } = body;
    if (profileId !== null && (typeof profileId !== "string" || !entryIdPattern.test(profileId))) {
      throw new GoalError("请选择有效的目标方案。");
    }
    return {
      key: "dayGoal",
      apply(_, settings) {
        if (profileId === null) return null;
        const profile = settingsFrom(settings).goalProfiles.find(item => item.id === profileId);
        if (!profile) throw new GoalError("该方案已删除，请刷新后重新选择。");
        return profile;
      }
    };
  }

  if (body.type !== "goalProfile") return null;
  if (typeof body.remove === "string" && entryIdPattern.test(body.remove)) {
    return {
      key: "settings",
      apply(settings) {
        const current = settingsFrom(settings);
        return { ...current, goalProfiles: current.goalProfiles.filter(item => item.id !== body.remove) };
      }
    };
  }

  const item = body.value;
  const name = typeof item?.name === "string" ? item.name.trim() : "";
  if (!name || name.length > 40 || typeof item.id !== "string" || !entryIdPattern.test(item.id) ||
      !validAmounts(item.amounts, maxGoal)) {
    throw new GoalError("请输入方案名称，并检查目标克数。");
  }
  const profile = { id: item.id, name, amounts: item.amounts };
  return {
    key: "settings",
    apply(settings) {
      const current = settingsFrom(settings);
      const list = current.goalProfiles;
      if (list.some(item => item.name === name && item.id !== profile.id)) {
        throw new GoalError("已有同名方案，请换一个名称。");
      }
      if (list.some(item => item.id === profile.id)) {
        return { ...current, goalProfiles: list.map(item => item.id === profile.id ? profile : item) };
      }
      if (list.length >= 20) throw new GoalError("最多保存 20 套目标方案。");
      return { ...current, goalProfiles: [...list, profile] };
    }
  };
}
