'use client'

import '@xyflow/react/dist/style.css'

import type { Edge, Node, NodeProps } from '@xyflow/react'

import { useTheme } from '@payloadcms/ui'
import { Background, BackgroundVariant, Controls, MarkerType, ReactFlow } from '@xyflow/react'
import { useMemo } from 'react'

import type { NodeCardProps } from './NodeCard'
import type { RunModel } from './runModel'

import { flowThemeStyle } from './flowTheme'
import { NodeCard } from './NodeCard'

type CardNode = Node<NodeCardProps, 'card'>

function CardNodeView({ data, selected }: NodeProps<CardNode>) {
  return <NodeCard {...data} selected={selected} />
}

const nodeTypes = { card: CardNodeView }

/** How many steps the graph opens on when no step failed. */
const FIRST_STEPS = 5

/** The read-only React Flow canvas of the run viewer. Loaded on demand, only on the Run tab. */
export default function RunGraph({
  model,
  onSelect,
  selected,
}: {
  model: RunModel
  onSelect: (id: null | string) => void
  selected: null | string
}) {
  const { theme } = useTheme()

  const nodes = useMemo<CardNode[]>(
    () =>
      model.nodes.map((node) => ({
        data: { ...node.card, hideHandles: true },
        id: node.id,
        position: node.position,
        selected: node.id === selected,
        type: 'card',
      })),
    [model, selected],
  )

  const edges = useMemo<Edge[]>(
    () =>
      model.edges.map((edge) => ({
        animated: false,
        className: edge.taken ? 'pw-edge pw-edge--taken' : 'pw-edge',
        id: edge.id,
        markerEnd: {
          color: edge.taken ? 'var(--theme-success-500)' : 'var(--theme-elevation-350)',
          height: 16,
          type: MarkerType.ArrowClosed,
          width: 16,
        },
        source: edge.source,
        style: edge.taken
          ? { stroke: 'var(--theme-success-500)', strokeWidth: 2 }
          : { stroke: 'var(--theme-elevation-300)', strokeDasharray: '5 5' },
        sourceHandle: edge.sourceHandle ?? undefined,
        target: edge.target,
      })),
    [model],
  )

  // A long run shrinks to fit and its cards turn unreadable. Open at a readable size on the
  // failed step, or else on the first few, and let the wheel scroll down the rest.
  const focus = useMemo(() => {
    const failed = model.nodes.find((node) => node.card.status === 'failed')
    return (failed ? [failed] : model.nodes.slice(0, FIRST_STEPS)).map((node) => ({ id: node.id }))
  }, [model])

  return (
    <ReactFlow
      colorMode={theme === 'dark' ? 'dark' : 'light'}
      edges={edges}
      edgesFocusable={false}
      fitView
      fitViewOptions={{ maxZoom: 1, minZoom: 0.75, nodes: focus, padding: 0.2 }}
      maxZoom={1.5}
      minZoom={0.2}
      nodes={nodes}
      nodesConnectable={false}
      nodesDraggable={false}
      nodeTypes={nodeTypes}
      onNodeClick={(_, node) => onSelect(node.id === selected ? null : node.id)}
      onPaneClick={() => onSelect(null)}
      panOnScroll
      proOptions={{ hideAttribution: true }}
      style={flowThemeStyle}
    >
      <Background gap={20} size={1.5} variant={BackgroundVariant.Dots} />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}
