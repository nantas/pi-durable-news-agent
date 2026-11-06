<script setup lang="ts">
import { computed } from "vue";
import { BadgeCheck, Megaphone, ThumbsDown, ThumbsUp, Zap } from "@lucide/vue";
import { HFS_CATEGORIES, type Card, type HfsCategory } from "@dna/sdk";
import { api, attempt, notify, referenceInChat, ui } from "../client/store";

const props = defineProps<{ card: Card }>();
const ICONS = { hype: Megaphone, facts: BadgeCheck, signal: Zap };
const NAMES: Record<HfsCategory, string> = { hype: "Hype", facts: "Facts", signal: "Signal" };
/** Label buttons in the same order as the card's ranked H/F/S chips. */
const order = computed<HfsCategory[]>(
  () => props.card.hfs?.ranked.map((r) => r.category) ?? [...HFS_CATEGORIES],
);

async function signal(value: "more" | "less") {
  const r = await attempt(() => api.feedback(props.card.id, { signal: value }));
  if (r)
    notify(
      value === "more"
        ? `Showing more like this${r.changed.length ? `, ${r.changed.map((c) => c.term).join(", ")} up` : ""}${r.leads?.length ? `. The next sweep looks at ${r.leads.map((l) => l.site).join(", ")} as a source` : ""}`
        : `Hidden from News. Showing less like this${r.changed.length ? `, ${r.changed.map((c) => c.term).join(", ")} down` : ""}`,
    );
}
async function label(category: HfsCategory) {
  const current = props.card.feedback?.labels ?? [];
  const next = current.includes(category)
    ? current.filter((c) => c !== category)
    : [...current, category];
  await attempt(() => api.feedback(props.card.id, { labels: next }));
}
async function bookmark() {
  await attempt(async () => {
    await api.addBookmark(props.card.id);
    notify("已保存到待收藏列表");
  });
}
</script>

<template>
  <div class="feedback">
    <button
      class="fb"
      data-cap="feedback.calibrate"
      @click="
        ui.calibrationCard = card.id;
        referenceInChat(`评分不准（卡片 ${card.id}）：`);
      "
    >
      评分不准
    </button>
    <button class="fb" aria-label="收藏线索" title="收藏线索" @click="bookmark">收藏</button>
    <button
      class="fb"
      data-cap="feedback.more"
      :class="{ on: card.feedback?.signal === 'more' }"
      :aria-pressed="card.feedback?.signal === 'more'"
      title="Show me more"
      aria-label="Show me more"
      @click="signal('more')"
    >
      <ThumbsUp :size="14" />
    </button>
    <button
      class="fb"
      data-cap="feedback.less"
      :class="{ on: card.feedback?.signal === 'less' }"
      :aria-pressed="card.feedback?.signal === 'less'"
      title="Show me less"
      aria-label="Show me less"
      @click="signal('less')"
    >
      <ThumbsDown :size="14" />
    </button>
    <span class="fb-labels" data-cap="feedback.label" role="group" aria-label="Your label">
      <span class="fb-prefix" aria-hidden="true">Label</span>
      <button
        v-for="c in order"
        :key="c"
        class="fb tag"
        :class="[c, { on: card.feedback?.labels.includes(c) }]"
        :aria-pressed="!!card.feedback?.labels.includes(c)"
        :aria-label="`Label ${NAMES[c]}`"
        :title="`Label this ${NAMES[c]}`"
        @click="label(c)"
      >
        <component :is="ICONS[c]" :size="13" />
      </button>
    </span>
  </div>
</template>
