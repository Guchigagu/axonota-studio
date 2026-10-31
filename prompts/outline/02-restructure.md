---
id: outline-restructure
title: AI 重构结构
call: 侧边栏「用 AI 重构结构」（整本／单章）
stream: false
temperature: 0.4
output: json
---

# AI 重构结构

## 何时触发
用户在 AI 侧边栏说"调整整本结构／调整这一章结构"，或自由描述（"第 2 章太散了，合并成三节"）。

## 变量

| 变量 | 含义 | 来源 |
|---|---|---|
| `{{scope}}` | `book` 或 `chapter` | 用户选择 |
| `{{structure_json}}` | 当前结构树（含 id、title、goal、状态） | 程序 |
| `{{instruction}}` | 用户的重构要求原文 | 用户输入 |
| `{{locked_ids}}` | 用户已生成正文、不允许移动的节点 id 列表 | 程序 |

## 系统提示词

```text
你的任务是修改目录结构，不改写正文。输出的是结构补丁，不是新目录全文。

硬规则：
1. 节点 id 必须稳定：已有节点一律沿用原 id；不得因为顺序变化而重新编号（前车之鉴：按序号生成目录名导致删节点后整体漂移）。
2. 已生成正文的节点（见 locked_ids）只能改名，不能删除、不能移动层级；改名时在输出里标注 renamed_with_content，让界面提示"标题已改，正文未改"。
3. 只输出必要的操作；未被提到的节点不要出现在补丁里。
4. 新增节点的 id 用父节点 id + 序号（如 02 下新增 → 2.6），不得与现有 id 冲突。
5. 用户要求与文档结构原则冲突时（例如把 5 节塞进一章、或让后章依赖前章未教的内容），先执行用户要求，再用 one_line_warning 指出代价。
6. 不生成正文、不写小节内容。
```

## 用户消息模板

```text
重构范围：{{scope}}
用户要求：{{instruction}}
不可移动节点：{{locked_ids}}
当前结构：
{{structure_json}}

请输出结构补丁 JSON。
```

## 输出 Schema

```json
{
  "type": "structure_patch",
  "ops": [
    { "op": "rename", "id": "2.3", "title": "用状态驱动界面" },
    { "op": "add", "parentId": "02", "id": "2.6", "title": "错误处理与边界", "goal": "能处理请求失败与空数据" },
    { "op": "move", "id": "1.3", "parentId": "02", "afterId": "2.2" },
    { "op": "remove", "id": "3.4" }
  ],
  "renamed_with_content": ["2.3"],
  "one_line_warning": "把 1.3 移进第 2 章后，第 1 章会只剩 2 节，前两章长度不对等。",
  "sources": []
}
```

`op` 只能是 `add` / `rename` / `move` / `remove`；`move` 必须同时给 `parentId` 与 `afterId`（同级重排用 `afterId`，跨层移动用 `parentId`）。

## 失败处理
- 补丁里出现删除 locked 节点 → 整条补丁作废，返回 `{"type":"structure_patch","ops":[],"rejected":"不能删除已生成正文的节点"}`。
- id 冲突 → 自动改为新 id 并写进 `one_line_warning`。

## 禁止
- 不返回完整目录树（避免与现有树整树覆盖、丢失状态）。
- 不在补丁里改变节点顺序以外的正文内容。
