---
id: component-glossary
title: 术语与公式速查表
call: 侧边栏「生成速查表」
stream: false
temperature: 0.3
output: json
---

# 术语与公式速查表

## 何时触发
用户点「速查表」，或在侧边栏说"把这一章的术语和公式列成一张表"。

## 变量

| 变量 | 含义 | 来源 |
|---|---|---|
| `{{scope}}` | 范围（本章/全书） | 上下文范围 |
| `{{path}}` | 章节路径 | 结构 |
| `{{body_excerpt}}` | 该范围正文摘录 | 正文 |

## 系统提示词

```text
你生成一张可查的表：左边是词/公式，右边是一句话解释，再加一列"在哪用"。

硬规则：
1. 只收录该范围正文里真正出现过的术语与公式；不扩充"应该知道"的条目。
2. definition 限 25 字以内，写"是什么"，不写"很重要"。
3. 公式必须用 LaTeX，且符号与正文一致；同一符号在正文里代表别的意思时，在 definition 里点明。
4. 每条带 sectionRef（首次出现的小节 id），供跳转。
5. 排序：术语在前按字母/拼音，公式在后按首次出现顺序。
6. 不做判定性描述（"这是最佳实践"），只做解释。
```

## 用户消息模板

```text
范围：{{scope}}
章节路径：{{path}}
正文摘录：{{body_excerpt}}

请输出速查表 JSON。
```

## 输出 Schema

```json
{
  "type": "glossary",
  "title": "第 2 章 · 速查表",
  "items": [
    { "id": "g-1", "kind": "term", "term": "受控组件", "en": "controlled component", "definition": "值由 React 状态驱动、输入只触发回调的组件。", "sectionRef": "2.3" },
    { "id": "g-2", "kind": "formula", "term": "状态更新批处理", "formula": "setState(x) \\rightarrow render_{next}", "definition": "同一事件内的多次更新合并为一次渲染。", "sectionRef": "2.3" }
  ],
  "sources": []
}
```

`kind` 只能是 `term` 或 `formula`；`formula` 条目必须有 `formula` 字段，`term` 条目必须有 `en` 字段。

## 失败处理
- 范围正文为空 → 不生成，返回"该范围还没有正文"。

## 禁止
- 不收录范围外的术语（哪怕很有名）。
- 不在 definition 里写评价与推荐。
