/**
 * Elevation profile UI state (E5.3): two-way sync between the canvas profile
 * and the map — highlight band (set from map segment clicks) and the scrub
 * position (set from profile pointer interaction, rendered as a map marker).
 */
export interface ProfileHighlight {
  startM: number;
  endM: number;
}

export interface ProfileScrub {
  dM: number;
  lat: number;
  lng: number;
  ele: number | null;
}

const state = $state({
  highlight: null as ProfileHighlight | null,
  scrub: null as ProfileScrub | null,
});

export const profileState = {
  get highlight(): ProfileHighlight | null {
    return state.highlight;
  },
  get scrub(): ProfileScrub | null {
    return state.scrub;
  },
  setHighlight(h: ProfileHighlight | null): void {
    state.highlight = h;
  },
  setScrub(s: ProfileScrub | null): void {
    state.scrub = s;
  },
  reset(): void {
    state.highlight = null;
    state.scrub = null;
  },
};
