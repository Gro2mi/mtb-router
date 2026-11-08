<script lang="ts">
  import { i18n } from '../i18n.svelte';
  import { geocode, type GeoResult } from '../search/geocode';

  let { onPick, onClear }: {
    onPick: (r: GeoResult) => void;
    onClear: () => void;
  } = $props();

  type Status = 'idle' | 'loading' | 'results' | 'empty' | 'error';

  let query = $state('');
  let status = $state<Status>('idle');
  let results = $state<GeoResult[]>([]);
  /** index of the highlighted (keyboard) row */
  let active = $state(0);
  let open = $state(false);
  /** keeps the dropdown open while clicking a result inside it */
  let listHover = false;

  let controller: AbortController | null = null;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let inputEl: HTMLInputElement | undefined = $state();

  const LANG = () => (i18n.locale === 'de' ? 'de' : 'en');

  function run(raw: string): void {
    const q = raw.trim();
    controller?.abort();
    clearTimeout(debounce);
    if (q.length < 3) {
      status = 'idle';
      results = [];
      return;
    }
    status = 'loading';
    debounce = setTimeout(async () => {
      controller = new AbortController();
      try {
        results = await geocode(q, LANG(), controller.signal);
        status = results.length > 0 ? 'results' : 'empty';
        active = 0;
        open = true;
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return;
        status = 'error';
        results = [];
      }
    }, 300);
  }

  function pick(r: GeoResult): void {
    query = r.label;
    open = false;
    status = 'idle';
    results = [];
    inputEl?.blur();
    onPick(r);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      clear();
      inputEl?.blur();
    } else if (e.key === 'Enter' && status === 'results') {
      pick(results[active]!);
    } else if (e.key === 'ArrowDown' && status === 'results') {
      e.preventDefault();
      active = Math.min(active + 1, results.length - 1);
    } else if (e.key === 'ArrowUp' && status === 'results') {
      e.preventDefault();
      active = Math.max(active - 1, 0);
    }
  }

  function clear(): void {
    controller?.abort();
    clearTimeout(debounce);
    query = '';
    results = [];
    status = 'idle';
    open = false;
    onClear();
  }
</script>

<!-- Place search: floats over the map below the top controls; the status
     pill moved below it. Results dropdown lists name + region context. -->
<div
  class="pointer-events-auto absolute top-3 right-[3.75rem] left-14 z-20 lg:right-[calc(384px+3.75rem)]"
  data-testid="search-bar"
>
  <div class="relative">
    <input
      bind:this={inputEl}
      bind:value={query}
      type="search"
      class="h-11 w-full rounded-xl border-2 border-slate-300 bg-white/95 pr-9 pl-3 text-sm font-medium text-slate-900 shadow-lg placeholder:text-slate-500 focus:border-orange-600 focus:outline-none dark:border-slate-500 dark:bg-slate-900/95 dark:text-white"
      placeholder={i18n.m.search_placeholder()}
      aria-label={i18n.m.search_placeholder()}
      autocomplete="off"
      data-testid="search-input"
      oninput={() => run(query)}
      onkeydown={onKeydown}
      onfocus={() => (open = status === 'results')}
    />
    {#if query}
      <button
        type="button"
        class="absolute top-1/2 right-2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
        aria-label={i18n.m.search_clear()}
        onclick={clear}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.4"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    {/if}
  </div>

  {#if (open && status === 'results') || status === 'loading' || status === 'empty' || status === 'error'}
    <div
      class="mt-1 max-h-64 overflow-y-auto rounded-xl border-2 border-slate-200 bg-white/98 shadow-xl dark:border-slate-600 dark:bg-slate-900/98"
      role="listbox"
      tabindex="-1"
      aria-label={i18n.m.search_placeholder()}
      onmouseenter={() => (listHover = true)}
      onmouseleave={() => {
        listHover = false;
        setTimeout(() => {
          if (!listHover && inputEl && document.activeElement !== inputEl) open = false;
        }, 150);
      }}
    >
      {#if status === 'loading'}
        <div class="flex items-center gap-2 px-3 py-2.5 text-sm text-slate-500 dark:text-slate-400">
          <span class="mtbr-spinner text-orange-600" aria-hidden="true"></span>
          {i18n.m.search_searching()}
        </div>
      {:else if status === 'empty'}
        <div class="px-3 py-2.5 text-sm text-slate-500 dark:text-slate-400" data-testid="search-empty">
          {i18n.m.search_no_results()}
        </div>
      {:else if status === 'error'}
        <div class="px-3 py-2.5 text-sm text-red-600 dark:text-red-400" data-testid="search-error">
          {i18n.m.search_error()}
        </div>
      {:else}
        {#each results as r, i (r.label)}
          <button
            type="button"
            role="option"
            aria-selected={i === active}
            class="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm {i === active
              ? 'bg-orange-50 dark:bg-slate-800'
              : ''}"
            data-testid="search-result"
            onclick={() => pick(r)}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-4 w-4 shrink-0 text-orange-600"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <span class="truncate text-slate-900 dark:text-white">{r.label}</span>
          </button>
        {/each}
      {/if}
    </div>
  {/if}
</div>
