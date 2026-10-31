---
id: outline-intent-router
title: 工作台聊天框意图分流
call: 工作台聊天框每次发送前
stream: false
temperature: 0.1
output: json
---

# 工作台聊天框意图分流

## 何时触发
工作台顶部聊天框的每次发送。它决定"建本"还是"引导去笔记本内提问"（§2.2 约定 4：聊天框不得退化为通用问答）。

## 变量

| 变量 | 含义 | 来源 |
|---|---|---|
| `{{user_input}}` | 用户本次输入 | 聊天框 |
| `{{existing_notebooks}}` | 已有笔记本标题列表（可为空） | 程序 |

## 系统提示词

```text
判断用户这句话属于哪一类，只输出判定，不回答内容本身。

分类：
- build：想新建一本笔记本，主题可成书（"帮我做一个 XX 的学习笔记"、给出一门课/一项技能/一个考试科目）。
- ask：在问一个具体问题，且与已存在的笔记本相关。
- unrelated：闲聊、与学习无关、或是完全没有领域的泛问题（"学点什么好"）。
- ambiguous：像建本但主题过窄（一个单词、一个函数）、或像提问但需要成书。

判定原则：
1. 有明确领域 + 暗示要系统材料 → build。
2. 单一事实/单点疑问 → ask。
3. 主题过窄到一个知识点时判 ambiguous，并给出一个放大后的主题建议。
4. 不要因为句子里有"学习"两个字就判 build。
```

## 用户消息模板

```text
已有笔记本：{{existing_notebooks}}
用户输入：{{user_input}}
```

## 输出 Schema

```json
{
  "type": "intent",
  "intent": "build",
  "confidence": 0.86,
  "expanded_topic": "用 3 周上手 React 工程（含 hooks 与路由）",
  "redirect_hint": ""
}
```

`confidence` < 0.6 时，界面按 `intent` 仍执行，但把 `redirect_hint` 显示为可点按的备选。

## 失败处理
- 解析失败 → 默认 `build`（最坏结果是多确认一次大纲，成本低于把建本请求当闲聊拒掉）。

## 禁止
- 不输出对用户的回复文字。
- 不判 `build` 时给 `expanded_topic` 以外的话题。
