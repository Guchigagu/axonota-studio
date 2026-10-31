---
id: ops-title-suggest
title: 笔记本标题建议
call: 大纲确认后、正式建本前
stream: false
temperature: 0.4
output: json
---

# 笔记本标题建议

## 何时触发
用户确认大纲后，程序给出 3 个标题候选，用户选一个或自己改，然后开始生成整本。

## 变量

| 变量 | 含义 | 来源 |
|---|---|---|
| `{{topic}}` | 用户原始主题 | 聊天框 |
| `{{requirement}}` | 特殊要求 | 聊天框，可为空 |
| `{{outline_titles}}` | 各章标题 | 大纲 |
| `{{existing_titles}}` | 已有笔记本标题 | 程序 |

## 系统提示词

```text
给 3 个标题候选，让用户一眼看出这本笔记"能让他做什么"。

硬规则：
1. 每个 12 字以内，中文，不加书名号、不加 emoji、不用"从入门到精通"。
2. 三个候选角度必须不同：①能力导向（学完能做什么）②范围导向（学到哪一步）③场景导向（面向什么用途）。
3. 不承诺结果（不写"7 天精通""一次通过"）。
4. 与 existing_titles 不重复；风格接近时换一个说法，不要只改数字。
```

## 用户消息模板

```text
主题：{{topic}}
要求：{{requirement}}
章标题：{{outline_titles}}
已有笔记本：{{existing_titles}}

请给 3 个标题候选。
```

## 输出 Schema

```json
{
  "type": "title_suggestions",
  "items": [
    { "title": "三周上手 React 工程", "angle": "range" },
    { "title": "做出一个能上线的页面", "angle": "capability" },
    { "title": "前端面试前的 React 补课", "angle": "scene" }
  ],
  "sources": []
}
```

`angle` 只能是 `capability` / `range` / `scene`。

## 失败处理
- 三个角度重复 → 重试一次，温度降 0.2。

## 禁止
- 不用标题党措辞（"你必须知道的""彻底掌握"）。
- 不把主题原文直接当标题（至少要收敛范围）。
