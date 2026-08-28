<script lang="ts">
  // "A newer release is on GitHub" banner in the Control Panel.
  //
  // Notification only - it links to the release rather than installing, since
  // this ships portable and a running .exe can't replace itself on Windows.
  // Dismissal is remembered per version so the same release doesn't nag on
  // every launch.
  import { onMount } from "svelte";
  import { checkForNewerRelease, openReleasePage, type ReleaseInfo } from "$lib/tauri/release-check";

  const DISMISSED_KEY = "ww-rando-hint-tracker-dismissed-release";

  let release: ReleaseInfo | null = $state(null);

  onMount(async () => {
    const found = await checkForNewerRelease();
    if (!found) return;
    try {
      if (localStorage.getItem(DISMISSED_KEY) === found.version) return;
    } catch {
      // Storage unavailable - showing the notice is the safer default.
    }
    release = found;
  });

  function dismiss() {
    try {
      if (release) localStorage.setItem(DISMISSED_KEY, release.version);
    } catch {
      // Non-fatal: it just means the notice returns next launch.
    }
    release = null;
  }
</script>

{#if release}
  <div class="update-notice" role="status">
    <span class="update-notice-text">
      Version <strong>{release.version}</strong> is available on GitHub.
    </span>
    <button class="tool-button" type="button" onclick={() => openReleasePage(release!.url)}>View release</button>
    <button class="tool-button" type="button" onclick={dismiss}>Dismiss</button>
  </div>
{/if}
