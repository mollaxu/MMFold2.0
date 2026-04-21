import { useState, useMemo } from 'react'
import AppHeader from './AppHeader'
import './HomePage.css'

// ── Mock data ──────────────────────────────────────────────────────

const MOCK_JOBS = [
  { id: '4d4784ff-d4e5-7f6a-1b2c-3d4e5f6a7b8c', name: '酶-小分子 Docking',  status: 'COMPLETED', duration: '2m 8s',  updatedAt: Date.now() - 2 * 3600 * 1000,  type: 'enzyme' },
  { id: '3cf3c319-a1b2-4c3d-8e9f-0a1b2c3d4e5f', name: '抗体抗原结构预测',    status: 'COMPLETED', duration: '5m 21s', updatedAt: Date.now() - 23 * 3600 * 1000, type: 'antibody' },
]

const ALL_STATUSES = ['DRAFT', 'RUNNING', 'COMPLETED', 'FAILED']
const PAGE_SIZE_OPTIONS = [10, 25, 50]

const STATUS_CONFIG = {
  DRAFT:     { label: 'Draft',     color: 'status-draft',     icon: '📄' },
  RUNNING:   { label: 'Running',   color: 'status-running',   icon: '↻'  },
  COMPLETED: { label: 'Completed', color: 'status-completed', icon: '✓'  },
  FAILED:    { label: 'Failed',    color: 'status-failed',    icon: '✕'  },
}

function formatTimeAgo(ts) {
  const diff = Date.now() - ts
  const s = Math.floor(diff / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (s < 60) return 'Just now'
  if (m < 60) return `${m} ${m === 1 ? 'minute' : 'minutes'} ago`
  if (h < 24) return `${h} ${h === 1 ? 'hour' : 'hours'} ago`
  if (d < 7)  return `${d} ${d === 1 ? 'day' : 'days'} ago`
  return new Date(ts).toLocaleDateString()
}

// ── EntityCard ─────────────────────────────────────────────────────

function EntityCard({ entityType, setEntityType, copies, setCopies, sequence, setSequence, canRemove, onRemove }) {
  const [collapsed, setCollapsed] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  if (collapsed) {
    return (
      <div className="entity-card entity-card-collapsed">
        <span className="entity-drag">⠿</span>
        <span className="entity-type-label">{entityType.charAt(0).toUpperCase() + entityType.slice(1)}</span>
        <span className="entity-copies-label">x{copies}</span>
        {sequence && <span className="entity-preview">{sequence.slice(0, 40)}{sequence.length > 40 ? '...' : ''} ({sequence.length} aa)</span>}
        <button className="entity-icon-btn" onClick={() => setCollapsed(false)}>∨</button>
      </div>
    )
  }

  return (
    <div className="entity-card">
      <span className="entity-drag">⠿</span>
      <div className="entity-body">
        <div className="entity-top-row">
          <label className="entity-field-label">Entity type</label>
          <div className="entity-select-wrap">
            <select className="entity-select" value={entityType} onChange={e => setEntityType(e.target.value)}>
              <option value="protein">Protein</option>
              <option value="dna">DNA</option>
              <option value="rna">RNA</option>
              <option value="ion">Ion</option>
              <option value="ligand">Ligand</option>
            </select>
            <span className="entity-select-arrow">∨</span>
          </div>
          <label className="entity-field-label" style={{ marginLeft: 12 }}>Copies</label>
          <input
            type="number" min="1" className="entity-copies-input" value={copies}
            onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) setCopies(v) }}
          />
        </div>
        <textarea
          className="entity-textarea"
          placeholder="Paste sequence or fasta"
          value={sequence}
          onChange={e => setSequence(e.target.value)}
          rows={3}
        />
      </div>
      <div className="entity-actions">
        <div style={{ position: 'relative' }}>
          <button className="entity-icon-btn" onClick={() => setMenuOpen(o => !o)}>⋮</button>
          {menuOpen && (
            <div className="entity-menu" onMouseLeave={() => setMenuOpen(false)}>
              {canRemove && (
                <button className="entity-menu-item entity-menu-item-danger" onClick={() => { setMenuOpen(false); onRemove?.() }}>
                  ✕ Delete
                </button>
              )}
              {!canRemove && <span className="entity-menu-item entity-menu-item-disabled">✕ Delete</span>}
            </div>
          )}
        </div>
        <button className="entity-icon-btn" onClick={() => setCollapsed(true)}>∧</button>
      </div>
    </div>
  )
}

// ── JobHistory ─────────────────────────────────────────────────────

