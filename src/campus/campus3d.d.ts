export type Pt = [number, number];

export type ZoneShape = {
  id: number;
  poly: Pt[];
  color: string;
  label?: string;
  sub?: string;
  aria?: string;
  mine?: boolean;
  dim?: boolean;
};

export type Campus = {
  setZones(z: ZoneShape[]): void;
  selectZone(id: number | null, fly?: boolean): void;
  focusPoly(poly: Pt[]): void;
  setView(id: string): void;
  setLabels(o: { buildings: boolean; zones?: boolean }): void;
  setDrawing(on: boolean): void;
  setDraft(points: Pt[]): void;
  setTime(h: number): void;
  northUp(): void;
  dispose(): void;
  views: { id: string; name: string }[];
};

export const PX_PER_M: number;

export function createCampus(stage: HTMLElement, opts?: {
  onPick?: (id: number | null) => void;
  onDrawPoint?: (p: Pt) => void;
  onUserMove?: () => void;
  onHeading?: (rad: number) => void;
}): Campus;
