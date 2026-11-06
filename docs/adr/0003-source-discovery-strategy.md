# 0003. 面向游戏创作的来源发现策略

- 状态：已接受
- 日期：2026-11-07

## 背景

新闻代理需要同时发现新发布内容与新发现的旧材料。来源价值取决于它对游戏创作的贡献，而不是通用热度。不同来源的访问能力、许可和更新形态差异明显，不能假设所有网站都提供稳定 RSS，也不能让缺乏鉴权的平台成为核心依赖。

## 决策

### 按创作输入组织来源

来源可以服务多个创作输入类型和知识域，分类用于指导筛选，不限制一篇材料只能属于一类。

**游戏设计方法**

保留 Mega Crit News、Game Maker's Toolkit、GDC Festival of Gaming、Architect of Games、Mix and Jam、Game Industry Conference；Tabletop Turtle 主要作为桌游评测与内容参考。新增：

- Skeleton Code Machine：https://www.skeletoncodemachine.com/feed
- Space-Biff!：https://spacebiff.com/feed/
- Ludology 暂不纳入默认来源，避免固定音频转写成本。

Stonemaier Games 保留，但主要作为游戏运营、众筹与发行来源。Game Developer Design 需要栏目过滤与分页补充，不能只依赖站级 RSS。

**创作与生产工具**

保留 Hugging Face Blog、Penusbmic、Gamefromscratch、Matt Pocock、Eero Alvar。新增：

- Godot 博客与 Releases：https://godotengine.org/rss.xml
- ComfyUI 博客与 Releases：https://blog.comfy.org/feed.xml
- A Sound Effect：https://www.asoundeffect.com/feed/

高频发布、开发快照和促销内容必须经主题与噪声筛选。

**内容参考与储备**

持续更新流新增：

- The Public Domain Review：https://publicdomainreview.org/rss.xml
- Animation Obsessive：https://www.animationobsessive.com/feed

按需参考库新增：

- Art Institute of Chicago：https://www.artic.edu/ ，API 文档：https://api.artic.edu/docs/
- Sakugabooru：https://www.sakugabooru.com/ ，只保存检索元数据与原链接，不镜像视频。

按需参考库不进入定时 Feed，也不做全站镜像。

### 访问受限来源降级

Patreon Dodoot、80.lv 不进入默认自动采集。前者无法稳定取得公开正文，后者的 Feed 受 robots 限制。AI Tool Hunt 暂不纳入，因为缺乏有效 Feed 和可靠分类分页。保留用户手动提供链接的发现入口。

### YouTube 采集

使用已确认的 channel ID。频道视频列表是主发现路径，官方 RSS 只作补充；404/500 视为临时读取失败并退避，不视为频道失效。只有进入进一步阅读时才获取字幕或转写。

### GitHub 发现

先按仓库实际用途、话题和游戏创作关系分类，再评价热度。分类至少区分引擎与 Godot 生态、游戏 AI、美术与动画、音频、关卡或系统设计、Agent 与生产工作流；无法确认与游戏创作关系的仓库不推送。

使用 GitHub 官方搜索和 star history，组合仓库创建时间、总 star、7/30 天 star 净增量、最近提交与 Release 状态。Trendshift 只作外部热度交叉验证，不取代官方指标。

### X 辅助发现

在无 X 登录、Cookie 或 API key 的前提下，只使用趋势话题、搜索引擎已索引帖子和已知帖子的公开回填。X 不承担实时、完整或稳定的关键词监控，也不作为核心工作流依赖。

## 后果

- 来源配置需要区分持续更新流、按需参考库和手动线索。
- 采集器需要支持 RSS、网站列表、YouTube、GitHub 搜索与 star history，并保留来源特定过滤规则。
- 来源可访问不等于适合自动采集；robots、许可、正文可得性和漏抓风险必须进入配置审查。
- 本决策只确定目标来源与发现策略，不代表来源配置已经实施。
