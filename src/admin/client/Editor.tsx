'use client'

import '@xyflow/react/dist/style.css'

import type { Connection, Edge, EdgeChange, NodeChange, NodeProps } from '@xyflow/react'

import { useTheme } from '@payloadcms/ui'
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import type { ValidationIssue } from '../../core/validate'
import type { TaskCatalogue, WorkflowGraph, WorkflowNode } from '../../core/types'
import type { FlowNode, PaletteItem } from './editorModel'
import type { CollectionChoice } from './WorkflowBuilder'

import { autoLayout, descendants } from '../../core/graph'
import { validateGraph } from '../../core/validate'
import { describeNode } from './describe'
import {
  createNode,
  DRAG_TYPE,
  emptyEditorGraph,
  toFlowEdges,
  toFlowNodes,
  toGraph,
} from './editorModel'
import { flowThemeStyle } from './flowTheme'
import { NodeIcon } from './icons'
import { Inspector } from './Inspector'
import { NodeCard } from './NodeCard'

type EditorContextValue = { issues: Map<string, ValidationIssue[]>; labels: Record<string, string> }
const EditorContext = createContext<EditorContextValue>({ issues: new Map(), labels: {} })

function EditorNodeView({ data, id, selected, type }: NodeProps<FlowNode>) {
  const { issues, labels } = useContext(EditorContext)
  const node = { data, id, position: { x: 0, y: 0 }, type } as WorkflowNode
  const { subtitle, title } = describeNode(node, labels)
  return <NodeCard issueCount={issues.get(id)?.length} kind={type} selected={selected} subtitle={subtitle} title={title} />
}

const nodeTypes = { condition: EditorNodeView, delay: EditorNodeView, task: EditorNodeView, trigger: EditorNodeView }

const defaultEdgeOptions = { markerEnd: { color: 'var(--theme-elevation-400)', height: 16, type: MarkerType.ArrowClosed, width: 16 } }

export type EditorProps = {
  catalogue: TaskCatalogue
  collections: CollectionChoice[]
  onChange: (graph: WorkflowGraph) => void
  readOnly: boolean
  value: null | undefined | WorkflowGraph
}

function Palette({ catalogue, onAdd, readOnly }: { catalogue: TaskCatalogue; onAdd: (item: PaletteItem) => void; readOnly: boolean }) {
  const [search, setSearch] = useState('')
  const tasks = Object.values(catalogue).filter((task) =>
    `${task.label} ${task.slug}`.toLowerCase().includes(search.trim().toLowerCase()),
  )

  const item = (entry: PaletteItem, label: string, hint: string, key: string) => (
    <button
      className={`pw-palette__item pw-palette__item--${entry.kind}`}
      disabled={readOnly}
      draggable={!readOnly}
      key={key}
      onClick={() => onAdd(entry)}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(entry))
        event.dataTransfer.effectAllowed = 'move'
      }}
      title="Drag onto the canvas, or click to add after the selected step"
      type="button"
    >
      <span className={`pw-node__icon pw-node__icon--${entry.kind}`}>
        <NodeIcon type={entry.kind} />
      </span>
      <span className="pw-palette__text">
        <span className="pw-palette__label">{label}</span>
        <span className="pw-palette__hint">{hint}</span>
      </span>
    </button>
  )

  return (
    <div className="pw-palette">
      <p className="pw-palette__heading">Logic</p>
      {item({ kind: 'condition' }, 'Condition', 'Yes / No branch', 'condition')}
      {item({ kind: 'delay' }, 'Delay', 'Wait, then continue', 'delay')}
      <p className="pw-palette__heading">Tasks</p>
      {Object.keys(catalogue).length > 6 && (
        <input
          aria-label="Search tasks"
          className="pw-palette__search"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search tasks"
          value={search}
        />
      )}
      {tasks.map((task) => item({ kind: 'task', task: task.slug }, task.label, task.slug, task.slug))}
      {Object.keys(catalogue).length === 0 && (
        <p className="pw-palette__empty">No tasks are registered. Add tasks to `jobs.tasks` in your Payload config.</p>
      )}
    </div>
  )
}

