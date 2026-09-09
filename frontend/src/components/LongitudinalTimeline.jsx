import { useMemo, useState } from 'react'

const PHASE_LEGEND = [
  { phase: 'baseline', label: 'Pretreatment (screening / C1D1)' },
  { phase: 'onTreatment', label: 'On-treatment' },
  { phase: 'progression', label: 'Progression / EOT' },
]

const PHASE_LABEL = {
  baseline: 'Pretreatment (screening / C1D1)',
  onTreatment: 'On-treatment',
  progression: 'Progression / EOT',
}

// Full literal class names so Tailwind's content scanner can find them even
// though the phase they belong to is picked dynamically at render time.
const PHASE_FILL_CLASS = {
  baseline: 'fill-accent-600',
  onTreatment: 'fill-epi-600',
  progression: 'fill-amber-600',
}
const PHASE_DOT_CLASS = {
  baseline: 'bg-accent-600',
  onTreatment: 'bg-epi-600',
  progression: 'bg-amber-600',
}

const VIEW_W = 1000
const GUTTER = 226
const RIGHT_PAD = 24
const TOP_PAD = 54
const ROW_H = 46
const SECTION_HEAD_H = 28
const AXIS_H = 38

function weeksBetween(fromIso, toIso) {
  const from = new Date(`${fromIso}T00:00:00Z`)
  const to = new Date(`${toIso}T00:00:00Z`)
  return Math.round(((to - from) / 6048e5) * 10) / 10
}

function addWeeksIso(iso, weeks) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + Math.round(weeks * 7))
  return d.toISOString().slice(0, 10)
}

