/** 数据目录布局。路径一律 vault 相对、POSIX 分隔符。 */
export const P = {
  settings: "settings.json",
  notebooks: "notebooks",
  notebookDir: (nbId: string) => `notebooks/${nbId}`,
  notebookFile: (nbId: string) => `notebooks/${nbId}/notebook.md`,
  nodeDir: (nbId: string) => `notebooks/${nbId}/nodes`,
  nodeFile: (nbId: string, nodeId: string) => `notebooks/${nbId}/nodes/${nodeId}.md`,
  filesDir: (nbId: string) => `notebooks/${nbId}/files`,
  chatFile: (nbId: string) => `notebooks/${nbId}/chat.jsonl`,
  trashDir: ".trash",
};
