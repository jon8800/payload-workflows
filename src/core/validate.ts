import type { TaskCatalogue, WorkflowGraph } from './types'

import { ancestors, descendants, incomingEdges, nodeMap, outgoingEdges, topologicalSort } from './graph'
import { findReferences, parsePath, referencedStep } from './template'

export type ValidationIssue = {
  message: string
  /** The node the issue belongs to, if any. The editor outlines that node. */
  nodeId?: string
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
}

const CRON_FIELDS = /^\S+(\s+\S+){4,5}$/

/**
 * Checks a graph before it is saved as enabled, and before it runs. Returns an empty list when the
 * graph is valid.
 */
export function validateGraph(
  graph: WorkflowGraph,
  catalogue: TaskCatalogue,
  options: { collections?: string[] } = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const nodes = nodeMap(graph)

  if (nodes.size !== graph.nodes.length) issues.push({ message: 'Two steps share the same id.' })

  const triggers = graph.nodes.filter((node) => node.type === 'trigger')
  if (triggers.length === 0) issues.push({ message: 'Add a trigger. Every workflow starts with one.' })
  if (triggers.length > 1) {
    for (const extra of triggers.slice(1)) {
      issues.push({ message: 'A workflow can have only one trigger.', nodeId: extra.id })
    }
  }

  for (const edge of graph.edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) {
      issues.push({ message: `Connection ${edge.id} points at a step that does not exist.` })
    }
  }

  const { cyclic } = topologicalSort(graph)
  if (cyclic.length > 0) {
    issues.push({ message: 'The steps form a loop. Workflows must not loop back to an earlier step.' })
    for (const id of cyclic) issues.push({ message: 'This step is part of a loop.', nodeId: id })
  }

  const trigger = triggers[0]
  const reachable = trigger ? descendants(graph, trigger.id) : new Set<string>()

  for (const node of graph.nodes) {
    if (node.type === 'trigger') {
      if (incomingEdges(graph, node.id).length > 0) {
        issues.push({ message: 'Nothing can connect into the trigger.', nodeId: node.id })
      }
      const { data } = node
      if (data.kind === 'schedule' && !CRON_FIELDS.test((data.cron ?? '').trim())) {
        issues.push({ message: 'Enter a cron expression with 5 or 6 fields, e.g. "0 9 * * 1".', nodeId: node.id })
      }
      if (data.kind === 'collection') {
        if (!data.collection) {
          issues.push({ message: 'Choose the collection that starts this workflow.', nodeId: node.id })
        } else if (options.collections && !options.collections.includes(data.collection)) {
          issues.push({
            message: `The collection "${data.collection}" is not set up to start workflows.`,
            nodeId: node.id,
          })
        }
        if (!data.operations?.length) {
          issues.push({ message: 'Choose at least one operation: create, update or delete.', nodeId: node.id })
        }
      }
      continue
    }

    if (trigger && !reachable.has(node.id)) {
      issues.push({ message: 'This step is not connected to the trigger, so it never runs.', nodeId: node.id })
    }

    if (node.type === 'task') {
      const entry = catalogue[node.data.task]
      if (!entry) {
        issues.push({ message: `The task "${node.data.task}" is not registered.`, nodeId: node.id })
      } else {
        for (const field of entry.fields) {
          if (field.required && isBlank(node.data.input?.[field.name])) {
            issues.push({ message: `"${field.label}" is required.`, nodeId: node.id })
          }
        }
      }
    }

    if (node.type === 'condition') {
      if (!node.data.rules?.length) issues.push({ message: 'Add at least one rule.', nodeId: node.id })
      for (const edge of outgoingEdges(graph, node.id)) {
        if (edge.sourceHandle !== 'true' && edge.sourceHandle !== 'false') {
          issues.push({ message: 'Connect a condition from its "Yes" or "No" handle.', nodeId: node.id })
        }
      }
    }

    if (node.type === 'delay') {
      if (!(typeof node.data.amount === 'number' && node.data.amount > 0)) {
        issues.push({ message: 'Enter a delay greater than 0.', nodeId: node.id })
      }
      // A step after a Delay runs in a later job. If it could also be reached without passing the
      // Delay, it would run twice, so every path into it must come through the Delay.
      const after = descendants(graph, node.id)
      for (const id of after) {
        const sources = incomingEdges(graph, id).map((edge) => edge.source)
        if (sources.some((source) => source !== node.id && !after.has(source))) {
          issues.push({
            message: 'This step can be reached both through a Delay and around it. Route every path through the Delay.',
            nodeId: id,
          })
        }
      }
    }

    issues.push(...referenceIssues(graph, node.id))
  }

  return dedupe(issues)
}

function referenceIssues(graph: WorkflowGraph, nodeId: string): ValidationIssue[] {
  const node = graph.nodes.find((n) => n.id === nodeId)!
  const values =
    node.type === 'task'
      ? node.data.input
      : node.type === 'condition'
        ? node.data.rules
        : undefined
  const issues: ValidationIssue[] = []
  const upstream = ancestors(graph, nodeId)
  for (const path of findReferences(values)) {
    if (!parsePath(path)) {
      issues.push({
        message: `"{{${path}}}" is not a valid reference. Start it with trigger., steps. or workflow.`,
        nodeId,
      })
      continue
    }
    const step = referencedStep(path)
    if (step === null) continue
    const target = graph.nodes.find((n) => n.id === step)
    if (!target) {
      issues.push({ message: `"{{${path}}}" points at a step that does not exist.`, nodeId })
    } else if (!upstream.has(step)) {
      issues.push({ message: `"{{${path}}}" points at a step that does not run before this one.`, nodeId })
    }
  }
  return issues
}

function dedupe(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>()
  return issues.filter((issue) => {
    const key = `${issue.nodeId ?? ''}|${issue.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
