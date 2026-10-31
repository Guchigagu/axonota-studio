import { Vault, createPromptLibrary, type FetchLike } from "@nb/core";
import { TauriFs, LocalFs } from "./fs";
import { promptFiles } from "./prompts";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { invoke } from "@tauri-apps/api/core";

export const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** 外部链接统一走系统默认浏览器；网页版退化为新窗口打开 */
export function openExternal(url: string) {
  if (isDesktop) {
    void invoke("open_external", { url });
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/** 把导出的归档写到「文档/Axonota Exports」，返回落盘路径 */
export async function saveExportFile(name: string, bytes: Uint8Array): Promise<string> {
  if (!isDesktop) {
    const buf = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buf).set(bytes);
    const blob = new Blob([buf], { type: "application/zip" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return name;
  }
  return invoke<string>("save_archive", { name, data: Array.from(bytes) });
}

/** 用系统默认程序打开 vault 内的文件 */
export function openVaultFile(relPath: string) {
  if (isDesktop) void invoke("open_local_file", { path: relPath });
}

/** 打开系统回收站（删除笔记本后的恢复入口） */
export function openRecycleBin() {
  if (isDesktop) void invoke("open_recycle_bin");
}

/** 在资源管理器中定位导出的文件 */
export function revealPath(path: string) {
  if (isDesktop) void invoke("reveal_path", { path });
}

export const lib = createPromptLibrary(promptFiles);

export const fetchFn: FetchLike = isDesktop
  ? (input, init) => tauriFetch(input, init as never)
  : (input, init) => fetch(input, init);

let vault: Vault | null = null;

export function getVault(): Vault {
  if (!vault) {
    vault = new Vault(isDesktop ? new TauriFs() : new LocalFs());
  }
  return vault;
}