function IssuesPanel({ issues, onSelect }: { issues: ValidationIssue[]; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  if (issues.length === 0) {
    return (
      <div className="pw-issues pw-issues--ok">
        <span className="pw-dot pw-dot--succeeded" /> Ready to run
      </div>
    )
  }
  return (
    <div className="pw-issues">
      <button className="pw-issues__toggle" onClick={() => setOpen(!open)} type="button">
        <span className="pw-dot pw-dot--failed" />
        {issues.length === 1 ? '1 problem' : `${issues.length} problems`}
        <span className="pw-issues__chevron">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <ul className="pw-issues__list">
          {issues.map((issue, index) => (
            <li key={index}>
              {issue.nodeId ? (
                <button className="pw-link" onClick={() => onSelect(issue.nodeId!)} type="button">
                  {issue.message}
                </button>
              ) : (
                issue.message
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Canvas({ catalogue, collections, onChange, readOnly, value }: EditorProps) {
  const { theme } = useTheme()
  const flow = useReactFlow<FlowNode, Edge>()
  const [initial] = useState(() => value ?? emptyEditorGraph())
  const [nodes, setNodes] = useState<FlowNode[]>(() => toFlowNodes(initial))
  const [edges, setEdges] = useState<Edge[]>(() => toFlowEdges(initial))
  const committed = useRef(JSON.stringify(toGraph(toFlowNodes(initial), toFlowEdges(initial))))

  const graph = useMemo(() => toGraph(nodes, edges), [nodes, edges])
  const collectionSlugs = useMemo(() => collections.map((c) => c.slug), [collections])
  const issues = useMemo(() => validateGraph(graph, catalogue, { collections: collectionSlugs }), [graph, catalogue, collectionSlugs])
  const issuesByNode = useMemo(() => {
    const map = new Map<string, ValidationIssue[]>()
    for (const issue of issues) if (issue.nodeId) map.set(issue.nodeId, [...(map.get(issue.nodeId) ?? []), issue])
    return map
  }, [issues])
  const labels = useMemo(() => Object.fromEntries(Object.values(catalogue).map((t) => [t.slug, t.label])), [catalogue])
  const selected = nodes.find((node) => node.selected) ?? null

  // Write to the form when the graph really changed, and not on every frame of a drag.
  useEffect(() => {
    if (nodes.some((node) => node.dragging)) return
    const json = JSON.stringify(graph)
    if (json === committed.current) return
    committed.current = json
    onChange(graph)
  }, [graph, nodes, onChange])

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => setNodes((current) => applyNodeChanges(changes, current)), [])
  const onEdgesChange = useCallback((changes: EdgeChange[]) => setEdges((current) => applyEdgeChanges(changes, current)), [])

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      if (connection.source === connection.target) return false
      if (nodes.find((node) => node.id === connection.target)?.type === 'trigger') return false
      const handle = connection.sourceHandle ?? null
      if (edges.some((e) => e.source === connection.source && e.target === connection.target && (e.sourceHandle ?? null) === handle)) return false
      return !descendants(graph, connection.target).has(connection.source)
    },
    [edges, graph, nodes],
  )

  const onConnect = useCallback((connection: Connection) => {
    const id = `e-${connection.source}-${connection.sourceHandle ?? 'out'}-${connection.target}`
    setEdges((current) => addEdge({ ...connection, id }, current))
  }, [])

  const select = useCallback((id: null | string) => {
    setNodes((current) => current.map((node) => ({ ...node, selected: node.id === id })))
    setEdges((current) => current.map((edge) => ({ ...edge, selected: false })))
  }, [])

  const addNode = useCallback(
    (item: PaletteItem, position?: { x: number; y: number }) => {
      const taken = new Set(nodes.map((node) => node.id))
      const anchor = selected ?? nodes.toSorted((a, b) => b.position.y - a.position.y)[0]
      const at = position ?? (anchor ? { x: anchor.position.x, y: anchor.position.y + 150 } : { x: 0, y: 0 })
      const node = { ...createNode(item, at, taken), selected: true }
      setNodes((current) => [...current.map((n) => ({ ...n, selected: false })), node])
      // A click (no drop position) connects the new step after the selected one.
      if (!position && anchor && anchor.type !== 'condition') {
        setEdges((current) => [...current, { id: `e-${anchor.id}-out-${node.id}`, source: anchor.id, target: node.id }])
      }
    },
    [nodes, selected],
  )

  const updateNode = useCallback((id: string, data: FlowNode['data']) => {
    setNodes((current) => current.map((node) => (node.id === id ? { ...node, data } : node)))
  }, [])

  const deleteNode = useCallback((id: string) => {
    setNodes((current) => current.filter((node) => node.id !== id))
    setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id))
  }, [])

  const tidy = useCallback(() => {
    const laidOut = autoLayout(graph)
    const positions = new Map(laidOut.nodes.map((node) => [node.id, node.position]))
    setNodes((current) => current.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position })))
    requestAnimationFrame(() => flow.fitView({ duration: 300, maxZoom: 1, padding: 0.2 }))
  }, [flow, graph])

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      const raw = event.dataTransfer.getData(DRAG_TYPE)
      if (!raw) return
      event.preventDefault()
      const position = flow.screenToFlowPosition({ x: event.clientX - 120, y: event.clientY - 30 })
      addNode(JSON.parse(raw) as PaletteItem, position)
    },
    [addNode, flow],
  )

  return (
    <EditorContext.Provider value={{ issues: issuesByNode, labels }}>
      <div className="pw-editor">
        <Palette catalogue={catalogue} onAdd={(item) => addNode(item)} readOnly={readOnly} />
        <div
          className="pw-editor__canvas"
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes(DRAG_TYPE)) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
          }}
          onDrop={onDrop}
        >
          <ReactFlow
            colorMode={theme === 'dark' ? 'dark' : 'light'}
            defaultEdgeOptions={defaultEdgeOptions}
            deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
            edges={edges}
            edgesReconnectable={false}
            elementsSelectable
            fitView
            fitViewOptions={{ maxZoom: 1, padding: 0.25 }}
            isValidConnection={isValidConnection}
            maxZoom={1.5}
            minZoom={0.2}
            nodes={nodes}
            nodesConnectable={!readOnly}
            nodesDraggable={!readOnly}
            nodeTypes={nodeTypes}
            onBeforeDelete={async ({ edges: e, nodes: n }) => ({ edges: e, nodes: n.filter((node) => node.type !== 'trigger') })}
            onConnect={onConnect}
            onEdgesChange={onEdgesChange}
            onNodesChange={onNodesChange}
            proOptions={{ hideAttribution: true }}
            style={flowThemeStyle}
          >
            <Background gap={20} size={1.5} variant={BackgroundVariant.Dots} />
            <Controls showInteractive={false} />
            <Panel position="top-right">
              <button className="pw-toolbar-button" disabled={readOnly} onClick={tidy} type="button">
                Tidy up
              </button>
            </Panel>
            <Panel position="bottom-right">
              <IssuesPanel issues={issues} onSelect={select} />
            </Panel>
          </ReactFlow>
        </div>
        <Inspector
          catalogue={catalogue}
          collections={collections}
          graph={graph}
          issues={selected ? (issuesByNode.get(selected.id) ?? []) : issues}
          node={selected ? (graph.nodes.find((node) => node.id === selected.id) ?? null) : null}
          onChange={updateNode}
          onDelete={deleteNode}
          readOnly={readOnly}
        />
      </div>
    </EditorContext.Provider>
  )
}

/** The visual workflow editor. Loaded on demand by the `graph` field. */
export default function Editor(props: EditorProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  )
}
