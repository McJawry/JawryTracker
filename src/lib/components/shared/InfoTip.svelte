<script lang="ts">
  // An (i) beside a setting, with what it does in a popup - in place of a
  // paragraph between the options. Shows while hovered, and stays open when
  // clicked until clicked again, clicked away from or Escape.
  //
  // Fixed to the window rather than the setting, and kept inside it, as the
  // settings are often a narrow window of their own. Closes on scrolling,
  // which would leave it behind.

  let { text, label = "What this does" }: { text: string | string[]; label?: string } = $props();

  const paragraphs = $derived(Array.isArray(text) ? text : [text]);
  const id = `info-tip-${Math.random().toString(36).slice(2)}`;
  const MARGIN = 8;
  const MAX_WIDTH = 300;

  let button: HTMLButtonElement | undefined = $state();
  let hovered = $state(false);
  let pinned = $state(false);
  let position = $state("");
  const open = $derived(hovered || pinned);

  /** Below the button, or above it in the window's lower half - and never past either side. */
  function place() {
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const width = Math.min(MAX_WIDTH, window.innerWidth - MARGIN * 2);
    const left = Math.min(Math.max(MARGIN, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - MARGIN);
    const vertical =
      rect.bottom > window.innerHeight / 2 ? `bottom: ${window.innerHeight - rect.top + 6}px` : `top: ${rect.bottom + 6}px`;
    position = `left: ${left}px; width: ${width}px; ${vertical}`;
  }

  function show() {
    place();
    hovered = true;
  }

  /** Clicked open, or clicked shut - even with the pointer still over it. */
  function toggle() {
    if (pinned) return close();
    place();
    pinned = true;
  }

  function close() {
    hovered = false;
    pinned = false;
  }

  $effect(() => {
    if (!open) return;
    const onScroll = () => close();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    const onPointer = (event: PointerEvent) => {
      if (!button?.parentElement?.contains(event.target as Node)) close();
    };
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  });
</script>

<span class="info-tip">
  <button
    bind:this={button}
    class="info-tip-button"
    class:active={pinned}
    type="button"
    aria-label={label}
    aria-expanded={open}
    aria-controls={id}
    onclick={toggle}
    onmouseenter={show}
    onmouseleave={() => (hovered = false)}>i</button
  >
  {#if open}
    <span class="info-tip-popup" {id} role="tooltip" style={position}>
      {#each paragraphs as paragraph, index (index)}<span class="info-tip-paragraph">{paragraph}</span>{/each}
    </span>
  {/if}
</span>