function JobHistory({ onViewResult }) {
  const [search, setSearch]           = useState('')
  const [activeFilters, setFilters]   = useState([...ALL_STATUSES])
  const [pageSize, setPageSize]       = useState(10)
  const [currentPage, setPage]        = useState(1)
  const [selectedIds, setSelected]    = useState(new Set())
  const [copiedId, setCopiedId]       = useState(null)

  const filtered = useMemo(() => {
    return MOCK_JOBS.filter(j =>
      activeFilters.includes(j.status) &&
      (j.name.toLowerCase().includes(search.toLowerCase()) || j.id.includes(search))
    )
  }, [search, activeFilters])

  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const offset = (currentPage - 1) * pageSize
  const pageJobs = filtered.slice(offset, offset + pageSize)
  const rangeStart = total === 0 ? 0 : offset + 1
  const rangeEnd   = Math.min(offset + pageSize, total)

  const toggleFilter = (s) => setFilters(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  const toggleAll = () => setSelected(selectedIds.size === pageJobs.length && pageJobs.length > 0 ? new Set() : new Set(pageJobs.map(j => j.id)))
  const toggleOne = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const copyId = (id) => {
    navigator.clipboard.writeText(id).catch(() => {})
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  return (
    <div className="jh-wrap">
      <h2 className="jh-title">Job History</h2>

      <div className="jh-search-wrap">
        <svg className="jh-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input className="jh-search" placeholder="Search History" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
      </div>

      <div className="jh-filters">
        {ALL_STATUSES.map(s => {
          const cfg = STATUS_CONFIG[s]
          const isActive = activeFilters.includes(s)
          return (
            <button key={s} onClick={() => { toggleFilter(s); setPage(1) }} className={`jh-filter-btn ${isActive ? cfg.color : 'jh-filter-inactive'}`}>
              <span>{cfg.icon}</span> {cfg.label}
            </button>
          )
        })}
      </div>

      <div className="jh-table-wrap">
        <table className="jh-table">
          <thead>
            <tr>
              <th className="jh-th jh-th-check">
                <input type="checkbox" className="jh-checkbox"
                  checked={pageJobs.length > 0 && selectedIds.size === pageJobs.length}
                  onChange={toggleAll} />
              </th>
              <th className="jh-th">ID</th>
              <th className="jh-th">Name</th>
              <th className="jh-th">Status</th>
              <th className="jh-th">Duration</th>
              <th className="jh-th jh-th-right">Modified</th>
            </tr>
          </thead>
          <tbody>
            {pageJobs.length === 0 ? (
              <tr><td colSpan={6} className="jh-empty">No jobs found</td></tr>
            ) : pageJobs.map(job => {
              const cfg = STATUS_CONFIG[job.status]
              return (
                <tr key={job.id} className="jh-row" onClick={() => job.status === 'COMPLETED' && onViewResult(job)}>
                  <td className="jh-td jh-td-check" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" className="jh-checkbox" checked={selectedIds.has(job.id)} onChange={() => toggleOne(job.id)} />
                  </td>
                  <td className="jh-td" onClick={e => e.stopPropagation()}>
                    <div className="jh-id-cell">
                      <span className="jh-id-text" title={job.id}>{job.id.slice(0, 8)}</span>
                      <button className="jh-copy-btn" onClick={() => copyId(job.id)} title="Copy ID">
                        {copiedId === job.id ? '✓' : '⎘'}
                      </button>
                    </div>
                  </td>
                  <td className="jh-td jh-td-name">{job.name}</td>
                  <td className="jh-td">
                    <span className={`jh-status-badge ${cfg.color}`}>
                      {cfg.icon} {cfg.label}
                    </span>
                  </td>
                  <td className="jh-td jh-td-muted">{job.duration}</td>
                  <td className="jh-td jh-td-muted jh-td-right">{formatTimeAgo(job.updatedAt)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <div className="jh-pagination">
          <div className="jh-page-size">
            <span>Items per page:</span>
            <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1) }} className="jh-page-select">
              {PAGE_SIZE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <span className="jh-range">{rangeStart} – {rangeEnd} of {total}</span>
          <div className="jh-page-btns">
            {[
              ['«', () => setPage(1),           currentPage <= 1],
              ['‹', () => setPage(p => Math.max(1, p - 1)),          currentPage <= 1],
              ['›', () => setPage(p => Math.min(totalPages, p + 1)), currentPage >= totalPages],
              ['»', () => setPage(totalPages),  currentPage >= totalPages],
            ].map(([label, fn, disabled], i) => (
              <button key={i} onClick={fn} disabled={disabled} className="jh-page-btn">{label}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── HomePage ───────────────────────────────────────────────────────

let uidCounter = 1
function newEntry() { return { uid: uidCounter++, type: 'protein', copies: 1, sequence: '' } }

export default function HomePage({ onViewResult }) {
  const [entries, setEntries] = useState([newEntry()])

  const updateEntry = (uid, patch) => setEntries(prev => prev.map(e => e.uid === uid ? { ...e, ...patch } : e))
  const removeEntry = (uid) => setEntries(prev => prev.length > 1 ? prev.filter(e => e.uid !== uid) : prev)
  const addEntry    = () => setEntries(prev => [...prev, newEntry()])

  return (
    <div className="home-page">
      <AppHeader activePage="server" />

      <div className="home-content">
        {/* Top toolbar */}
        <div className="home-toolbar">
          <span className="home-quota">Remaining jobs today: <strong>30</strong></span>
          <div className="home-toolbar-actions">
            <button className="home-btn-outline">⬆ Upload JSON</button>
            <button className="home-btn-outline">↺ Clear</button>
          </div>
        </div>

        {/* Entity cards */}
        <div className="home-entities">
          {entries.map(e => (
            <EntityCard
              key={e.uid}
              entityType={e.type}
              setEntityType={t => updateEntry(e.uid, { type: t })}
              copies={e.copies}
              setCopies={c => updateEntry(e.uid, { copies: c })}
              sequence={e.sequence}
              setSequence={s => updateEntry(e.uid, { sequence: s })}
              canRemove={entries.length > 1}
              onRemove={() => removeEntry(e.uid)}
            />
          ))}
        </div>

        {/* Add entity */}
        <button className="home-add-entity" onClick={addEntry}>
          + Add entity
        </button>

        {/* Submit row */}
        <div className="home-submit-row">
          <button className="home-btn-primary">Continue and preview job</button>
          <button className="home-btn-outline">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight:6}}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            Save job
          </button>
        </div>

        {/* Job history */}
        <JobHistory onViewResult={onViewResult} />
      </div>
    </div>
  )
}
