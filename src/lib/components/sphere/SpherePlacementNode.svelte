<script lang="ts">
  // Ported from createSpherePlacementNode() (dev/app/app.js:3602+).
  import { WWRSphereEngine, type SphereCalculationResult } from "$lib/logic";
  import type { SpherePlacement } from "$lib/state/sphere.svelte";
  import { unassignPlacement } from "$lib/logic/assignment";
  import { recordTrackerAction } from "$lib/state/tracker-history.svelte";
  import { data } from "$lib/state/data.svelte";
  import { itemImage, getItemNumberBadge } from "$lib/logic/images";
  import { getAreaFromLocation } from "$lib/logic/data-loading";
  import { getProgressiveItemStageImageName } from "$lib/logic/sphere-progressive-items";
  import type { RelativeUnknownResult } from "$lib/logic/sphere-inference";

  let {
    placement,
    sphereNumber,
    calculation,
    relativeUnknown = null
  }: {
    placement: SpherePlacement;
    sphereNumber: number | null;
    calculation: SphereCalculationResult;
    relativeUnknown?: RelativeUnknownResult | null;
  } = $props();

  const normalize = WWRSphereEngine.normalize;

  const knownSphere = $derived(Number.isInteger(sphereNumber));
  const outOfLogic = $derived(!Number.isInteger(calculation.locationSpheres[normalize(placement.location)]));
  const itemKey = $derived(normalize(placement.item));
  const jalhallaRequired = $derived(!data.requiredBosses.size || data.requiredBosses.has(normalize("Jalhalla")));
  const mandatoryUpgrade = $derived(
    ["progressive sword", "progressive bow", "progressive picto box"].includes(itemKey) || (itemKey === "progressive shield" && jalhallaRequired)
  );
  const isPruned = $derived(!mandatoryUpgrade && (calculation.prunedPlacementIds || []).includes(placement.id));
  const cardClass = $derived(
    ["sphere-placement", placement.fromHint ? "hint-derived" : null, knownSphere ? null : "unknown-sphere-placement", outOfLogic ? "out-of-logic-placement" : null, isPruned ? "optional-placement" : null]
      .filter(Boolean)
      .join(" ")
  );
  const sphereLabel = $derived(knownSphere ? `Sphere ${sphereNumber}` : outOfLogic ? "Out of logic" : "Sphere unknown");
  const imageSrc = $derived(itemImage(getProgressiveItemStageImageName(placement, calculation, relativeUnknown) || placement.item));
  const badge = $derived(getItemNumberBadge(placement.item));
  const area = $derived(getAreaFromLocation(placement.location));
</script>

<button
  type="button"
  class={cardClass}
  data-node-id={placement.id}
  title={`${placement.item}\n${placement.location}\n${sphereLabel}${isPruned ? "\nOptional in the minimal playthrough" : ""}\nRight-click to remove placement and un-acquire the item`}
  oncontextmenu={(event) => { event.preventDefault(); recordTrackerAction(); unassignPlacement(placement); }}
>
  <span class="sphere-item-icon">
    <img src={imageSrc} alt="" />
    {#if badge}
      <span class="item-number {badge.className}">{badge.number}</span>
    {/if}
  </span>
  <span class="sphere-placement-label">
    <small class="sphere-placement-area">{area.replace(" Sector", "")}</small>
    <strong class="sphere-placement-location">{placement.location.replace(`${area} - `, "")}</strong>
  </span>
  {#if isPruned}
    <small class="sphere-optional-label">Optional</small>
  {/if}
</button>
