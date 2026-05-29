#!/usr/bin/env node
// Emits 65 placeholder SVG illustrations — one per row in customization_options.
// Each SVG is a small, distinct line-art glyph designed for ~180×220 thumbnail
// rendering inside the Customize-Your-Suit drawer's option-card grid.
//
// All glyphs share a single viewBox and visual language (1.6px black stroke,
// no fill, rounded line joins) so the grid reads as a cohesive set.
//
// Run from project root: node scripts/generate-customization-svgs.mjs
// Output: assets/customization/svg/{option_id}.svg

import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = 'assets/customization/svg';
fs.mkdirSync(OUT_DIR, { recursive: true });

// Shared SVG wrapper
const wrap = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 240" fill="none" stroke="#1a1a1a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

// Reusable silhouettes (centered, leave room for variant overlays)
//   JACKET_FRONT  — a generic jacket-front outline w/ V neckline
const JACKET_FRONT = `<path d="M 100 38 L 70 50 L 50 80 L 50 210 L 100 220 L 150 210 L 150 80 L 130 50 Z M 100 38 L 80 110 M 100 38 L 120 110"/>`;
//   JACKET_BACK   — generic jacket-back outline
const JACKET_BACK = `<path d="M 50 60 L 50 210 L 100 220 L 150 210 L 150 60 L 100 50 Z"/>`;
//   PANTS_OUTLINE — 2 leg shapes coming down from waist
const PANTS_OUTLINE = `<path d="M 50 50 L 150 50 L 145 220 L 110 220 L 100 90 L 90 220 L 55 220 Z"/>`;
//   WAIST_BAND    — close-up waistband only
const WAIST_BAND = `<rect x="30" y="90" width="140" height="50" rx="2"/>`;
//   PANT_LEG      — a single pant leg close-up
const PANT_LEG = `<path d="M 75 40 L 75 210 L 125 210 L 125 40 Z"/>`;

const G = {}; // option_id → inner svg content

// ---------------- JACKET CONSTRUCTION (3) ----------------
G['jacket-construction-half-canvas']   = JACKET_FRONT + `<path d="M 65 105 L 135 105" stroke-dasharray="3 3"/>`;
G['jacket-construction-full-canvas']   = JACKET_FRONT + `<path d="M 65 105 L 135 105 M 60 135 L 140 135 M 58 165 L 142 165" stroke-dasharray="3 3"/>`;
G['jacket-construction-unconstructed'] = JACKET_FRONT.replace('M 100 38 L 70 50 L 50 80', 'M 100 38 Q 75 48 50 80'); // softer shoulder, no internal lines

// ---------------- JACKET STYLE (4) ----------------
G['jacket-style-sb-1-button'] = JACKET_FRONT + `<circle cx="100" cy="140" r="4"/>`;
G['jacket-style-sb-2-button'] = JACKET_FRONT + `<circle cx="100" cy="125" r="4"/><circle cx="100" cy="160" r="4"/>`;
G['jacket-style-sb-3-button'] = JACKET_FRONT + `<circle cx="100" cy="115" r="4"/><circle cx="100" cy="145" r="4"/><circle cx="100" cy="175" r="4"/>`;
G['jacket-style-db-6x2']       = JACKET_FRONT
  + `<circle cx="80" cy="115" r="4"/><circle cx="120" cy="115" r="4"/>`
  + `<circle cx="80" cy="150" r="4"/><circle cx="120" cy="150" r="4"/>`
  + `<circle cx="80" cy="185" r="4"/><circle cx="120" cy="185" r="4"/>`;

// ---------------- JACKET LAPEL (3) ----------------
G['jacket-lapel-notch'] = JACKET_FRONT + `<path d="M 85 90 L 100 75 L 115 90"/><path d="M 87 95 L 78 80 M 113 95 L 122 80"/>`; // notch V at gorge
G['jacket-lapel-peak']  = JACKET_FRONT + `<path d="M 82 95 L 100 70 L 118 95"/><path d="M 100 70 L 90 78 M 100 70 L 110 78"/>`; // peak ▲
G['jacket-lapel-shawl'] = JACKET_FRONT + `<path d="M 80 95 Q 100 65 120 95"/>`;                                                    // shawl curve

// ---------------- JACKET INTERIOR STYLE (3) ----------------
G['jacket-interior-style-standard']    = JACKET_FRONT + `<path d="M 70 95 L 70 145 M 130 95 L 130 145" stroke-dasharray="2 4"/>`;
G['jacket-interior-style-fully-lined'] = JACKET_FRONT + `<path d="M 70 95 L 70 205 M 130 95 L 130 205 M 90 110 L 90 200 M 110 110 L 110 200" stroke-dasharray="2 4"/>`;
G['jacket-interior-style-half-lined']  = JACKET_FRONT + `<path d="M 70 95 L 70 125 M 130 95 L 130 125" stroke-dasharray="2 4"/>`;

