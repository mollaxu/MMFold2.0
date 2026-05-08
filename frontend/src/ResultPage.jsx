import { useState, useEffect, useMemo, useRef, Fragment } from 'react'
import MolstarViewer from './MolstarViewer'
import PAECanvas from './PAECanvas'
import AppHeader from './AppHeader'
import { scanEntities } from './liabilityScanner'
import { analyzeInteractions, analyzeProteinProteinInteractions } from './interactionAnalyzer'
import { buildRuleContext, generateSuggestions } from './optimizationRules'

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
  const [focusedResidues, setFocusedResidues] = useState([])  // [{chain, seqId, resType}, ...]
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
    setFocusedResidues([])
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
    if (focusedResidues.length) {
      residues.push(...focusedResidues)
    }
    if (hoveredIxResidue) {
      residues.push(hoveredIxResidue)
    }
    return residues.length > 0 ? residues : null
  }, [hoveredGroupId, selectedGroupIds, activeGroups, focusedResidues, hoveredIxResidue])

  const toggleGroupSelection = (groupId) => {
    setSelectedGroupIds(prev => {
      const next = new Set(prev)
      next.has(groupId) ? next.delete(groupId) : next.add(groupId)
      return next
    })
  }

  const clearSelections = () => {
    setSelectedGroupIds(new Set())
    setFocusedResidues([])
  }

  const lastFocused = focusedResidues[focusedResidues.length - 1] ?? null

  // Click residue: toggle in/out of multi-selection
  const handleResidueClick = (residue, e) => {
    e?.stopPropagation?.()
    if (!residue) { setFocusedResidues([]); setSelectedGroupIds(new Set()); setHoveredIxResidue(null); return }
    if (Array.isArray(residue)) {
      setFocusedResidues(residue)
      return
    }
    setFocusedResidues(prev => {
      const idx = prev.findIndex(r => r.chain === residue.chain && r.seqId === residue.seqId)
      return idx >= 0 ? prev.filter((_, i) => i !== idx) : [...prev, residue]
    })
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

  const focusedIxTypes = useMemo(() => {
    if (!focusedResidues.length || !interactions) return null
    const match = (c, s) => focusedResidues.some(r => r.chain === c && r.seqId === s)
    const types = []
    if ((interactions.hBonds ?? []).some(b => match(b.donorChain, b.donorPosition) || match(b.acceptorChain, b.acceptorPosition))) types.push('hBond')
    if ((interactions.piPiStacks ?? []).some(b => match(b.chain1, b.position1) || match(b.chain2, b.position2))) types.push('piPi')
    if ((interactions.piCations ?? []).some(b => match(b.ringChain, b.ringPosition) || match(b.cationChain, b.cationPosition))) types.push('piCation')
    if ((interactions.saltBridges ?? []).some(b => match(b.chain1, b.position1) || match(b.chain2, b.position2))) types.push('saltBridge')
    if ((interactions.hydrophobics ?? []).some(b => match(b.chain1, b.position1) || match(b.chain2, b.position2))) types.push('hydrophobic')
    return types.length ? types : null
  }, [focusedResidues, interactions])

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
          ) : null}
          {/* LEFT: sticky 3D viewer + legend */}
          <div className="rp-left-col">
            <div className="rp-viewer-card" style={{ flex: 1, minHeight: 0 }}>
              <div className="rp-viewer-toolbar">
                <div className="rp-toolbar-half">
                  <div className="rp-repr-toggle">
                    <button
                      className={`rp-repr-btn ${reprMode === 'surface' ? 'active' : ''}`}
                      onClick={() => setReprMode('surface')}
                    >Surface</button>
                    <button
                      className={`rp-repr-btn ${reprMode === 'cartoon' ? 'active' : ''}`}
                      onClick={() => setReprMode('cartoon')}
                    >Cartoon</button>
                  </div>
                  <div className="rp-color-toggle">
                    <button
                      className={`rp-color-btn ${colorMode === 'plddt' ? 'active' : ''}`}
                      onClick={() => setColorMode('plddt')}
                    >pLDDT</button>
                    <button
                      className={`rp-color-btn ${colorMode === 'electrostatic' ? 'active' : ''}`}
                      onClick={() => setColorMode('electrostatic')}
                    >Electrostatic</button>
                  </div>
                </div>
                {focusedIxTypes ? (
                  <div className="rp-ix-legend">
                    {focusedIxTypes.map(t => (
                      <span key={t} className="rp-ix-legend-item">
                        <span className="rp-ix-legend-dot" style={{ background: IX_LEGEND[t]?.color }} />
                        {IX_LEGEND[t]?.label}
                      </span>
                    ))}
                  </div>
                ) : colorMode === 'plddt' ? (
                  <div className="rp-plddt-legend">
                    <div className="rp-plddt-item">
                      <span className="rp-plddt-label">&gt;90</span>
                      <div className="rp-plddt-bar" style={{ background: '#0066cc' }} />
                    </div>
                    <div className="rp-plddt-item">
                      <span className="rp-plddt-label">70–90</span>
                      <div className="rp-plddt-bar" style={{ background: '#4dd8e8' }} />
                    </div>
                    <div className="rp-plddt-item">
                      <span className="rp-plddt-label">50–70</span>
                      <div className="rp-plddt-bar" style={{ background: '#ffdd57' }} />
                    </div>
                    <div className="rp-plddt-item">
                      <span className="rp-plddt-label">&lt;50</span>
                      <div className="rp-plddt-bar" style={{ background: 'linear-gradient(to right, #ff9933, #ff6600)' }} />
                    </div>
                  </div>
                ) : colorMode === 'electrostatic' ? (
                  <div className="rp-electro-legend">
                    <div className="rp-electro-labels">
                      <span>Negative (−)</span>
                      <span>Neutral</span>
                      <span>Positive (+)</span>
                    </div>
                    <div className="rp-electro-bar" />
                  </div>
                ) : null}
              </div>
              <MolstarViewer
                structureUrl={structureUrl}
                highlightedResidues={highlightedResidues}
                focusedResidue={lastFocused}
                representationMode={reprMode}
                taskType={taskType}
                superimposeUrl={superimposeUrl}
                onResidueClick={handleResidueClick}
                colorMode={colorMode}
                autoFocusLigand={taskType === 'enzyme'}
                interactions={interactions}
              />
            </div>
            {information && (
              <SequenceBar
                entities={information.entities}
                groups={activeGroups}
                focusedResidues={focusedResidues}
                onResidueClick={handleResidueClick}
              />
            )}
          </div>

          {/* RIGHT: scrollable panels */}
          <div className="rp-right-col">

            {/* Optimization Suggestions */}
            <h2 className="rp-section-label">Optimization Suggestions</h2>
            <AiSuggestionsCard
              key={activeSample}
              taskType={taskType}
              summary={summary}
              annotationGroups={activeGroups}
              liabilityHits={liabilityHits}
              information={information}
              interactions={interactions}
              onResidueClick={handleResidueClick}
            />

            <h2 className="rp-section-label">MMetrics</h2>
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
                            const isFocused = focusedResidues.some(fr => fr.chain === r.chain && fr.seqId === r.seqId)
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

            <InteractionsCard
              interactions={interactions}
              loading={interactionsLoading}
              focusedResidues={focusedResidues}
              taskType={taskType}
              annotationGroups={activeGroups}
              structureUrl={structureUrl}
              abChains={abChains}
              onResidueFocus={(chain, seqId, resName) => {
                const residue = { chain, seqId, resType: resName }
                setFocusedResidues(prev => {
                  const idx = prev.findIndex(r => r.chain === chain && r.seqId === seqId)
                  return idx >= 0 ? prev.filter((_, i) => i !== idx) : [...prev, residue]
                })
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
                focusedResidues={focusedResidues}
                onHitClick={(hit) => {
                  const seqId = hit.start + 1
                  const residue = { chain: hit.chain, seqId, resType: hit.matchedSeq[0] }
                  setFocusedResidues(prev => {
                    const idx = prev.findIndex(r => r.chain === hit.chain && r.seqId === seqId)
                    return idx >= 0 ? prev.filter((_, i) => i !== idx) : [...prev, residue]
                  })
                }}
              />
            )}

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

            {/* Information */}
            {information && <InformationSection info={information} />}

          </div>
        </div>
      </div>

      {/* <ResidueInspector
        residue={lastFocused ?? hoveredIxResidue}
        pinned={!!lastFocused}
        annotationGroups={activeGroups}
        interactions={interactions}
        liabilityHits={liabilityHits}
        information={information}
        onClose={() => setFocusedResidues([])}
      /> */}
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

