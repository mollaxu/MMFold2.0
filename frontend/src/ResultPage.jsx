import { useState, useEffect } from 'react'
import MolstarViewer from './MolstarViewer'
import PAECanvas from './PAECanvas'
import AppHeader from './AppHeader'
import './HomePage.css'
import './ResultPage.css'

const FOLDERS = {
  enzyme: '酶-小分子docking',
  antibody: '抗体抗原结构预测',
}

const SAMPLE_COUNT = 5

export default function ResultPage({ task, onBack }) {
  const folder = FOLDERS[task?.type] ?? FOLDERS.enzyme
  const [activeSample, setActiveSample] = useState(0)
  const [summaries, setSummaries] = useState([])
  const [fullData, setFullData] = useState(null)
  const [loadingFull, setLoadingFull] = useState(false)

  // Load all 5 summary files upfront for ranking scores
  useEffect(() => {
    const loadSummaries = async () => {
      const results = await Promise.all(
        Array.from({ length: SAMPLE_COUNT }, (_, i) =>
          fetch(`/${folder}/summary_confidences_sample_${i + 1}.json`).then(r => r.json())
        )
      )
      setSummaries(results)
    }
    loadSummaries().catch(console.error)
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

  const structureUrl = `/${folder}/model_sample_${activeSample + 1}.pdb`
  const summary = summaries[activeSample]

  return (
    <div className="rp-page">
      <AppHeader />

      {/* Sub-header */}
      <div className="rp-subheader">
        <button className="rp-back" onClick={onBack}>← Back</button>
        <span className="rp-task-name">{task?.name ?? 'Result'}</span>
        <button className="rp-download">⬇ Download</button>
      </div>

      {/* Content */}
      <div className="rp-content">
        {/* Structure Preview + sample tabs */}
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

        {/* pLDDT color legend */}
        <div className="rp-plddt-legend">
          <div className="rp-plddt-item">
            <span>Very high (pLDDT &gt; 90)</span>
            <div className="rp-plddt-bar" style={{ background: '#0066cc' }} />
          </div>
          <div className="rp-plddt-item">
            <span>Confident (90 &gt; pLDDT &gt; 70)</span>
            <div className="rp-plddt-bar" style={{ background: '#4dd8e8' }} />
          </div>
          <div className="rp-plddt-item">
            <span>Low (70 &gt; pLDDT &gt; 50)</span>
            <div className="rp-plddt-bar" style={{ background: '#ffdd57' }} />
          </div>
          <div className="rp-plddt-item">
            <span>Very low (pLDDT &lt; 50)</span>
            <div className="rp-plddt-bar" style={{ background: 'linear-gradient(to right, #ff9933, #ff6600)' }} />
          </div>
        </div>

        {/* ipTM / pTM scores */}
        {summary && (
          <div className="rp-metrics">
            <span className="rp-metric-label">ipTM =</span>
            <span className="rp-metric-value">{summary.iptm?.toFixed(2) ?? '—'}</span>
            <span className="rp-metric-label">pTM =</span>
            <span className="rp-metric-value">{summary.ptm?.toFixed(2) ?? '—'}</span>
            <a href="#" className="rp-learn-more">learn more</a>
          </div>
        )}

        {/* 3D + PAE */}
        <div className="rp-viewers">
          <div className="rp-viewer-card">
            <MolstarViewer structureUrl={structureUrl} />
          </div>
          <div className="rp-viewer-card">
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
      </div>
    </div>
  )
}