// ---------------- JACKET REAR VENT (3) ----------------
G['jacket-rear-vent-side']   = JACKET_BACK + `<path d="M 70 165 L 70 215"/><path d="M 130 165 L 130 215"/>`;
G['jacket-rear-vent-center'] = JACKET_BACK + `<path d="M 100 165 L 100 215"/>`;
G['jacket-rear-vent-none']   = JACKET_BACK;

// ---------------- JACKET EXTERIOR POCKET (5) ----------------
// All show a close-up of a pocket area on the jacket
const POCKET_FRAME = `<rect x="35" y="60" width="130" height="120" rx="2"/>`;
G['jacket-exterior-pocket-flap']          = POCKET_FRAME + `<path d="M 60 110 L 140 110 L 140 130 L 60 130 Z M 60 110 L 60 100 L 140 100 L 140 110"/>`;
G['jacket-exterior-pocket-jetted']        = POCKET_FRAME + `<path d="M 60 120 L 140 120"/>`;
G['jacket-exterior-pocket-patch']         = POCKET_FRAME + `<path d="M 60 95 L 140 95 L 140 145 L 60 145 Z"/>`;
G['jacket-exterior-pocket-flap-ticket']   = POCKET_FRAME + `<path d="M 60 130 L 140 130 L 140 150 L 60 150 Z M 60 130 L 60 120 L 140 120 L 140 130"/><path d="M 90 95 L 140 95 L 140 105 L 90 105 Z M 90 95 L 90 87 L 140 87 L 140 95"/>`;
G['jacket-exterior-pocket-jetted-ticket'] = POCKET_FRAME + `<path d="M 60 130 L 140 130"/><path d="M 90 100 L 140 100"/>`;

// ---------------- JACKET BUTTONS (5) — close-up button discs ----------------
const BUTTON_CIRCLE = (fill = 'none') => `<circle cx="100" cy="120" r="50" fill="${fill}"/>`;
const BUTTON_HOLES = `<circle cx="92" cy="112" r="2.5"/><circle cx="108" cy="112" r="2.5"/><circle cx="92" cy="128" r="2.5"/><circle cx="108" cy="128" r="2.5"/>`;
G['jacket-buttons-horn']   = BUTTON_CIRCLE() + BUTTON_HOLES + `<path d="M 65 100 Q 100 85 135 100" opacity="0.5"/>`;                              // marbling hint
G['jacket-buttons-dark']   = BUTTON_CIRCLE('#3a3530') + BUTTON_HOLES.replace(/stroke="#1a1a1a"/g, 'stroke="#fff"');
G['jacket-buttons-brown']  = BUTTON_CIRCLE('#7b5b3a') + `<circle cx="92" cy="112" r="2.5" fill="#fff"/><circle cx="108" cy="112" r="2.5" fill="#fff"/><circle cx="92" cy="128" r="2.5" fill="#fff"/><circle cx="108" cy="128" r="2.5" fill="#fff"/>`;
G['jacket-buttons-black']  = BUTTON_CIRCLE('#1a1a1a') + `<circle cx="92" cy="112" r="2.5" fill="#fff"/><circle cx="108" cy="112" r="2.5" fill="#fff"/><circle cx="92" cy="128" r="2.5" fill="#fff"/><circle cx="108" cy="128" r="2.5" fill="#fff"/>`;
G['jacket-buttons-formal'] = BUTTON_CIRCLE() + BUTTON_HOLES + `<path d="M 75 90 Q 100 75 110 95" opacity="0.7"/>`;                                // shine line

// ---------------- JACKET MONOGRAM (2) ----------------
G['jacket-monogram-none'] = `<rect x="35" y="60" width="130" height="120" rx="3" stroke-dasharray="4 4"/>`;
G['jacket-monogram-add']  = `<rect x="35" y="60" width="130" height="120" rx="3" stroke-dasharray="4 4"/>`
  + `<text x="100" y="135" text-anchor="middle" font-family="Georgia, serif" font-size="34" font-style="italic" stroke="none" fill="#1a1a1a">ABC</text>`;

// ---------------- JACKET INTERIOR LINING (2) ----------------
G['jacket-interior-lining-standard'] = `<rect x="35" y="40" width="130" height="160" rx="3"/>`;
G['jacket-interior-lining-contrast'] = `<rect x="35" y="40" width="130" height="160" rx="3"/>`
  + `<path d="M 35 65 L 165 65 M 35 90 L 165 90 M 35 115 L 165 115 M 35 140 L 165 140 M 35 165 L 165 165 M 35 190 L 165 190" stroke-dasharray="2 6" opacity="0.6"/>`;

