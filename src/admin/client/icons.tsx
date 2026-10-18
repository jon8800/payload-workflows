import type { WorkflowNodeType } from '../../core/types'

const PATHS: Record<WorkflowNodeType | 'step', string> = {
  condition: 'M12 3 21 12 12 21 3 12Z',
  delay: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  step: 'M4 7h16M4 12h16M4 17h10',
  task: 'M4 8 12 4l8 4v8l-8 4-8-4Z M4 8l8 4 8-4 M12 12v8',
  trigger: 'M13 3 5 13.5h6L10 21l8-10.5h-6Z',
}

export function NodeIcon({ type }: { type: WorkflowNodeType | 'step' }) {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" viewBox="0 0 24 24" width="16">
      <path d={PATHS[type]} />
    </svg>
  )
}
