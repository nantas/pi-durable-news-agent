# 增量评估、自然语言反馈与待收藏列表的数据模型

## 背景

现有 SQLite  schema 以 HFS classification、卡片偏好反馈和持久新闻任务为中心。新需求需要可失效的三类增量评分、覆盖证据、自然语言修正和不执行委派的待收藏列表，同时复用现有 JEV ledger、反馈记录与 durable task 检查点。

## 决策

### 增量评估

新增 `assessments`，每行绑定 Item、JEV 命令版本、材料内容哈希和知识库覆盖快照。保存三类分数、置信度、评估状态、实际阅读深度、主张、证据、查询回执和错误；通过 `jev_call_id` 关联现有 JEV 调用记录，不重复保存原始答案与成本。

以 `item_id + command + version + material_hash + coverage_snapshot` 建立唯一约束。`items` 增加当前评估引用；待评估、完成、未知等状态由评估记录提供，不增加平行的状态副本。

后台执行复用 durable task 和检查点，不建立另一套通用任务表。重启后可以由待评估记录找到需要恢复的工作。

### 反馈

扩展现有 `feedback`，保留 `more`／`less` 的主题与来源偏好语义。新增反馈种类、关联评估、对话、结构化修正和工具调用 ID。原始自然语言使用现有 `note`；修正 JSON 同时保存模型原值和用户修正值。工具调用 ID 用于防止 Agent 重试造成重复记录。

反馈不直接修改历史 JEV 答案，不自动偏移后续分数，也不允许 Agent 修改评分 Prompt 或阈值。

### 待收藏列表

新增 `bookmarks`，保存 Item 引用、标题、canonical URL 哈希、来源、可选备注和时间。Item 与 URL 哈希均唯一；重复收藏返回已有记录，取消收藏删除记录。该表不包含阅读、提案、确认或知识库委派状态。

### 来源扩展

`sources.options_json` 保存分页、频道和主题等来源配置；`source_cache.metadata_json` 保存 GitHub 指标或 YouTube 属性。`items.created_at` 表示发现时间，`published_at` 表示发布时间。

### 旧 HFS 数据

不承诺完整迁移或保留旧 HFS 生产数据，也不建立新旧双写或运行时回退。选择少量有代表性的 HFS 记录整理为测试 fixture，用于新评分或新管线出现异常时进行对比；fixture 不进入生产评分路径。旧运行时结构可以在新路径替代其读者和写者后清理。

## 验证

- 在全新数据库和已有旧 schema 数据库上执行迁移。
- 验证相同评分快照和重试请求不会生成重复评估或反馈。
- 验证 Bookmark 重复、备注和取消收藏。
- 验证重启后待评估工作可以恢复，失败不会变成零分。
- 验证 HFS fixture 仅供测试读取，生产代码不依赖旧 HFS 数据。
