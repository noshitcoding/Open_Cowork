import { tr } from '../i18n'
﻿import {
  Boxes,
  Brain,
  CheckCircle2,
  Clock3,
  FileSearch,
  GitCompareArrows,
  Network,
  PlugZap,
  Search,
  ShieldCheck,
} from 'lucide-react'

type FeatureStatus = 'ready' | 'partial' | 'planned'

type FeatureItem = {
  title: string
  description: string
  status: FeatureStatus
  action: string
  icon: typeof CheckCircle2
}

const STATUS_LABELS: Record<FeatureStatus, string> = {
  ready: 'Ready',
  partial: 'In progress',
  planned: 'Planned',
}

const FEATURES: FeatureItem[] = [
  {
    title: 'MCP Server',
    description: 'Configure servers, test them, and connect tools for agentic work.',
    status: 'partial',
    action: 'Build lifecycle, logs, and auto-reconnect',
    icon: PlugZap,
  },
  {
    title: 'Skills & Plugins',
    description: 'Manage skills, learning history, and extensions as reusable work blocks.',
    status: 'partial',
    action: 'Add hot-reload and plugin lifecycle',
    icon: Boxes,
  },
  {
    title: 'Crew AI',
    description: 'Manage roles, providers, models, and governance for multi-agent runs.',
    status: 'partial',
    action: 'Unify the run state machine and pause/resume behavior',
    icon: Network,
  },
  {
    title: 'Memory',
    description: 'Persistent notes, profiles, and context suggestions for recurring tasks.',
    status: 'ready',
    action: 'Extend learning loop after task completion',
    icon: Brain,
  },
  {
    title: 'Global Search',
    description: 'Find threads, sessions, tasks, artifacts, skills, settings, and logs in one place.',
    status: 'planned',
    action: 'Implement search index and grouped result view',
    icon: Search,
  },
  {
    title: 'Artifact and diff preview',
    description: 'Review files, Markdown, Office outputs, tables, and tool results directly.',
    status: 'planned',
    action: 'Build a preview surface with diff and export actions',
    icon: GitCompareArrows,
  },
  {
    title: 'File Safety',
    description: 'Show allowlists, backups, restore options, delete gates, and audit data per file operation.',
    status: 'partial',
    action: 'Refine policy UI and restore workflows',
    icon: ShieldCheck,
  },
  {
    title: 'Desktop Smoke Tests',
    description: 'Run doctor, typecheck, lint, tests, build, and optional Rust checks reproducibly.',
    status: 'ready',
    action: 'Add Playwright E2E after localhost policy approval',
    icon: FileSearch,
  },
]

function statusClass(status: FeatureStatus): string {
  if (status === 'ready') return 'success'
  if (status === 'partial') return 'warning'
  return 'muted'
}

export default function FeaturesView() {
  return (
    <div className="settings-view settings-view-wide">
      <header className="features-header">
        <div>
          <h1>{tr("Features")}</h1>
          <p className="hint-text">{tr("Status of key Open_Cowork features, extension points, and upcoming improvements.")}</p>
        </div>
        <div className="feature-summary">
          <CheckCircle2 size={16} aria-hidden="true" />
          <span>{FEATURES.filter((feature) => feature.status === 'ready').length}{tr("produktiv")}</span>
          <Clock3 size={16} aria-hidden="true" />
          <span>{FEATURES.filter((feature) => feature.status !== 'ready').length}{tr("offen")}</span>
        </div>
      </header>

      <div className="features-grid">
        {FEATURES.map((feature) => {
          const Icon = feature.icon
          return (
            <article key={feature.title} className="card feature-card">
              <div className="feature-card-header">
                <Icon size={18} aria-hidden="true" />
                <h2>{feature.title}</h2>
                <span className={`feature-status ${statusClass(feature.status)}`}>
                  {STATUS_LABELS[feature.status]}
                </span>
              </div>
              <p>{tr(feature.description)}</p>
              <div className="feature-next-action">{feature.action}</div>
            </article>
          )
        })}
      </div>
    </div>
  )
}





