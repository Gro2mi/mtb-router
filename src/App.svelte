<script lang="ts">
  import { onMount } from 'svelte';
  import { createMap, type MapHandle } from './lib/map/createMap';
  import { bindGestures, type GestureBinding } from './lib/map/pointerGestures';
  import { WaypointLayer, isUiTarget } from './lib/map/waypointLayer';
  import { RouteLayer } from './lib/map/routeLayer';
  import { i18n } from './lib/i18n.svelte';
  import { toast } from './lib/state/toast.svelte';
  import { planning } from './lib/state/planning.svelte';
  import { profileState } from './lib/state/profile.svelte';
  import { waypoints } from './lib/waypoints/store.svelte';
  import Sheet from './lib/ui/Sheet.svelte';
  import Toast from './lib/ui/Toast.svelte';
  import Fab from './lib/ui/Fab.svelte';
  import StatusPill from './lib/ui/StatusPill.svelte';
  import { ContourLayer } from './lib/map/contourLayer';
  import SearchBar from './lib/ui/SearchBar.svelte';
  import type { GeoResult } from './lib/search/geocode';
  import { Marker } from 'maplibre-gl';

  let mapContainer: HTMLDivElement;

  let mapHandle: MapHandle | undefined = $state();
  let layer: WaypointLayer | undefined = $state();
  let routeLayer: RouteLayer | undefined = $state();
  let contourLayer: ContourLayer | undefined = $state();
  let searchPin: Marker | null = null;

  /** place search: fly to the result and drop a pin until the next action */
  function onSearchPick(r: GeoResult): void {
    const { map } = mapHandle!;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    map.flyTo({
      center: [r.lng, r.lat],
      zoom: Math.max(map.getZoom(), 14),
      duration: reduced ? 0 : 1400,
    });
    searchPin?.remove();
    const el = document.createElement('div');
    el.className = 'mtbr-search-pin mtbr-ui';
    el.setAttribute('aria-hidden', 'true');
    searchPin = new Marker({ element: el }).setLngLat([r.lng, r.lat]).addTo(map);
  }

  function clearSearchPin(): void {
    searchPin?.remove();
    searchPin = null;
  }

  onMount(() => {
    // global error boundary (E7.3): surface uncaught failures as a toast
    // instead of failing silently; map tile 404s etc. are console-only
    let lastGeneric = 0;
    const generic = (): void => {
      const now = Date.now();
      if (now - lastGeneric > 4000) {
        lastGeneric = now;
        toast(i18n.m.generic_error());
      }
    };
    const onError = (e: ErrorEvent): void => {
      if (e.message?.includes('Failed to fetch')) return; // offline noise, handled elsewhere
      generic();
    };
    const onRejection = (e: PromiseRejectionEvent): void => {
      if (String(e.reason).includes('aborted')) return; // superseded plans
      generic();
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);

    mapHandle = createMap(mapContainer);
    const { map } = mapHandle;

    mapHandle.geolocate.on('error', (event: unknown) => {
      const error = event as GeolocationPositionError;
      if (error.code === error.PERMISSION_DENIED) toast(i18n.m.geolocation_denied());
      else if (error.code === error.POSITION_UNAVAILABLE) toast(i18n.m.geolocation_unavailable());
      else toast(i18n.m.geolocation_timeout());
    });

    // The waypoint/route layers add map sources, which requires the style to
    // be loaded first (addSource throws before the map's 'load' event).
    const onMapLoad = (): void => {
      // contours first: everything planned on top (route, waypoints) paints above
      contourLayer = new ContourLayer(map);
      contourLayer.setVisible(planning.contours);
      layer = new WaypointLayer(map, {
        onDelete: (id) => waypoints.remove(id),
        onMove: (id, lng, lat) => waypoints.move(id, lng, lat),
        onSnapProbe: (id, lng, lat) => {
          void planning.snapProbe(lng, lat).then((snap) => {
            layer?.onProbeResult(id, snap, lng, lat);
          });
        },
        onInsertAt: (index, lng, lat) => waypoints.insertAt(index, lng, lat),
      });
      routeLayer = new RouteLayer(map);
    };
    if (map.isStyleLoaded()) onMapLoad();
    else map.once('load', onMapLoad);

    // --- waypoint interactions (E2.2) -------------------------------------
    const addWaypointAt = (lng: number, lat: number): void => {
      waypoints.add(lng, lat);
    };

    // right-click anywhere on the map adds a waypoint (desktop)
    map.on('contextmenu', (e) => {
      clearSearchPin();
      addWaypointAt(e.lngLat.lng, e.lngLat.lat);
    });

    // touch/mouse gesture classification on the map surface
    const gestures: GestureBinding = bindGestures(mapContainer, {
      onTap: ({ x, y, target }) => {
        if (isUiTarget(target ?? null)) return;
        clearSearchPin();
        if (planning.mode !== 'plan') return;
        const lngLat = map.unproject([x, y]);
        addWaypointAt(lngLat.lng, lngLat.lat);
      },
      onLongPress: ({ x, y, target }) => {
        if (isUiTarget(target ?? null)) return;
        clearSearchPin();
        const lngLat = map.unproject([x, y]);
        addWaypointAt(lngLat.lng, lngLat.lat);
      },
    });

    // --- keyboard parity (E2.6/E2.7) --------------------------------------
    const onKeyDown = (e: KeyboardEvent): void => {
      const el = e.target instanceof Element ? e.target : null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) {
        return;
      }
      const key = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) waypoints.redo();
        else waypoints.undo();
      } else if (ctrl && key === 'y') {
        e.preventDefault();
        waypoints.redo();
      } else if (key === 'delete' || key === 'backspace') {
        if (waypoints.waypoints.length > 0) {
          e.preventDefault();
          waypoints.removeLast();
        }
      } else if (key === 'enter' && planning.mode === 'plan') {
        const center = map.getCenter();
        addWaypointAt(center.lng, center.lat);
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('keydown', onKeyDown);
      gestures.destroy();
      map.off('load', onMapLoad);
      clearSearchPin();
      routeLayer?.destroy();
      contourLayer?.destroy();
      layer?.destroy();
      mapHandle?.destroy();
      mapHandle = undefined;
      layer = undefined;
      routeLayer = undefined;
      contourLayer = undefined;
    };
  });

  // --- contour toggle (Settings) -------------------------------------------
  $effect(() => {
    contourLayer?.setVisible(planning.contours);
  });

  // --- corridor + routing pipeline (E3): plan when waypoints change --------
  $effect(() => {
    const pts = waypoints.waypoints.map((wp) => [wp.rawLng, wp.rawLat] as [number, number]);
    planning.ensureCorridor(pts);
  });

  // --- marker sync ---------------------------------------------------------
  $effect(() => {
    const list = waypoints.waypoints.map((wp) => ({ ...wp, snap: wp.snap }));
    layer?.sync(list);
  });

  // --- route rendering -----------------------------------------------------
  $effect(() => {
    routeLayer?.setRoute(planning.route);
  });

  // no zoom-to-fit: setting a waypoint (or a reroute) must never move the
  // camera — the user keeps their zoom level and position (user request)

  // --- profile scrub ↔ map marker (E5.3) -----------------------------------
  $effect(() => {
    const scrub = profileState.scrub;
    routeLayer?.setScrubPoint(scrub ? [scrub.lng, scrub.lat] : null);
  });
</script>

<div class="relative h-dvh w-full overflow-hidden">
  <!-- Wrapper carries the Tailwind geometry: maplibre's own CSS forces
       `position: relative` on the container element, which overrides layered
       Tailwind utilities (v4 cascade layers), so the container must not rely
       on `absolute inset-0` itself. -->
  <div class="absolute inset-0 {planning.mode === 'plan' ? 'plan-mode' : ''}">
    <div bind:this={mapContainer} class="map-surface h-full w-full" data-testid="map"></div>
  </div>
  {#if mapHandle}
    <SearchBar onPick={onSearchPick} onClear={clearSearchPin} />
  {/if}
  <Fab />
  <StatusPill />
  <Sheet />
  <Toast />
</div>
