import type { CSSProperties } from 'react'

/**
 * React Flow's own stylesheet is not in a cascade layer, so it wins over Payload's layered admin
 * CSS. Its colours are CSS variables, so we set them inline on the React Flow root, pointing at
 * Payload's theme variables. They then follow the admin's light and dark theme.
 */
export const flowThemeStyle = {
  '--xy-attribution-background-color': 'transparent',
  '--xy-background-color': 'var(--color-bg-secondary)',
  '--xy-background-pattern-dots-color': 'var(--color-border)',
  '--xy-connectionline-stroke': 'var(--color-text-secondary)',
  '--xy-connectionline-stroke-width': '2',
  '--xy-controls-box-shadow': 'none',
  '--xy-controls-button-background-color': 'var(--color-bg)',
  '--xy-controls-button-background-color-hover': 'var(--color-bg-secondary)',
  '--xy-controls-button-border-color': 'var(--color-border)',
  '--xy-controls-button-color': 'var(--color-text)',
  '--xy-controls-button-color-hover': 'var(--color-text)',
  '--xy-edge-label-background-color': 'var(--color-bg-secondary)',
  '--xy-edge-label-color': 'var(--color-text-secondary)',
  '--xy-edge-stroke': 'var(--color-border)',
  '--xy-edge-stroke-selected': 'var(--color-text)',
  '--xy-edge-stroke-width': '1.5',
  '--xy-handle-background-color': 'var(--color-bg)',
  '--xy-handle-border-color': 'var(--color-text-secondary)',
  '--xy-node-background-color': 'transparent',
  '--xy-node-border': 'none',
  '--xy-node-boxshadow-hover': 'none',
  '--xy-node-boxshadow-selected': 'none',
  '--xy-node-color': 'var(--color-text)',
  '--xy-selection-background-color': 'color-mix(in srgb, var(--color-text-secondary) 10%, transparent)',
  '--xy-selection-border': '1px dashed var(--color-text-secondary)',
} as CSSProperties
