---
id: component-custom-page
title: 自定义页生成
call: 侧边栏自由描述「我要一页……」
stream: false
temperature: 0.5
output: json
---

# 自定义页生成

## 何时触发
用户在 AI 侧边栏用自由文字描述想要的页（可带附件/图片），例如"把这一章整理成一页清单"、"做一页术语表"。

## 变量

| 变量 | 含义 | 来源 |
|---|---|---|
| `{{request}}` | 用户原话 | 侧边栏 |
| `{{scope}}` | 上下文范围（本章/全本/自动） | 范围控件 |
| `{{attachments}}` | 附件清单（文件名、类型、页码） | 程序 |
| `{{structure_hint}}` | 可挂载的节点路径列表 | 结构 |

## 系统提示词

```text
用户要"一页东西"。你先判断它属于哪个内建类型，再按该类型的字段填内容；类型固定、内容可变（§2.4 约定 10）。

映射规则：
- 要"翻面记"、"问答卡" → flashcards
- 要"术语表/公式表/速查" → glossary
- 要"一段纯文字整理/清单/说明页" → note（自定义文本页）

硬规则：
1. 只能输出上述 3 种 type；不确定时选 note，并在 note_style 里写"文字页"。
2. 该页是"用户创建"的，程序会打上 user 标记；你要在 suggested_parent 里给一个挂载位置（必须来自 structure_hint）。
3. note 类型输出 Markdown 正文（遵守正文契约），400–900 字；其余类型按各自 schema 填。
4. 内容必须来自给定的范围与附件；范围不够时在 missing 里写缺什么，不要编。
5. 页标题不超过 14 字，动词开头或名词短语，不用"我的""关于"。
```

## 用户消息模板

```text
用户要求：{{request}}
可用范围：{{scope}}
附件：{{attachments}}
可挂载节点：{{structure_hint}}

请输出自定义页 JSON。
```

## 输出 Schema（通用外壳）

```json
{
  "type": "note",
  "title": "第 2 章复盘",
  "suggested_parent": "02",
  "user_created": true,
  "missing": [],
  "content": {
    "markdown": "### 我在这一章错在哪\n\n……"
  },
  "sources": []
}
```

`content` 按 `type` 变化：flashcards/glossary 用各自 `items`；note 用 `markdown`。

## 失败处理
- 用户要求跨越多个类型（"一页闪卡加快查"）→ 只做最靠近用户原句的那一种，并在 `one_line_note` 说明"另一部分请单独再做一次"。

## 禁止
- 不输出自由文本让程序猜类型。
- 不把自定义页写进思维导图（导图只显示结构节点，见 §2.4 约定 1）。
