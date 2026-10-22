// Every project with a roadmap, one summary each, for the all-projects view.
// Pure: register.tsx reads the registry and each project's files and hands them here.

import type { FeatureEvidence } from './detect'
import { type Health, STALLED_DAYS, healthOf, lastActive } from './insights'
import { type Roadmap, type Status, nextUp, progressOf } from './schema'

/** A project untouched this many days gets a nudge on its card. */
export const NUDGE_DAYS = STALLED_DAYS

const DAY = 86_400_000

export type ProjectSummary = {
  path: string
  name: string
  /** The project this session runs in. */
  isHere: boolean
  /** ok; missing: the folder or its roadmap is gone; broken: the roadmap has errors. */
  state: 'ok' | 'missing' | 'broken'
  overall: number | null
  ui: number | null
  functional: number | null
  features: number
  done: number
  health: Health | null
  /** Newest activity: the roadmap's last touch or a commit to a feature's files. */
  lastActiveMs: number
  untouchedDays: number
  needsYou: { title: string; reason: string }[]
  needsCode: { title: string; reason: string }[]
  next: { title: string; status: Status; note: string } | null
  leftOff: string
  milestones: { title: string; overall: number | null; done: number; total: number }[]
  live: boolean | null
}

type Input = {
  path: string
  name: string
  isHere: boolean
  roadmap: Roadmap | null
  /** Whether the roadmap file exists at all. */
  exists: boolean
  evidence: Readonly<Record<string, FeatureEvidence>>
  live: boolean | null
}

/** One project's card, from its roadmap and evidence. */
export function summarize(input: Input, nowMs: number): ProjectSummary {
  const blank: ProjectSummary = {
    path: input.path,
    name: input.name,
    isHere: input.isHere,
    state: input.exists ? 'broken' : 'missing',
    overall: null,
    ui: null,
    functional: null,
    features: 0,
    done: 0,
    health: null,
    lastActiveMs: 0,
    untouchedDays: 0,
    needsYou: [],
    needsCode: [],
    next: null,
    leftOff: '',
    milestones: [],
    live: null,
  }
  const roadmap = input.roadmap
  if (!roadmap) return blank

  const p = progressOf(roadmap.features)
  const active = lastActive(roadmap, input.evidence)
  const blocked = (on: 'you' | 'code') =>
    roadmap.features
      .filter(feature => feature.status === 'blocked' && (feature.blocked_on ?? 'code') === on)
      .map(feature => ({ title: feature.title, reason: feature.blocker_reason ?? '' }))
  const next = nextUp(roadmap)

  return {
    ...blank,
    name: roadmap.name || input.name,
    state: 'ok',
    overall: p.overall,
    ui: p.ui,
    functional: p.functional,
    features: roadmap.features.length,
    done: p.counts.done,
    health: healthOf(roadmap, input.evidence, nowMs),
    lastActiveMs: active,
    untouchedDays: Math.max(0, Math.floor((nowMs - active) / DAY)),
    needsYou: blocked('you'),
    needsCode: blocked('code'),
    next: next ? { title: next.title, status: next.status, note: next.note.split('\n')[0]?.trim() ?? '' } : null,
    leftOff: roadmap.where_i_left_off,
    milestones: roadmap.milestones.map(milestone => {
      const features = roadmap.features.filter(feature => feature.milestone === milestone.id)
      const mp = progressOf(features)
      return { title: milestone.title, overall: mp.overall, done: mp.counts.done, total: features.length }
    }),
    live: input.live,
  }
}

/** Most recently active first; projects whose roadmap is gone or broken last. */
export function sortProjects(projects: readonly ProjectSummary[]): ProjectSummary[] {
  const rank = (project: ProjectSummary) => (project.state === 'ok' ? 0 : 1)
  return [...projects].sort((a, b) => rank(a) - rank(b) || b.lastActiveMs - a.lastActiveMs || a.name.localeCompare(b.name))
}
