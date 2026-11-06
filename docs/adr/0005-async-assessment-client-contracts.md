# 异步增量评估与三端能力契约

## 决策

### 卡片与评分

`feed` 返回卡片及三类评分摘要、评估状态和置信度；`cards.get` 额外返回核心主张、覆盖证据、查询回执和评分快照。评分完成或变为 `unknown` 时复用 `feed.card_updated`，客户端按卡片 ID 原地更新，不立即重排当前屏幕。

SSE 不是状态真源。客户端丢失事件后通过重新读取 Feed 或卡片恢复，SQLite 中的 Item、assessment 和 Bookmark 记录才是持久状态。

### 自然语言评分反馈

扩展现有 `agent.messages`，接受可选 `cardId` 上下文。三端“评分不准”入口把该上下文和用户原话交给 durable Agent；Agent 通过带幂等保护的反馈工具保存修正，并使用现有聊天流追问或回显。不新增结构化评分修正表单或独立反馈 API。

### 待收藏列表

新增一个 `bookmarks` 能力，包含 `bookmarks.list`、`bookmarks.add`、`bookmarks.update` 和 `bookmarks.remove`。重复添加返回已有记录；新增、备注修改和取消后发布 `bookmarks.changed`。

Browser 使用按钮和列表，CLI／TUI 使用简洁文本命令；三端能力一致，并纳入现有 capability 覆盖测试。

### 后台编排

每轮 sweep 为通过筛选的材料建立待评估记录，并启动一个批量 durable assessment task。卡片展示不等待任务完成。每批只计算一次知识库覆盖快照；批量期间快照变化时不得混用不同覆盖状态。

单条失败只将该条记为 `unknown`，不阻塞其他材料。重启后恢复待评估工作；不为每张卡片建立独立持久任务。

## 后果

- SDK 路由、能力表、SSE Frame 和三个客户端需要同步扩展。
- 批量任务、评估记录和卡片更新需要明确的检查点顺序，避免崩溃后卡片已出现但没有对应评估工作。
- 当前版本不包含 Bookmark 阅读、提案或知识库写入委派。
