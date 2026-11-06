<script setup lang="ts">
// A pane that flows bottom up like a chat: newest last, pinned to the bottom, with a jump button for new items.
import { ref } from "vue";
import { ArrowDown } from "@lucide/vue";
import { usePinned } from "../client/pin";

const props = defineProps<{ count: number; label: string; top?: boolean }>();
const scroller = ref<HTMLElement>();
const { unseen, jump } = props.top
  ? { unseen: ref(0), jump: () => {} }
  : usePinned(scroller, () => props.count);
</script>

<template>
  <div class="bottom-pane" :class="{ 'top-pane': top }">
    <div ref="scroller" class="bottom-scroll" :aria-label="label">
      <div class="bottom-inner"><slot /></div>
    </div>
    <button
      v-if="unseen > 0"
      class="new-items"
      :aria-label="`${unseen} new, jump to the newest`"
      @click="jump"
    >
      <ArrowDown :size="15" />{{ unseen }} new
    </button>
  </div>
</template>

<style scoped>
.top-pane .bottom-inner {
  margin-top: 0;
}
</style>
