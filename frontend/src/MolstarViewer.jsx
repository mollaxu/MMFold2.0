import { useEffect, useRef, useState } from 'react'

export default function MolstarViewer({ structureUrl }) {
  const parentRef = useRef(null)
  const pluginRef = useRef(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!parentRef.current) return

    let mounted = true
    let plugin = null
    const container = document.createElement('div')
    container.style.width = '100%'
    container.style.height = '100%'
    parentRef.current.appendChild(container)

    const init = async () => {
      try {
        setIsLoading(true)
        setError(null)

        const { createPluginUI } = await import('molstar/lib/commonjs/mol-plugin-ui')
        const { renderReact18 } = await import('molstar/lib/commonjs/mol-plugin-ui/react18')
        const { DefaultPluginUISpec } = await import('molstar/lib/commonjs/mol-plugin-ui/spec')

        if (!mounted) return

        plugin = await createPluginUI({
          target: container,
          render: renderReact18,
          spec: {
            ...DefaultPluginUISpec(),
            layout: {
              initial: { isExpanded: false, showControls: false },
            },
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
          settings: (props) => {
            props.renderer.backgroundColor = Color(0x1a1d24)
          },
        })

        await applyPlddtColoring(plugin)

        if (mounted) setIsLoading(false)
      } catch (err) {
        console.error('Molstar init failed:', err)
        if (mounted) {
          setError(err?.message || 'Failed to load structure')
          setIsLoading(false)
        }
      }
    }

    init()

    return () => {
      mounted = false
      if (plugin) {
        try { plugin.dispose() } catch (e) { /* ignore */ }
      }
      pluginRef.current = null
      container.remove()
    }
  }, [structureUrl])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {isLoading && (
        <div className="mol-overlay">
          <span>Loading 3D structure...</span>
        </div>
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
          s.components,
          { color: themeName || 'plddt-confidence' }
        )
      }
    })
  } catch (err) {
    console.warn('pLDDT coloring failed, using default:', err)
  }
}
