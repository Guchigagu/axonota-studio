/**
 * 数据层自检：不依赖 Tauri，用内存实现跑一遍核心约定。
 * 运行：node scripts/selftest.mjs（由 esbuild 打包，见 package.json）
 */
import { Vault } from "../packages/core/src/vault";
import type { DirEntry, VaultFs } from "../packages/core/src/fs";

class MemoryFs implements VaultFs {
  files = new Map<string, string>();
  dirs = new Set<string>();

  async readText(path: string): Promise<string> {
    const v = this.files.get(path);
    if (v === undefined) throw new Error(`missing ${path}`);
    return v;
  }
  async writeText(path: string, data: string): Promise<void> {
    this.files.set(path, data);
  }
  async readBinary(): Promise<Uint8Array> {
    return new Uint8Array();
  }
  async writeBinary(path: string, data: Uint8Array): Promise<void> {
    this.files.set(path, `bin:${data.length}`);
  }
  async list(path: string): Promise<DirEntry[]> {
    const prefix = path ? `${path}/` : "";
    const names = new Set<string>();
    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const name = rest.split("/")[0];
      if (name) names.add(name);
    }
    return [...names].map((name) => ({ name, isDir: this.dirs.has(`${prefix}${name}`), size: 0, mtime: 0 }));
  }
  async mkdir(path: string): Promise<void> {
    this.dirs.add(path);
  }
  async remove(path: string): Promise<void> {
    for (const key of [...this.files.keys()]) if (key === path || key.startsWith(`${path}/`)) this.files.delete(key);
    for (const key of [...this.dirs]) if (key === path || key.startsWith(`${path}/`)) this.dirs.delete(key);
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path);
  }
  async rename(from: string, to: string): Promise<void> {
    const v = this.files.get(from);
    if (v !== undefined) {
      this.files.set(to, v);
      this.files.delete(from);
    }
  }
  async resolve(path: string): Promise<string> {
    return `mem://${path}`;
  }
}

const checks: Array<[string, boolean]> = [];
const check = (name: string, ok: boolean) => checks.push([name, ok]);

const fs = new MemoryFs();
const vault = new Vault(fs);
await vault.init();

const draft = {
  type: "outline" as const,
  assumption: "按三周可交付收敛",
  scope_one_line: "能独立搭起并交付一个 React 项目",
  chapters: [
    {
      id: "01",
      title: "工程化起步",
      goal: "能跑起带热更新的项目",
      sections: [
        { id: "1.1", title: "工具链与骨架", goal: "三分钟建出可运行项目" },
        { id: "1.2", title: "组件与 JSX", goal: "把静态 HTML 改造成组件" },
      ],
    },
    { id: "02", title: "状态与数据", goal: "能判断该把状态放在哪", sections: [{ id: "2.1", title: "本地状态", goal: "写出受控表单" }] },
  ],
};

const nb = await vault.createNotebookFromOutline({ topic: "React", draft, style: "feynman", webSearch: true });
check("建立笔记本", nb.nodes.length === 1 + 2 + 3);
check("根节点唯一", nb.nodes.filter((n) => n.kind === "root").length === 1);
const ids = new Set(nb.nodes.map((n) => n.id));
check("节点 ID 唯一", ids.size === nb.nodes.length);
check("ID 不派生自序号", !nb.nodes.some((n) => /^\d/.test(n.id)));

const loaded = await vault.loadNotebook(nb.id);
check("回归读写：节点数一致", loaded?.nodes.length === nb.nodes.length);
check("回归读写：保持顺序", loaded?.nodes.filter((n) => n.kind === "chapter").map((n) => n.title).join(",") === "工程化起步,状态与数据");

const chapter = nb.nodes.find((n) => n.kind === "chapter")!;
const section = nb.nodes.find((n) => n.kind === "section")!;

await vault.renameNode(nb.id, chapter.id, "工程化基础");
const afterRename = await vault.loadNotebook(nb.id);
check("改名后 ID 不变", afterRename?.nodes.find((n) => n.id === chapter.id)?.title === "工程化基础");

await vault.putNodeBody(nb.id, section.id, "## 这一节\n\n正文内容");
check("正文可写读", (await vault.getNodeBody(nb.id, section.id)).includes("正文内容"));

const att = await vault.saveAttachment(nb.id, { name: "handbook.txt", bytes: new TextEncoder().encode("hello") }, true);
await vault.attachToNode(nb.id, chapter.id, att);
const attLocal = await vault.saveAttachment(nb.id, { name: "local-only.txt", bytes: new Uint8Array([1, 2]) }, false);
await vault.attachToNode(nb.id, chapter.id, attLocal);

const fresh = (await vault.loadNotebook(nb.id))!;
const inherited = vault.collectAttachments(fresh, section.id);
check("继承开关：继承的附件下发", inherited.some((a) => a.name === "handbook.txt"));
check("继承开关：仅本层不下发", !inherited.some((a) => a.name === "local-only.txt"));

const doomedChapter = fresh.nodes.find((n) => n.title === "状态与数据")!;
await vault.removeNode(nb.id, doomedChapter.id);
const afterDelete = (await vault.loadNotebook(nb.id))!;
check("删除节点连带子树", afterDelete.nodes.filter((n) => n.parentId === doomedChapter.id).length === 0);
check("删除后剩余节点 ID 未漂移", afterDelete.nodes.filter((n) => n.kind === "section").every((n) => ids.has(n.id)));

await vault.updateNode(nb.id, section.id, { status: "done" });
check("状态写回", (await vault.loadNotebook(nb.id))?.nodes.find((n) => n.id === section.id)?.status === "done");

await vault.addModel({ id: "m1", name: "本地模型", baseUrl: "http://localhost:1234/v1", apiKey: "k", modelId: "x", createdAt: "2026-10-30" }, true);
const settings = await vault.getSettings();
check("模型配置落盘", settings.models.length === 1 && settings.defaultModelId === "m1");

let failed = 0;
for (const [name, ok] of checks) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
}
console.log(`\n${checks.length - failed}/${checks.length} 通过`);
process.exit(failed ? 1 : 0);
