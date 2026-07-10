// js/measurement-schema.js
// Single source of truth for the measurements-capture UI. Each `key` matches a
// numeric column in the corresponding db/09_measurements.sql table EXACTLY.
// No browser-only imports — importable in Node for the drift-guard test.

export const MEASUREMENT_SCHEMA = [
  {
    kind: 'body',
    label: 'Body',
    groups: [
      { heading: 'Jacket & Coat', fields: [
        { key: 'chest_in',      label: 'Chest',       unit: 'in', hint: 'Around the fullest part of the chest' },
        { key: 'stomach_in',    label: 'Stomach',     unit: 'in' },
        { key: 'hips_in',       label: 'Hips',        unit: 'in' },
        { key: 'shoulders_in',  label: 'Shoulders',   unit: 'in', hint: 'Seam to seam across the back' },
        { key: 'arm_length_in', label: 'Arm length',  unit: 'in' },
        { key: 'bicep_in',      label: 'Bicep',       unit: 'in' },
        { key: 'arm_hole_in',   label: 'Arm hole',    unit: 'in' },
        { key: 'front_in',      label: 'Front',       unit: 'in' },
        { key: 'back_in',       label: 'Back',        unit: 'in' },
        { key: 'length_in',     label: 'Length',      unit: 'in' },
        { key: 'neck_in',       label: 'Neck',        unit: 'in' },
      ]},
      { heading: 'Trousers', fields: [
        { key: 'trouser_waist_in',  label: 'Waist',  unit: 'in' },
        { key: 'trouser_hips_in',   label: 'Hips',   unit: 'in' },
        { key: 'trouser_crotch_in', label: 'Crotch', unit: 'in' },
        { key: 'trouser_thigh_in',  label: 'Thigh',  unit: 'in' },
        { key: 'trouser_knee_in',   label: 'Knee',   unit: 'in' },
        { key: 'trouser_calf_in',   label: 'Calf',   unit: 'in' },
        { key: 'trouser_cuff_in',   label: 'Cuff',   unit: 'in' },
        { key: 'trouser_length_in', label: 'Length', unit: 'in' },
      ]},
      { heading: 'Height & Weight', fields: [
        { key: 'height_cm', label: 'Height', unit: 'cm' },
        { key: 'weight_kg', label: 'Weight', unit: 'kg' },
      ]},
    ],
    hasNotes: true,
  },
  {
    kind: 'jacket_reference',
    label: 'Jacket',
    groups: [
      { heading: 'Jacket reference garment', fields: [
        { key: 'collar_in',          label: 'Collar',          unit: 'in' },
        { key: 'shoulder_in',        label: 'Shoulder',        unit: 'in' },
        { key: 'half_armhole_in',    label: 'Half armhole',    unit: 'in' },
        { key: 'sleeve_length_in',   label: 'Sleeve length',   unit: 'in' },
        { key: 'sleeve_inseam_in',   label: 'Sleeve inseam',   unit: 'in' },
        { key: 'sleeve_width_in',    label: 'Sleeve width',    unit: 'in' },
        { key: 'length_lower_in',    label: 'Length (lower)',  unit: 'in' },
        { key: 'length_upper_in',    label: 'Length (upper)',  unit: 'in' },
        { key: 'back_length_in',     label: 'Back length',     unit: 'in' },
        { key: 'half_chest_in',      label: 'Half chest',      unit: 'in' },
        { key: 'half_waist_in',      label: 'Half waist',      unit: 'in' },
        { key: 'bottom_hem_in',      label: 'Bottom hem',      unit: 'in' },
        { key: 'yoke_in',            label: 'Yoke',            unit: 'in' },
        { key: 'half_girth_in',      label: 'Half girth',      unit: 'in' },
        { key: 'half_back_width_in', label: 'Half back width', unit: 'in' },
      ]},
    ],
    hasNotes: true,
  },
  {
    kind: 'shirt_reference',
    label: 'Shirt',
    groups: [
      { heading: 'Shirt reference garment', fields: [
        { key: 'collar_in',        label: 'Collar',        unit: 'in' },
        { key: 'chest_in',         label: 'Chest',         unit: 'in' },
        { key: 'waist_in',         label: 'Waist',         unit: 'in' },
        { key: 'hips_in',          label: 'Hips',          unit: 'in' },
        { key: 'length_in',        label: 'Length',        unit: 'in' },
        { key: 'sleeve_length_in', label: 'Sleeve length', unit: 'in' },
        { key: 'shoulders_in',     label: 'Shoulders',     unit: 'in' },
        { key: 'armhole_in',       label: 'Armhole',       unit: 'in' },
        { key: 'bicep_in',         label: 'Bicep',         unit: 'in' },
        { key: 'cuff_in',          label: 'Cuff',          unit: 'in' },
      ]},
    ],
    hasNotes: true,
  },
  {
    kind: 'pants_reference',
    label: 'Trousers',
    groups: [
      { heading: 'Trouser reference garment', fields: [
        { key: 'waist_in',        label: 'Waist',          unit: 'in' },
        { key: 'hips_in',         label: 'Hips',           unit: 'in' },
        { key: 'length_in',       label: 'Length',         unit: 'in' },
        { key: 'crotch_front_in', label: 'Crotch (front)', unit: 'in' },
        { key: 'crotch_back_in',  label: 'Crotch (back)',  unit: 'in' },
        { key: 'thigh_in',        label: 'Thigh',          unit: 'in' },
        { key: 'calf_in',         label: 'Calf',           unit: 'in' },
        { key: 'bottom_in',       label: 'Bottom',         unit: 'in' },
      ]},
    ],
    hasNotes: true,
  },
];

// Flat list of field keys for a kind (excludes the free-text `notes`).
export function fieldKeysForKind(kind) {
  const def = MEASUREMENT_SCHEMA.find(k => k.kind === kind);
  if (!def) return [];
  return def.groups.flatMap(g => g.fields.map(f => f.key));
}

// Anchor <-> kind mapping used by the page nav (short hashes).
export const ANCHOR_BY_KIND = { body: 'body', jacket_reference: 'jacket', shirt_reference: 'shirt', pants_reference: 'pants' };
export const KIND_BY_ANCHOR = { body: 'body', jacket: 'jacket_reference', shirt: 'shirt_reference', pants: 'pants_reference' };
