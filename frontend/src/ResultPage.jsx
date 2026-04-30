import { useState, useEffect, useMemo, useRef, Fragment } from 'react'
import MolstarViewer from './MolstarViewer'
import PAECanvas from './PAECanvas'
import AppHeader from './AppHeader'
import { scanEntities } from './liabilityScanner'
import { analyzeInteractions, analyzeProteinProteinInteractions } from './interactionAnalyzer'

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
  const folder = task?.folder ?? FOLDERS[task?.type] ?? FOLDERS.enzyme
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
  const [hoveredIxResidue, setHoveredIxResidue] = useState(null)

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
    if (hoveredIxResidue) {
      residues.push(hoveredIxResidue)
    }
    return residues.length > 0 ? residues : null
  }, [hoveredGroupId, selectedGroupIds, activeGroups, focusedResidue, hoveredIxResidue])

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

  // Resolve antibody / antigen chains from information
  const { abChains, agChains } = useMemo(() => {
    if (taskType !== 'antibody' || !information?.entities) return { abChains: [], agChains: [] }
    const ab = [], ag = []
    for (const e of information.entities) {
      const lbl = (e.label || '').toLowerCase()
      if (lbl.includes('heavy') || lbl.includes('light')) ab.push(e.chain)
      else if (lbl.includes('antigen')) ag.push(e.chain)
    }
    return { abChains: ab, agChains: ag }
  }, [taskType, information])

  // Compute interactions from PDB when sample changes
  useEffect(() => {
    if (taskType === 'antibody' && (abChains.length === 0 || agChains.length === 0)) return
    const url = `/${folder}/model_sample_${activeSample + 1}.pdb`
    setInteractionsLoading(true)
    setInteractions(null)
    const promise = taskType === 'enzyme'
      ? analyzeInteractions(url)
      : analyzeProteinProteinInteractions(url, abChains, agChains)
    promise
      .then(data => { setInteractions(data); setInteractionsLoading(false) })
      .catch(() => setInteractionsLoading(false))
  }, [folder, activeSample, taskType, abChains, agChains])

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
              <div className="rp-homolog-source-hint">
                {taskType === 'antibody'
                  ? 'Searched by antigen sequence similarity'
                  : 'Searched by enzyme sequence similarity'}
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
                          className="rp-anno-item-header clickable"
                          onClick={() => toggleGroupSelection(group.id)}
                        >
                          <div className="rp-anno-info">
                            <div className="rp-anno-label-row">
                              <div className="rp-anno-dot" style={{ background: group.color }} />
                              <span className="rp-anno-label">{group.label}</span>
                            </div>
                            <span className="rp-anno-residues">{group.residues.length} residues</span>
                          </div>
                          <span className={`rp-anno-pin ${isSelected ? 'pinned' : ''}`} style={{ color: isSelected ? group.color : undefined }}>
                            {isSelected ? '◉' : '○'}
                          </span>
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


            {/* Interactions */}
            <InteractionsCard
              interactions={interactions}
              loading={interactionsLoading}
              focusedResidue={focusedResidue}
              taskType={taskType}
              annotationGroups={activeGroups}
              onResidueFocus={(chain, seqId, resName) => {
                setFocusedResidue(prev =>
                  prev?.chain === chain && prev?.seqId === seqId
                    ? null
                    : { chain, seqId, resType: resName }
                )
              }}
              onResidueHover={(chain, seqId, resName) => {
                setHoveredIxResidue(chain ? { chain, seqId, resType: resName } : null)
              }}
            />

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

      <ResidueInspector
        residue={focusedResidue ?? hoveredIxResidue}
        pinned={!!focusedResidue}
        annotationGroups={activeGroups}
        interactions={interactions}
        liabilityHits={liabilityHits}
        information={information}
        onClose={() => setFocusedResidue(null)}
      />
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
                    const spanStart = h.start + 1
                    const spanEnd = h.start + h.matchedSeq.length
                    const isFocused = focusedResidue?.chain === h.chain
                      && focusedResidue.seqId >= spanStart && focusedResidue.seqId <= spanEnd
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

