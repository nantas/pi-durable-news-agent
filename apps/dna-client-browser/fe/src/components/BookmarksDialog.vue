<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from "vue";
import type { Bookmark } from "@dna/sdk";
import { api, attempt, onFrame, ui } from "../client/store";
const bookmarks = ref<Bookmark[]>([]);
async function refresh() {
  const rows = await attempt(() => api.bookmarks());
  if (rows) bookmarks.value = rows;
}
const stop = onFrame((frame) => {
  if (frame.type === "bookmarks.changed" || frame.type === "hello") void refresh();
});
onMounted(refresh);
onBeforeUnmount(stop);
async function save(bookmark: Bookmark) {
  await attempt(() => api.updateBookmark(bookmark.id, bookmark.note));
  await refresh();
}
async function remove(id: number) {
  await attempt(() => api.removeBookmark(id));
  await refresh();
}
</script>
<template>
  <div
    class="modal-backdrop"
    @click.self="ui.bookmarks = false"
    @keydown.esc="ui.bookmarks = false"
  >
    <section class="modal" role="dialog" aria-modal="true" aria-label="待收藏列表">
      <header>
        <h2>待收藏列表</h2>
        <button aria-label="关闭待收藏列表" @click="ui.bookmarks = false">关闭</button>
      </header>
      <p v-if="!bookmarks.length">待收藏列表为空</p>
      <article v-for="bookmark in bookmarks" :key="bookmark.id">
        <a :href="bookmark.url" target="_blank" rel="noopener">{{ bookmark.title }}</a>
        <p>{{ bookmark.sourceName }} {{ bookmark.createdAt }}</p>
        <label
          >备注 <input v-model="bookmark.note" :aria-label="`备注 ${bookmark.id}`" maxlength="2000"
        /></label>
        <button @click="save(bookmark)">保存备注</button>
        <button @click="remove(bookmark.id)">取消收藏</button>
      </article>
    </section>
  </div>
</template>
