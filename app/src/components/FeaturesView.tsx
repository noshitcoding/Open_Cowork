import { useState } from 'react'
import MemoryPanel from './MemoryPanel'
import SkillPanel from './SkillPanel'
import InsightsPanel from './InsightsPanel'
import ProcessPanel from './ProcessPanel'
import TerminalPanel from './TerminalPanel'
import PersonalitySelector from './PersonalitySelector'
import SessionSearchPanel from './SessionSearchPanel'
import PipelinePanel from './PipelinePanel'
import ModelSwitcher from './ModelSwitcher'

const TABS = [
  { key: 'memory', label: '🧠 Memory', Component: MemoryPanel },
  { key: 'skills', label: '⚡ Skills', Component: SkillPanel },
  { key: 'sessions', label: '📂 Sessions', Component: SessionSearchPanel },
  { key: 'insights', label: '📊 Insights', Component: InsightsPanel },
  { key: 'personality', label: '🎭 Persoenlichkeit', Component: PersonalitySelector },
  { key: 'model', label: '🔄 Modell', Component: ModelSwitcher },
  { key: 'processes', label: '⚙️ Prozesse', Component: ProcessPanel },
  { key: 'terminal', label: '💻 Terminal', Component: TerminalPanel },
  { key: 'pipelines', label: '🔗 Pipelines', Component: PipelinePanel },
] as const

type TabKey = (typeof TABS)[number]['key']

export default function FeaturesView() {
  const [activeTab, setActiveTab] = useState<TabKey>('memory')
  const ActiveComponent = TABS.find((t) => t.key === activeTab)!.Component

  return (
    <div className="code-mode" style={{ overflow: 'auto', height: '100%' }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 4,
        padding: '10px 16px 0', borderBottom: '1px solid var(--border-color)',
        background: 'var(--bg-primary)', position: 'sticky', top: 0, zIndex: 5,
      }}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`btn-sm${activeTab === tab.key ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
            style={{ marginBottom: -1, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Active panel */}
      <div style={{ padding: '16px' }}>
        <ActiveComponent />
      </div>
    </div>
  )
}
