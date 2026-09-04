<script lang="ts">
  // Ported from the notes-section markup in index.html plus
  // updateFromInput()/resizeHintInput()/setNotesTab() (dev/app/app.js:5758+,
  // 5769, 5774). The Sphere Tracking textarea uses a simplified text
  // round-trip (see sphere-notes-text.ts) rather than the original's
  // ID-stable line diffing.
  import { hints, hintNotes, updateHintsFromNotes, setNotesEditorFocused } from "$lib/state/hints.svelte";
  import { settings, saveSettings } from "$lib/state/settings.svelte";
  import { sphere } from "$lib/state/sphere.svelte";
  import { parseSphereNotesText, serializeSpherePlacements } from "$lib/logic/sphere-notes-text";

  let activeTab: "hint" | "sphere" = $state("hint");

  let hintTextarea: HTMLTextAreaElement | undefined = $state();
  let sphereTextarea: HTMLTextAreaElement | undefined = $state();
  let sphereText = $state(serializeSpherePlacements());

  /**
   * A textarea cannot colour its own text, so the notes are drawn twice: a
   * layer behind carries one span per line with the colour, and the textarea
   * sits in front with transparent glyphs and a visible caret. The two share
   * every typographic property, so the lines land exactly on each other.
   */
  const hintByLine = $derived(new Map(hints.map((hint) => [hint.lineNumber, hint])));

  const highlightedLines = $derived(
    hintNotes.value.split(/\r?\n/).map((text, index) => ({ text, className: lineClass(index + 1) }))
  );

  function lineClass(lineNumber: number): string {
    const hint = hintByLine.get(lineNumber);
    if (!hint) return "";
    // Path and location hints are told apart by their kind; only an item hint
    // carries a requirement, and there the tag is the more useful thing to see
    // at a glance, so it decides the colour.
    if (hint.type === "path") return "hint-line path";
    if (hint.type === "location") return "hint-line location";
    if (hint.type !== "item") return "";
    const key = hint.requirement?.key;
    if (key === "required") return "hint-line required";
    if (key === "possibly-required") return "hint-line possible";
    if (key === "not-required") return "hint-line not-required";
    return "hint-line item";
  }

  let highlightEl: HTMLPreElement | undefined = $state();

  /** The layer has no scrollbar of its own - it follows the textarea's. */
  function syncScroll() {
    if (!highlightEl || !hintTextarea) return;
    highlightEl.scrollTop = hintTextarea.scrollTop;
    highlightEl.scrollLeft = hintTextarea.scrollLeft;
  }

  const MIN_HEIGHT = 135;

  /**
   * Two modes, toggled from the panel header:
   *  - grow: the box (and so the panel) gets taller as text is added
   *  - fixed: the box stays at settings.notesHeight and scrolls internally
   */
  function resize(el: HTMLTextAreaElement | undefined) {
    if (!el) return;
    if (!settings.notesAutoGrow) {
      el.style.height = `${Math.max(MIN_HEIGHT, settings.notesHeight)}px`;
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.max(MIN_HEIGHT, el.scrollHeight)}px`;
  }

  function resizeAll() {
    resize(hintTextarea);
    resize(sphereTextarea);
  }

  function toggleAutoGrow() {
    // Leaving grow mode keeps the height it had reached, so the panel doesn't
    // jump - that height becomes the fixed one.
    if (settings.notesAutoGrow) {
      const current = activeTab === "hint" ? hintTextarea : sphereTextarea;
      if (current) settings.notesHeight = Math.max(MIN_HEIGHT, Math.round(current.getBoundingClientRect().height));
    }
    settings.notesAutoGrow = !settings.notesAutoGrow;
    saveSettings();
    requestAnimationFrame(resizeAll);
  }

  // In fixed mode the textarea gets a native resize grip; remember where the
  // user drags it to.
  function handleManualResize(event: Event) {
    if (settings.notesAutoGrow) return;
    const el = event.currentTarget as HTMLTextAreaElement;
    const height = Math.round(el.getBoundingClientRect().height);
    if (height <= 0 || height === settings.notesHeight) return;
    settings.notesHeight = height;
    saveSettings();
  }

  function handleHintInput() {
    updateHintsFromNotes();
    resize(hintTextarea);
  }

  function handleSphereInput() {
    parseSphereNotesText(sphereText);
    resize(sphereTextarea);
  }

  $effect(() => {
    hintNotes.value;
    settings.notesAutoGrow;
    settings.notesHeight;
    resize(hintTextarea);
  });

  // Keep the sphere textarea in sync when placements change from elsewhere
  // (map/board click-to-assign) rather than only on direct text edits.
  $effect(() => {
    sphere.placements.length;
    if (activeTab !== "sphere") sphereText = serializeSpherePlacements();
  });

  function switchTab(tab: "hint" | "sphere") {
    activeTab = tab;
    if (tab === "sphere") {
      sphereText = serializeSpherePlacements();
      requestAnimationFrame(() => resize(sphereTextarea));
    } else {
      requestAnimationFrame(() => resize(hintTextarea));
    }
  }
</script>

<section class="notes-section">
  <div class="section-heading">
    <div class="segmented-control notes-tabs" role="tablist" aria-label="Notes type">
      <button class:active={activeTab === "hint"} type="button" role="tab" aria-selected={activeTab === "hint"} onclick={() => switchTab("hint")}>Hint Notes</button>
      <button class:active={activeTab === "sphere"} type="button" role="tab" aria-selected={activeTab === "sphere"} onclick={() => switchTab("sphere")}>Sphere Tracking</button>
    </div>
  </div>

  <!-- Own row rather than in the heading: the heading is a nowrap flex row in
       an auto-sized grid column, so an extra control there widened the whole
       panel and stopped the textarea tracking its width. -->
  <div class="notes-options">
    <label class="notes-grow-toggle" title="Grow the panel as notes are added, or keep it fixed and scroll inside the box">
      <input type="checkbox" checked={settings.notesAutoGrow} onchange={toggleAutoGrow} />
      <span>Grow with text</span>
    </label>
  </div>
  <div class="notes-editor" hidden={activeTab !== "hint"}>
    <pre class="notes-highlight" bind:this={highlightEl} aria-hidden="true">{#each highlightedLines as line, index (index)}<span class={line.className}>{line.text}</span>{"\n"}{/each}</pre>
    <textarea
      bind:this={hintTextarea}
      bind:value={hintNotes.value}
      oninput={handleHintInput}
      onscroll={syncScroll}
      onfocus={() => setNotesEditorFocused(true)}
      onblur={() => setNotesEditorFocused(false)}
      class="notes-input"
      class:fixed-height={!settings.notesAutoGrow}
      onmouseup={handleManualResize}
      spellcheck="false"
      aria-label="Hint notes"
      placeholder={"Type hints here, one per line.\n\nExamples:\ndragon roost to gohma\nhookshot at needle rock\nprogressive sword in dragon roost cavern boss"}
    ></textarea>
  </div>
  <textarea
    bind:this={sphereTextarea}
    bind:value={sphereText}
    oninput={handleSphereInput}
    class="notes-input"
    class:fixed-height={!settings.notesAutoGrow}
    onmouseup={handleManualResize}
    spellcheck="false"
    aria-label="Sphere tracking notes"
    hidden={activeTab !== "sphere"}
    placeholder={"Bomb at Dragon Roost Island - Wind Shrine\nDeku Leaf at Forbidden Woods - Kalle Demos Heart Container"}
  ></textarea>
</section>
