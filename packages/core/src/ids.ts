/**
 * 稳定标识：节点 ID 一旦生成就不再随位置变化（D-012 硬约定）。
 * 不使用序号派生，避免删除节点后整体漂移。
 */
export function newId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "")
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}_${rand.slice(0, 12)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
