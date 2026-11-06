/** Type declarations for the tile builder CLI (plain Node ESM, JSDoc-typed). */
export declare const TILE_DEG: number;
export declare const FORMAT_VERSION: number;

/** Way event consumed by the tile core: id + inline coords + filtered tags. */
export interface WayEvent {
  id: number;
  coords: [number, number][]; // [lat, lng]
  tags: Record<string, string>;
}

export interface BuiltTile {
  ways: [number, [number, number][], Record<string, string>][];
}

export interface BuildResult {
  tiles: Map<string, BuiltTile>;
  wayCount: number;
  tileDeg: number;
}

export declare function buildTilesFromWays(
  ways: Iterable<WayEvent>,
  opts?: { tileDeg?: number },
): BuildResult;

export declare function waysFromXml(xml: string): Promise<WayEvent[]>;

export declare function waysFromPbf(pbfPath: string): Promise<WayEvent[]>;

export declare function buildTilesFromXml(
  xml: string,
  opts?: { tileDeg?: number },
): Promise<BuildResult>;

export declare function tileToJson(tile: BuiltTile): { v: number; w: BuiltTile['ways'] };