function fmtDateShort(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function fmtDateLong(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** Builds the section/row/event structure for one patient from cohort.json. */
function buildSections(p) {
  const wk = (iso) => weeksBetween(p.daraxonrasibStartDate, iso)
  const rows = []

  rows.push({
    section: 'Clinical course',
    key: 'therapy',
    label: 'Line of therapy',
    sub: 'Enrollment · C1D1',
    events: [
      {
        week: wk(p.enrollmentDate),
        date: p.enrollmentDate,
        phase: 'baseline',
        title: 'Enrolled / screening',
        lines: [
          `Line of therapy: ${p.lineOfTherapy}L`,
          `Prior: ${p.priorRegimens.length ? p.priorRegimens.join(' → ') : 'treatment-naive'}`,
        ],
      },
      {
        week: 0,
        date: p.daraxonrasibStartDate,
        phase: 'baseline',
        title: 'Daraxonrasib initiated (C1D1)',
        lines: [`Dose band ${p.doseBand}`],
      },
    ],
  })

  const cb = p.clinical.baseline
  const cm = p.clinical.midTreatment
  const cp = p.clinical.progression
  rows.push({
    section: 'Clinical course',
    key: 'clinical',
    label: 'Clinical assessment',
    sub: 'ECOG · adverse events',
    events: [
      {
        week: wk(cb.date),
        date: cb.date,
        phase: 'baseline',
        title: 'Baseline assessment',
        lines: [`ECOG ${cb.ecog}`, `Weight ${cb.weightKg} kg`, `Mets: ${cb.metastaticSitesBaseline.join(', ')}`],
      },
      {
        week: wk(cm.date),
        date: cm.date,
        phase: 'onTreatment',
        title: 'On-treatment assessment',
        lines: [
          `ECOG ${cm.performanceStatusMidTreatment}`,
          ...cm.toxicityProfile.map((t) => `${t.term[0].toUpperCase()}${t.term.slice(1)} Gr.${t.grade}`),
        ],
      },
      {
        week: wk(cp.date),
        date: cp.date,
        phase: 'progression',
        title: 'Progression assessment',
        lines: [`ECOG ${cp.performanceStatusEOT}`, `New metastatic sites: ${cp.newMetastaticSites ? 'yes' : 'no'}`],
      },
    ],
  })

  const ib = p.imaging.baseline
  const im = p.imaging.midTreatment
  const ip = p.imaging.progression
  rows.push({
    section: 'Clinical course',
    key: 'imaging',
    label: 'Imaging',
    sub: 'RECIST 1.1',
    events: [
      {
        week: wk(ib.date),
        date: ib.date,
        phase: 'baseline',
        title: 'Baseline scan',
        lines: [`${ib.targetLesions.length} target lesions`, `Sum of diameters ${ib.sumOfDiametersMm.toFixed(1)} mm`],
      },
      ...im.interimRECIST.map((pt) => ({
        week: wk(pt.date),
        date: pt.date,
        phase: 'onTreatment',
        title: 'Interim RECIST',
        lines: [`Assessment: ${pt.assessment}`],
      })),
      {
        week: wk(ip.date),
        date: ip.date,
        phase: 'progression',
        title: 'Confirmation scan',
        lines: ['Assessment: PD', `New lesion detected: ${ip.confirmationScan.newLesionDetected ? 'yes' : 'no'}`],
      },
    ],
  })

  const lb = p.laboratory.baseline
  const lm = p.laboratory.midTreatment
  const lp = p.laboratory.progression
  rows.push({
    section: 'Clinical course',
    key: 'laboratory',
    label: 'Laboratory',
    sub: 'CA19-9 · NLR',
    events: [
      {
        week: wk(lb.date),
        date: lb.date,
        phase: 'baseline',
        title: 'Baseline labs',
        lines: [`CA19-9 ${lb.ca199.toFixed(1)} U/mL`, `NLR ${lb.nlr.toFixed(2)}`],
      },
      ...lm.ca199Series.map((pt, i) => ({
        week: wk(pt.date),
        date: pt.date,
        phase: 'onTreatment',
        title: 'Serum labs',
        lines: [`CA19-9 ${pt.value.toFixed(1)} U/mL`, `NLR ${lm.nlrSeries[i].value.toFixed(2)}`],
      })),
      {
        week: wk(lp.date),
        date: lp.date,
        phase: 'progression',
        title: 'Labs at progression',
        lines: [`CA19-9 ${lp.ca199AtProgression.toFixed(1)} U/mL`, `NLR ${lp.nlrAtProgression.toFixed(2)}`],
      },
    ],
  })

  const bb = p.biospecimens.baseline
  const bp = p.biospecimens.progression
  rows.push({
    section: 'Tumor sampling & core genomics',
    key: 'biospecimens',
    label: 'Biospecimens',
    sub: 'FFPE / fresh-frozen biopsy',
    events: [bb, bp].map((rec, i) => ({
      week: wk(rec.date),
      date: rec.date,
      phase: i === 0 ? 'baseline' : 'progression',
      title: 'Paired biopsy collected',
      lines: [
        `Site: ${rec.collectionSite}`,
        `FFPE${rec.freshFrozenCollected ? ' + fresh-frozen' : ''} · tumor content ${rec.tumorContentPct.toFixed(1)}%`,
      ],
    })),
  })

  const gb = p.genomics.baseline
  const gm = p.genomics.midTreatment
  const gp = p.genomics.progression
  const germ = gb.germlineDNA
  const dx = gb.diagnosticBiopsyNGS
  const repeat = gp.repeatBiopsyNGS
  rows.push({
    section: 'Tumor sampling & core genomics',
    key: 'genomics',
    label: 'Genomics',
    sub: 'NGS panel · serial ctDNA',
    events: [
      {
        week: wk(gb.date),
        date: gb.date,
        phase: 'baseline',
        title: 'Diagnostic NGS + germline',
        lines: [
          `KRAS ${dx.baselineKrasVariant} (VAF ${dx.baselineVAF.toFixed(1)}%)`,
          `TP53 ${dx.pretreatmentTP53Status} · germline BRCA ${germ.brca1Brca2PathogenicVariant ? `positive (${germ.gene})` : 'negative'}`,
        ],
      },
      {
        week: wk(gm.serialCtDNA.date),
        date: gm.serialCtDNA.date,
        phase: 'onTreatment',
        title: 'Serial ctDNA',
        lines: [`VAF ${gm.serialCtDNA.vaf.toFixed(2)}%`],
      },
      {
        week: wk(gp.date),
        date: gp.date,
        phase: 'progression',
        title: 'Repeat biopsy NGS (panel)',
        lines: [
          repeat.resistanceMechanism ? `Mechanism: ${repeat.resistanceMechanism}` : 'No reportable alteration',
          `EOT VAF ${repeat.eotVAF.toFixed(1)}% · tissue/ctDNA ${repeat.tissueCtdnaConcordant ? 'concordant' : 'discordant'}`,
        ],
        highlight: !repeat.tissueCtdnaConcordant,
        calloutLabel: 'Tissue/ctDNA discordant at progression',
      },
    ],
  })

  if (p.deepSequencing.baseline || p.deepSequencing.progression) {
    const events = []
    if (p.deepSequencing.baseline) {
      const db = p.deepSequencing.baseline
      events.push({
        week: wk(db.date),
        date: db.date,
        phase: 'baseline',
        title: db.assay,
        lines: [`${db.meanDepthX}× mean depth`, `TMB ${db.tumorMutationalBurdenPerMb.toFixed(1)} mut/Mb`],
      })
    }
    if (p.deepSequencing.progression) {
      const dp = p.deepSequencing.progression
      events.push({
        week: wk(dp.date),
        date: dp.date,
        phase: 'progression',
        title: dp.nonPanelAlterationDetected ? `${dp.assay} — ${dp.nonPanelAlterationGene} identified` : dp.assay,
        lines: [`${dp.meanDepthX}× mean depth`, dp.nonPanelAlterationDetail ?? 'No additional non-panel alteration identified'],
        highlight: dp.nonPanelAlterationDetected,
        calloutLabel: `${dp.nonPanelAlterationGene} — panel-negative, WES/WGS-only`,
      })
    }
    rows.push({
      section: 'Tumor sampling & core genomics',
      key: 'deepSequencing',
      label: 'Deep sequencing',
      sub: 'High-depth WES / WGS',
      events,
    })
  }

  const tb = p.transcriptomics.baseline
  const tm = p.transcriptomics.midTreatment
  const tp = p.transcriptomics.progression
  rows.push({
    section: 'Multi-omic / translational',
    key: 'transcriptomics',
    label: 'Transcriptomics',
    sub: 'Bulk + single-cell RNA-seq',
    events: [
      {
        week: wk(tb.date),
        date: tb.date,
        phase: 'baseline',
        title: tb.singleCellRNAseq ? 'Bulk + single-cell RNA-seq' : 'Bulk RNA-seq',
        lines: [
          `DUSP6 ${tb.bulkRNAseq.dusp6Tpm.toFixed(1)} TPM`,
          tb.singleCellRNAseq
            ? `Lineage: ${tb.singleCellRNAseq.cellStateComposition.classicalPct.toFixed(1)}% classical / ${tb.singleCellRNAseq.cellStateComposition.basalLikePct.toFixed(1)}% basal-like`
            : null,
        ].filter(Boolean),
      },
      {
        week: wk(tm.date),
        date: tm.date,
        phase: 'onTreatment',
        title: 'Bulk RNA-seq',
        lines: [`DUSP6 ${tm.bulkRNAseq.dusp6Tpm.toFixed(1)} TPM`],
      },
      {
        week: wk(tp.date),
        date: tp.date,
        phase: 'progression',
        title: tp.singleCellRNAseq ? 'Bulk + single-cell RNA-seq' : 'Bulk RNA-seq',
        lines: [
          `DUSP6 ${tp.bulkRNAseq.dusp6Tpm.toFixed(1)} TPM`,
          tp.singleCellRNAseq
            ? `Lineage${tp.singleCellRNAseq.lineageShiftFromBaseline ? ' shift' : ''}: ${tp.singleCellRNAseq.cellStateComposition.basalLikePct.toFixed(1)}% basal-like`
            : null,
        ].filter(Boolean),
        highlight: tp.singleCellRNAseq?.lineageShiftFromBaseline ?? false,
        calloutLabel: 'Classical → basal-like lineage shift',
      },
    ],
  })

  const eb = p.epigenomics.baseline
  const ep = p.epigenomics.progression
  rows.push({
    section: 'Multi-omic / translational',
    key: 'epigenomics',
    label: 'Epigenomics',
    sub: eb.assay,
    events: [
      {
        week: wk(eb.date),
        date: eb.date,
        phase: 'baseline',
        title: eb.assay,
        lines: [`Chromatin shift score ${eb.chromatinAccessibilityShiftScore.toFixed(2)}`],
      },
      {
        week: wk(ep.date),
        date: ep.date,
        phase: 'progression',
        title: ep.epigeneticReprogrammingDetected ? `${ep.assay} — reprogramming` : ep.assay,
        lines: [
          `Shift score ${ep.chromatinAccessibilityShiftScore.toFixed(2)}`,
          ep.topDifferentialLocus ? `Gain of accessibility: ${ep.topDifferentialLocus}` : null,
        ].filter(Boolean),
      },
    ],
  })

  const fb = p.flowCytometry.baseline
  const fm = p.flowCytometry.midTreatment
  const fp = p.flowCytometry.progression
  rows.push({
    section: 'Multi-omic / translational',
    key: 'flow',
    label: 'Flow cytometry',
    sub: 'HER2 (AF647), MFI',
    events: [
      { week: wk(fb.date), date: fb.date, phase: 'baseline', title: 'HER2 flow cytometry', lines: [`MFI ${Math.round(fb.her2MFI).toLocaleString()}`] },
      { week: wk(fm.date), date: fm.date, phase: 'onTreatment', title: 'HER2 flow cytometry', lines: [`MFI ${Math.round(fm.her2MFI).toLocaleString()}`] },
      {
        week: wk(fp.date),
        date: fp.date,
        phase: 'progression',
        title: 'HER2 flow cytometry',
        lines: [`MFI ${Math.round(fp.her2MFI).toLocaleString()} — ${fp.her2Upregulated ? 'upregulated (≥2×)' : 'not upregulated (<2×)'}`],
      },
    ],
  })

  const hb = p.digitalPathology.baseline
  const hm = p.digitalPathology.midTreatment
  const hp = p.digitalPathology.progression
  rows.push({
    section: 'Multi-omic / translational',
    key: 'ihc',
    label: 'Digital pathology',
    sub: 'pERK IHC (HALO classifier)',
    events: [
      { week: wk(hb.date), date: hb.date, phase: 'baseline', title: 'pERK IHC', lines: [`${hb.pERKPositivityPctEpithelial.toFixed(1)}% epithelial positivity`] },
      { week: wk(hm.date), date: hm.date, phase: 'onTreatment', title: 'pERK IHC', lines: [`${hm.pERKPositivityPctEpithelial.toFixed(1)}%`] },
      { week: wk(hp.date), date: hp.date, phase: 'progression', title: 'pERK IHC', lines: [`${hp.pERKPositivityPctEpithelial.toFixed(1)}%`] },
    ],
  })

  const wm = p.phosphoproteomics.midTreatment
  const wp = p.phosphoproteomics.progression
  rows.push({
    section: 'Multi-omic / translational',
    key: 'wb',
    label: 'Phospho-proteomics',
    sub: 'Western blot / phospho-RPPA',
    events: [wm, wp].map((rec, i) => ({
      week: wk(rec.date),
      date: rec.date,
      phase: i === 0 ? 'onTreatment' : 'progression',
      title: 'Western blot',
      lines: [
        `pERK ${rec.pERKFoldChangeVsBaseline.toFixed(2)}× · pMEK ${rec.pMEKFoldChangeVsBaseline.toFixed(2)}× · pCDK1 ${rec.pCDK1FoldChangeVsBaseline.toFixed(2)}×`,
        `γH2AX ${rec.gammaH2AXFoldChangeVsBaseline.toFixed(2)}×`,
      ],
    })),
  })

  const sections = []
  rows.forEach((row) => {
    const last = sections[sections.length - 1]
    if (!last || last.title !== row.section) sections.push({ title: row.section, rows: [row] })
    else last.rows.push(row)
  })
  return sections
}

function EventTooltip({ tooltip }) {
  if (!tooltip) return null
  const { x, y, row, event } = tooltip
  const width = 260
  const clampedX = typeof window !== 'undefined' ? Math.min(x + 14, window.innerWidth - width - 8) : x + 14
  return (
    <div
      className="pointer-events-none fixed z-40 w-[260px] rounded-md border border-ink-200 bg-white px-3 py-2 text-xs shadow-lg"
      style={{ left: clampedX, top: y - 44 }}
    >
      <p className="font-semibold text-ink-950">
        {row.label} — {event.title}
      </p>
      <p className="mb-1.5 text-[11px] text-ink-400">
        {PHASE_LABEL[event.phase]} · {fmtDateLong(event.date)} · wk {event.week}
      </p>
      {event.lines.map((line, i) => (
        <p key={i} className="text-ink-700">
          {line}
        </p>
      ))}
      {event.highlight && event.calloutLabel && (
        <p className="mt-1.5 border-t border-ink-100 pt-1.5 font-semibold text-critical-700">{event.calloutLabel}</p>
      )}
    </div>
  )
}

function LongitudinalTimeline({ patient }) {
  const [viewMode, setViewMode] = useState('chart')
  const [tooltip, setTooltip] = useState(null)

  const sections = useMemo(() => buildSections(patient), [patient])

  const geometry = useMemo(() => {
    const xMaxWeek = Math.ceil((patient.progressionFreeSurvivalWeeks + 4) / 4) * 4
    const enrollmentWeek = weeksBetween(patient.daraxonrasibStartDate, patient.enrollmentDate)
    const xMinWeek = Math.min(-1.5, enrollmentWeek - 1.5)
    const plotW = VIEW_W - GUTTER - RIGHT_PAD
    const xOf = (week) => GUTTER + ((week - xMinWeek) / (xMaxWeek - xMinWeek)) * plotW

    let y = TOP_PAD
    const rowY = {}
    const sectionBands = []
    sections.forEach((sec) => {
      const top = y
      y += SECTION_HEAD_H
      sec.rows.forEach((row) => {
        rowY[row.key] = y + ROW_H / 2
        row.top = y
        y += ROW_H
      })
      sectionBands.push({ title: sec.title, top, bottom: y, rows: sec.rows })
    })
    const chartBottom = y
    const totalH = chartBottom + AXIS_H

    return { xMaxWeek, xMinWeek, xOf, rowY, sectionBands, chartBottom, totalH }
  }, [patient, sections])

  const { xMaxWeek, xOf, rowY, sectionBands, chartBottom, totalH } = geometry

  const weekTicks = []
  for (let wkTick = 0; wkTick <= xMaxWeek; wkTick += 4) weekTicks.push(wkTick)

  const referenceMarkers = [
    { week: 0, label: 'Daraxonrasib start', date: patient.daraxonrasibStartDate },
    { week: patient.progressionFreeSurvivalWeeks, label: 'Progression / EOT', date: patient.progressionDate },
  ]

  function showTooltip(clientX, clientY, row, event) {
    setTooltip({ x: clientX, y: clientY, row, event })
  }
  function handleFocus(e, row, event) {
    const rect = e.currentTarget.getBoundingClientRect()
    showTooltip(rect.left + rect.width / 2, rect.top, row, event)
  }

  return (
    <div className="rounded-lg border border-ink-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-ink-950">Longitudinal event timeline</p>
          <p className="text-xs text-ink-400">Hover or focus any marker for details · horizontal position = weeks on treatment</p>
        </div>
        <div role="group" aria-label="Chart display mode" className="flex overflow-hidden rounded-md border border-ink-200">
          <button
            type="button"
            onClick={() => setViewMode('chart')}
            aria-pressed={viewMode === 'chart'}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              viewMode === 'chart' ? 'bg-accent-100 text-accent-700' : 'bg-white text-ink-500 hover:text-ink-800'
            }`}
          >
            Timeline
          </button>
          <button
            type="button"
            onClick={() => setViewMode('table')}
            aria-pressed={viewMode === 'table'}
            className={`border-l border-ink-200 px-3 py-1.5 text-xs font-medium transition-colors ${
              viewMode === 'table' ? 'bg-accent-100 text-accent-700' : 'bg-white text-ink-500 hover:text-ink-800'
            }`}
          >
            Table
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 border-b border-ink-100 px-4 py-3 text-xs text-ink-500">
        {PHASE_LEGEND.map((item) => (
          <span key={item.phase} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${PHASE_DOT_CLASS[item.phase]}`} aria-hidden="true" />
            {item.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-critical-600 ring-2 ring-critical-100" aria-hidden="true" />
          Key finding
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0 w-4 border-t border-dashed border-ink-300" aria-hidden="true" />
          Same-domain sequence
        </span>
      </div>

      {viewMode === 'chart' ? (
        <div className="overflow-x-auto px-2 py-3">
          <svg viewBox={`0 0 ${VIEW_W} ${totalH}`} className="block h-auto w-full min-w-[880px]" role="img" aria-label={`Event timeline for patient ${patient.patientId}`}>
            {sectionBands.map((sec) => (
              <g key={sec.title}>
                <rect x={0} y={sec.top} width={VIEW_W} height={sec.bottom - sec.top} className="fill-ink-50" />
                <text x={GUTTER} y={sec.top + 18} className="fill-ink-400 text-[10px] font-semibold tracking-wide uppercase">
                  {sec.title}
                </text>
                {sec.rows.map((row, i) => {
                  const cy = rowY[row.key]
                  return (
                    <g key={row.key}>
                      {i % 2 === 1 && <rect x={0} y={row.top} width={VIEW_W} height={ROW_H} className="fill-ink-100 opacity-60" />}
                      <text x={16} y={cy - 4} className="fill-ink-950 text-[12px] font-semibold">
                        {row.label}
                      </text>
                      <text x={16} y={cy + 11} className="fill-ink-400 text-[10px]">
                        {row.sub}
                      </text>
                      <line x1={0} x2={VIEW_W} y1={row.top + ROW_H} y2={row.top + ROW_H} className="stroke-ink-200" strokeWidth={1} />
                    </g>
                  )
                })}
              </g>
            ))}

            <line x1={GUTTER} x2={GUTTER} y1={TOP_PAD} y2={chartBottom} className="stroke-ink-200" strokeWidth={1} />

            {weekTicks.map((wkTick) => {
              const tx = xOf(wkTick)
              return (
                <g key={wkTick}>
                  <line x1={tx} x2={tx} y1={TOP_PAD} y2={chartBottom} className="stroke-ink-100" strokeWidth={1} />
                  <text x={tx} y={chartBottom + 16} textAnchor="middle" className="fill-ink-400 text-[10px]">
                    wk {wkTick}
                  </text>
                  {wkTick % 8 === 0 && (
                    <text x={tx} y={chartBottom + 32} textAnchor="middle" className="fill-ink-500 text-[10px] font-medium">
                      {fmtDateShort(addWeeksIso(patient.daraxonrasibStartDate, wkTick))}
                    </text>
                  )}
                </g>
              )
            })}

            {referenceMarkers.map((ref) => {
              const rx = xOf(ref.week)
              const chipW = 132
              const chipX = Math.min(Math.max(rx - chipW / 2, GUTTER + 2), VIEW_W - RIGHT_PAD - chipW)
              return (
                <g key={ref.label}>
                  <line x1={rx} x2={rx} y1={TOP_PAD - 8} y2={chartBottom} className="stroke-ink-300" strokeWidth={1} strokeDasharray="3 3" />
                  <rect x={chipX} y={TOP_PAD - 46} width={chipW} height={34} rx={7} className="fill-white stroke-ink-200" />
                  <text x={chipX + chipW / 2} y={TOP_PAD - 30} textAnchor="middle" className="fill-ink-600 text-[10px] font-semibold">
                    {ref.label}
                  </text>
                  <text x={chipX + chipW / 2} y={TOP_PAD - 17} textAnchor="middle" className="fill-ink-400 font-mono text-[10px]">
                    {fmtDateShort(ref.date)}
                  </text>
                </g>
              )
            })}

            {sectionBands.flatMap((sec) =>
              sec.rows.map((row) => {
                const cy = rowY[row.key]
                return (
                  <g key={`connectors-${row.key}`}>
                    {row.events.slice(1).map((event, i) => (
                      <line
                        key={i}
                        x1={xOf(row.events[i].week)}
                        x2={xOf(event.week)}
                        y1={cy}
                        y2={cy}
                        className="stroke-ink-200"
                        strokeWidth={1.5}
                      />
                    ))}
                  </g>
                )
              }),
            )}

            {sectionBands.flatMap((sec) =>
              sec.rows.map((row) => {
                const cy = rowY[row.key]
                return row.events.map((event, i) => {
                  const cx = xOf(event.week)
                  const r = event.highlight ? 8 : 5.5
                  const lx = cx - 14
                  return (
                    <g
                      key={`${row.key}-${i}`}
                      tabIndex={0}
                      role="button"
                      aria-label={`${row.label}: ${event.title}`}
                      className="cursor-pointer rounded-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500 focus-visible:outline-offset-2"
                      onMouseEnter={(e) => showTooltip(e.clientX, e.clientY, row, event)}
                      onMouseMove={(e) => showTooltip(e.clientX, e.clientY, row, event)}
                      onMouseLeave={() => setTooltip(null)}
                      onFocus={(e) => handleFocus(e, row, event)}
                      onBlur={() => setTooltip(null)}
                    >
                      <circle cx={cx} cy={cy} r={14} fill="transparent" />
                      <circle
                        cx={cx}
                        cy={cy}
                        r={r}
                        className={`stroke-white ${event.highlight ? 'fill-critical-600' : PHASE_FILL_CLASS[event.phase]}`}
                        strokeWidth={2}
                      />
                      {event.highlight && (
                        <>
                          <line x1={cx - r - 2} y1={cy} x2={lx} y2={cy} className="stroke-critical-600" strokeWidth={1.25} />
                          <text x={lx} y={cy - 4} textAnchor="end" className="fill-critical-700 text-[10.5px] font-semibold">
                            {event.calloutLabel}
                          </text>
                        </>
                      )}
                    </g>
                  )
                })
              }),
            )}
          </svg>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-ink-100 bg-ink-50 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
                <th className="px-4 py-2">Domain</th>
                <th className="px-4 py-2">Event</th>
                <th className="px-4 py-2">Week</th>
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {sectionBands.flatMap((sec) =>
                sec.rows.flatMap((row) =>
                  row.events.map((event, i) => (
                    <tr key={`${row.key}-${i}`} className={`border-b border-ink-100 ${event.highlight ? 'bg-critical-100/40' : ''}`}>
                      <td className="px-4 py-2 text-ink-400">{row.label}</td>
                      <td className={`px-4 py-2 ${event.highlight ? 'font-semibold text-critical-700' : 'text-ink-800'}`}>
                        <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${event.highlight ? 'bg-critical-600' : PHASE_DOT_CLASS[event.phase]}`} />
                        {event.title}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-ink-500">wk {event.week}</td>
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-ink-500">{fmtDateShort(event.date)}</td>
                      <td className="px-4 py-2 text-ink-600">{event.lines.join(' · ')}</td>
                    </tr>
                  )),
                ),
              )}
            </tbody>
          </table>
        </div>
      )}

      <EventTooltip tooltip={tooltip} />
    </div>
  )
}

export default LongitudinalTimeline
