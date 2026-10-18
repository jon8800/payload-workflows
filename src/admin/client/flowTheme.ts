import type { CSSProperties } from 'react'

/**
 * React Flow's own stylesheet is not in a cascade layer, so it wins over Payload's layered admin
 * CSS. Its colours are CSS variables, so we set them inline on the React Flow root, pointing at
 * Payload's theme variables. They then follow the admin's light and dark theme.
 */
export const flowThemeStyle = {
  '--xy-attribution-background-color': 'transparent',
  '--xy-background-color': 'var(--theme-elevation-50)',
  '--xy-background-pattern-dots-color': 'var(--theme-elevation-250)',
  '--xy-connectionline-stroke': 'var(--theme-elevation-600)',
  '--xy-connectionline-stroke-width': '2',
  '--xy-controls-box-shadow': 'none',
  '--xy-controls-button-background-color': 'var(--theme-elevation-0)',
  '--xy-controls-button-background-color-hover': 'var(--theme-elevation-100)',
  '--xy-controls-button-border-color': 'var(--theme-elevation-150)',
  '--xy-controls-button-color': 'var(--theme-elevation-800)',
  '--xy-controls-button-color-hover': 'var(--theme-elevation-1000)',
  '--xy-edge-label-background-color': 'var(--theme-elevation-50)',
  '--xy-edge-label-color': 'var(--theme-elevation-600)',
  '--xy-edge-stroke': 'var(--theme-elevation-350)',
  '--xy-edge-stroke-selected': 'var(--theme-elevation-800)',
  '--xy-edge-stroke-width': '1.5',
  '--xy-handle-background-color': 'var(--theme-elevation-0)',
  '--xy-handle-border-color': 'var(--theme-elevation-500)',
  '--xy-node-background-color': 'transparent',
  '--xy-node-border': 'none',
  '--xy-node-boxshadow-hover': 'none',
  '--xy-node-boxshadow-selected': 'none',
  '--xy-node-color': 'var(--theme-text)',
  '--xy-selection-background-color': 'color-mix(in srgb, var(--theme-elevation-500) 10%, transparent)',
  '--xy-selection-border': '1px dashed var(--theme-elevation-500)',
} as CSSProperties
