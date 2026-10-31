import type { DirEntry, VaultFs } from "@nb/core";
import { invoke } from "@tauri-apps/api/core";

/** 桌面端实现：所有磁盘操作都在 Rust 侧完成，前端只拿到字符串。 */
export class TauriFs implements VaultFs {
  async readText(path: string): Promise<string> {
    return invoke<string>("fs_read_text", { path });
  }
  async writeText(path: string, data: string): Promise<void> {
    await invoke("fs_write_text", { path, data });
  }
  async readBinary(path: string): Promise<Uint8Array> {
    const data = await invoke<number[]>("fs_read_binary", { path });
    return new Uint8Array(data);
  }
  async writeBinary(path: string, data: Uint8Array): Promise<void> {
    await invoke("fs_write_binary", { path, data: Array.from(data) });
  }
  async list(path: string): Promise<DirEntry[]> {
    return invoke<DirEntry[]>("fs_list", { path });
  }
  async mkdir(path: string): Promise<void> {
    await invoke("fs_mkdir", { path });
  }
  async remove(path: string): Promise<void> {
    await invoke("fs_trash", { path });
  }
  async exists(path: string): Promise<boolean> {
    return invoke<boolean>("fs_exists", { path });
  }
  async rename(from: string, to: string): Promise<void> {
    await invoke("fs_rename", { from, to });
  }
  async resolve(path: string): Promise<string> {
    return invoke<string>("fs_resolve", { path });
  }
}

/** 浏览器调试实现：数据落在 localStorage，第一次运行注入示例笔记本。 */
export class LocalFs implements VaultFs {
  private prefix = "nb.vault:";

  private key(path: string) {
    return this.prefix + path.replace(/^\/+/, "");
  }

  private allKeys(): string[] {
    const out: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(this.prefix)) out.push(k.slice(this.prefix.length));
    }
    return out;
  }

  async readText(path: string): Promise<string> {
    const v = localStorage.getItem(this.key(path));
    if (v === null) throw new Error(`文件不存在：${path}`);
    return v;
  }
  async writeText(path: string, data: string): Promise<void> {
    localStorage.setItem(this.key(path), data);
  }
  async readBinary(path: string): Promise<Uint8Array> {
    const v = localStorage.getItem(this.key(path)) ?? "";
    return new TextEncoder().encode(atob(v));
  }
  async writeBinary(path: string, data: Uint8Array): Promise<void> {
    localStorage.setItem(this.key(path), btoa(String.fromCharCode(...data)));
  }
  async list(path: string): Promise<DirEntry[]> {
    const dir = path.replace(/^\/+|\/+$/g, "");
    const names = new Set<string>();
    for (const key of this.allKeys()) {
      if (!key.startsWith(`${dir}/`)) continue;
      const rest = key.slice(dir.length + 1);
      const name = rest.split("/")[0];
      if (name) names.add(name);
    }
    return [...names].map((name) => ({
      name,
      isDir: keyIsDir(name, dir),
      size: 0,
      mtime: 0,
    }));
  }
  private dirSet() {
    const set = new Set<string>();
    for (const key of this.allKeys()) {
      const parts = key.split("/");
      for (let i = 1; i < parts.length; i++) set.add(parts.slice(0, i).join("/"));
    }
    return set;
  }
  async mkdir(path: string): Promise<void> {
    localStorage.setItem(this.key(`${path}/.keep`), "");
  }
  async remove(path: string): Promise<void> {
    for (const key of this.allKeys()) {
      if (key === path || key.startsWith(`${path}/`)) localStorage.removeItem(this.key(key));
    }
  }
  async exists(path: string): Promise<boolean> {
    return localStorage.getItem(this.key(path)) !== null || this.dirSet().has(path.replace(/\/+$/, ""));
  }
  async rename(from: string, to: string): Promise<void> {
    localStorage.setItem(this.key(to), localStorage.getItem(this.key(from)) ?? "");
    await this.remove(from);
  }
  async resolve(path: string): Promise<string> {
    return `localStorage://${path}`;
  }
}

function keyIsDir(name: string, dir: string): boolean {
  const target = `${dir}/${name}`;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(`${TEST_PREFIX}${target}/`)) return true;
  }
  return false;
}

const TEST_PREFIX = "nb.vault:";