// ── Residue Inspector floating panel ─────────────────────────────────

const IX_LABELS = { hBonds: 'H-Bond', piPiStacks: 'π-π Stack', piCations: 'π-Cation', saltBridges: 'Salt Bridge', hydrophobics: 'Hydrophobic' }

function ixOtherSide(type, row, chain, seqId) {
  if (type === 'hBonds') {
    const isD = row.donorChain === chain && row.donorPosition === seqId
    return isD
      ? { chain: row.acceptorChain, pos: row.acceptorPosition, res: row.acceptorResidue, dist: row.distance }
      : { chain: row.donorChain, pos: row.donorPosition, res: row.donorResidue, dist: row.distance }
  }
  if (type === 'piCations') {
    const isR = row.ringChain === chain && row.ringPosition === seqId
    return isR
      ? { chain: row.cationChain, pos: row.cationPosition, res: row.cationResidue, dist: row.distance }
      : { chain: row.ringChain, pos: row.ringPosition, res: row.ringResidue, dist: row.distance }
  }
  const is1 = row.chain1 === chain && row.position1 === seqId
  return is1
    ? { chain: row.chain2, pos: row.position2, res: row.residue2, dist: row.distance }
    : { chain: row.chain1, pos: row.position1, res: row.residue1, dist: row.distance }
}

