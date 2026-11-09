/**
 * "North the map" control (user request): a high-contrast compass button that
 * resets the map bearing to 0. The needle counter-rotates with the current
 * bearing; the button dims (aria-pressed) when the map already faces north.
 */
import type { IControl, Map as MapLibreMap } from 'maplibre-gl';
import { i18n } from '../i18n.svelte';

const NORTH_EPSILON_DEG = 2;

export class NorthControl implements IControl {
  private map: MapLibreMap | null = null;
  private container: HTMLElement | null = null;
  private button: HTMLButtonElement | null = null;
  private onRotate: (() => void) | null = null;

  onAdd(map: MapLibreMap): HTMLElement {
    this.map = map;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mtbr-north mtbr-ui';
    button.setAttribute('aria-label', i18n.m.north_map());
    button.title = i18n.m.north_map();
    button.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
        <g class="mtbr-north-needle">
          <polygon points="12,3 16,14 12,11.5 8,14" fill="currentColor" stroke="none"></polygon>
          <polygon points="12,21 8,10 12,12.5 16,10" fill="none" stroke="currentColor" stroke-width="1.5"></polygon>
        </g>
      </svg>`;

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      map.easeTo({ bearing: 0, pitch: 0, duration: 300 });
    });
    button.addEventListener('keydown', (event) => event.stopPropagation());

    const container = document.createElement('div');
    // maplibregl-ctrl base class = float/clear/margin like the other controls
    container.className = 'maplibregl-ctrl maplibregl-ctrl-group mtbr-north-group';
    container.appendChild(button);

    const update = (): void => {
      const bearing = map.getBearing();
      const needle = button.querySelector<SVGElement>('.mtbr-north-needle');
      if (needle) needle.style.transform = `rotate(${-bearing}deg)`;
      const north = Math.abs(bearing) < NORTH_EPSILON_DEG;
      button.setAttribute('aria-pressed', String(north));
      button.classList.toggle('mtbr-north-active', north);
    };
    map.on('rotate', update);
    update();

    this.button = button;
    this.container = container;
    this.onRotate = update;
    return container;
  }

  onRemove(): void {
    if (this.map && this.onRotate) this.map.off('rotate', this.onRotate);
    this.container?.remove();
    this.map = null;
    this.container = null;
    this.button = null;
    this.onRotate = null;
  }
}