// ---------------- JACKET SLEEVE BUTTONS (3) — close-up cuff ----------------
const CUFF = `<rect x="40" y="50" width="120" height="160" rx="2"/>`;
G['jacket-sleeve-buttons-non-functional'] = CUFF
  + `<circle cx="100" cy="80" r="4"/><circle cx="100" cy="105" r="4"/><circle cx="100" cy="130" r="4"/><circle cx="100" cy="155" r="4"/>`;
G['jacket-sleeve-buttons-functional'] = CUFF
  + `<circle cx="100" cy="80" r="4"/><circle cx="100" cy="105" r="4"/><circle cx="100" cy="130" r="4"/><circle cx="100" cy="155" r="4"/>`
  + `<path d="M 110 80 L 145 80 M 110 105 L 145 105 M 110 130 L 145 130 M 110 155 L 145 155" opacity="0.5"/>`;
G['jacket-sleeve-buttons-kissing'] = CUFF
  + `<circle cx="96" cy="80" r="5"/><circle cx="104" cy="80" r="5"/>`
  + `<circle cx="96" cy="100" r="5"/><circle cx="104" cy="100" r="5"/>`
  + `<circle cx="96" cy="120" r="5"/><circle cx="104" cy="120" r="5"/>`
  + `<circle cx="96" cy="140" r="5"/><circle cx="104" cy="140" r="5"/>`;

// ---------------- JACKET TUXEDO CONTRAST (3) ----------------
G['jacket-tuxedo-contrast-none']     = JACKET_FRONT;
G['jacket-tuxedo-contrast-satin']    = JACKET_FRONT
  + `<path d="M 100 38 L 80 110 L 75 165 L 65 165 L 50 80 L 70 50 Z" fill="#1a1a1a"/>`
  + `<path d="M 100 38 L 120 110 L 125 165 L 135 165 L 150 80 L 130 50 Z" fill="#1a1a1a"/>`;
G['jacket-tuxedo-contrast-grosgrain'] = JACKET_FRONT
  + `<path d="M 100 38 L 80 110 L 75 165 L 65 165 L 50 80 L 70 50 Z" fill="#4a4540"/>`
  + `<path d="M 100 38 L 120 110 L 125 165 L 135 165 L 150 80 L 130 50 Z" fill="#4a4540"/>`
  + `<path d="M 55 70 L 70 70 M 53 85 L 72 85 M 52 100 L 74 100 M 53 115 L 76 115 M 55 130 L 78 130 M 56 145 L 79 145" stroke="#fff" opacity="0.5"/>`
  + `<path d="M 145 70 L 130 70 M 147 85 L 128 85 M 148 100 L 126 100 M 147 115 L 124 115 M 145 130 L 122 130 M 144 145 L 121 145" stroke="#fff" opacity="0.5"/>`;

// ---------------- PANTS PLEATS (3) ----------------
G['pants-pleats-none']   = PANTS_OUTLINE;
G['pants-pleats-single'] = PANTS_OUTLINE + `<path d="M 75 55 L 75 105 M 125 55 L 125 105"/>`;
G['pants-pleats-double'] = PANTS_OUTLINE + `<path d="M 70 55 L 70 100 M 80 55 L 80 100 M 120 55 L 120 100 M 130 55 L 130 100"/>`;

// ---------------- PANTS WAISTBAND (4) ----------------
G['pants-waistband-belt-loops']    = WAIST_BAND
  + `<path d="M 55 85 L 55 95 M 75 85 L 75 95 M 100 85 L 100 95 M 125 85 L 125 95 M 145 85 L 145 95"/>`;
G['pants-waistband-side-tabs']     = WAIST_BAND
  + `<path d="M 30 110 L 15 105 L 15 125 L 30 120 Z M 170 110 L 185 105 L 185 125 L 170 120 Z"/>`
  + `<rect x="18" y="113" width="9" height="4"/>`
  + `<rect x="173" y="113" width="9" height="4"/>`;
G['pants-waistband-belt-and-tabs'] = WAIST_BAND
  + `<path d="M 60 85 L 60 95 M 100 85 L 100 95 M 140 85 L 140 95"/>`
  + `<path d="M 30 110 L 15 105 L 15 125 L 30 120 Z M 170 110 L 185 105 L 185 125 L 170 120 Z"/>`;
G['pants-waistband-none']          = WAIST_BAND;

// ---------------- PANTS BACK POCKETS (2) ----------------
const PANTS_BACK = `<path d="M 50 60 L 150 60 L 145 220 L 55 220 Z M 100 60 L 100 220"/>`;
G['pants-back-pockets-two'] = PANTS_BACK
  + `<rect x="60" y="85" width="32" height="10" rx="1"/><rect x="108" y="85" width="32" height="10" rx="1"/>`;
G['pants-back-pockets-one'] = PANTS_BACK
  + `<rect x="108" y="85" width="32" height="10" rx="1"/>`;

