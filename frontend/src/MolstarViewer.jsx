import { useEffect, useRef, useState } from 'react'

export default function MolstarViewer({
  structureUrl,
  highlightedResidues,   // [{chain, seqId}] | null — hovered + pinned groups combined
  focusedResidue,        // {chain, seqId} | null  — selects + focuses residue
}) {
  const parentRef = useRef(null)
  const pluginRef = useRef(null)
  const focusRefRef = useRef(null)   // state ref for focused-residue ball-and-stick component
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [structureReady, setStructureReady] = useState(false)

  // ── Init plugin + load structure ──────────────────────────────────
  useEffect(() => {
    if (!parentRef.current) return

    let mounted = true
    let plugin = null
    const container = document.createElement('div')
    container.style.cssText = 'width:100%;height:100%'
    parentRef.current.appendChild(container)

    ;(async () => {
      try {
        setIsLoading(true)
        setError(null)
        setStructureReady(false)
        focusRefRef.current = null

        const { createPluginUI } = await import('molstar/lib/commonjs/mol-plugin-ui')
        const { renderReact18 } = await import('molstar/lib/commonjs/mol-plugin-ui/react18')
        const { DefaultPluginUISpec } = await import('molstar/lib/commonjs/mol-plugin-ui/spec')

        if (!mounted) return

        plugin = await createPluginUI({
          target: container,
          render: renderReact18,
          spec: {
            ...DefaultPluginUISpec(),
            layout: { initial: { isExpanded: false, showControls: false } },
            components: { remoteState: 'none' },
          },
        })

        pluginRef.current = plugin

        const data = await plugin.builders.data.download(
          { url: structureUrl, isBinary: false },
          { state: { isGhost: false } }
        )
        const trajectory = await plugin.builders.structure.parseTrajectory(data, 'pdb')
        await plugin.builders.structure.hierarchy.applyPreset(trajectory, 'default')

        const { PluginCommands } = await import('molstar/lib/commonjs/mol-plugin/commands')
        const { Color } = await import('molstar/lib/commonjs/mol-util/color')
        PluginCommands.Canvas3D.SetSettings(plugin, {
          settings: p => { p.renderer.backgroundColor = Color(0x1a1d24) },
        })

        await applyPlddtColoring(plugin)

        if (mounted) { setIsLoading(false); setStructureReady(true) }
      } catch (err) {
        console.error('Molstar init failed:', err)
        if (mounted) { setError(err?.message ?? 'Failed to load structure'); setIsLoading(false) }
      }
    })()

    return () => {
      mounted = false
      try { plugin?.dispose() } catch {}
      pluginRef.current = null
      focusRefRef.current = null
      setStructureReady(false)
      container.remove()
    }
  }, [structureUrl])

  // ── Highlight: hovered + pinned groups combined ───────────────────
  useEffect(() => {
    if (!structureReady || !pluginRef.current) return
    if (highlightedResidues?.length) {
      applyGroupHighlight(pluginRef.current, highlightedResidues)
    } else {
      clearGroupHighlight(pluginRef.current)
    }
  }, [structureReady, highlightedResidues])

  // ── Click: native selection + camera focus + bond display ──────────
  useEffect(() => {
    if (!structureReady || !pluginRef.current) return
    if (focusedResidue) {
      applyResidueFocus(pluginRef.current, focusedResidue, focusRefRef)
    } else {
      clearResidueFocus(pluginRef.current, focusRefRef)
    }
  }, [structureReady, focusedResidue])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {isLoading && (
        <div className="mol-overlay"><span>Loading 3D structure...</span></div>
      )}
      {error && (
        <div className="mol-overlay mol-error">
          <span>Failed to load structure</span>
          <small>{error}</small>
        </div>
      )}
      <div ref={parentRef} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Build a MolScript expression for a set of residues (grouped by chain). */
async function buildResidueExpression(residues) {
  const { MolScriptBuilder: MS } = await import('molstar/lib/commonjs/mol-script/language/builder')
  const byChain = {}
  for (const { chain, seqId } of residues) {
    ;(byChain[chain] ??= []).push(seqId)
  }
  const exprs = Object.entries(byChain).map(([ch, ids]) =>
    MS.struct.generator.atomGroups({
      'chain-test': MS.core.rel.eq([MS.ammp('auth_asym_id'), ch]),
      'residue-test': MS.core.set.has([MS.set(...ids), MS.ammp('auth_seq_id')]),
    })
  )
  return exprs.length === 1 ? exprs[0] : MS.struct.combinator.merge(exprs)
}

/** Resolve expression → StructureElement.Loci */
async function getLoci(plugin, expression) {
  const { Script } = await import('molstar/lib/commonjs/mol-script/script')
  const { StructureSelection } = await import('molstar/lib/commonjs/mol-model/structure')
  const structure = plugin.managers.structure.hierarchy.current.structures[0]?.cell.obj?.data
  if (!structure) return null
  const sel = Script.getStructureSelection(expression, structure)
  return StructureSelection.toLociWithSourceUnits(sel)
}

// ── Hover highlight ───────────────────────────────────────────────────

async function applyGroupHighlight(plugin, residues) {
  try {
    const expression = await buildResidueExpression(residues)
    const loci = await getLoci(plugin, expression)
    if (!loci) return
    plugin.managers.interactivity.lociHighlights.highlightOnly({ loci, repr: void 0 })
  } catch (err) {
    console.warn('Group highlight failed:', err)
  }
}

function clearGroupHighlight(plugin) {
  try {
    plugin.managers.interactivity.lociHighlights.clearHighlights()
  } catch (err) {
    console.warn('Clear highlight failed:', err)
  }
}

// ── Residue focus (native focus manager: surroundings + interactions + camera) ──

async function applyResidueFocus(plugin, residue, focusRefRef) {
  const { MolScriptBuilder: MS } = await import('molstar/lib/commonjs/mol-script/language/builder')

  if (!plugin.managers.structure.hierarchy.current.structures.length) return

  // Clear previous focus first
  clearResidueFocus(plugin, focusRefRef)

  const { chain, seqId } = residue
  const expression = MS.struct.generator.atomGroups({
    'chain-test': MS.core.rel.eq([MS.ammp('auth_asym_id'), chain]),
    'residue-test': MS.core.rel.eq([MS.ammp('auth_seq_id'), seqId]),
  })

  let loci = null
  try { loci = await getLoci(plugin, expression) } catch {}
  if (!loci) return

  // Use the native focus manager — identical to clicking directly in the viewport:
  // renders the residue + surrounding shell + interaction lines automatically
  try {
    plugin.managers.structure.focus.setFromLoci(loci)
  } catch (err) {
    console.warn('Focus manager failed:', err)
  }

  // Camera focus
  try {
    plugin.managers.camera.focusLoci(loci, { durationMs: 500 })
  } catch {}
}

function clearResidueFocus(plugin, focusRefRef) {
  focusRefRef.current = null
  try { plugin.managers.structure.focus.clear() } catch {}
  try { plugin.managers.structure.selection.clear() } catch {}
}

// ── pLDDT coloring ────────────────────────────────────────────────────

async function applyPlddtColoring(plugin) {
  try {
    const { CustomElementProperty } = await import(
      'molstar/lib/commonjs/mol-model-props/common/custom-element-property'
    )
    const { Color } = await import('molstar/lib/commonjs/mol-util/color')

    const CustomPlddt = CustomElementProperty.create({
      label: 'Custom pLDDT Confidence',
      name: 'custom-plddt-confidence',
      getData(model) {
        const map = new Map()
        if (model.atomicConformation?.B_iso_or_equiv) {
          const bFactors = model.atomicConformation.B_iso_or_equiv.value
          for (let i = 0, n = model.atomicHierarchy.atoms._rowCount; i < n; i++) {
            map.set(i, bFactors(i))
          }
        }
        return { value: map }
      },
      coloring: {
        getColor(v) {
          if (v > 90) return Color(0x0066cc)
          if (v > 70) return Color(0x4dd8e8)
          if (v > 50) return Color(0xffdd57)
          return Color(0xff9933)
        },
        defaultColor: Color(0x999999),
      },
      getLabel(v) {
        if (v > 90) return 'Very High (>90)'
        if (v > 70) return 'Confident (70-90)'
        if (v > 50) return 'Low (50-70)'
        return 'Very Low (<50)'
      },
    })

    const themeName = CustomPlddt.colorThemeProvider?.name
    if (CustomPlddt.colorThemeProvider) {
      plugin.representation.structure.themes.colorThemeRegistry.add(CustomPlddt.colorThemeProvider)
    }
    if (CustomPlddt.propertyProvider) {
      plugin.customModelProperties.register(CustomPlddt.propertyProvider, true)
    }

    await plugin.dataTransaction(async () => {
      for (const s of plugin.managers.structure.hierarchy.current.structures) {
        await plugin.managers.structure.component.updateRepresentationsTheme(
          s.components, { color: themeName || 'plddt-confidence' }
        )
      }
    })
  } catch (err) {
    console.warn('pLDDT coloring failed, using default:', err)
  }
}
