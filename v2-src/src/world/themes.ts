/* Every room's own furnishing, matched to its paintings and wall colour: the frame style, the lamps that
   light the paintings, the ceiling lamps, the bench and the metal of the fittings.
   Frames are profiles (outward offset from the canvas edge, depth off the wall) swept around each
   canvas by the vertex shader — see frameMesh.ts and the paintings pipeline in renderer.ts. */

/* frame segment materials: A = the style's wood/lacquer/paint colour, B = its metal or accent colour */
export const FM = { Wood: 1, Gold: 2, Lacquer: 3, Paint: 4, Silver: 5, Mat: 6, Bole: 7, Accent: 8 } as const;
/* carved ornament on a segment */
export const FO = { None: 0, Acanthus: 1, Bead: 2, Rope: 3, Chip: 4, Reed: 5, Twig: 6 } as const;

export const FrameStyle = {
  AntiqueGilt: 0, LouisGilt: 1, Oak: 2, Zakopane: 3, Walnut: 4, Rope: 5, Float: 6,
  Secession: 7, MuseumGilt: 8, PassePartout: 9, Japanese: 10, Twig: 11,
} as const;

type Pt = [number, number, number, number];   // d, z, material of the next segment, ornament
export interface FrameDef { pts: Pt[]; a: string; b: string; outer: number; depth: number }

const def = (a: string, b: string, pts: Pt[]): FrameDef =>
  ({ pts, a, b, outer: pts[pts.length - 1][0], depth: Math.max(...pts.map(p => p[1])) });
const { Wood, Gold, Lacquer, Paint, Silver, Mat, Bole, Accent } = FM;
const { None, Acanthus, Bead, Rope, Chip, Reed, Twig } = FO;

export const FRAMES: FrameDef[] = [
  // the lobby portrait: an antique gilt frame, darker gold
  def('#5a3e22', '#a8844a', [[0, 0.03, Gold, Bead], [0.006, 0.042, Gold, None], [0.014, 0.046, Gold, Reed], [0.032, 0.062, Gold, Acanthus],
    [0.058, 0.074, Gold, None], [0.075, 0.07, Gold, Bead], [0.088, 0.058, Gold, None], [0.095, 0.036, Wood, None], [0.095, 0, Wood, None]]),
  // Paris & Venice: Louis XV carved gilt, red bole showing in the hollow
  def('#8a3a26', '#d6aa5c', [[0, 0.03, Gold, Bead], [0.007, 0.044, Gold, None], [0.012, 0.044, Bole, None], [0.03, 0.05, Gold, Acanthus],
    [0.05, 0.072, Gold, Acanthus], [0.075, 0.08, Gold, None], [0.095, 0.072, Gold, Reed], [0.11, 0.055, Gold, None], [0.115, 0.03, Gold, None], [0.115, 0, Gold, None]]),
  // Landscapes: wide natural oak with a thin gilt slip
  def('#a8784a', '#c8a060', [[0, 0.03, Gold, None], [0.007, 0.038, Gold, None], [0.011, 0.04, Wood, None], [0.016, 0.048, Wood, None],
    [0.08, 0.052, Wood, None], [0.088, 0.046, Wood, None], [0.09, 0.03, Wood, None], [0.09, 0, Wood, None]]),
  // Tatra & mountains: light spruce, Zakopane-style chip carving
  def('#c89a5e', '#7a5230', [[0, 0.03, Wood, None], [0.01, 0.046, Wood, Chip], [0.05, 0.058, Wood, Chip], [0.07, 0.056, Wood, None],
    [0.08, 0.044, Wood, None], [0.08, 0, Wood, None]]),
  // Polish cities: dark walnut ogee with a gilt liner
  def('#4a2c18', '#c8a060', [[0, 0.03, Gold, Bead], [0.006, 0.04, Gold, None], [0.01, 0.042, Wood, None], [0.022, 0.056, Wood, None],
    [0.04, 0.066, Wood, None], [0.058, 0.062, Wood, None], [0.068, 0.05, Wood, None], [0.072, 0.034, Wood, None], [0.072, 0, Wood, None]]),
  // Marines: limed white wood with a rope-twist moulding and a navy liner
  def('#e8e2d4', '#2a3c50', [[0, 0.03, Accent, None], [0.006, 0.036, Accent, None], [0.01, 0.038, Paint, None], [0.018, 0.05, Paint, Rope],
    [0.034, 0.066, Paint, Rope], [0.05, 0.05, Paint, None], [0.068, 0.046, Paint, None], [0.074, 0.032, Paint, None], [0.074, 0, Paint, None]]),
  // Impressions & abstraction: a slim black float frame, the canvas floating over a shadow gap
  def('#141414', '#e8e2d4', [[0, 0.03, Mat, None], [0.0005, 0.008, Lacquer, None], [0.009, 0.008, Lacquer, None], [0.009, 0.036, Lacquer, None],
    [0.016, 0.036, Lacquer, None], [0.016, 0, Lacquer, None]]),
  // Scenes & symbolism: black lacquer with a gold Secession bead and line
  def('#16110e', '#c9a24e', [[0, 0.03, Gold, Bead], [0.007, 0.043, Gold, None], [0.012, 0.044, Lacquer, None], [0.03, 0.06, Lacquer, None],
    [0.06, 0.064, Gold, None], [0.064, 0.064, Lacquer, None], [0.076, 0.056, Lacquer, None], [0.08, 0.036, Lacquer, None], [0.08, 0, Lacquer, None]]),
  // Portraits & nudes: classic museum gilt, beaded ogee with carved leaves
  def('#6a4424', '#d0a452', [[0, 0.03, Gold, Bead], [0.006, 0.042, Gold, None], [0.012, 0.046, Gold, None], [0.026, 0.06, Gold, Reed],
    [0.046, 0.072, Gold, Acanthus], [0.07, 0.072, Gold, None], [0.086, 0.062, Gold, Bead], [0.096, 0.046, Gold, None], [0.1, 0.03, Gold, None], [0.1, 0, Gold, None]]),
  // Drawings & diptychs: white passe-partout with a bevelled window, silver fillet, thin maple frame
  def('#dcc6a0', '#e8e4da', [[0, 0.03, Mat, None], [0.004, 0.034, Mat, None], [0.07, 0.034, Silver, None], [0.072, 0.046, Wood, None],
    [0.086, 0.048, Wood, None], [0.09, 0.036, Wood, None], [0.09, 0, Wood, None]]),
  // the secret room's Japanese ink drawing: a silk mat and thin black lacquer
  def('#141210', '#e6dcc4', [[0, 0.03, Accent, None], [0.003, 0.032, Accent, None], [0.05, 0.032, Lacquer, None], [0.05, 0.044, Lacquer, None],
    [0.06, 0.044, Lacquer, None], [0.06, 0, Lacquer, None]]),
  // the way back from the forest: № 052 in a gilded frame of twigs
  def('#5a4026', '#c8a050', [[0, 0.03, Gold, Twig], [0.02, 0.058, Gold, Twig], [0.045, 0.07, Gold, Twig], [0.068, 0.055, Gold, Twig],
    [0.08, 0.03, Wood, Twig], [0.08, 0, Wood, None]]),
];
export const FRAME_MAXP = Math.max(...FRAMES.map(f => f.pts.length));