function LiabilityScanCard({ hits, openGroups, onToggleGroup, focusedResidues, onHitClick }) {
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
                    const isFocused = focusedResidues.some(fr =>
                      fr.chain === h.chain && fr.seqId >= spanStart && fr.seqId <= spanEnd
                    )
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

const AA3 = { A:'ALA',R:'ARG',N:'ASN',D:'ASP',C:'CYS',E:'GLU',Q:'GLN',G:'GLY',H:'HIS',I:'ILE',L:'LEU',K:'LYS',M:'MET',F:'PHE',P:'PRO',S:'SER',T:'THR',W:'TRP',Y:'TYR',V:'VAL' }

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
          <span className="rp-inspector-res">{AA3[residue.resType] || residue.resType}</span>
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

const PRIORITY_COLORS = { high: '#ef4444', medium: '#f59e0b', low: '#6b7280' }
const PRIORITY_LABELS = { high: 'High', medium: 'Medium', low: 'Low' }
const AI_CTA_PROMPTS = {
  Developability: 'Want to improve developability?',
  Affinity: 'Want to optimize binding affinity?',
  Selectivity: 'Want to engineer selectivity?',
  Catalysis: 'Want to boost catalytic activity?',
  Stability: 'Want to enhance stability?',
}

function StrategySection({ strategy, mutationTable }) {
  if (!mutationTable?.length) {
    return <p className="rp-ai-strategy">{strategy}</p>
  }
  return (
    <div className="rp-ai-strategy-block">
      {strategy && <p className="rp-ai-strategy">{strategy}</p>}
      <div className="rp-ai-mutation-table">
        <div className="rp-ai-mutation-header">
          <span>Position</span>
          <span>Substitution</span>
          <span>Region</span>
          <span>Rationale</span>
          <span>Priority</span>
        </div>
        {mutationTable.map((m, i) => (
          <div key={i} className="rp-ai-mutation-row">
            <span className="rp-ai-mut-pos">{m.position}</span>
            <span className="rp-ai-mut-sub">
              <span className="rp-ai-mut-from">{m.from}</span>
              <span className="rp-ai-mut-arrow">→</span>
              <span className="rp-ai-mut-to">{m.to}</span>
            </span>
            <span className="rp-ai-mut-region">{m.region}</span>
            <span className="rp-ai-mut-rationale">{m.rationale}</span>
            <span className={`rp-ai-ev-risk rp-ai-ev-risk--${m.priority.toLowerCase()}`}>{m.priority}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function AiSuggestionsCard({ taskType, summary, annotationGroups, liabilityHits, information, interactions, onResidueClick }) {
  const suggestions = useMemo(() => {
    if (!summary) return []
    const ctx = buildRuleContext(taskType, summary, annotationGroups, liabilityHits, information, interactions)
    return generateSuggestions(ctx)
  }, [taskType, summary, annotationGroups, liabilityHits, information, interactions])

  const [phase, setPhase] = useState('thinking')
  const [revealCount, setRevealCount] = useState(0)
  const phaseKeyRef = useRef(null)

  const suggestionsKey = suggestions.map(s => s.id).join(',')
  if (suggestionsKey && phaseKeyRef.current !== suggestionsKey) {
    phaseKeyRef.current = suggestionsKey
    setPhase('thinking')
    setRevealCount(0)
  }

  useEffect(() => {
    if (!suggestions.length || phase !== 'thinking') return
    const t = setTimeout(() => { setPhase('streaming'); setRevealCount(1) }, 3000)
    return () => clearTimeout(t)
  }, [suggestions.length, phase])

  useEffect(() => {
    if (phase !== 'streaming' || revealCount >= suggestions.length) return
    const t = setTimeout(() => setRevealCount(prev => prev + 1), 600)
    return () => clearTimeout(t)
  }, [phase, revealCount, suggestions.length])

  const [openIds, setOpenIds] = useState(new Set())
  const firstIdRef = useRef(null)
  const visible = phase === 'thinking' ? [] : suggestions.slice(0, revealCount)
  if (visible.length && firstIdRef.current !== visible[0].id) {
    firstIdRef.current = visible[0].id
    if (!openIds.has(visible[0].id)) {
      setOpenIds(new Set([visible[0].id]))
    }
  }
  const toggle = id => setOpenIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  if (!suggestions.length) return null

  if (phase === 'thinking') {
    return (
      <div className="rp-anno-panel rp-ai-thinking">
        <div className="rp-ai-thinking-content">
          <span className="rp-ai-thinking-dots"><span /><span /><span /></span>
          <span className="rp-ai-thinking-text">Analyzing structure and generating suggestions...</span>
        </div>
      </div>
    )
  }

  return (
    <>
      {visible.map((s, idx) => {
        const isOpen = openIds.has(s.id)
        return (
          <div key={s.id} className={`rp-anno-panel rp-ai-card rp-ai-card--reveal`} style={{ '--ai-color': PRIORITY_COLORS[s.priority], animationDelay: `${idx * 0.1}s` }}>
            <div className="rp-ai-card-header" onClick={() => toggle(s.id)}>
              <span className="rp-ai-title">{s.title}</span>
              <span className="rp-ai-category" style={{ background: PRIORITY_COLORS[s.priority] }}>
                {s.category}
              </span>
              <span className={`rp-ai-chevron ${isOpen ? 'open' : ''}`}>▸</span>
            </div>
            {isOpen && (
              <div className="rp-ai-card-body">
                <p className="rp-ai-summary">{s.summary}</p>
                <div className="rp-ai-section">
                  <span className="rp-ai-section-label">Evidence</span>
                  {s.evidence.length > 0 && typeof s.evidence[0] === 'object' ? (
                    <div className="rp-ai-evidence-structured">
                      {s.evidence.map((e, i) => (
                        <div key={i} className="rp-ai-ev-item" onClick={() => e.residues?.length && onResidueClick?.(e.residues)}>
                          <div className="rp-ai-ev-header">
                            <span className="rp-ai-ev-type">{e.type}</span>
                            <span className="rp-ai-ev-motif">motif: {e.motif}</span>
                            <span className={`rp-ai-ev-risk rp-ai-ev-risk--${e.risk.toLowerCase()}`}>{e.risk}</span>
                          </div>
                          <div className="rp-ai-ev-details">
                            <span className="rp-ai-ev-detail"><span className="rp-ai-ev-label">Position</span>{e.position}</span>
                            {e.cdr && <span className="rp-ai-ev-detail"><span className="rp-ai-ev-label">Region</span>{e.cdr}</span>}
                            {e.rsa != null && <span className="rp-ai-ev-detail"><span className="rp-ai-ev-label">RSA</span>{e.rsa}% ({e.rsaLabel})</span>}
                          </div>
                          {e.mechanism && <p className="rp-ai-ev-mechanism">{e.mechanism}</p>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <>
                      <ul className="rp-ai-evidence">
                        {s.evidence.map((e, i) => <li key={i}>{e}</li>)}
                      </ul>
                      {s.relatedResidues?.length > 0 && (
                        <div className="rp-ai-residues">
                          {s.relatedResidues.map((r, i) => (
                            <span
                              key={i}
                              className="rp-ai-residue-tag"
                              onClick={e => onResidueClick?.(r, e)}
                            >
                              {r.chain}:{r.resType}{r.seqId}
                            </span>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
                <div className="rp-ai-section">
                  <span className="rp-ai-section-label">Strategy</span>
                  <StrategySection strategy={s.strategy} mutationTable={s.mutationTable} />
                </div>
                <button
                  className="rp-mos-btn rp-ai-cta"
                  onClick={() => window.open(MOS_URL, '_blank', 'noopener,noreferrer')}
                >
                  <span className="rp-mos-prompt">{AI_CTA_PROMPTS[s.category] || `Want to optimize ${s.category.toLowerCase()}?`}</span>
                  <span className="rp-mos-action">Go to MOS →</span>
                </button>
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

// TODO: Replace rule engine with API call when backend is ready
// function fetchAiSuggestions(folder) {
//   return fetch(`/api/optimize/${folder}`).then(r => r.json())
// }

function InteractionsCard({ interactions, loading, focusedResidues, taskType, annotationGroups, structureUrl, abChains, onResidueFocus, onResidueHover }) {
  const [viewMode, setViewMode] = useState('2d')
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
    if (!focusedResidues.length) return false
    return focusedResidues.some(({ chain: fc, seqId: fs }) =>
      (fc === side1Chain && fs === side1Pos) || (fc === side2Chain && fs === side2Pos)
    )
  }

  return (
    <div className="rp-anno-panel">
      <div className="rp-anno-header">
        <span className="rp-anno-title">Non-Covalent Bond</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {isAntibody && cdrMap.size > 0 && (
            <div className="rp-ix-filter-toggle">
              <button className={`rp-ix-filter-btn ${epitopeOnly ? 'active' : ''}`} onClick={() => setEpitopeOnly(true)}>CDR</button>
              <button className={`rp-ix-filter-btn ${!epitopeOnly ? 'active' : ''}`} onClick={() => setEpitopeOnly(false)}>All</button>
            </div>
          )}
          <div className="rp-ix-filter-toggle">
            <button className={`rp-ix-filter-btn ${viewMode === 'table' ? 'active' : ''}`} onClick={() => setViewMode('table')}>Table</button>
            <button className={`rp-ix-filter-btn ${viewMode === '2d' ? 'active' : ''}`} onClick={() => setViewMode('2d')}>2D</button>
          </div>
        </div>
      </div>
      {loading && <div className="rp-anno-loading">Analyzing interactions...</div>}
      {!loading && interactions && viewMode === '2d' && (
        <InteractionDiagram2D
          interactions={{ hBonds, piPiStacks, piCations, saltBridges, hydrophobics }}
          taskType={taskType} structureUrl={structureUrl}
          abChains={abChains} cdrMap={cdrMap}
          onResidueFocus={onResidueFocus} />
      )}
      {!loading && interactions && viewMode === 'table' && (
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

// ── 2D Interaction Diagram ───────────────────────────────────────────

const RESIDUE_PROPERTY_COLORS = {
  hydrophobic: '#4caf50',
  positive: '#5b8ff9',
  negative: '#ff7043',
  polar: '#26c6da',
  special: '#bdbdbd',
}

const RESIDUE_PROPERTY = {
  ALA: 'hydrophobic', VAL: 'hydrophobic', LEU: 'hydrophobic', ILE: 'hydrophobic',
  PHE: 'hydrophobic', TRP: 'hydrophobic', MET: 'hydrophobic', PRO: 'hydrophobic',
  ARG: 'positive', LYS: 'positive', HIS: 'positive',
  ASP: 'negative', GLU: 'negative',
  SER: 'polar', THR: 'polar', ASN: 'polar', GLN: 'polar', CYS: 'polar', TYR: 'polar',
  GLY: 'special',
}

const IX_TYPE_COLORS = {
  hBond: '#00cc66',
  piPi: '#ff8800',
  piCation: '#ffcc00',
  saltBridge: '#ff4444',
  hydrophobic: '#bb88ff',
}

const IX_TYPE_LABELS = {
  hBond: 'H-Bond',
  piPi: 'π-π Stack',
  piCation: 'π-Cation',
  saltBridge: 'Salt Bridge',
  hydrophobic: 'Hydrophobic',
}

function InteractionDiagram2D({ interactions, taskType, structureUrl, abChains, cdrMap, onResidueFocus }) {
  const [ligandData, setLigandData] = useState(null)

  useEffect(() => {
    if (!structureUrl || taskType !== 'enzyme') { setLigandData(null); return }
    fetch(structureUrl).then(r => r.text()).then(text => {
      const atoms = []
      for (const line of text.split('\n')) {
        const rec = line.substring(0, 6).trim()
        if (rec !== 'HETATM') continue
        const element = line.substring(76, 78).trim()
        if (!element || element === 'H') continue
        atoms.push({
          serial: parseInt(line.substring(6, 11)),
          atomName: line.substring(12, 16).trim(),
          resName: line.substring(17, 20).trim(),
          chain: line.substring(21, 22).trim(),
          resSeq: parseInt(line.substring(22, 26)),
          x: parseFloat(line.substring(30, 38)),
          y: parseFloat(line.substring(38, 46)),
          z: parseFloat(line.substring(46, 54)),
          element,
        })
      }
      if (!atoms.length) { setLigandData(null); return }

      const bonds = []
      for (let i = 0; i < atoms.length; i++) {
        for (let j = i + 1; j < atoms.length; j++) {
          const dx = atoms[i].x - atoms[j].x, dy = atoms[i].y - atoms[j].y, dz = atoms[i].z - atoms[j].z
          if (Math.sqrt(dx * dx + dy * dy + dz * dz) < 1.9) bonds.push([i, j])
        }
      }

      const coords = atoms.map(a => [a.x, a.y, a.z])
      const n = coords.length
      const mean = [0, 0, 0]
      for (const c of coords) { mean[0] += c[0]; mean[1] += c[1]; mean[2] += c[2] }
      mean[0] /= n; mean[1] /= n; mean[2] /= n
      const centered = coords.map(c => [c[0] - mean[0], c[1] - mean[1], c[2] - mean[2]])

      const cov = Array.from({ length: 3 }, () => [0, 0, 0])
      for (const c of centered) {
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += c[i] * c[j]
      }

      let v1 = [1, 0, 0], v2 = [0, 1, 0]
      for (let iter = 0; iter < 50; iter++) {
        const nv = [0, 0, 0]
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) nv[i] += cov[i][j] * v1[j]
        const len = Math.sqrt(nv[0] ** 2 + nv[1] ** 2 + nv[2] ** 2) || 1
        v1 = nv.map(x => x / len)
      }
      const dot1 = v2[0] * v1[0] + v2[1] * v1[1] + v2[2] * v1[2]
      v2 = [v2[0] - dot1 * v1[0], v2[1] - dot1 * v1[1], v2[2] - dot1 * v1[2]]
      const cov2 = Array.from({ length: 3 }, () => [0, 0, 0])
      for (const c of centered) {
        const proj = c[0] * v1[0] + c[1] * v1[1] + c[2] * v1[2]
        const r = [c[0] - proj * v1[0], c[1] - proj * v1[1], c[2] - proj * v1[2]]
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov2[i][j] += r[i] * r[j]
      }
      for (let iter = 0; iter < 50; iter++) {
        const nv = [0, 0, 0]
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) nv[i] += cov2[i][j] * v2[j]
        const len = Math.sqrt(nv[0] ** 2 + nv[1] ** 2 + nv[2] ** 2) || 1
        v2 = nv.map(x => x / len)
      }

      const proj2d = centered.map(c => ({
        x: c[0] * v1[0] + c[1] * v1[1] + c[2] * v1[2],
        y: c[0] * v2[0] + c[1] * v2[1] + c[2] * v2[2],
      }))

      setLigandData({ atoms, bonds, proj2d })
    }).catch(() => setLigandData(null))
  }, [structureUrl, taskType])

  if (taskType === 'enzyme' && ligandData) {
    return <LigandSkeletonDiagram ligandData={ligandData} interactions={interactions} onResidueFocus={onResidueFocus} />
  }

  if (taskType === 'antibody' && abChains?.length) {
    return <ProteinProteinDiagram interactions={interactions} abChains={abChains} cdrMap={cdrMap} onResidueFocus={onResidueFocus} />
  }

  return <RadialDiagram interactions={interactions} taskType={taskType} onResidueFocus={onResidueFocus} />
}

// ── Bipartite diagram for antibody–antigen interactions (atom-level) ──
function ProteinProteinDiagram({ interactions, abChains, cdrMap, onResidueFocus }) {
  const abSet = useMemo(() => new Set(abChains || []), [abChains])
  const [selectedKey, setSelectedKey] = useState(null)

  const { atomEdges, abResidues, agResidues } = useMemo(() => {
    if (!interactions) return { atomEdges: [], abResidues: [], agResidues: [] }
    const edges = []

    const norm = (s1, s2, type, dist) =>
      abSet.has(s1.chain) ? { ab: s1, ag: s2, type, dist } : { ab: s2, ag: s1, type, dist }

    for (const b of interactions.hBonds ?? [])
      edges.push(norm(
        { chain: b.donorChain, pos: b.donorPosition, res: b.donorResidue, atom: b.donorAtom },
        { chain: b.acceptorChain, pos: b.acceptorPosition, res: b.acceptorResidue, atom: b.acceptorAtom },
        'hBond', b.distance))
    for (const b of interactions.piPiStacks ?? [])
      edges.push(norm(
        { chain: b.chain1, pos: b.position1, res: b.residue1, atom: 'ring' },
        { chain: b.chain2, pos: b.position2, res: b.residue2, atom: 'ring' },
        'piPi', b.distance))
    for (const b of interactions.piCations ?? [])
      edges.push(norm(
        { chain: b.ringChain, pos: b.ringPosition, res: b.ringResidue, atom: 'ring' },
        { chain: b.cationChain, pos: b.cationPosition, res: b.cationResidue, atom: b.cationAtom },
        'piCation', b.distance))
    for (const b of interactions.saltBridges ?? [])
      edges.push(norm(
        { chain: b.chain1, pos: b.position1, res: b.residue1, atom: b.atom1 },
        { chain: b.chain2, pos: b.position2, res: b.residue2, atom: b.atom2 },
        'saltBridge', b.distance))
    for (const b of interactions.hydrophobics ?? [])
      edges.push(norm(
        { chain: b.chain1, pos: b.position1, res: b.residue1, atom: b.atom1 },
        { chain: b.chain2, pos: b.position2, res: b.residue2, atom: b.atom2 },
        'hydrophobic', b.distance))

    const abMap = new Map(), agMap = new Map()
    for (const e of edges) {
      const abk = `${e.ab.chain}:${e.ab.pos}`
      if (!abMap.has(abk)) abMap.set(abk, { chain: e.ab.chain, pos: e.ab.pos, res: e.ab.res, types: new Set() })
      abMap.get(abk).types.add(e.type)
      const agk = `${e.ag.chain}:${e.ag.pos}`
      if (!agMap.has(agk)) agMap.set(agk, { chain: e.ag.chain, pos: e.ag.pos, res: e.ag.res, types: new Set() })
      agMap.get(agk).types.add(e.type)
    }
    const sortByPos = (a, b) => a.chain < b.chain ? -1 : a.chain > b.chain ? 1 : a.pos - b.pos
    return { atomEdges: edges, abResidues: [...abMap.values()].sort(sortByPos), agResidues: [...agMap.values()].sort(sortByPos) }
  }, [interactions, abSet])

  const W = 480, nodeR = 18, nodeGap = 50, topPad = 35
  const maxN = Math.max(abResidues.length, agResidues.length, 1)
  const H = Math.max(280, topPad + maxN * nodeGap + 30)
  const leftX = 85, rightX = W - 85

  const nodePos = useMemo(() => {
    const pos = new Map()
    const layOut = (arr, x, prefix) => {
      const startY = topPad + (H - topPad - 30 - arr.length * nodeGap) / 2 + nodeGap / 2
      arr.forEach((r, i) => pos.set(`${prefix}:${r.chain}:${r.pos}`, { x, y: startY + i * nodeGap }))
    }
    layOut(abResidues, leftX, 'ab')
    layOut(agResidues, rightX, 'ag')
    return pos
  }, [abResidues, agResidues, H])

  const edgeGroups = useMemo(() => {
    const groups = new Map()
    for (const e of atomEdges) {
      const key = `${e.ab.chain}:${e.ab.pos}-${e.ag.chain}:${e.ag.pos}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(e)
    }
    return groups
  }, [atomEdges])

  const activeTypes = useMemo(() => {
    const s = new Set()
    for (const e of atomEdges) s.add(e.type)
    return [...s]
  }, [atomEdges])

  const connectedKeys = useMemo(() => {
    if (!selectedKey) return null
    const keys = new Set([selectedKey])
    for (const e of atomEdges) {
      const abk = `${e.ab.chain}:${e.ab.pos}`, agk = `${e.ag.chain}:${e.ag.pos}`
      if (abk === selectedKey) keys.add(agk)
      if (agk === selectedKey) keys.add(abk)
    }
    return keys
  }, [selectedKey, atomEdges])

  const handleNodeClick = (chain, pos, res) => {
    const k = `${chain}:${pos}`
    setSelectedKey(prev => prev === k ? null : k)
    onResidueFocus(chain, pos, res)
  }

  if (!abResidues.length && !agResidues.length) return <div className="rp-ix-2d-empty">No interactions detected</div>

  return (
    <div className="rp-ix-2d-container">
      <svg viewBox={`0 0 ${W} ${H}`} className="rp-ix-2d-svg">
        <text x={leftX} y={16} textAnchor="middle" fill="#888" fontSize="11" fontWeight="bold">Antibody</text>
        <text x={rightX} y={16} textAnchor="middle" fill="#888" fontSize="11" fontWeight="bold">Antigen</text>

        {[...edgeGroups.entries()].map(([pairKey, group]) => {
          const first = group[0]
          const from = nodePos.get(`ab:${first.ab.chain}:${first.ab.pos}`)
          const to = nodePos.get(`ag:${first.ag.chain}:${first.ag.pos}`)
          if (!from || !to) return null
          const abk = `${first.ab.chain}:${first.ab.pos}`, agk = `${first.ag.chain}:${first.ag.pos}`
          const edgeActive = !connectedKeys || connectedKeys.has(abk) && connectedKeys.has(agk)
          const fanSpread = 6
          const offset = group.length > 1 ? -(group.length - 1) * fanSpread / 2 : 0
          return group.map((e, i) => {
            const dy = offset + i * fanSpread
            const x1 = from.x + nodeR + 2, y1 = from.y + dy
            const x2 = to.x - nodeR - 2, y2 = to.y + dy
            const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
            return (
              <g key={`${pairKey}-${i}`} opacity={edgeActive ? 1 : 0.15}>
                <line x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={IX_TYPE_COLORS[e.type]} strokeWidth="1.2" strokeDasharray="5 3" opacity="0.7" />
                <text x={x1 + 4} y={y1 - 4} fill={IX_TYPE_COLORS[e.type]} fontSize="7" fontWeight="bold">{e.ab.atom}</text>
                <text x={x2 - 4} y={y2 - 4} fill={IX_TYPE_COLORS[e.type]} fontSize="7" fontWeight="bold" textAnchor="end">{e.ag.atom}</text>
                <text x={mx} y={my - 4} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="6.5">{e.dist}Å</text>
              </g>
            )
          })
        })}

        {abResidues.map(r => {
          const nk = `ab:${r.chain}:${r.pos}`
          const rk = `${r.chain}:${r.pos}`
          const p = nodePos.get(nk)
          if (!p) return null
          const prop = RESIDUE_PROPERTY[r.res] ?? 'special'
          const color = RESIDUE_PROPERTY_COLORS[prop]
          const cdr = cdrMap?.get(rk) ?? null
          const active = !connectedKeys || connectedKeys.has(rk)
          return (
            <g key={nk} style={{ cursor: 'pointer' }} opacity={active ? 1 : 0.3}
              onClick={() => handleNodeClick(r.chain, r.pos, r.res)}>
              <circle cx={p.x} cy={p.y} r={nodeR} fill={color} opacity="0.85" />
              <text x={p.x} y={p.y - 4} textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize="9" fontWeight="bold">{r.res}</text>
              <text x={p.x} y={p.y + 8} textAnchor="middle" dominantBaseline="central" fill="rgba(255,255,255,0.7)" fontSize="7">{rk}</text>
              {cdr && <text x={p.x - nodeR - 4} y={p.y} textAnchor="end" dominantBaseline="central" fill="#666" fontSize="7">{cdr}</text>}
            </g>
          )
        })}

        {agResidues.map(r => {
          const nk = `ag:${r.chain}:${r.pos}`
          const rk = `${r.chain}:${r.pos}`
          const p = nodePos.get(nk)
          if (!p) return null
          const prop = RESIDUE_PROPERTY[r.res] ?? 'special'
          const color = RESIDUE_PROPERTY_COLORS[prop]
          const active = !connectedKeys || connectedKeys.has(rk)
          return (
            <g key={nk} style={{ cursor: 'pointer' }} opacity={active ? 1 : 0.3}
              onClick={() => handleNodeClick(r.chain, r.pos, r.res)}>
              <circle cx={p.x} cy={p.y} r={nodeR} fill={color} opacity="0.85" />
              <text x={p.x} y={p.y - 4} textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize="9" fontWeight="bold">{r.res}</text>
              <text x={p.x} y={p.y + 8} textAnchor="middle" dominantBaseline="central" fill="rgba(255,255,255,0.7)" fontSize="7">{rk}</text>
            </g>
          )
        })}
      </svg>

      <div className="rp-ix-2d-legend">
        <div className="rp-ix-2d-legend-group">
          {activeTypes.map(t => (
            <span key={t} className="rp-ix-2d-legend-item">
              <span style={{ width: 14, height: 2, background: IX_TYPE_COLORS[t], display: 'inline-block', borderRadius: 1 }} />
              <span>{IX_TYPE_LABELS[t]}</span>
            </span>
          ))}
        </div>
        <div className="rp-ix-2d-legend-group">
          {Object.entries(RESIDUE_PROPERTY_COLORS).map(([k, c]) => (
            <span key={k} className="rp-ix-2d-legend-item">
              <span style={{ width: 8, height: 8, background: c, borderRadius: '50%', display: 'inline-block' }} />
              <span>{k}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function LigandSkeletonDiagram({ ligandData, interactions, onResidueFocus }) {
  const { atoms, bonds, proj2d } = ligandData
  const [selectedKey, setSelectedKey] = useState(null)

  const ELEMENT_COLORS = { C: '#888', N: '#4488ff', O: '#ff4444', S: '#ffcc00', P: '#ff8800', F: '#33cc33', Cl: '#33cc33', Br: '#993300' }

  const interactingResidues = useMemo(() => {
    if (!interactions) return []
    const map = new Map()
    const addRes = (chain, pos, res, type, dist) => {
      const key = `${chain}:${pos}`
      if (!map.has(key)) map.set(key, { chain, pos, res, types: [], minDist: Infinity })
      const entry = map.get(key)
      if (!entry.types.includes(type)) entry.types.push(type)
      entry.minDist = Math.min(entry.minDist, dist)
    }
    for (const b of interactions.hBonds ?? []) { addRes(b.acceptorChain, b.acceptorPosition, b.acceptorResidue, 'hBond', b.distance) }
    for (const b of interactions.piPiStacks ?? []) { addRes(b.chain2, b.position2, b.residue2, 'piPi', b.distance) }
    for (const b of interactions.piCations ?? []) { addRes(b.cationChain, b.cationPosition, b.cationResidue, 'piCation', b.distance) }
    for (const b of interactions.saltBridges ?? []) { addRes(b.chain2, b.position2, b.residue2, 'saltBridge', b.distance) }
    for (const b of interactions.hydrophobics ?? []) { addRes(b.chain2, b.position2, b.residue2, 'hydrophobic', b.distance) }
    return [...map.values()]
  }, [interactions])

  const ligAtomIxMap = useMemo(() => {
    if (!interactions) return new Map()
    const map = new Map()
    const add = (atomName, chain, pos, type) => {
      if (!map.has(atomName)) map.set(atomName, [])
      map.get(atomName).push({ target: `${chain}:${pos}`, type })
    }
    for (const b of interactions.hBonds ?? []) add(b.donorAtom, b.acceptorChain, b.acceptorPosition, 'hBond')
    for (const b of interactions.saltBridges ?? []) add(b.atom1, b.chain2, b.position2, 'saltBridge')
    for (const b of interactions.hydrophobics ?? []) add(b.atom1, b.chain2, b.position2, 'hydrophobic')
    return map
  }, [interactions])

  const W = 460, H = 400
  const padding = 60

  const layout = useMemo(() => {
    if (!proj2d.length) return { ligScale: 1, ligOffX: 0, ligOffY: 0, resPositions: new Map() }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const p of proj2d) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
    }
    const rangeX = maxX - minX || 1, rangeY = maxY - minY || 1
    const ligW = W * 0.45, ligH = H * 0.45
    const scale = Math.min(ligW / rangeX, ligH / rangeY)
    const offX = W / 2 - ((minX + maxX) / 2) * scale
    const offY = H / 2 - ((minY + maxY) / 2) * scale

    const resCount = interactingResidues.length
    const resPositions = new Map()
    const radius = Math.min(W, H) / 2 - 30
    interactingResidues.forEach((r, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / resCount
      resPositions.set(`${r.chain}:${r.pos}`, {
        x: W / 2 + radius * Math.cos(angle),
        y: H / 2 + radius * Math.sin(angle),
      })
    })

    return { ligScale: scale, ligOffX: offX, ligOffY: offY, resPositions }
  }, [proj2d, interactingResidues, W, H])

  const { ligScale, ligOffX, ligOffY, resPositions } = layout

  const ligAtomScreenPos = (idx) => ({
    x: proj2d[idx].x * ligScale + ligOffX,
    y: proj2d[idx].y * ligScale + ligOffY,
  })

  const activeTypes = useMemo(() => {
    const s = new Set()
    for (const r of interactingResidues) for (const t of r.types) s.add(t)
    return [...s]
  }, [interactingResidues])

  const connectedAtoms = useMemo(() => {
    if (!selectedKey) return null
    const atomNames = new Set()
    for (const [name, targets] of ligAtomIxMap) {
      if (targets.some(t => t.target === selectedKey)) atomNames.add(name)
    }
    return atomNames
  }, [selectedKey, ligAtomIxMap])

  const handleResClick = (chain, pos, res) => {
    const k = `${chain}:${pos}`
    setSelectedKey(prev => prev === k ? null : k)
    onResidueFocus(chain, pos, res)
  }

  return (
    <div className="rp-ix-2d-container">
      <svg viewBox={`0 0 ${W} ${H}`} className="rp-ix-2d-svg">
        {/* Interaction lines: ligand atom → residue */}
        {atoms.map((a, idx) => {
          const ixList = ligAtomIxMap.get(a.atomName)
          if (!ixList) return null
          const from = ligAtomScreenPos(idx)
          return ixList.map((ix, j) => {
            const to = resPositions.get(ix.target)
            if (!to) return null
            const active = !selectedKey || ix.target === selectedKey
            return <line key={`ix-${idx}-${j}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y}
              stroke={IX_TYPE_COLORS[ix.type]} strokeWidth="1.2" strokeDasharray="5 3" opacity={active ? 0.7 : 0.1} />
          })
        })}

        {/* Ligand bonds */}
        {bonds.map(([i, j], idx) => {
          const a = ligAtomScreenPos(i), b = ligAtomScreenPos(j)
          return <line key={`bond-${idx}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke="#666" strokeWidth="1.5" />
        })}

        {/* Ligand atoms */}
        {atoms.map((a, idx) => {
          const p = ligAtomScreenPos(idx)
          const color = ELEMENT_COLORS[a.element] || '#aaa'
          const active = !selectedKey || (connectedAtoms && connectedAtoms.has(a.atomName))
          if (a.element === 'C') {
            return <circle key={`atom-${idx}`} cx={p.x} cy={p.y} r={2.5} fill={color} opacity={active ? 1 : 0.3} />
          }
          return (
            <g key={`atom-${idx}`} opacity={active ? 1 : 0.3}>
              <circle cx={p.x} cy={p.y} r={8} fill="#161616" />
              <text x={p.x} y={p.y + 1} textAnchor="middle" dominantBaseline="central"
                fill={color} fontSize="9" fontWeight="bold">{a.element}</text>
            </g>
          )
        })}

        {/* Protein residue nodes */}
        {interactingResidues.map(r => {
          const key = `${r.chain}:${r.pos}`
          const p = resPositions.get(key)
          if (!p) return null
          const prop = RESIDUE_PROPERTY[r.res] ?? 'special'
          const color = RESIDUE_PROPERTY_COLORS[prop]
          const active = !selectedKey || key === selectedKey
          return (
            <g key={key} style={{ cursor: 'pointer' }} opacity={active ? 1 : 0.3}
              onClick={() => handleResClick(r.chain, r.pos, r.res)}>
              <circle cx={p.x} cy={p.y} r={18} fill={color} opacity="0.85" />
              <text x={p.x} y={p.y - 4} textAnchor="middle" dominantBaseline="central"
                fill="#fff" fontSize="9" fontWeight="bold">{r.res}</text>
              <text x={p.x} y={p.y + 8} textAnchor="middle" dominantBaseline="central"
                fill="rgba(255,255,255,0.7)" fontSize="7.5">{r.chain}:{r.pos}</text>
            </g>
          )
        })}
      </svg>

      <div className="rp-ix-2d-legend">
        <div className="rp-ix-2d-legend-group">
          {activeTypes.map(t => (
            <span key={t} className="rp-ix-2d-legend-item">
              <span style={{ width: 14, height: 2, background: IX_TYPE_COLORS[t], display: 'inline-block', borderRadius: 1 }} />
              <span>{IX_TYPE_LABELS[t]}</span>
            </span>
          ))}
        </div>
        <div className="rp-ix-2d-legend-group">
          {Object.entries(RESIDUE_PROPERTY_COLORS).map(([k, c]) => (
            <span key={k} className="rp-ix-2d-legend-item">
              <span style={{ width: 8, height: 8, background: c, borderRadius: '50%', display: 'inline-block' }} />
              <span>{k}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Radial diagram (fallback for antibody / no ligand) ──────────────
function RadialDiagram({ interactions, taskType, onResidueFocus }) {
  const residueMap = useMemo(() => {
    if (!interactions) return new Map()
    const map = new Map()

    const addResidue = (chain, pos, res, type) => {
      const key = `${chain}:${pos}`
      if (!map.has(key)) map.set(key, { chain, pos, res, types: new Set() })
      map.get(key).types.add(type)
    }

    const isLigand = (chain) => taskType === 'enzyme' && chain !== 'A'

    for (const b of interactions.hBonds ?? []) {
      if (isLigand(b.donorChain)) addResidue(b.acceptorChain, b.acceptorPosition, b.acceptorResidue, 'hBond')
      else if (isLigand(b.acceptorChain)) addResidue(b.donorChain, b.donorPosition, b.donorResidue, 'hBond')
      else { addResidue(b.donorChain, b.donorPosition, b.donorResidue, 'hBond'); addResidue(b.acceptorChain, b.acceptorPosition, b.acceptorResidue, 'hBond') }
    }
    for (const b of interactions.piPiStacks ?? []) {
      addResidue(b.chain1, b.position1, b.residue1, 'piPi')
      addResidue(b.chain2, b.position2, b.residue2, 'piPi')
    }
    for (const b of interactions.piCations ?? []) {
      addResidue(b.ringChain, b.ringPosition, b.ringResidue, 'piCation')
      addResidue(b.cationChain, b.cationPosition, b.cationResidue, 'piCation')
    }
    for (const b of interactions.saltBridges ?? []) {
      addResidue(b.chain1, b.position1, b.residue1, 'saltBridge')
      addResidue(b.chain2, b.position2, b.residue2, 'saltBridge')
    }
    for (const b of interactions.hydrophobics ?? []) {
      addResidue(b.chain1, b.position1, b.residue1, 'hydrophobic')
      addResidue(b.chain2, b.position2, b.residue2, 'hydrophobic')
    }

    return map
  }, [interactions, taskType])

  const edges = useMemo(() => {
    if (!interactions) return []
    const result = []
    const isLigand = (chain) => taskType === 'enzyme' && chain !== 'A'

    const addEdge = (type, c1, p1, c2, p2, dist) => {
      const from = isLigand(c1) ? 'ligand' : `${c1}:${p1}`
      const to = isLigand(c2) ? 'ligand' : `${c2}:${p2}`
      if (from === to) return
      result.push({ type, from, to, distance: dist })
    }

    for (const b of interactions.hBonds ?? []) addEdge('hBond', b.donorChain, b.donorPosition, b.acceptorChain, b.acceptorPosition, b.distance)
    for (const b of interactions.piPiStacks ?? []) addEdge('piPi', b.chain1, b.position1, b.chain2, b.position2, b.distance)
    for (const b of interactions.piCations ?? []) addEdge('piCation', b.ringChain, b.ringPosition, b.cationChain, b.cationPosition, b.distance)
    for (const b of interactions.saltBridges ?? []) addEdge('saltBridge', b.chain1, b.position1, b.chain2, b.position2, b.distance)
    for (const b of interactions.hydrophobics ?? []) addEdge('hydrophobic', b.chain1, b.position1, b.chain2, b.position2, b.distance)

    const seen = new Set()
    return result.filter(e => {
      const key = [e.from, e.to, e.type].sort().join('|')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [interactions, taskType])

  const hasLigand = taskType === 'enzyme'
  const proteinResidues = useMemo(() => [...residueMap.values()].filter(r => !(taskType === 'enzyme' && r.chain !== 'A')), [residueMap, taskType])

  const W = 460, H = 380
  const cx = W / 2, cy = H / 2
  const radius = Math.min(W, H) / 2 - 50

  const nodePositions = useMemo(() => {
    const pos = new Map()
    if (hasLigand) pos.set('ligand', { x: cx, y: cy })

    const nodes = proteinResidues
    const count = nodes.length
    if (!count) return pos

    const startAngle = -Math.PI / 2
    const centerNode = hasLigand ? { x: cx, y: cy } : null

    nodes.forEach((r, i) => {
      const angle = startAngle + (2 * Math.PI * i) / count
      const rx = hasLigand ? radius : radius * 0.8
      const ry = hasLigand ? radius : radius * 0.8
      const ox = (centerNode?.x ?? cx) + rx * Math.cos(angle)
      const oy = (centerNode?.y ?? cy) + ry * Math.sin(angle)
      pos.set(`${r.chain}:${r.pos}`, { x: ox, y: oy })
    })

    return pos
  }, [proteinResidues, hasLigand, cx, cy, radius])

  const activeTypes = useMemo(() => {
    const s = new Set()
    for (const e of edges) s.add(e.type)
    return [...s]
  }, [edges])

  if (!proteinResidues.length) return <div className="rp-ix-2d-empty">No interactions detected</div>

  return (
    <div className="rp-ix-2d-container">
      <svg viewBox={`0 0 ${W} ${H}`} className="rp-ix-2d-svg">
        {edges.map((e, i) => {
          const from = nodePositions.get(e.from)
          const to = nodePositions.get(e.to)
          if (!from || !to) return null
          return (
            <line key={i}
              x1={from.x} y1={from.y} x2={to.x} y2={to.y}
              stroke={IX_TYPE_COLORS[e.type]} strokeWidth="1.5"
              strokeDasharray="5 3" opacity="0.8"
            />
          )
        })}

        {hasLigand && (
          <g>
            <circle cx={cx} cy={cy} r={22} fill="#333" stroke="#888" strokeWidth="1.5" />
            <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="central"
              fill="#fff" fontSize="10" fontWeight="bold">LIG</text>
          </g>
        )}

        {proteinResidues.map(r => {
          const key = `${r.chain}:${r.pos}`
          const p = nodePositions.get(key)
          if (!p) return null
          const prop = RESIDUE_PROPERTY[r.res] ?? 'special'
          const color = RESIDUE_PROPERTY_COLORS[prop]
          return (
            <g key={key} style={{ cursor: 'pointer' }}
              onClick={() => onResidueFocus(r.chain, r.pos, r.res)}>
              <circle cx={p.x} cy={p.y} r={18} fill={color} opacity="0.85" />
              <text x={p.x} y={p.y - 4} textAnchor="middle" dominantBaseline="central"
                fill="#fff" fontSize="9" fontWeight="bold">{r.res}</text>
              <text x={p.x} y={p.y + 8} textAnchor="middle" dominantBaseline="central"
                fill="rgba(255,255,255,0.7)" fontSize="7.5">{r.chain}:{r.pos}</text>
            </g>
          )
        })}
      </svg>

      <div className="rp-ix-2d-legend">
        <div className="rp-ix-2d-legend-group">
          {activeTypes.map(t => (
            <span key={t} className="rp-ix-2d-legend-item">
              <span style={{ width: 14, height: 2, background: IX_TYPE_COLORS[t], display: 'inline-block', borderRadius: 1 }} />
              <span>{IX_TYPE_LABELS[t]}</span>
            </span>
          ))}
        </div>
        <div className="rp-ix-2d-legend-group">
          {Object.entries(RESIDUE_PROPERTY_COLORS).map(([k, c]) => (
            <span key={k} className="rp-ix-2d-legend-item">
              <span style={{ width: 8, height: 8, background: c, borderRadius: '50%', display: 'inline-block' }} />
              <span>{k}</span>
            </span>
          ))}
        </div>
      </div>
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
      <span className="rp-homolog-xtal-tag">Crystal Structure</span>
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

const IX_LEGEND = {
  hBond: { color: '#00cc66', label: 'H-Bond' },
  piPi: { color: '#ff8800', label: 'π-π Stack' },
  piCation: { color: '#ffcc00', label: 'π-Cation' },
  saltBridge: { color: '#ff4444', label: 'Salt Bridge' },
  hydrophobic: { color: '#bb88ff', label: 'Hydrophobic' },
}

function SequenceBar({ entities, groups, focusedResidues, onResidueClick }) {
  const BLOCK = 10
  const chains = entities.filter(e => e.sequence)
  const colorMap = useMemo(() => buildResidueColorMap(groups || []), [groups])
  const focusedRef = useRef(null)
  const lastFocused = focusedResidues[focusedResidues.length - 1] ?? null

  useEffect(() => {
    if (focusedRef.current) {
      focusedRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [lastFocused])

  const uniqueGroups = useMemo(() => {
    if (!groups?.length) return []
    const seen = new Set()
    return groups.filter(g => { if (seen.has(g.label)) return false; seen.add(g.label); return true })
  }, [groups])

  return (
    <div className="rp-seqbar">
      {chains.map((entity, idx) => {
        const seq = entity.sequence
        const blocks = []
        for (let i = 0; i < seq.length; i += BLOCK) {
          blocks.push({ start: i, chars: seq.slice(i, i + BLOCK) })
        }
        return (
          <div key={entity.chain} className="rp-seqbar-chain">
            <div className={`rp-seqbar-chain-label ${idx === 0 ? 'rp-seqbar-chain-label--first' : ''}`}>
              <span>
                {entity.label || `Chain ${entity.chain}`}
                <span className="rp-seqbar-chain-id">{entity.chain}</span>
              </span>
              {idx === 0 && uniqueGroups.length > 0 && (
                <span className="rp-seqbar-legend">
                  {uniqueGroups.map(g => (
                    <span key={g.id} className="rp-seqbar-legend-item">
                      <span className="rp-seqbar-legend-dot" style={{ background: g.color }} />
                      {g.label}
                    </span>
                  ))}
                </span>
              )}
            </div>
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
                      const isFocused = focusedResidues.some(fr => fr.chain === entity.chain && fr.seqId === seqId)
                      const isLast = lastFocused?.chain === entity.chain && lastFocused?.seqId === seqId
                      return (
                        <span
                          key={j}
                          ref={isLast ? focusedRef : undefined}
                          className={`rp-seqbar-aa ${isFocused ? 'focused' : ''} ${color ? 'annotated' : ''}`}
                          style={{ color: isFocused ? '#38b6ff' : (color || '#666') }}
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
