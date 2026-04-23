import { useState, useEffect, useMemo } from 'react'
import MolstarViewer from './MolstarViewer'
import PAECanvas from './PAECanvas'
import AppHeader from './AppHeader'

import './HomePage.css'
import './ResultPage.css'

const FOLDERS = {
  enzyme: '酶-小分子docking',
  antibody: '抗体抗原结构预测',
}

const NUMBERING_SCHEMES = ['IMGT', 'Kabat', 'EU', 'AHo', 'ANARCI']

const MOS_PROMPTS = {
  enzyme: [
    'Want to engineer pocket affinity?',
    'Want to predict key mutation sites?',
    'Want to boost catalytic activity?',
    'Want to enhance thermal stability?',
    'Want to design directed evolution strategies?',
  ],
  antibody: [
    'Want to humanize your antibody?',
    'Want to optimize CDR affinity?',
    'Want to reduce immunogenicity?',
    'Want to design bispecific antibodies?',
    'Want to analyze epitope coverage?',
  ],
}

const MOS_URL = 'https://mos.moleculemind.com/'

const SAMPLE_COUNT = 5

export default function ResultPage({ task, onBack }) {
  const folder = FOLDERS[task?.type] ?? FOLDERS.enzyme
  const [activeSample, setActiveSample] = useState(0)
  const [summaries, setSummaries] = useState([])
  const [fullData, setFullData] = useState(null)
  const [loadingFull, setLoadingFull] = useState(false)
  const [annotations, setAnnotations] = useState(null)
  const [hoveredGroupId, setHoveredGroupId] = useState(null)
  const [focusedResidue, setFocusedResidue] = useState(null)  // {chain, seqId, resType}
  const [information, setInformation] = useState(null)
  const [promptIndex, setPromptIndex] = useState(0)
  const [activeScheme, setActiveScheme] = useState('IMGT')
  const [selectedGroupIds, setSelectedGroupIds] = useState(new Set())
  const [homologs, setHomologs] = useState(null)
  const [homologsLoading, setHomologsLoading] = useState(false)
  const [homologsError, setHomologsError] = useState(null)

  const taskType = task?.type === 'antibody' ? 'antibody' : 'enzyme'
  const prompts = MOS_PROMPTS[taskType]

  useEffect(() => {
    setPromptIndex(0)
    const id = setInterval(() => setPromptIndex(i => (i + 1) % prompts.length), 3000)
    return () => clearInterval(id)
  }, [taskType, prompts.length])

  // Load all 5 summary files upfront for ranking scores
  useEffect(() => {
    Promise.all(
      Array.from({ length: SAMPLE_COUNT }, (_, i) =>
        fetch(`/${folder}/summary_confidences_sample_${i + 1}.json`).then(r => r.json())
      )
    ).then(setSummaries).catch(console.error)
  }, [folder])

  // Load full confidence data for active sample (pae matrix)
  useEffect(() => {
    setFullData(null)
    setLoadingFull(true)
    fetch(`/${folder}/confidences_sample_${activeSample + 1}.json`)
      .then(r => r.json())
      .then(data => { setFullData(data); setLoadingFull(false) })
      .catch(() => setLoadingFull(false))
  }, [folder, activeSample])

  // Load annotations
  useEffect(() => {
    setAnnotations(null)
    setHoveredGroupId(null)
    setFocusedResidue(null)
    setActiveScheme('IMGT')
    setSelectedGroupIds(new Set())
    setHomologs(null)
    setHomologsError(null)
    fetch(`/${folder}/annotations.json`)
      .then(r => r.json())
      .then(setAnnotations)
      .catch(console.error)
  }, [folder])

  // Load input information
  useEffect(() => {
    setInformation(null)
    fetch(`/${folder}/information.json`)
      .then(r => r.json())
      .then(setInformation)
      .catch(console.error)
  }, [folder])

  // Load homologs from static mock file
  useEffect(() => {
    setHomologsLoading(true)
    setHomologsError(null)
    fetch(`/${folder}/homologs.json`)
      .then(r => r.json())
      .then(data => { setHomologs(data); setHomologsLoading(false) })
      .catch(err => { setHomologsError(err.message); setHomologsLoading(false) })
  }, [folder])

  // Resolve active groups based on task type and selected scheme
  const activeGroups = useMemo(() => {
    if (!annotations) return []
    if (taskType === 'antibody' && annotations.schemes) {
      return annotations.schemes[activeScheme]?.groups ?? []
    }
    return annotations.groups ?? []
  }, [annotations, taskType, activeScheme])

  // Combine pinned (selected) + hovered residues for 3D highlight
  const highlightedResidues = useMemo(() => {
    const residues = []
    for (const id of selectedGroupIds) {
      const group = activeGroups.find(g => g.id === id)
      if (group) residues.push(...group.residues)
    }
    if (hoveredGroupId && !selectedGroupIds.has(hoveredGroupId)) {
      const group = activeGroups.find(g => g.id === hoveredGroupId)
      if (group) residues.push(...group.residues)
    }
    return residues.length > 0 ? residues : null
  }, [hoveredGroupId, selectedGroupIds, activeGroups])

  const toggleGroupSelection = (groupId) => {
    setSelectedGroupIds(prev => {
      const next = new Set(prev)
      next.has(groupId) ? next.delete(groupId) : next.add(groupId)
      return next
    })
  }

  const clearSelections = () => {
    setSelectedGroupIds(new Set())
    setFocusedResidue(null)
  }

  // Click residue tag: focus camera (toggle off if same)
  const handleResidueClick = (residue, e) => {
    e.stopPropagation()
    setFocusedResidue(prev =>
      prev?.chain === residue.chain && prev?.seqId === residue.seqId ? null : residue
    )
  }

  const structureUrl = `/${folder}/model_sample_${activeSample + 1}.pdb`
  const summary = summaries[activeSample]

  return (
    <div className="rp-page">
      <AppHeader />

      <div className="rp-subheader">
        <div className="rp-subheader-inner">
          <button className="rp-back" onClick={onBack}>← Back</button>
          <span className="rp-task-name">{task?.name ?? 'Result'}</span>
          <button className="rp-download">⬇ Download</button>
        </div>
      </div>

      <div className="rp-content">
        {/* Section header + sample tabs */}
        <div className="rp-section-header">
          <h2 className="rp-section-title">Structure Preview</h2>
          <div className="rp-sample-tabs">
            {Array.from({ length: SAMPLE_COUNT }, (_, i) => (
              <button
                key={i}
                className={`rp-sample-tab ${activeSample === i ? 'active' : ''}`}
                onClick={() => setActiveSample(i)}
              >
                Sample {i + 1}
              </button>
            ))}
          </div>
        </div>

        {/* Main two-column layout: sticky 3D viewer left, scrollable panels right */}
        <div className="rp-main-layout">

          {/* Row 1: ipTM/pTM | MOS CTA */}
          {summary ? (
            <div className="rp-metrics">
              <span className="rp-metric-label">ipTM =</span>
              <span className="rp-metric-value">{summary.iptm?.toFixed(2) ?? '—'}</span>
              <span className="rp-metric-label">pTM =</span>
              <span className="rp-metric-value">{summary.ptm?.toFixed(2) ?? '—'}</span>
              <a href="#" className="rp-learn-more">learn more</a>
            </div>
          ) : <div />}
          <button
            className="rp-mos-btn"
            onClick={() => window.open(MOS_URL, '_blank', 'noopener,noreferrer')}
          >
            <span className="rp-mos-prompt" key={promptIndex}>{prompts[promptIndex]}</span>
            <span className="rp-mos-action">Go to MOS →</span>
          </button>

          {/* LEFT: sticky 3D viewer + pLDDT legend */}
          <div className="rp-left-col">
            <div className="rp-plddt-legend">
              <div className="rp-plddt-item">
                <span>Very high (pLDDT &gt; 90)</span>
                <div className="rp-plddt-bar" style={{ background: '#0066cc' }} />
              </div>
              <div className="rp-plddt-item">
                <span>Confident (70–90)</span>
                <div className="rp-plddt-bar" style={{ background: '#4dd8e8' }} />
              </div>
              <div className="rp-plddt-item">
                <span>Low (50–70)</span>
                <div className="rp-plddt-bar" style={{ background: '#ffdd57' }} />
              </div>
              <div className="rp-plddt-item">
                <span>Very low (&lt; 50)</span>
                <div className="rp-plddt-bar" style={{ background: 'linear-gradient(to right, #ff9933, #ff6600)' }} />
              </div>
            </div>
            <div className="rp-viewer-card" style={{ flex: 1, minHeight: 0 }}>
              <MolstarViewer
                structureUrl={structureUrl}
                highlightedResidues={highlightedResidues}
                focusedResidue={focusedResidue}
              />
            </div>
          </div>

          {/* RIGHT: scrollable panels */}
          <div className="rp-right-col">

            {/* Annotations card */}
            <div className="rp-anno-panel">
              <div className="rp-anno-header">
                <span className="rp-anno-title">Annotations</span>
              </div>
              {taskType === 'antibody' && annotations?.schemes && (
                <div className="rp-scheme-tabs">
                  {NUMBERING_SCHEMES.map(s => (
                    <button
                      key={s}
                      className={`rp-scheme-tab ${activeScheme === s ? 'active' : ''}`}
                      onClick={() => { setActiveScheme(s); setHoveredGroupId(null); setFocusedResidue(null); setSelectedGroupIds(new Set()) }}
                    >
                      {s}
                    </button>
                  ))}
                  {selectedGroupIds.size > 0 && (
                    <button className="rp-scheme-clear" onClick={clearSelections}>
                      Clear ({selectedGroupIds.size})
                    </button>
                  )}
                </div>
              )}
              {!annotations ? (
                <div className="rp-anno-loading">Loading annotations...</div>
              ) : (
                <div className="rp-anno-list">
                  {activeGroups.map(group => {
                    const isSelected = selectedGroupIds.has(group.id)
                    return (
                      <div
                        key={group.id}
                        className={`rp-anno-item ${hoveredGroupId === group.id ? 'hovered' : ''} ${isSelected ? 'selected' : ''}`}
                        style={{ '--group-color': group.color }}
                        onMouseEnter={() => setHoveredGroupId(group.id)}
                        onMouseLeave={() => setHoveredGroupId(null)}
                      >
                        <div
                          className={`rp-anno-item-header ${taskType === 'antibody' ? 'clickable' : ''}`}
                          onClick={taskType === 'antibody' ? () => toggleGroupSelection(group.id) : undefined}
                        >
                          <div className="rp-anno-info">
                            <div className="rp-anno-label-row">
                              <div className="rp-anno-dot" style={{ background: group.color }} />
                              <span className="rp-anno-label">{group.label}</span>
                            </div>
                            <span className="rp-anno-residues">{group.residues.length} residues</span>
                          </div>
                          {taskType === 'antibody' && (
                            <span className={`rp-anno-pin ${isSelected ? 'pinned' : ''}`} style={{ color: isSelected ? group.color : undefined }}>
                              {isSelected ? '◉' : '○'}
                            </span>
                          )}
                        </div>
                        <div className="rp-anno-tags">
                          {group.residues.map(r => {
                            const isFocused = focusedResidue?.chain === r.chain && focusedResidue?.seqId === r.seqId
                            return (
                              <span
                                key={`${r.chain}${r.seqId}`}
                                className={`rp-anno-tag ${isFocused ? 'focused' : ''}`}
                                style={{ '--tag-color': group.color }}
                                onClick={e => handleResidueClick(r, e)}
                              >
                                {r.chain}{r.seqId}{r.resType}
                              </span>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Homologs card */}
            <div className="rp-anno-panel">
              <div className="rp-anno-header">
                <span className="rp-anno-title">Homologs</span>
                <span className="rp-anno-count-badge">
                  {taskType === 'enzyme' ? 'Chain A' : 'Antigen · Chain C'}
                </span>
              </div>
              <div className="rp-homologs-list">
                {homologsLoading && <div className="rp-anno-loading">Loading...</div>}
                {homologsError && (
                  <div className="rp-anno-loading" style={{ color: '#f87171' }}>Failed to load</div>
                )}
                {homologs && homologs.map(h => (
                  <a
                    key={h.pdbId}
                    className="rp-homolog-card"
                    href={`https://www.rcsb.org/structure/${h.pdbId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="rp-homolog-id">{h.pdbId}</span>
                    <span className="rp-homolog-identity">{h.identity}%</span>
                  </a>
                ))}
              </div>
            </div>


            {/* PAE */}
            <div>
              <h2 className="rp-section-title" style={{ marginBottom: 12 }}>Predicted Aligned Error</h2>
              <div className="rp-viewer-card rp-pae-card">
                {loadingFull ? (
                  <div className="rp-loading">Loading PAE data...</div>
                ) : fullData ? (
                  <PAECanvas
                    paeData={fullData.pae}
                    tokenChainIds={fullData.token_chain_ids}
                    tokenResIds={fullData.token_res_ids}
                  />
                ) : null}
              </div>
            </div>

            {/* Information */}
            {information && <InformationSection info={information} />}

          </div>
        </div>
      </div>
    </div>
  )
}

// ── Sequence display ──────────────────────────────────────────────────
function SequenceBlock({ sequence }) {
  const BLOCK = 10
  const COLS = 5
  const rows = []
  for (let i = 0; i < sequence.length; i += BLOCK * COLS) {
    const blocks = []
    for (let j = 0; j < COLS; j++) {
      const start = i + j * BLOCK
      if (start >= sequence.length) break
      blocks.push({ pos: start + BLOCK, seq: sequence.slice(start, start + BLOCK) })
    }
    rows.push(blocks)
  }

  return (
    <div className="rp-seq-wrap">
      {rows.map((blocks, ri) => (
        <div key={ri} className="rp-seq-row">
          <div className="rp-seq-labels">
            {blocks.map(b => (
              <span key={b.pos} className="rp-seq-label">
                {Math.min(b.pos, sequence.length)}
              </span>
            ))}
          </div>
          <div className="rp-seq-chars">
            {blocks.map(b => (
              <span key={b.pos} className="rp-seq-block">
                {b.seq.split('').join(' ')}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function InformationSection({ info }) {
  return (
    <div className="rp-info-section">
      <h2 className="rp-section-title" style={{ marginBottom: 12 }}>Input Information</h2>
      <div className="rp-info-table">
        <div className="rp-info-head">
          <span className="rp-info-col-type">Type</span>
          <span className="rp-info-col-copies">Copies</span>
          <span className="rp-info-col-seq">Sequence</span>
        </div>
        {info.entities.map((entity, i) => (
          <div key={i} className="rp-info-row">
            <span className="rp-info-col-type">
              {entity.type}
              {entity.label && <span className="rp-info-chain-label">{entity.label}</span>}
            </span>
            <span className="rp-info-col-copies">{entity.copies}</span>
            <span className="rp-info-col-seq">
              {entity.sequence
                ? <SequenceBlock sequence={entity.sequence} />
                : <span className="rp-info-smiles">{entity.smiles}</span>
              }
            </span>
          </div>
        ))}
        <div className="rp-info-seed">
          <span className="rp-info-seed-label">Seed:</span>
          <span className="rp-info-seed-value">{info.seed}</span>
        </div>
      </div>
    </div>
  )
}
