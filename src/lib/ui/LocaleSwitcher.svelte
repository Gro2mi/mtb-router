<script lang="ts">
  import { i18n, locales } from '../i18n.svelte';

  const localeNames: Record<string, string> = { en: 'EN', de: 'DE' };
</script>

<div
  class="flex rounded-full border-2 border-slate-300 p-0.5 dark:border-slate-500"
  role="group"
  aria-label={i18n.m.language()}
>
  {#each locales as locale (locale)}
    <button
      type="button"
      class="flex h-11 min-w-12 items-center justify-center rounded-full px-2 text-sm font-extrabold transition-colors {i18n.locale ===
      locale
        ? 'bg-orange-600 text-white'
        : 'text-slate-700 hover:text-orange-700 dark:text-slate-300 dark:hover:text-orange-400'}"
      aria-pressed={i18n.locale === locale}
      onclick={() => i18n.set(locale)}
    >
      {localeNames[locale] ?? locale}
    </button>
  {/each}
</div>