/* the lamps lighting the paintings */
export const PicLamp = { Spot: 0, Picture: 1 } as const;
/* ceiling lamps */
export const CeilLamp = {
  Halo: 0, Murano: 1, Drum: 2, Cartwheel: 3, Lantern: 4, Ship: 5, Laylight: 6, Tulip: 7, Alabaster: 8, Enamel: 9, Paper: 10,
} as const;
export const BenchKind = {
  None: 0, Banquette: 1, LiveEdge: 2, Zakopane: 3, Planty: 4, Deck: 5, Chrome: 6, Borne: 7, Chesterfield: 8, PlanChest: 9, Hinoki: 10,
} as const;

export interface Theme {
  frame: number;
  picLamp: number;
  metal: string;          // fittings: lamps, legs, hardware
  ceiling: number;
  spacing: number;        // ceiling lamps every … metres (at least one per room)
  bench: number;
}

const BRASS = '#c09452', BRONZE = '#6e5236', IRON = '#2c2a28', WHITE = '#e8e6e0', BLACK = '#1c1b1a';

export const THEMES: Record<string, Theme> = {
  '__lobby':               { frame: FrameStyle.AntiqueGilt, picLamp: PicLamp.Picture, metal: BRASS, ceiling: CeilLamp.Halo, spacing: 99, bench: BenchKind.None },
  'Paryż i Wenecja':       { frame: FrameStyle.LouisGilt, picLamp: PicLamp.Picture, metal: BRASS, ceiling: CeilLamp.Murano, spacing: 4.6, bench: BenchKind.Banquette },
  'Pejzaże':               { frame: FrameStyle.Oak, picLamp: PicLamp.Spot, metal: BRONZE, ceiling: CeilLamp.Drum, spacing: 4.6, bench: BenchKind.LiveEdge },
  'Tatry i góry':          { frame: FrameStyle.Zakopane, picLamp: PicLamp.Spot, metal: IRON, ceiling: CeilLamp.Cartwheel, spacing: 6.5, bench: BenchKind.Zakopane },
  'Miasta polskie':        { frame: FrameStyle.Walnut, picLamp: PicLamp.Spot, metal: BRONZE, ceiling: CeilLamp.Lantern, spacing: 2.9, bench: BenchKind.Planty },
  'Mariny':                { frame: FrameStyle.Rope, picLamp: PicLamp.Spot, metal: BRASS, ceiling: CeilLamp.Ship, spacing: 2.9, bench: BenchKind.Deck },
  'Impresje i abstrakcje': { frame: FrameStyle.Float, picLamp: PicLamp.Spot, metal: WHITE, ceiling: CeilLamp.Laylight, spacing: 4.4, bench: BenchKind.Chrome },
  'Sceny i symbolizm':     { frame: FrameStyle.Secession, picLamp: PicLamp.Picture, metal: BRASS, ceiling: CeilLamp.Tulip, spacing: 5, bench: BenchKind.Borne },
  'Portrety i akty':       { frame: FrameStyle.MuseumGilt, picLamp: PicLamp.Picture, metal: BRASS, ceiling: CeilLamp.Alabaster, spacing: 4.8, bench: BenchKind.Chesterfield },
  'Rysunki i dyptyki':     { frame: FrameStyle.PassePartout, picLamp: PicLamp.Spot, metal: BLACK, ceiling: CeilLamp.Enamel, spacing: 3.6, bench: BenchKind.PlanChest },
  '__secret':              { frame: FrameStyle.Japanese, picLamp: PicLamp.Spot, metal: BLACK, ceiling: CeilLamp.Paper, spacing: 99, bench: BenchKind.Hinoki },
};