// ---------------- PANTS WAIST CLOSURE (5) ----------------
G['pants-waist-closure-standard']         = WAIST_BAND + `<circle cx="100" cy="115" r="4"/>`;
G['pants-waist-closure-extended-round']   = WAIST_BAND + `<path d="M 100 90 L 145 90 Q 162 115 145 140 L 100 140"/><circle cx="135" cy="115" r="3.5"/>`;
G['pants-waist-closure-extended-arrow']   = WAIST_BAND + `<path d="M 100 90 L 145 90 L 165 115 L 145 140 L 100 140"/><circle cx="135" cy="115" r="3.5"/>`;
G['pants-waist-closure-extended-square']  = WAIST_BAND + `<path d="M 100 90 L 160 90 L 160 140 L 100 140"/><circle cx="140" cy="115" r="3.5"/>`;
G['pants-waist-closure-double-button']    = WAIST_BAND + `<circle cx="90" cy="115" r="4"/><circle cx="115" cy="115" r="4"/>`;

// ---------------- PANTS HEM (2) ----------------
G['pants-hem-no-cuff']   = PANT_LEG;
G['pants-hem-with-cuff'] = PANT_LEG + `<path d="M 75 185 L 125 185"/>`;

// ---------------- PANTS BUTTONS (3) ----------------
G['pants-buttons-standard']        = BUTTON_CIRCLE() + BUTTON_HOLES + `<path d="M 65 100 Q 100 85 135 100" opacity="0.5"/>`;
G['pants-buttons-matching-jacket'] = BUTTON_CIRCLE() + BUTTON_HOLES;
G['pants-buttons-contrast']        = BUTTON_CIRCLE('#1a1a1a') + `<circle cx="92" cy="112" r="2.5" fill="#fff"/><circle cx="108" cy="112" r="2.5" fill="#fff"/><circle cx="92" cy="128" r="2.5" fill="#fff"/><circle cx="108" cy="128" r="2.5" fill="#fff"/>`;

// ---------------- PANTS SUSPENDER BUTTONS (2) ----------------
G['pants-suspender-buttons-none'] = WAIST_BAND;
G['pants-suspender-buttons-add']  = WAIST_BAND
  + `<circle cx="55" cy="115" r="3"/><circle cx="73" cy="115" r="3"/><circle cx="92" cy="115" r="3"/><circle cx="108" cy="115" r="3"/><circle cx="127" cy="115" r="3"/><circle cx="145" cy="115" r="3"/>`;

// ---------------- PANTS FRONT POCKETS (2) ----------------
G['pants-front-pockets-slanted'] = PANTS_OUTLINE
  + `<path d="M 55 70 L 75 95 M 145 70 L 125 95"/>`;
G['pants-front-pockets-on-seam'] = PANTS_OUTLINE
  + `<path d="M 55 60 L 55 100 M 145 60 L 145 100"/>`;

// ---------------- PANTS KNEE LINING (3) ----------------
G['pants-knee-lining-none']  = PANT_LEG;
G['pants-knee-lining-front'] = PANT_LEG + `<path d="M 80 100 L 120 100 L 120 145 L 80 145 Z" stroke-dasharray="3 3"/>`;
G['pants-knee-lining-full']  = PANT_LEG + `<path d="M 80 50 L 120 50 L 120 200 L 80 200 Z" stroke-dasharray="3 3"/>`;

// ---------------- PANTS TUXEDO CONTRAST (3) ----------------
G['pants-tuxedo-contrast-none']      = PANT_LEG;
G['pants-tuxedo-contrast-satin']     = PANT_LEG + `<rect x="120" y="40" width="6" height="170" fill="#1a1a1a"/>`;
G['pants-tuxedo-contrast-grosgrain'] = PANT_LEG
  + `<rect x="118" y="40" width="10" height="170" fill="#4a4540"/>`
  + `<path d="M 118 50 L 128 50 M 118 60 L 128 60 M 118 70 L 128 70 M 118 80 L 128 80 M 118 90 L 128 90 M 118 100 L 128 100 M 118 110 L 128 110 M 118 120 L 128 120 M 118 130 L 128 130 M 118 140 L 128 140 M 118 150 L 128 150 M 118 160 L 128 160 M 118 170 L 128 170 M 118 180 L 128 180 M 118 190 L 128 190 M 118 200 L 128 200" stroke="#fff" opacity="0.5"/>`;

// =============================================================================
// Write all files
// =============================================================================
const ids = Object.keys(G);
let written = 0;
for (const id of ids) {
  const out = path.join(OUT_DIR, `${id}.svg`);
  fs.writeFileSync(out, wrap(G[id]));
  written++;
}
console.log(`✓ Wrote ${written} SVGs to ${OUT_DIR}/`);

// Verify count vs. customization_options
console.log('\nIDs covered:');
ids.forEach(id => console.log('  ', id));