function ResidueInspector({ residue, pinned, annotationGroups, interactions, liabilityHits, information, onClose }) {
  if (!residue) return null

  const chainEntity = information?.entities?.find(e => e.chain === residue.chain)
  const chainLabel = chainEntity?.label

  const matchedGroups = useMemo(() =>
    (annotationGroups || []).filter(g =>
      g.residues.some(r => r.chain === residue.chain && r.seqId === residue.seqId)
    ), [annotationGroups, residue.chain, residue.seqId])

  const matchIx = (c, p) => c === residue.chain && p === residue.seqId
  const matchedIx = useMemo(() => {
    if (!interactions) return null
    const result = {}
    let total = 0
    for (const [key, label] of Object.entries(IX_LABELS)) {
      const rows = (interactions[key] ?? []).filter(b => {
        if (key === 'hBonds') return matchIx(b.donorChain, b.donorPosition) || matchIx(b.acceptorChain, b.acceptorPosition)
        if (key === 'piCations') return matchIx(b.ringChain, b.ringPosition) || matchIx(b.cationChain, b.cationPosition)
        return matchIx(b.chain1, b.position1) || matchIx(b.chain2, b.position2)
      })
      if (rows.length > 0) { result[key] = rows; total += rows.length }
    }
    return total > 0 ? { entries: result, total } : null
  }, [interactions, residue.chain, residue.seqId])

  const matchedLiability = useMemo(() =>
    (liabilityHits || []).filter(h =>
      h.chain === residue.chain && residue.seqId >= h.start + 1 && residue.seqId <= h.start + h.matchedSeq.length
    ), [liabilityHits, residue.chain, residue.seqId])

  const hasContent = matchedGroups.length > 0 || matchedIx || matchedLiability.length > 0

  return (
    <div className={`rp-inspector ${pinned ? 'pinned' : 'preview'}`}>
      <div className="rp-inspector-header">
        <span className="rp-inspector-id">
          {residue.chain}{residue.seqId}
          <span className="rp-inspector-res">{residue.resType}</span>
        </span>
        {chainLabel && <span className="rp-inspector-chain">{chainLabel}</span>}
        {pinned && <button className="rp-inspector-close" onClick={onClose}>×</button>}
      </div>

      {!hasContent && (
        <div className="rp-inspector-empty">No associated data</div>
      )}

      {matchedGroups.length > 0 && (
        <div className="rp-inspector-section">
          <div className="rp-inspector-section-title">Annotation</div>
          {matchedGroups.map(g => (
            <div key={g.id} className="rp-inspector-anno-item">
              <span className="rp-inspector-dot" style={{ background: g.color }} />
              {g.label}
            </div>
          ))}
        </div>
      )}

      {matchedIx && (
        <div className="rp-inspector-section">
          <div className="rp-inspector-section-title">Interactions ({matchedIx.total})</div>
          {Object.entries(matchedIx.entries).map(([key, rows]) =>
            rows.map((row, i) => {
              const other = ixOtherSide(key, row, residue.chain, residue.seqId)
              return (
                <div key={`${key}-${i}`} className="rp-inspector-ix-item">
                  <span className="rp-inspector-ix-type">{IX_LABELS[key]}</span>
                  <span className="rp-inspector-ix-arrow">→</span>
                  <span className="rp-inspector-ix-target">{other.chain}:{other.pos} {other.res}</span>
                  <span className="rp-inspector-ix-dist">{other.dist.toFixed(1)}Å</span>
                </div>
              )
            })
          )}
        </div>
      )}

      {matchedLiability.length > 0 && (
        <div className="rp-inspector-section">
          <div className="rp-inspector-section-title">Liability</div>
          {matchedLiability.map((h, i) => (
            <div key={i} className="rp-inspector-liability-item">
              <span className="rp-inspector-liability-group">{h.group}</span>
              <span className="rp-inspector-liability-motif">{h.matchedSeq}</span>
              <span className="rp-inspector-liability-rsa">RSA {h.rsa}%</span>
              <span className="rp-inspector-liability-risk" style={{ color: RISK_COLORS[h.risk] }}>{h.risk}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Interactions card ────────────────────────────────────────────────

const CDR_ORDER = ['CDR-H1', 'CDR-H2', 'CDR-H3', 'CDR-L1', 'CDR-L2', 'CDR-L3', 'Framework']

function buildCdrLookup(groups) {
  const map = new Map()
  if (!groups) return map
  for (const g of groups) {
    if (!g.id.startsWith('cdr_')) continue
    const label = g.label
    for (const r of g.residues) {
      map.set(`${r.chain}:${r.seqId}`, label)
    }
  }
  return map
}

function groupByEpitope(rows, antigenKey, antibodyKey, cdrMap) {
  const grouped = new Map()
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const ag = antigenKey(row)
    const epLabel = `${ag.chain}${ag.seqId} ${ag.resName}`
    if (!grouped.has(epLabel)) grouped.set(epLabel, [])
    const ab = antibodyKey(row)
    const cdr = cdrMap.get(`${ab.chain}:${ab.seqId}`) ?? 'Framework'
    grouped.get(epLabel).push({ row, originalIndex: i, cdr })
  }
  for (const items of grouped.values()) {
    items.sort((a, b) => CDR_ORDER.indexOf(a.cdr) - CDR_ORDER.indexOf(b.cdr))
  }
  return grouped
}

function InteractionsCard({ interactions, loading, focusedResidue, taskType, annotationGroups, onResidueFocus, onResidueHover }) {
  const [openSections, setOpenSections] = useState(new Set(['hBond']))
  const [selectedRow, setSelectedRow] = useState(null)
  const [selectedPair, setSelectedPair] = useState(null)
  const [epitopeOnly, setEpitopeOnly] = useState(true)
  const toggleSection = (key) => setOpenSections(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  const isAntibody = taskType === 'antibody'
  const cdrMap = useMemo(() => isAntibody ? buildCdrLookup(annotationGroups) : new Map(), [isAntibody, annotationGroups])

  const filterByCdr = (rows, abChainKey, abSeqIdKey) => {
    if (!isAntibody || !epitopeOnly || cdrMap.size === 0) return rows
    return rows.filter(b => cdrMap.has(`${b[abChainKey]}:${b[abSeqIdKey]}`))
  }

  const hBonds = filterByCdr(interactions?.hBonds ?? [], 'donorChain', 'donorPosition')
  const piPiStacks = filterByCdr(interactions?.piPiStacks ?? [], 'chain1', 'position1')
  const piCations = filterByCdr(interactions?.piCations ?? [], 'ringChain', 'ringPosition')
  const saltBridges = filterByCdr(interactions?.saltBridges ?? [], 'chain1', 'position1')
  const hydrophobics = filterByCdr(interactions?.hydrophobics ?? [], 'chain1', 'position1')

  const handleRowClick = (section, index, chain, seqId, resName, abChain, abSeqId) => {
    const key = `${section}:${index}`
    if (selectedRow === key) {
      setSelectedRow(null)
      setSelectedPair(null)
      onResidueFocus(chain, seqId, resName)
    } else {
      setSelectedRow(key)
      setSelectedPair(abChain != null ? { abChain, abSeqId, agChain: chain, agSeqId: seqId } : null)
      onResidueFocus(chain, seqId, resName)
    }
  }

  const isRowSelected = (section, index) => selectedRow === `${section}:${index}`

  const isRowRelated = (section, index, abChain, abSeqId, agChain, agSeqId) => {
    if (!selectedPair || selectedRow === `${section}:${index}`) return false
    return selectedPair.abChain === abChain && selectedPair.abSeqId === abSeqId
      && selectedPair.agChain === agChain && selectedPair.agSeqId === agSeqId
  }

  const isRowExternallyFocused = (side1Chain, side1Pos, side2Chain, side2Pos) => {
    if (!focusedResidue) return false
    const { chain: fc, seqId: fs } = focusedResidue
    return (fc === side1Chain && fs === side1Pos) || (fc === side2Chain && fs === side2Pos)
  }

  return (
    <div className="rp-anno-panel">
      <div className="rp-anno-header">
        <span className="rp-anno-title">Non-Covalent Bond</span>
        {isAntibody && cdrMap.size > 0 && (
          <div className="rp-ix-filter-toggle">
            <button className={`rp-ix-filter-btn ${epitopeOnly ? 'active' : ''}`} onClick={() => setEpitopeOnly(true)}>CDR</button>
            <button className={`rp-ix-filter-btn ${!epitopeOnly ? 'active' : ''}`} onClick={() => setEpitopeOnly(false)}>All</button>
          </div>
        )}
      </div>
      {loading && <div className="rp-anno-loading">Analyzing interactions...</div>}
      {!loading && interactions && (
        <div className="rp-interactions-body">

          {/* H-Bond */}
          <IxSection id="hBond" label="H-Bond" count={hBonds.length} cutoff="3.5" open={openSections} toggle={toggleSection}>
            {isAntibody ? (
              <GroupedDonorAcceptorTable
                section="hBond" rows={hBonds} cdrMap={cdrMap}
                antigenKey={b => ({ chain: b.acceptorChain, seqId: b.acceptorPosition, resName: b.acceptorResidue })}
                antibodyKey={b => ({ chain: b.donorChain, seqId: b.donorPosition })}
                focusKey={b => [b.acceptorChain, b.acceptorPosition, b.acceptorResidue]}
                cols={['Don-Chain','Don-Pos','Don-Res','Don-Atom','Acc-Chain','Acc-Pos','Acc-Res','Acc-Atom','Dist (Å)']}
                renderRow={b => (<>
                  <td className="rp-ix-chain">{b.donorChain}</td><td>{b.donorPosition}</td>
                  <td className="rp-ix-res">{b.donorResidue}</td><td className="rp-ix-atom">{b.donorAtom}</td>
                  <td className="rp-ix-chain">{b.acceptorChain}</td><td>{b.acceptorPosition}</td>
                  <td className="rp-ix-res">{b.acceptorResidue}</td><td className="rp-ix-atom">{b.acceptorAtom}</td>
                  <td className="rp-ix-dist">{b.distance.toFixed(3)}</td>
                </>)}
                isRowSelected={isRowSelected} isRowRelated={isRowRelated} isRowExternallyFocused={isRowExternallyFocused} handleRowClick={handleRowClick} onResidueHover={onResidueHover}
              />
            ) : (
              <table className="rp-ix-table">
                <thead><tr>
                  <th>Don-Chain</th><th>Don-Pos</th><th>Don-Res</th><th>Don-Atom</th>
                  <th>Acc-Chain</th><th>Acc-Pos</th><th>Acc-Res</th><th>Acc-Atom</th>
                  <th>Dist (Å)</th>
                </tr></thead>
                <tbody>
                  {hBonds.map((b, i) => (
                    <tr key={i} className={isRowSelected('hBond', i) ? 'focused' : isRowRelated('hBond', i, b.donorChain, b.donorPosition, b.acceptorChain, b.acceptorPosition) ? 'related' : isRowExternallyFocused(b.donorChain, b.donorPosition, b.acceptorChain, b.acceptorPosition) ? 'ext-focused' : ''}
                      onClick={() => handleRowClick('hBond', i, b.acceptorChain, b.acceptorPosition, b.acceptorResidue, b.donorChain, b.donorPosition)}
                      onMouseEnter={() => onResidueHover(b.acceptorChain, b.acceptorPosition, b.acceptorResidue)}
                      onMouseLeave={() => onResidueHover(null)}>
                      <td className="rp-ix-chain">{b.donorChain}</td><td>{b.donorPosition}</td>
                      <td className="rp-ix-res">{b.donorResidue}</td><td className="rp-ix-atom">{b.donorAtom}</td>
                      <td className="rp-ix-chain">{b.acceptorChain}</td><td>{b.acceptorPosition}</td>
                      <td className="rp-ix-res">{b.acceptorResidue}</td><td className="rp-ix-atom">{b.acceptorAtom}</td>
                      <td className="rp-ix-dist">{b.distance.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </IxSection>

          {/* π-π Stack */}
          <IxSection id="piPi" label="π-π Stack" count={piPiStacks.length} cutoff="6.5" open={openSections} toggle={toggleSection}>
            {isAntibody ? (
              <GroupedPairTable
                section="piPi" rows={piPiStacks} cdrMap={cdrMap}
                antigenKey={b => ({ chain: b.chain2, seqId: b.position2, resName: b.residue2 })}
                antibodyKey={b => ({ chain: b.chain1, seqId: b.position1 })}
                focusKey={b => [b.chain2, b.position2, b.residue2]}
                cols={['Chain1','Pos1','Res1','Chain2','Pos2','Res2','Dist (Å)','Angle (°)']}
                renderRow={b => (<>
                  <td className="rp-ix-chain">{b.chain1}</td><td>{b.position1}</td><td className="rp-ix-res">{b.residue1}</td>
                  <td className="rp-ix-chain">{b.chain2}</td><td>{b.position2}</td><td className="rp-ix-res">{b.residue2}</td>
                  <td className="rp-ix-dist">{b.distance.toFixed(3)}</td><td className="rp-ix-angle">{b.angle.toFixed(1)}</td>
                </>)}
                isRowSelected={isRowSelected} isRowRelated={isRowRelated} isRowExternallyFocused={isRowExternallyFocused} handleRowClick={handleRowClick} onResidueHover={onResidueHover}
              />
            ) : (
              <table className="rp-ix-table">
                <thead><tr><th>Chain1</th><th>Pos1</th><th>Res1</th><th>Chain2</th><th>Pos2</th><th>Res2</th><th>Dist (Å)</th><th>Angle (°)</th></tr></thead>
                <tbody>
                  {piPiStacks.map((b, i) => (
                    <tr key={i} className={isRowSelected('piPi', i) ? 'focused' : isRowRelated('piPi', i, b.chain1, b.position1, b.chain2, b.position2) ? 'related' : isRowExternallyFocused(b.chain1, b.position1, b.chain2, b.position2) ? 'ext-focused' : ''}
                      onClick={() => handleRowClick('piPi', i, b.chain2, b.position2, b.residue2, b.chain1, b.position1)}
                      onMouseEnter={() => onResidueHover(b.chain2, b.position2, b.residue2)}
                      onMouseLeave={() => onResidueHover(null)}>
                      <td className="rp-ix-chain">{b.chain1}</td><td>{b.position1}</td><td className="rp-ix-res">{b.residue1}</td>
                      <td className="rp-ix-chain">{b.chain2}</td><td>{b.position2}</td><td className="rp-ix-res">{b.residue2}</td>
                      <td className="rp-ix-dist">{b.distance.toFixed(3)}</td><td className="rp-ix-angle">{b.angle.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </IxSection>

          {/* π-Cation */}
          <IxSection id="piCation" label="π-Cation" count={piCations.length} cutoff="6.0" open={openSections} toggle={toggleSection}>
            {isAntibody ? (
              <GroupedPairTable
                section="piCation" rows={piCations} cdrMap={cdrMap}
                antigenKey={b => ({ chain: b.cationChain, seqId: b.cationPosition, resName: b.cationResidue })}
                antibodyKey={b => ({ chain: b.ringChain, seqId: b.ringPosition })}
                focusKey={b => [b.cationChain, b.cationPosition, b.cationResidue]}
                cols={['Ring-Chain','Ring-Pos','Ring-Res','Cat-Chain','Cat-Pos','Cat-Res','Cat-Atom','Dist (Å)']}
                renderRow={b => (<>
                  <td className="rp-ix-chain">{b.ringChain}</td><td>{b.ringPosition}</td><td className="rp-ix-res">{b.ringResidue}</td>
                  <td className="rp-ix-chain">{b.cationChain}</td><td>{b.cationPosition}</td><td className="rp-ix-res">{b.cationResidue}</td>
                  <td className="rp-ix-atom">{b.cationAtom}</td><td className="rp-ix-dist">{b.distance.toFixed(3)}</td>
                </>)}
                isRowSelected={isRowSelected} isRowRelated={isRowRelated} isRowExternallyFocused={isRowExternallyFocused} handleRowClick={handleRowClick} onResidueHover={onResidueHover}
              />
            ) : (
              <table className="rp-ix-table">
                <thead><tr><th>Ring-Chain</th><th>Ring-Pos</th><th>Ring-Res</th><th>Cat-Chain</th><th>Cat-Pos</th><th>Cat-Res</th><th>Cat-Atom</th><th>Dist (Å)</th></tr></thead>
                <tbody>
                  {piCations.map((b, i) => (
                    <tr key={i} className={isRowSelected('piCation', i) ? 'focused' : isRowRelated('piCation', i, b.ringChain, b.ringPosition, b.cationChain, b.cationPosition) ? 'related' : isRowExternallyFocused(b.ringChain, b.ringPosition, b.cationChain, b.cationPosition) ? 'ext-focused' : ''}
                      onClick={() => handleRowClick('piCation', i, b.cationChain, b.cationPosition, b.cationResidue, b.ringChain, b.ringPosition)}
                      onMouseEnter={() => onResidueHover(b.cationChain, b.cationPosition, b.cationResidue)}
                      onMouseLeave={() => onResidueHover(null)}>
                      <td className="rp-ix-chain">{b.ringChain}</td><td>{b.ringPosition}</td><td className="rp-ix-res">{b.ringResidue}</td>
                      <td className="rp-ix-chain">{b.cationChain}</td><td>{b.cationPosition}</td><td className="rp-ix-res">{b.cationResidue}</td>
                      <td className="rp-ix-atom">{b.cationAtom}</td><td className="rp-ix-dist">{b.distance.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </IxSection>

          {/* Salt Bridge */}
          <IxSection id="saltBridge" label="Salt Bridge" count={saltBridges.length} cutoff="4.0" open={openSections} toggle={toggleSection}>
            {isAntibody ? (
              <GroupedPairTable
                section="saltBridge" rows={saltBridges} cdrMap={cdrMap}
                antigenKey={b => ({ chain: b.chain2, seqId: b.position2, resName: b.residue2 })}
                antibodyKey={b => ({ chain: b.chain1, seqId: b.position1 })}
                focusKey={b => [b.chain2, b.position2, b.residue2]}
                cols={['Chain1','Pos1','Res1','Atom1','Chain2','Pos2','Res2','Atom2','Dist (Å)']}
                renderRow={b => (<>
                  <td className="rp-ix-chain">{b.chain1}</td><td>{b.position1}</td><td className="rp-ix-res">{b.residue1}</td><td className="rp-ix-atom">{b.atom1}</td>
                  <td className="rp-ix-chain">{b.chain2}</td><td>{b.position2}</td><td className="rp-ix-res">{b.residue2}</td><td className="rp-ix-atom">{b.atom2}</td>
                  <td className="rp-ix-dist">{b.distance.toFixed(3)}</td>
                </>)}
                isRowSelected={isRowSelected} isRowRelated={isRowRelated} isRowExternallyFocused={isRowExternallyFocused} handleRowClick={handleRowClick} onResidueHover={onResidueHover}
              />
            ) : (
              <table className="rp-ix-table">
                <thead><tr><th>Chain1</th><th>Pos1</th><th>Res1</th><th>Atom1</th><th>Chain2</th><th>Pos2</th><th>Res2</th><th>Atom2</th><th>Dist (Å)</th></tr></thead>
                <tbody>
                  {saltBridges.map((b, i) => (
                    <tr key={i} className={isRowSelected('saltBridge', i) ? 'focused' : isRowRelated('saltBridge', i, b.chain1, b.position1, b.chain2, b.position2) ? 'related' : isRowExternallyFocused(b.chain1, b.position1, b.chain2, b.position2) ? 'ext-focused' : ''}
                      onClick={() => handleRowClick('saltBridge', i, b.chain2, b.position2, b.residue2, b.chain1, b.position1)}
                      onMouseEnter={() => onResidueHover(b.chain2, b.position2, b.residue2)}
                      onMouseLeave={() => onResidueHover(null)}>
                      <td className="rp-ix-chain">{b.chain1}</td><td>{b.position1}</td><td className="rp-ix-res">{b.residue1}</td><td className="rp-ix-atom">{b.atom1}</td>
                      <td className="rp-ix-chain">{b.chain2}</td><td>{b.position2}</td><td className="rp-ix-res">{b.residue2}</td><td className="rp-ix-atom">{b.atom2}</td>
                      <td className="rp-ix-dist">{b.distance.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </IxSection>

          {/* Hydrophobic */}
          <IxSection id="hydrophobic" label="Hydrophobic" count={hydrophobics.length} cutoff="4.5" open={openSections} toggle={toggleSection}>
            {isAntibody ? (
              <GroupedPairTable
                section="hydrophobic" rows={hydrophobics} cdrMap={cdrMap}
                antigenKey={b => ({ chain: b.chain2, seqId: b.position2, resName: b.residue2 })}
                antibodyKey={b => ({ chain: b.chain1, seqId: b.position1 })}
                focusKey={b => [b.chain2, b.position2, b.residue2]}
                cols={['Chain1','Pos1','Res1','Atom1','Chain2','Pos2','Res2','Atom2','Dist (Å)']}
                renderRow={b => (<>
                  <td className="rp-ix-chain">{b.chain1}</td><td>{b.position1}</td><td className="rp-ix-res">{b.residue1}</td><td className="rp-ix-atom">{b.atom1}</td>
                  <td className="rp-ix-chain">{b.chain2}</td><td>{b.position2}</td><td className="rp-ix-res">{b.residue2}</td><td className="rp-ix-atom">{b.atom2}</td>
                  <td className="rp-ix-dist">{b.distance.toFixed(3)}</td>
                </>)}
                isRowSelected={isRowSelected} isRowRelated={isRowRelated} isRowExternallyFocused={isRowExternallyFocused} handleRowClick={handleRowClick} onResidueHover={onResidueHover}
              />
            ) : (
              <table className="rp-ix-table">
                <thead><tr><th>Chain1</th><th>Pos1</th><th>Res1</th><th>Atom1</th><th>Chain2</th><th>Pos2</th><th>Res2</th><th>Atom2</th><th>Dist (Å)</th></tr></thead>
                <tbody>
                  {hydrophobics.map((b, i) => (
                    <tr key={i} className={isRowSelected('hydrophobic', i) ? 'focused' : isRowRelated('hydrophobic', i, b.chain1, b.position1, b.chain2, b.position2) ? 'related' : isRowExternallyFocused(b.chain1, b.position1, b.chain2, b.position2) ? 'ext-focused' : ''}
                      onClick={() => handleRowClick('hydrophobic', i, b.chain2, b.position2, b.residue2, b.chain1, b.position1)}
                      onMouseEnter={() => onResidueHover(b.chain2, b.position2, b.residue2)}
                      onMouseLeave={() => onResidueHover(null)}>
                      <td className="rp-ix-chain">{b.chain1}</td><td>{b.position1}</td><td className="rp-ix-res">{b.residue1}</td><td className="rp-ix-atom">{b.atom1}</td>
                      <td className="rp-ix-chain">{b.chain2}</td><td>{b.position2}</td><td className="rp-ix-res">{b.residue2}</td><td className="rp-ix-atom">{b.atom2}</td>
                      <td className="rp-ix-dist">{b.distance.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </IxSection>

        </div>
      )}
    </div>
  )
}

function IxSection({ id, label, count, cutoff, open, toggle, children }) {
  const isOpen = open.has(id)
  return (
    <div className="rp-ix-section">
      <div className="rp-ix-section-header" onClick={() => toggle(id)}>
        <span className="rp-ix-arrow">{isOpen ? '▾' : '▸'}</span>
        <span className="rp-ix-section-title">{label}</span>
        {cutoff && <span className="rp-ix-cutoff">≤ {cutoff} Å</span>}
        <span className="rp-ix-section-count">{count}</span>
      </div>
      {isOpen && count > 0 && <div className="rp-ix-table-wrap">{children}</div>}
      {isOpen && count === 0 && <div className="rp-anno-loading">No {label} detected</div>}
    </div>
  )
}

// ── Grouped interaction table (antibody mode) ──────────────────────

function GroupedIxTable({ section, rows, cdrMap, antigenKey, antibodyKey, focusKey, cols, renderRow, isRowSelected, isRowRelated, isRowExternallyFocused, handleRowClick, onResidueHover }) {
  const grouped = useMemo(() => groupByEpitope(rows, antigenKey, antibodyKey, cdrMap), [rows, antigenKey, antibodyKey, cdrMap])
  const colCount = cols.length + 1

  return (
    <table className="rp-ix-table">
      <thead><tr>
        <th>CDR</th>
        {cols.map(c => <th key={c}>{c}</th>)}
      </tr></thead>
      <tbody>
        {[...grouped.entries()].map(([epLabel, items]) => (
          <Fragment key={epLabel}>
            <tr className="rp-ix-epitope-row">
              <td colSpan={colCount}>
                <span className="rp-ix-epitope-label">{epLabel}</span>
                <span className="rp-ix-epitope-count">{items.length}</span>
              </td>
            </tr>
            {items.map(({ row, originalIndex, cdr }) => {
              const [agChain, agSeqId, agRes] = focusKey(row)
              const ab = antibodyKey(row)
              const cls = isRowSelected(section, originalIndex) ? 'focused'
                : isRowRelated(section, originalIndex, ab.chain, ab.seqId, agChain, agSeqId) ? 'related'
                : isRowExternallyFocused(ab.chain, ab.seqId, agChain, agSeqId) ? 'ext-focused' : ''
              return (
                <tr key={originalIndex}
                  className={cls}
                  onClick={() => handleRowClick(section, originalIndex, agChain, agSeqId, agRes, ab.chain, ab.seqId)}
                  onMouseEnter={() => onResidueHover(agChain, agSeqId, agRes)}
                  onMouseLeave={() => onResidueHover(null)}
                >
                  <td><span className="rp-ix-cdr-tag">{cdr}</span></td>
                  {renderRow(row)}
                </tr>
              )
            })}
          </Fragment>
        ))}
      </tbody>
    </table>
  )
}

const GroupedDonorAcceptorTable = GroupedIxTable
const GroupedPairTable = GroupedIxTable

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

  const uniqueGroups = useMemo(() => {
    if (!groups?.length) return []
    const seen = new Set()
    return groups.filter(g => { if (seen.has(g.label)) return false; seen.add(g.label); return true })
  }, [groups])

  return (
    <div className="rp-seqbar">
      {uniqueGroups.length > 0 && (
        <div className="rp-seqbar-legend">
          {uniqueGroups.map(g => (
            <span key={g.id} className="rp-seqbar-legend-item">
              <span className="rp-seqbar-legend-dot" style={{ background: g.color }} />
              {g.label}
            </span>
          ))}
        </div>
      )}
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
