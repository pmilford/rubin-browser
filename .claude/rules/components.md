# Svelte Component Rules

## Svelte 5 Only

Use Svelte 5 runes syntax. Never use Svelte 4 patterns:

```svelte
<!-- Good (Svelte 5) -->
<script lang="ts">
  let count = $state(0);
  let doubled = $derived(count * 2);
  $effect(() => console.log(count));
</script>

<!-- Bad (Svelte 4) -->
<script lang="ts">
  let count = 0;
  $: doubled = count * 2;
</script>
```

## Component Organization

- `src/components/` — Reusable, self-contained widgets
- `src/views/` — Page-level components (route targets)

## Props

Use `$props()` rune with destructuring:

```svelte
<script lang="ts">
  let { objectId, filter = 'r' }: { objectId: string; filter?: string } = $props();
</script>
```

## TypeScript

All component `<script>` blocks use `lang="ts"`. Define prop types inline or import from `src/types/`.

## Events

Use callback props instead of `createEventDispatcher`:

```svelte
<script lang="ts">
  let { onSelect }: { onSelect: (id: string) => void } = $props();
</script>

<button onclick={() => onSelect(objectId)}>Select</button>
```

## Styling

Scoped styles only. No global CSS in components. Shared styles go in `public/styles/`.

## File Naming

- PascalCase: `LightCurve.svelte`, `GalaxyStack.svelte`
- One component per file
- Co-locate test file: `LightCurve.test.ts` next to `LightCurve.svelte`
