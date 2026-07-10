/**
 * Pure 3D surface ("mountain" / carpet) plot geometry — NO DOM.
 *
 * Given a 2D grid of heights (intensities 0..1), project it as a shaded 3D surface
 * using an oblique/isometric projection with painter's-algorithm ordering, so a
 * component can render it as flat SVG polygons. Used to show the intensity of a
 * sky region as a relief map. Unit-tested against closed-form geometry.
 *
 * Grid convention: `grid[row][col]`, row 0 = far (back), increasing row = nearer
 * (front); col 0 = left. Height raises a point UP the screen (smaller y).
 */

export interface SurfaceOptions {
  /** Output box width (px). */
  width: number;
  /** Output box height (px). */
  height: number;
  /** Vertical exaggeration of the height axis, 0..1 of the box height. Default 0.45. */
  zScale?: number;
  /** Horizontal skew of the isometric grid (0..1). Default 0.5. */
  skew?: number;
}

export interface SurfaceCell {
  /** The four projected screen corners of the cell, in draw order. */
  points: [number, number][];
  /** 0..1 mean height of the cell (for colouring). */
  height: number;
  /** Painter's-algorithm depth key — larger = farther = drawn first. */
  depth: number;
}

export interface SurfaceGeometry {
  /** Cells sorted back-to-front (farthest first) for painter's algorithm. */
  cells: SurfaceCell[];
  rows: number;
  cols: number;
}

/**
 * Project a height grid to 2D surface cells. Each interior cell (row r, col c)
 * becomes a quad from grid corners (r,c),(r,c+1),(r+1,c+1),(r+1,c). Points are
 * scaled to fit [0,width]×[0,height]; taller heights sit higher on screen.
 */
export function surfaceGeometry(grid: number[][], opts: SurfaceOptions): SurfaceGeometry {
  const rows = grid.length;
  const cols = rows > 0 ? grid[0]!.length : 0;
  const zScale = opts.zScale ?? 0.45;
  const skew = opts.skew ?? 0.5;
  if (rows < 2 || cols < 2) return { cells: [], rows, cols };

  // Oblique/isometric projection of grid point (row r, col c) with height z into a
  // unit plane: x grows left→right with col and shifts each FARTHER row rightward
  // by `skew` (revealing depth); y grows front-ward with row and UP with height.
  const gp = (r: number, c: number): [number, number] => {
    const fr = rows > 1 ? r / (rows - 1) : 0; // 0=back, 1=front
    const baseX = (cols > 1 ? c / (cols - 1) : 0) + skew * (1 - fr) * 0.25;
    const y = fr - clamp01(grid[r]![c]!) * zScale;
    return [baseX, y];
  };

  // First pass: project every grid point, tracking bounds to normalise into the box.
  const raw: [number, number][][] = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let r = 0; r < rows; r++) {
    const rowPts: [number, number][] = [];
    for (let c = 0; c < cols; c++) {
      const p = gp(r, c);
      rowPts.push(p);
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    raw.push(rowPts);
  }

  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const pad = 2;
  const fit = (p: [number, number]): [number, number] => [
    pad + ((p[0] - minX) / spanX) * (opts.width - 2 * pad),
    pad + ((p[1] - minY) / spanY) * (opts.height - 2 * pad),
  ];

  const cells: SurfaceCell[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const p00 = fit(raw[r]![c]!);
      const p01 = fit(raw[r]![c + 1]!);
      const p11 = fit(raw[r + 1]![c + 1]!);
      const p10 = fit(raw[r + 1]![c]!);
      const height =
        (clamp01(grid[r]![c]!) + clamp01(grid[r]![c + 1]!) + clamp01(grid[r + 1]![c + 1]!) + clamp01(grid[r + 1]![c]!)) / 4;
      cells.push({
        points: [p00, p01, p11, p10],
        height,
        // Farther (smaller row) drawn first; within a row, doesn't matter much.
        depth: (rows - 1 - r) * cols + c,
      });
    }
  }
  // Painter's algorithm: farthest (largest depth) first.
  cells.sort((a, b) => b.depth - a.depth);
  return { cells, rows, cols };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0;
}
