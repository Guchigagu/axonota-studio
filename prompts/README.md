# Axonota 提示词库

本目录存放 Axonota 所有需要调用大模型的功能所发送的提示词。每个文件对应一个功能点，可被程序直接读取并拼装成请求。

- 事实来源：`../axonota.md`。提示词里的约束若与文档冲突，以文档为准，并回来改这里。
- 一个文件 = 一个调用。不做"一个大提示词管所有事"，避免约束互相打架。
- 所有提示词均为**中文**（用户界面语言为中文），代码、字段名、枚举值保持英文。

## 目录

### `shared/` 公共段（被其他提示词引用，不单独发送）

| 文件 | 作用 |
|---|---|
| [01-tone.md](shared/01-tone.md) | 角色与语气基线：极简、不寒暄、不虚构 |
| [02-output-contract.md](shared/02-output-contract.md) | 输出格式契约：Markdown 子集、LaTeX、引用编号、组件 JSON |
| [03-sources.md](shared/03-sources.md) | 来源规则：本机资料／网络检索／无资料标注／冲突处理 |
| [04-context.md](shared/04-context.md) | 上下文装配：逐层继承、附件开关、超预算裁剪、高亮排除 |
| [05-safety.md](shared/05-safety.md) | 隐私与边界：图片中的个人信息、拒答范围、不确定表达 |

### `outline/` 建本与结构

| 文件 | 触发 | 输出 |
|---|---|---|
| [01-notebook-outline.md](outline/01-notebook-outline.md) | 工作台快速聊天框发送主题 | 目录树（章／节）+ 学习目标 |
| [02-restructure.md](outline/02-restructure.md) | 侧边栏「用 AI 重构结构」 | 结构变更补丁（增删改移） |
| [03-intent-router.md](outline/03-intent-router.md) | 工作台聊天框每次发送前的分流 | 意图判定（建本／提问／无关） |

### `content/` 正文生成

| 文件 | 触发 | 输出 |
|---|---|---|
| [01-section-note.md](content/01-section-note.md) | 点击未生成的小节节点 | 小节正文（流式 Markdown） |
| [02-chapter-overview.md](content/02-chapter-overview.md) | 点击未生成的章节点 | 章概览（导航 + 要点 + 目标） |
| [03-root-overview.md](content/03-root-overview.md) | 点击未生成的根节点 | 领域学习地图 + 路线建议 |
| [04-style-rewrite.md](content/04-style-rewrite.md) | 用户切换讲解风格后手动重写 | 同结构重写后的正文 |

### `components/` 结构化组件（类型固定，AI 只填内容）

| 文件 | 触发 | 输出 |
|---|---|---|
| [01-flashcards.md](components/01-flashcards.md) | 「生成闪卡」／自由描述 | 闪卡组 JSON |
| [06-glossary.md](components/06-glossary.md) | 「生成速查表」 | 术语／公式表 JSON |
| [08-custom-page.md](components/08-custom-page.md) | 侧边栏自由描述「我要一页……」 | 自定义页 JSON（类型归属） |

### `chat/` 对话与划词

| 文件 | 触发 | 输出 |
|---|---|---|
| [01-notebook-chat.md](chat/01-notebook-chat.md) | AI 侧边栏提问 | 回答 + 依据页列表（流式） |
| [02-selection-asks.md](chat/02-selection-asks.md) | 划词「AI 追问」子菜单其中一项 | 针对所选文字的短回答 |

### `ops/` 系统调用

| 文件 | 触发 | 输出 |
|---|---|---|
| [01-connectivity-test.md](ops/01-connectivity-test.md) | 添加模型时 | 最小可用请求（不产生内容、不扣长上下文） |
| [02-title-suggest.md](ops/02-title-suggest.md) | 建本确认大纲后 | 笔记本标题候选（3 个） |

## 覆盖对照（逐条对回 `../axonota.md`）

| 文档位置 | 功能 | 提示词 |
|---|---|---|
| §2.2 | 聊天框分流 | `outline/03-intent-router.md` |
| §2.2 | 先出大纲、确认后成书 | `outline/01-notebook-outline.md` → `ops/02-title-suggest.md` → 逐节 `content/01-section-note.md` |
| §2.3 | 点节点生成（节／章／根） | `content/01`、`content/02`、`content/03` |
| §2.3 | 风格切换后重写 | `content/04-style-rewrite.md` |
| §2.4 | 与笔记本对话（三态范围） | `chat/01-notebook-chat.md` |
| §2.4 | 划词「AI 追问」五项 | `chat/02-selection-asks.md` |
| §2.4 | 生成结构化组件（自由描述） | `components/08-custom-page.md` |
| §2.4 | 闪卡／速查表 | `components/01`、`components/06` |
| §2.4 | 用 AI 重构结构 | `outline/02-restructure.md` |
| §2.6 | 添加模型前的连通性测试 | `ops/01-connectivity-test.md` |

**复用关系（不另写提示词）**：「按新风格生成整章」= 逐节 `content/04`。

**不属于 AI 调用（因此没有提示词）**：导入导出（zip/pdf）、系统回收站、标签栏与页签状态、结构树拖拽排序、附件可见范围开关、模型列表管理。

**待定（文档未定义，故未造）**：根文件的解析与索引目前在程序侧做摘要（`{{root_excerpt}}`）；若改为由模型抽取目录与要点，需新增 `ops/03-file-digest.md`。

## 文件格式约定

每个提示词文件由四部分组成，程序按固定键读取：

1. **frontmatter**：`id` / `title` / `call` / `stream` / `temperature` / `output`。
2. **变量表**：`{{variable}}` 占位符与来源说明；程序只替换表中声明过的变量。
3. **系统提示词**（`## 系统提示词` 下的 ```text 块）：身份 + 硬约束 + 禁止项，跨轮次不变。
4. **用户消息模板**（`## 用户消息模板` 下的 ```text 块）：当次任务的输入装配；模板在前、资料在后，资料用 `<<<name>>>` 包裹。

## 拼接顺序（程序侧）

```
系统提示词
  = shared/01-tone.md
  + 本文件 §系统提示词
  + shared/02-output-contract.md（按 output 类型取对应小节）
  + shared/03-sources.md（当次需要来源时）
用户消息
  = 本文件 §用户消息模板（已替换变量）
  + shared/04-context.md 装配出的资料块
```

## 检查

```powershell
node scripts/check-prompts.mjs
```

校验项：frontmatter 完整性、变量声明与使用一致、引用的 shared 文件存在、组件 JSON 示例可解析、README 索引与实际文件一致。
