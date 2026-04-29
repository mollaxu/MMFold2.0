import { useState, useEffect, useMemo, useRef } from 'react'
import MolstarViewer from './MolstarViewer'
import PAECanvas from './PAECanvas'
import AppHeader from './AppHeader'
import { scanEntities } from './liabilityScanner'
import { analyzeInteractions } from './interactionAnalyzer'

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
const HOMOLOG_SEARCH_ENABLED = false

const MOCK_SEARCH_RESULTS = {
  pdbid: [
    { pdbId: '5XFZ', identity: 100 },
    { pdbId: '5XG0', identity: 97 },
  ],
  sequence: [
    { pdbId: '3WPC', identity: 89 },
    { pdbId: '4GBZ', identity: 76 },
    { pdbId: '1QJB', identity: 72 },
    { pdbId: '2RFN', identity: 65 },
    { pdbId: '5T3W', identity: 58 },
  ],
  structure: [
    { pdbId: '6LU7', identity: 82 },
    { pdbId: '7BQY', identity: 74 },
    { pdbId: '3CL0', identity: 68 },
    { pdbId: '5R80', identity: 61 },
  ],
}

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
  const [reprMode, setReprMode] = useState('surface')
  const [colorMode, setColorMode] = useState('plddt')
  const [hSearchMode, setHSearchMode] = useState('pdbid')
  const [hSearchQuery, setHSearchQuery] = useState('')
  const [hSearchResults, setHSearchResults] = useState(null)
  const [hSearching, setHSearching] = useState(false)
  const [hUploadName, setHUploadName] = useState(null)
  const [superimposeId, setSuperimposeId] = useState(null)
  const [liabilityHits, setLiabilityHits] = useState([])
  const [liabilityOpen, setLiabilityOpen] = useState(new Set())
  const [interactions, setInteractions] = useState(null)
  const [interactionsLoading, setInteractionsLoading] = useState(false)

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

  // Run liability scan when information loads
  useEffect(() => {
    if (!information?.entities) { setLiabilityHits([]); return }
    const hits = scanEntities(information.entities)
    setLiabilityHits(hits)
    const firstGroup = hits.length > 0 ? hits[0].group : null
    setLiabilityOpen(firstGroup ? new Set([firstGroup]) : new Set())
  }, [information])

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

  // Combine pinned (selected) + hovered + focused residues for 3D highlight
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
    if (focusedResidue) {
      residues.push(focusedResidue)
    }
    return residues.length > 0 ? residues : null
  }, [hoveredGroupId, selectedGroupIds, activeGroups, focusedResidue])

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

  // Click residue: focus camera (toggle off if same)
  const handleResidueClick = (residue, e) => {
    e?.stopPropagation?.()
    if (!residue) { setFocusedResidue(null); return }
    setFocusedResidue(prev =>
      prev?.chain === residue.chain && prev?.seqId === residue.seqId ? null : residue
    )
  }

  // Compute interactions from PDB when sample changes (enzyme only)
  useEffect(() => {
    if (taskType !== 'enzyme') { setInteractions(null); return }
    const url = `/${folder}/model_sample_${activeSample + 1}.pdb`
    setInteractionsLoading(true)
    setInteractions(null)
    analyzeInteractions(url)
      .then(data => { setInteractions(data); setInteractionsLoading(false) })
      .catch(() => setInteractionsLoading(false))
  }, [folder, activeSample, taskType])

  const structureUrl = `/${folder}/model_sample_${activeSample + 1}.pdb`
  const superimposeUrl = superimposeId
    ? homologs?.find(h => h.pdbId === superimposeId)?.structureUrl ?? null
    : null
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
        <div className="rp-section-header" style={{ justifyContent: 'center' }}>
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

          {/* LEFT: sticky 3D viewer + legend */}
          <div className="rp-left-col">
            <div className="rp-viewer-toolbar">
              <div className="rp-color-toggle">
                <button
                  className={`rp-color-btn ${colorMode === 'plddt' ? 'active' : ''}`}
                  onClick={() => setColorMode('plddt')}
                >
                  pLDDT
                </button>
                <button
                  className={`rp-color-btn ${colorMode === 'electrostatic' ? 'active' : ''}`}
                  onClick={() => setColorMode('electrostatic')}
                >
                  Electrostatic
                </button>
              </div>
              <div className="rp-repr-toggle">
                <button
                  className={`rp-repr-btn ${reprMode === 'cartoon' ? 'active' : ''}`}
                  onClick={() => setReprMode('cartoon')}
                >
                  Cartoon
                </button>
                <button
                  className={`rp-repr-btn ${reprMode === 'surface' ? 'active' : ''}`}
                  onClick={() => setReprMode('surface')}
                >
                  Surface
                </button>
              </div>
            </div>
            {colorMode === 'plddt' && (
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
            )}
            {colorMode === 'electrostatic' && (
              <div className="rp-electro-legend">
                <div className="rp-electro-labels">
                  <span>Negative (−)</span>
                  <span>Neutral</span>
                  <span>Positive (+)</span>
                </div>
                <div className="rp-electro-bar" />
              </div>
            )}
            <div className="rp-viewer-card" style={{ flex: 1, minHeight: 0 }}>
              <MolstarViewer
                structureUrl={structureUrl}
                highlightedResidues={highlightedResidues}
                focusedResidue={focusedResidue}
                representationMode={reprMode}
                taskType={taskType}
                superimposeUrl={superimposeUrl}
                onResidueClick={handleResidueClick}
                colorMode={colorMode}
                autoFocusLigand={taskType === 'enzyme'}
              />
            </div>
            {information && (
              <SequenceBar
                entities={information.entities}
                groups={activeGroups}
                focusedResidue={focusedResidue}
                onResidueClick={handleResidueClick}
              />
            )}
          </div>

          {/* RIGHT: scrollable panels */}
          <div className="rp-right-col">

            {/* Homologs card */}
            <div className="rp-anno-panel">
              <div className="rp-anno-header">
                <span className="rp-anno-title">Homologs</span>
              </div>
              {HOMOLOG_SEARCH_ENABLED && (
                <>
                  <div className="rp-hsearch-tabs">
                    {[['pdbid', 'PDB ID'], ['sequence', 'Sequence'], ['structure', 'Structure']].map(([k, label]) => (
                      <button
                        key={k}
                        className={`rp-hsearch-tab ${hSearchMode === k ? 'active' : ''}`}
                        onClick={() => { setHSearchMode(k); setHSearchResults(null); setHSearchQuery(''); setHUploadName(null) }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="rp-hsearch-input-area">
                    {hSearchMode === 'structure' ? (
                      <label className="rp-hsearch-upload">
                        <input
                          type="file"
                          accept=".pdb,.cif,.mmcif"
                          style={{ display: 'none' }}
                          onChange={e => {
                            const file = e.target.files?.[0]
                            if (!file) return
                            setHUploadName(file.name)
                            setHSearching(true)
                            setHSearchResults(null)
                            setTimeout(() => {
                              setHSearchResults(MOCK_SEARCH_RESULTS.structure)
                              setHSearching(false)
                            }, 800)
                            e.target.value = ''
                          }}
                        />
                        <span className="rp-hsearch-upload-btn">
                          {hUploadName ? hUploadName : '↑ Upload PDB / mmCIF file'}
                        </span>
                      </label>
                    ) : (
                      <div className="rp-hsearch-row">
                        <input
                          className="rp-homolog-search"
                          type="text"
                          placeholder={hSearchMode === 'pdbid' ? 'e.g. 5XFZ' : 'Paste amino acid sequence...'}
                          value={hSearchQuery}
                          onChange={e => setHSearchQuery(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && hSearchQuery.trim()) {
                              setHSearching(true)
                              setHSearchResults(null)
                              setTimeout(() => {
                                setHSearchResults(MOCK_SEARCH_RESULTS[hSearchMode])
                                setHSearching(false)
                              }, 600)
                            }
                          }}
                        />
                        <button
                          className="rp-hsearch-go"
                          disabled={!hSearchQuery.trim() || hSearching}
                          onClick={() => {
                            if (!hSearchQuery.trim()) return
                            setHSearching(true)
                            setHSearchResults(null)
                            setTimeout(() => {
                              setHSearchResults(MOCK_SEARCH_RESULTS[hSearchMode])
                              setHSearching(false)
                            }, 600)
                          }}
                        >
                          Search
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
              <div className="rp-homologs-list">
                {HOMOLOG_SEARCH_ENABLED && hSearching && <div className="rp-anno-loading">Searching...</div>}
                {HOMOLOG_SEARCH_ENABLED && !hSearching && hSearchResults && hSearchResults.length === 0 && (
                  <div className="rp-anno-loading">No results found</div>
                )}
                {HOMOLOG_SEARCH_ENABLED && !hSearching && hSearchResults && hSearchResults.map(h => (
                  <HomologRow key={h.pdbId} h={h} superimposeId={superimposeId} onSuperimpose={setSuperimposeId} />
                ))}
                {(!HOMOLOG_SEARCH_ENABLED || (!hSearching && !hSearchResults)) && (
                  <>
                    {homologsLoading && <div className="rp-anno-loading">Loading...</div>}
                    {homologsError && (
                      <div className="rp-anno-loading" style={{ color: '#f87171' }}>Failed to load</div>
                    )}
                    {homologs && homologs.map(h => (
                      <HomologRow key={h.pdbId} h={h} superimposeId={superimposeId} onSuperimpose={setSuperimposeId} />
                    ))}
                  </>
                )}
              </div>
            </div>

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


            {/* Interactions (enzyme only) */}
            {taskType === 'enzyme' && (
              <InteractionsCard
                interactions={interactions}
                loading={interactionsLoading}
                focusedResidue={focusedResidue}
                onRowClick={(row) => {
                  const r = { chain: row.acceptorChain, seqId: row.acceptorPosition, resType: row.acceptorResidue }
                  setFocusedResidue(prev =>
                    prev?.chain === r.chain && prev?.seqId === r.seqId ? null : r
                  )
                }}
              />
            )}

            {/* Liability Scan */}
            {taskType === 'antibody' && liabilityHits.length > 0 && (
              <LiabilityScanCard
                hits={liabilityHits}
                openGroups={liabilityOpen}
                onToggleGroup={g => setLiabilityOpen(prev => {
                  const next = new Set(prev)
                  next.has(g) ? next.delete(g) : next.add(g)
                  return next
                })}
                focusedResidue={focusedResidue}
                onHitClick={(hit) => {
                  const seqId = hit.start + 1
                  setFocusedResidue(prev =>
                    prev?.chain === hit.chain && prev?.seqId === seqId ? null : { chain: hit.chain, seqId, resType: hit.matchedSeq[0] }
                  )
                }}
              />
            )}

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

// ── Liability Scan card ──────────────────────────────────────────────

const RISK_COLORS = { Critical: '#ef4444', High: '#f97316', Medium: '#eab308', Low: '#a3a3a3' }
const RISK_LEVELS = ['Critical', 'High', 'Medium', 'Low']

function riskOrder(r) {
  return { Critical: 0, High: 1, Medium: 2, Low: 3 }[r] ?? 4
}

function formatPos(h) {
  const start = h.start + 1
  const end = h.start + h.matchedSeq.length
  return start === end ? `${h.chain}${start}` : `${h.chain}${start}–${end}`
}

function LiabilityScanCard({ hits, openGroups, onToggleGroup, focusedResidue, onHitClick }) {
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterRisk, setFilterRisk] = useState([])
  const [filterChains, setFilterChains] = useState([])
  const [excludedGroups, setExcludedGroups] = useState(new Set())
  const [rsaMin, setRsaMin] = useState(0)
  const [rsaMax, setRsaMax] = useState(100)

  const allChains = useMemo(() => [...new Set(hits.map(h => h.chain))].sort(), [hits])
  const allGroups = useMemo(() => [...new Set(hits.map(h => h.group))], [hits])

  const isRsaActive = rsaMin > 0 || rsaMax < 100
  const activeFilterCount = (filterRisk.length > 0 ? 1 : 0)
    + (filterChains.length > 0 ? 1 : 0)
    + (excludedGroups.size > 0 ? 1 : 0)
    + (isRsaActive ? 1 : 0)

  const filtered = useMemo(() => {
    return hits.filter(h => {
      if (filterRisk.length > 0 && !filterRisk.includes(h.risk)) return false
      if (filterChains.length > 0 && !filterChains.includes(h.chain)) return false
      if (excludedGroups.has(h.group)) return false
      if (isRsaActive && (h.rsa < rsaMin || h.rsa > rsaMax)) return false
      return true
    })
  }, [hits, filterRisk, filterChains, excludedGroups, rsaMin, rsaMax, isRsaActive])

  const grouped = useMemo(() => {
    const map = new Map()
    for (const h of filtered) {
      if (!map.has(h.group)) map.set(h.group, [])
      map.get(h.group).push(h)
    }
    return [...map.entries()]
  }, [filtered])

  const toggleRisk = (r) => setFilterRisk(prev =>
    prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]
  )
  const toggleChain = (c) => setFilterChains(prev =>
    prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]
  )
  const toggleGroup = (g) => setExcludedGroups(prev => {
    const next = new Set(prev)
    next.has(g) ? next.delete(g) : next.add(g)
    return next
  })
  const clearAll = () => {
    setFilterRisk([]); setFilterChains([]); setExcludedGroups(new Set())
    setRsaMin(0); setRsaMax(100)
  }

  return (
    <div className="rp-anno-panel">
      <div className="rp-anno-header" style={{ position: 'relative' }}>
        <span className="rp-anno-title">Liability Scan</span>
        <span className="rp-anno-count-badge">{filtered.length} / {hits.length} hits</span>
        <button
          className={`rp-liability-filter-btn ${activeFilterCount > 0 ? 'active' : ''}`}
          onClick={() => setFilterOpen(p => !p)}
        >
          Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </button>

        {filterOpen && (
          <>
            <div className="rp-lf-backdrop" onClick={() => setFilterOpen(false)} />
            <div className="rp-lf-popover">
              <div className="rp-lf-section">
                <span className="rp-lf-label">Group</span>
                <div className="rp-lf-chips">
                  {allGroups.map(g => (
                    <button key={g} className={`rp-lf-chip ${!excludedGroups.has(g) ? 'active' : ''}`} onClick={() => toggleGroup(g)}>{g}</button>
                  ))}
                </div>
              </div>
              <div className="rp-lf-section">
                <span className="rp-lf-label">Risk</span>
                <div className="rp-lf-chips">
                  {RISK_LEVELS.map(r => (
                    <button key={r} className={`rp-lf-chip ${filterRisk.includes(r) ? 'active' : ''}`} style={filterRisk.includes(r) ? { borderColor: RISK_COLORS[r], color: RISK_COLORS[r] } : {}} onClick={() => toggleRisk(r)}>{r}</button>
                  ))}
                </div>
              </div>
              {allChains.length > 1 && (
                <div className="rp-lf-section">
                  <span className="rp-lf-label">Chain</span>
                  <div className="rp-lf-chips">
                    {allChains.map(c => (
                      <button key={c} className={`rp-lf-chip ${filterChains.includes(c) ? 'active' : ''}`} onClick={() => toggleChain(c)}>{c}</button>
                    ))}
                  </div>
                </div>
              )}
              <div className="rp-lf-section rp-lf-rsa-section">
                <div className="rp-lf-rsa-header">
                  <span className="rp-lf-label">RSA</span>
                  <span className="rp-lf-rsa-range">{rsaMin}% – {rsaMax}%</span>
                </div>
                <div className="rp-lf-rsa-slider">
                  <input type="range" min="0" max="100" value={rsaMin} onChange={e => setRsaMin(Math.min(+e.target.value, rsaMax))} />
                  <input type="range" min="0" max="100" value={rsaMax} onChange={e => setRsaMax(Math.max(+e.target.value, rsaMin))} />
                </div>
                <div className="rp-lf-rsa-presets">
                  <button className={`rp-lf-chip ${rsaMin === 0 && rsaMax === 5 ? 'active' : ''}`} onClick={() => { setRsaMin(0); setRsaMax(5) }}>Buried &lt;5%</button>
                  <button className={`rp-lf-chip ${rsaMin === 5 && rsaMax === 20 ? 'active' : ''}`} onClick={() => { setRsaMin(5); setRsaMax(20) }}>Partial 5–20%</button>
                  <button className={`rp-lf-chip ${rsaMin === 20 && rsaMax === 100 ? 'active' : ''}`} onClick={() => { setRsaMin(20); setRsaMax(100) }}>Exposed &gt;20%</button>
                  <button className={`rp-lf-chip ${rsaMin === 0 && rsaMax === 100 ? 'active' : ''}`} onClick={() => { setRsaMin(0); setRsaMax(100) }}>All</button>
                </div>
              </div>
              <div className="rp-lf-footer">
                <button className="rp-lf-confirm" onClick={() => setFilterOpen(false)}>Confirm</button>
                <button className="rp-lf-clear" onClick={clearAll}>Clear filters</button>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="rp-liability-list">
        {grouped.map(([group, items]) => {
          const isOpen = openGroups.has(group)
          const highestRisk = items.reduce((best, h) =>
            (!best || riskOrder(h.risk) < riskOrder(best)) ? h.risk : best
          , null)
          return (
            <div key={group} className="rp-liability-group">
              <div className="rp-liability-group-header" onClick={() => onToggleGroup(group)}>
                <span className="rp-liability-arrow">{isOpen ? '▾' : '▸'}</span>
                <span className="rp-liability-group-name">{group}</span>
                <span className="rp-liability-badge" style={{ background: RISK_COLORS[highestRisk] }}>{items.length}</span>
              </div>
              {isOpen && (
                <div className="rp-liability-items">
                  {items.map((h, i) => {
                    const seqId = h.start + 1
                    const isFocused = focusedResidue?.chain === h.chain && focusedResidue?.seqId === seqId
                    return (
                      <div
                        key={i}
                        className={`rp-liability-hit ${isFocused ? 'focused' : ''}`}
                        onClick={() => onHitClick(h)}
                      >
                        <span className="rp-liability-pos">{formatPos(h)}</span>
                        <span className="rp-liability-motif">{h.matchedSeq}</span>
                        <span className="rp-liability-rsa">RSA {h.rsa}%</span>
                        <span className="rp-liability-risk" style={{ color: RISK_COLORS[h.risk] }}>{h.risk}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
        {grouped.length === 0 && <div className="rp-anno-loading">No hits match filters</div>}
      </div>
      <div className="rp-liability-rsa-note">
        <strong>RSA</strong> (Relative Solvent Accessibility) measures the extent to which a residue is exposed on the protein surface. Buried residues (RSA &lt; 5%) are less likely to cause issues, while highly exposed residues (RSA &gt; 20%) are more prone to degradation, aggregation, or immunogenicity.
      </div>
    </div>
  )
}

// ── Interactions card (enzyme) ───────────────────────────────────────

function InteractionsCard({ interactions, loading, focusedResidue, onRowClick }) {
  const [openSections, setOpenSections] = useState(new Set(['hBond']))
  const toggleSection = (key) => setOpenSections(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  const hBonds = interactions?.hBonds ?? []

  return (
    <div className="rp-anno-panel">
      <div className="rp-anno-header">
        <span className="rp-anno-title">Non-Covalent Bond</span>
      </div>
      {loading && <div className="rp-anno-loading">Analyzing interactions...</div>}
      {!loading && interactions && (
        <div className="rp-interactions-body">
          <div className="rp-ix-section">
            <div className="rp-ix-section-header" onClick={() => toggleSection('hBond')}>
              <span className="rp-ix-arrow">{openSections.has('hBond') ? '▾' : '▸'}</span>
              <span className="rp-ix-section-title">H-Bond</span>
              <span className="rp-ix-section-count">{hBonds.length}</span>
            </div>
            {openSections.has('hBond') && hBonds.length > 0 && (
              <div className="rp-ix-table-wrap">
                <table className="rp-ix-table">
                  <thead>
                    <tr>
                      <th>Don-Chain</th>
                      <th>Don-Pos</th>
                      <th>Don-Res</th>
                      <th>Don-Atom</th>
                      <th>Acc-Chain</th>
                      <th>Acc-Pos</th>
                      <th>Acc-Res</th>
                      <th>Acc-Atom</th>
                      <th>Dist (Å)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hBonds.map((bond, i) => {
                      const isFocused = focusedResidue?.chain === bond.acceptorChain
                        && focusedResidue?.seqId === bond.acceptorPosition
                      return (
                        <tr
                          key={i}
                          className={isFocused ? 'focused' : ''}
                          onClick={() => onRowClick(bond)}
                        >
                          <td className="rp-ix-chain">{bond.donorChain}</td>
                          <td>{bond.donorPosition}</td>
                          <td className="rp-ix-res">{bond.donorResidue}</td>
                          <td className="rp-ix-atom">{bond.donorAtom}</td>
                          <td className="rp-ix-chain">{bond.acceptorChain}</td>
                          <td>{bond.acceptorPosition}</td>
                          <td className="rp-ix-res">{bond.acceptorResidue}</td>
                          <td className="rp-ix-atom">{bond.acceptorAtom}</td>
                          <td className="rp-ix-dist">{bond.distance.toFixed(3)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {openSections.has('hBond') && hBonds.length === 0 && (
              <div className="rp-anno-loading">No H-bonds detected</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Homolog row ──────────────────────────────────────────────────────

function HomologRow({ h, superimposeId, onSuperimpose }) {
  const isActive = superimposeId === h.pdbId
  return (
    <div className={`rp-homolog-card ${isActive ? 'active' : ''}`}>
      <span className="rp-homolog-id">{h.pdbId}</span>
      <span className="rp-homolog-identity">{h.identity}%</span>
      <div className="rp-homolog-actions">
        <button
          className={`rp-homolog-action-btn ${isActive ? 'active' : ''}`}
          onClick={() => onSuperimpose(isActive ? null : h.pdbId)}
        >
          {isActive ? 'Remove' : 'Superimpose'}
        </button>
        <a
          className="rp-homolog-action-btn ref"
          href={`https://www.rcsb.org/structure/${h.pdbId}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
        >
          Reference
        </a>
      </div>
    </div>
  )
}

// ── Sequence bar (below 3D viewer) ───────────────────────────────────

function buildResidueColorMap(groups) {
  const map = new Map()
  for (const g of groups) {
    for (const r of g.residues) {
      map.set(`${r.chain}:${r.seqId}`, g.color)
    }
  }
  return map
}

function SequenceBar({ entities, groups, focusedResidue, onResidueClick }) {
  const BLOCK = 10
  const chains = entities.filter(e => e.sequence)
  const colorMap = useMemo(() => buildResidueColorMap(groups || []), [groups])
  const focusedRef = useRef(null)

  useEffect(() => {
    if (focusedRef.current) {
      focusedRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [focusedResidue])

  return (
    <div className="rp-seqbar">
      {chains.map(entity => {
        const seq = entity.sequence
        const blocks = []
        for (let i = 0; i < seq.length; i += BLOCK) {
          blocks.push({ start: i, chars: seq.slice(i, i + BLOCK) })
        }
        return (
          <div key={entity.chain} className="rp-seqbar-chain">
            <span className="rp-seqbar-chain-label">
              {entity.label || `Chain ${entity.chain}`}
              <span className="rp-seqbar-chain-id">{entity.chain}</span>
            </span>
            <div className="rp-seqbar-blocks">
              {blocks.map(({ start, chars }) => (
                <div key={start} className="rp-seqbar-block">
                  <div className="rp-seqbar-ticks">
                    {chars.split('').map((_, j) => {
                      const seqId = start + j + 1
                      const show = seqId === 1 || seqId % 10 === 0
                      return <span key={j} className="rp-seqbar-tick">{show ? seqId : ''}</span>
                    })}
                  </div>
                  <div className="rp-seqbar-residues">
                    {chars.split('').map((aa, j) => {
                      const seqId = start + j + 1
                      const color = colorMap.get(`${entity.chain}:${seqId}`)
                      const isFocused = focusedResidue?.chain === entity.chain && focusedResidue?.seqId === seqId
                      return (
                        <span
                          key={j}
                          ref={isFocused ? focusedRef : undefined}
                          className={`rp-seqbar-aa ${isFocused ? 'focused' : ''} ${color ? 'annotated' : ''}`}
                          style={{ color: color || '#666' }}
                          title={`${entity.chain}${seqId} ${aa}`}
                          onClick={e => onResidueClick({ chain: entity.chain, seqId, resType: aa }, e)}
                        >
                          {aa}
                        </span>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
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

const INPUT_INFO_SEQUENCE_ENABLED = false

function InformationSection({ info }) {
  return (
    <div className="rp-info-section">
      <h2 className="rp-section-title" style={{ marginBottom: 12 }}>Input Information</h2>
      <div className="rp-info-table">
        {INPUT_INFO_SEQUENCE_ENABLED && (
          <>
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
          </>
        )}
        <div className="rp-info-seed">
          <span className="rp-info-seed-label">Seed:</span>
          <span className="rp-info-seed-value">{info.seed}</span>
        </div>
      </div>
    </div>
  )
}
