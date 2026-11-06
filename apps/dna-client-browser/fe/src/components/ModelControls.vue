<script setup lang="ts">
// Shown above the composer when the Model toggle is on: the agent's model and thinking level, the quick model and its
// thinking for one-shot jobs (reading publish dates), then the deep research subagents' model, thinking and count.
import { computed } from "vue";
import { ChevronDown } from "@lucide/vue";
import { agentState, api, attempt, feed, info, ui } from "../client/store";

const LEVELS = ["off", "minimal", "low", "medium", "high"] as const;
const DEEP_LEVELS = [...LEVELS, "xhigh"] as const;
const ROLES = ["research", "coverage", "summary"] as const;
const DEEP_COUNTS = [1, 2, 3, 4, 5];
const model = computed(() => info.value?.models.find((m) => m.id === agentState.value?.model));
async function configure(body: Parameters<typeof api.configure>[0]) {
  const state = await attempt(() => api.configure(body));
  if (state) feed.apply({ type: "agent.state", state });
}
const setThinking = (level: string) =>
  configure({ thinkingLevel: level as (typeof LEVELS)[number] });
</script>

<template>
  <div class="model-row" aria-label="Model and thinking">
    <button
      type="button"
      class="model-button"
      data-cap="agent.model"
      aria-label="Choose a model"
      @click="ui.models = true"
    >
      <img v-if="model?.icon" :src="`/icons/${model.icon}`" alt="" />
      <span>{{ model?.name ?? agentState?.model ?? "Model" }}</span>
      <ChevronDown :size="14" />
    </button>
    <label class="thinking-select" data-cap="agent.thinking"
      ><span class="control-label">Thinking</span>
      <select
        :value="agentState?.thinkingLevel ?? 'low'"
        aria-label="Thinking level"
        @change="setThinking(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="l in LEVELS" :key="l" :value="l">{{ l }}</option>
      </select>
    </label>
  </div>
  <div
    class="model-row quick"
    role="group"
    aria-label="Quick tasks"
    title="A small model for one-shot jobs, such as reading a publish date off a page"
  >
    <span class="control-label">Quick tasks</span>
    <select
      :value="agentState?.quick?.model"
      aria-label="Quick tasks model"
      @change="configure({ quickModel: ($event.target as HTMLSelectElement).value })"
    >
      <option v-for="m in info?.models ?? []" :key="m.id" :value="m.id">{{ m.name }}</option>
    </select>
    <label class="thinking-select"
      ><span class="control-label">Thinking</span>
      <select
        :value="agentState?.quick?.thinkingLevel ?? 'off'"
        aria-label="Quick tasks thinking level"
        @change="
          configure({
            quickThinking: ($event.target as HTMLSelectElement).value as (typeof LEVELS)[number],
          })
        "
      >
        <option v-for="l in LEVELS" :key="l" :value="l">{{ l }}</option>
      </select>
    </label>
  </div>
  <div
    class="model-row quick deep"
    role="group"
    aria-label="Deep research"
    title="The subagents that dig into a question when you ask the agent to deep dive, and how many run at once"
  >
    <span class="control-label">Deep research</span>
    <select
      :value="agentState?.deepResearch?.model"
      aria-label="Deep research model"
      @change="configure({ deepResearchModel: ($event.target as HTMLSelectElement).value })"
    >
      <option v-for="m in info?.models ?? []" :key="m.id" :value="m.id">{{ m.name }}</option>
    </select>
    <label class="thinking-select"
      ><span class="control-label">Thinking</span>
      <select
        :value="agentState?.deepResearch?.thinkingLevel ?? 'xhigh'"
        aria-label="Deep research thinking level"
        @change="
          configure({
            deepResearchThinking: ($event.target as HTMLSelectElement)
              .value as (typeof DEEP_LEVELS)[number],
          })
        "
      >
        <option v-for="l in DEEP_LEVELS" :key="l" :value="l">{{ l }}</option>
      </select>
    </label>
    <label class="thinking-select"
      ><span class="control-label">Count</span>
      <select
        :value="agentState?.deepResearch?.count ?? 1"
        aria-label="Deep research count"
        @change="
          configure({ deepResearchCount: Number(($event.target as HTMLSelectElement).value) })
        "
      >
        <option v-for="c in DEEP_COUNTS" :key="c" :value="c">{{ c }}</option>
      </select>
    </label>
  </div>
  <label v-for="role in ROLES" :key="role" class="model-row quick" data-cap="agent.model">
    <span class="control-label">{{ role }}</span>
    <select
      :aria-label="`${role} model`"
      :value="agentState?.roles?.[role]"
      @change="configure({ [`${role}Model`]: ($event.target as HTMLSelectElement).value })"
    >
      <option v-for="m in info?.models ?? []" :key="m.id" :value="m.id">{{ m.name }}</option>
    </select>
  </label>
</template>
