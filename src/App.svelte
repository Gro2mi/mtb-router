<script lang="ts">
  import { onMount } from 'svelte';
  import { createMap, type MapHandle } from './lib/map/createMap';
  import { bindGestures, type GestureBinding } from './lib/map/pointerGestures';
  import { WaypointLayer, isUiTarget } from './lib/map/waypointLayer';
  import { RouteLayer } from './lib/map/routeLayer';
  import { i18n } from './lib/i18n.svelte';
  import { toast } from './lib/state/toast.svelte';
  import { planning } from './lib/state/planning.svelte';
  import { waypoints } from './lib/waypoints/store.svelte';
  import Sheet from './lib/ui/Sheet.svelte';
  import Toast from './lib/ui/Toast.svelte';
  import Fab from './lib/ui/Fab.svelte';
  import StatusPill from './lib/ui/StatusPill.svelte';

  let mapContainer: HTMLDivElement;
  let mapHandle: MapHandle | undefined = $state();
  let layer: WaypointLayer | undefined = $state();
  let routeLayer: RouteLayer | undefined = $state();

  onMount(() => {
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
      addWaypointAt(e.lngLat.lng, e.lngLat.lat);
    });

    // touch/mouse gesture classification on the map surface
    const gestures: GestureBinding = bindGestures(mapContainer, {
      onTap: ({ x, y, target }) => {
        if (isUiTarget(target ?? null)) return;
        if (planning.mode !== 'plan') return;
        const lngLat = map.unproject([x, y]);
        addWaypointAt(lngLat.lng, lngLat.lat);
      },
      onLongPress: ({ x, y, target }) => {
        if (isUiTarget(target ?? null)) return;
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
      window.removeEventListener('keydown', onKeyDown);
      gestures.destroy();
      map.off('load', onMapLoad);
      routeLayer?.destroy();
      layer?.destroy();
      mapHandle?.destroy();
      mapHandle = undefined;
      layer = undefined;
      routeLayer = undefined;
    };
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
</script>

<div class="relative h-dvh w-full overflow-hidden">
  <!-- Wrapper carries the Tailwind geometry: maplibre's own CSS forces
       `position: relative` on the container element, which overrides layered
       Tailwind utilities (v4 cascade layers), so the container must not rely
       on `absolute inset-0` itself. -->
  <div class="absolute inset-0 {planning.mode === 'plan' ? 'plan-mode' : ''}">
    <div bind:this={mapContainer} class="map-surface h-full w-full" data-testid="map"></div>
  </div>
  <Fab />
  <StatusPill />
  <Sheet />
  <Toast />
</div>
