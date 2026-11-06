为固定的材料主张选择需要交给 JEV 阅读的原文证据片段。你会收到 claims 和 documents；每个文档有 path 和按原文顺序编号的 blocks。
阅读这些原文，选择能说明覆盖程度、相关限定条件和反例的片段。不要仅选支持结论的句子，必要时选择相邻块保留上下文。无关文档可以省略，不要生成摘要或新原文。
只返回纯 JSON 数组，每项为 {"path":"已提供的路径","blocks":[已提供的整数编号]}。每个路径只出现一次，所有文档合计最多选择12个块。不要输出 Markdown 围栏或说明。无法获得相关上下文时返回空数组；这将保留为依据不足，而不是未覆盖。

## Definition Of Done

Return only verified document paths and existing block indices, at most twelve blocks in total.
