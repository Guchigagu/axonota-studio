/** 文件系统端口：core 只依赖这个接口，桌面端用 Tauri 实现，浏览器调试用内存实现。 */
export interface DirEntry {
  name: string;
  isDir: boolean;
  size: number;
  mtime: number;
}

export interface VaultFs {
  readText(path: string): Promise<string>;
  writeText(path: string, data: string): Promise<void>;
  readBinary(path: string): Promise<Uint8Array>;
  writeBinary(path: string, data: Uint8Array): Promise<void>;
  list(path: string): Promise<DirEntry[]>;
  mkdir(path: string): Promise<void>;
  /** 桌面端实现应放进系统回收站，而不是永久删除（D-020） */
  remove(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  rename(from: string, to: string): Promise<void>;
  /** 返回可展示的绝对路径（用于「打开回收站」「在文件夹中显示」） */
  resolve(path: string): Promise<string>;
}
