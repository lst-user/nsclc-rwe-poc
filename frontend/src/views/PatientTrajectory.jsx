import { useMemo, useState } from 'react'
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import FilterSelect from '../components/FilterSelect'
import LongitudinalTimeline from '../components/LongitudinalTimeline'
import { useCohort } from '../data/useCohort'

function addWeeks(iso, weeks) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + Math.round(weeks * 7))
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

// Three ways a patient's progression can relate to a genomic driver:
// no resistance ever acquired, resistance acquired but the standard
// tissue/ctDNA panel called no reportable alteration (PPIA panel-miss), or
// a mechanism was identified.
const RESISTANCE_STATUS_OPTIONS = [
  { value: 'none', label: 'No genomic driver identified' },
  { value: 'unknown', label: 'Unknown / panel-negative' },
  { value: 'identified', label: 'Mechanism identified' },
]

function resistanceStatusOf(p) {
  if (!p.hasAcquiredResistance) return 'none'
  if (p.genomics.progression.repeatBiopsyNGS.resistanceMechanism === null) return 'unknown'
  return 'identified'
}

function MetaField({ label, value, sub }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-ink-950">{value}</p>
      {sub && <p className="text-xs text-ink-500">{sub}</p>}
    </div>
  )
}

function TrajectoryTooltip({ active, payload, label, showCa199, showNlr }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  const vaf = row.vafResponse ?? row.vafResistance
  return (
    <div className="rounded-md border border-ink-200 bg-white px-3 py-2 text-xs shadow-sm">
      <p className="font-semibold text-ink-950">Week {label}</p>
      {row.date && <p className="text-ink-400">{row.date}</p>}
      {vaf != null && (
        <p className="mt-1 text-ink-700">
          VAF: <span className="font-mono font-semibold text-ink-950">{vaf.toFixed(2)}%</span>
        </p>
      )}
      {showCa199 && row.ca199Index != null && (
        <p className="text-ink-700">
          CA19-9: <span className="font-mono font-semibold text-ink-950">{row.ca199Raw.toFixed(1)}</span> U/mL (
          {row.ca199Index.toFixed(0)}% of baseline)
        </p>
      )}
      {showNlr && row.nlrIndex != null && (
        <p className="text-ink-700">
          NLR: <span className="font-mono font-semibold text-ink-950">{row.nlrRaw.toFixed(2)}</span> (
          {row.nlrIndex.toFixed(0)}% of baseline)
        </p>
      )}
    </div>
  )
}

function PatientTrajectory({
  selectedMechanism,
  onSelectedMechanismChange,
  selectedPatientId,
  onSelectedPatientIdChange,
  onNavigate,
}) {
  const { cohort } = useCohort()
  const [search, setSearch] = useState('')
  const [resistanceStatusFilter, setResistanceStatusFilter] = useState('all')
  const [showCa199, setShowCa199] = useState(false)
  const [showNlr, setShowNlr] = useState(false)

  const availableMechanisms = useMemo(
    () => [...new Set(cohort.filter((p) => p.resistanceMechanism).map((p) => p.resistanceMechanism))].sort(),
    [cohort],
  )

  const filteredPatients = useMemo(() => {
    const term = search.trim().toLowerCase()
    return cohort.filter((p) => {
      if (selectedMechanism && p.resistanceMechanism !== selectedMechanism) return false
      if (resistanceStatusFilter !== 'all' && resistanceStatusOf(p) !== resistanceStatusFilter) return false
      if (term && !p.patientId.toLowerCase().includes(term)) return false
      return true
    })
  }, [cohort, selectedMechanism, resistanceStatusFilter, search])

  const filtersActive = selectedMechanism !== null || resistanceStatusFilter !== 'all' || search.trim() !== ''

  function resetFilters() {
    onSelectedMechanismChange(null)
    setResistanceStatusFilter('all')
    setSearch('')
  }

  // Prefer the current selection only while it still matches the active
  // filters, so changing a filter never leaves the chart showing a patient
  // that's no longer visible in the list above it.
  const selectedPatient =
    filteredPatients.find((p) => p.patientId === selectedPatientId) ?? filteredPatients[0] ?? null

  const chartData = useMemo(() => {
    if (!selectedPatient) return []
    const p = selectedPatient
    const ctdna = p.genomics.midTreatment.serialCtDNA
    const eotVAF = p.genomics.progression.repeatBiopsyNGS.eotVAF
    const resistant = p.hasAcquiredResistance
    const progWeek = p.progressionFreeSurvivalWeeks

    const rows = new Map()
    function set(week, date, field, value) {
      if (!rows.has(week)) rows.set(week, { week, date })
      rows.get(week)[field] = value
    }

    set(0, addWeeks(p.daraxonrasibStartDate, 0), 'vafResponse', p.genomics.baseline.diagnosticBiopsyNGS.baselineVAF)
    set(ctdna.weeksOnTreatment, addWeeks(p.daraxonrasibStartDate, ctdna.weeksOnTreatment), 'vafResponse', ctdna.vaf)
    if (resistant) set(ctdna.weeksOnTreatment, addWeeks(p.daraxonrasibStartDate, ctdna.weeksOnTreatment), 'vafResistance', ctdna.vaf)
    set(progWeek, addWeeks(p.daraxonrasibStartDate, progWeek), resistant ? 'vafResistance' : 'vafResponse', eotVAF)

    const ca199Baseline = p.laboratory.baseline.ca199
    const nlrBaseline = p.laboratory.baseline.nlr
    const ca199Points = [
      { week: 0, value: ca199Baseline },
      ...p.laboratory.midTreatment.ca199Series.map((pt) => ({ week: pt.weeksOnTreatment, value: pt.value })),
      { week: progWeek, value: p.laboratory.progression.ca199AtProgression },
    ]
    const nlrPoints = [
      { week: 0, value: nlrBaseline },
      ...p.laboratory.midTreatment.nlrSeries.map((pt) => ({ week: pt.weeksOnTreatment, value: pt.value })),
      { week: progWeek, value: p.laboratory.progression.nlrAtProgression },
    ]
    ca199Points.forEach((pt) => {
      set(pt.week, addWeeks(p.daraxonrasibStartDate, pt.week), 'ca199Raw', pt.value)
      set(pt.week, addWeeks(p.daraxonrasibStartDate, pt.week), 'ca199Index', ca199Baseline ? (pt.value / ca199Baseline) * 100 : null)
    })
    nlrPoints.forEach((pt) => {
      set(pt.week, addWeeks(p.daraxonrasibStartDate, pt.week), 'nlrRaw', pt.value)
      set(pt.week, addWeeks(p.daraxonrasibStartDate, pt.week), 'nlrIndex', nlrBaseline ? (pt.value / nlrBaseline) * 100 : null)
    })

    return Array.from(rows.values()).sort((a, b) => a.week - b.week)
  }, [selectedPatient])

  const p = selectedPatient
  const repeatBiopsy = p?.genomics.progression.repeatBiopsyNGS
  const resistant = p?.hasAcquiredResistance
  const resistanceStatus = p ? resistanceStatusOf(p) : null
  const mechanismLabel = resistant
    ? (repeatBiopsy.resistanceMechanism ?? `${p.resistanceMechanism} (panel-negative)`)
    : null
  const discordant = resistant && repeatBiopsy.tissueCtdnaConcordant === false
  const germline = p?.genomics.baseline.germlineDNA
  const tp53 = p?.genomics.baseline.diagnosticBiopsyNGS.pretreatmentTP53Status
  const showOverlay = showCa199 || showNlr

  return (
    <div className="space-y-6">
      <ViewHeader />

      <div className="rounded-lg border border-ink-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-4">
          <FilterSelect
            label="Filter by mechanism"
            value={selectedMechanism ?? 'all'}
            options={availableMechanisms}
            onChange={(v) => onSelectedMechanismChange(v === 'all' ? null : v)}
          />
          <FilterSelect
            label="Resistance status"
            value={resistanceStatusFilter}
            options={RESISTANCE_STATUS_OPTIONS}
            onChange={setResistanceStatusFilter}
          />
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wide text-ink-400">Search patient ID</span>
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="PDAC-###"
              className="rounded-md border border-ink-200 bg-white px-2.5 py-1.5 font-mono text-sm text-ink-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500"
            />
          </label>
          <p className="ml-auto text-xs text-ink-400">{filteredPatients.length} matching patients</p>
          {filtersActive && (
            <button
              type="button"
              onClick={resetFilters}
              className="text-xs font-medium text-accent-600 hover:text-accent-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500"
            >
              Reset filters
            </button>
          )}
        </div>

        <div className="mt-3 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
          {filteredPatients.map((patient) => {
            const isSelected = patient.patientId === p?.patientId
            return (
              <button
                key={patient.patientId}
                type="button"
                onClick={() => onSelectedPatientIdChange(patient.patientId)}
                aria-pressed={isSelected}
                className={`rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500 ${
                  isSelected
                    ? 'border-accent-600 bg-accent-100 text-accent-700'
                    : 'border-ink-200 bg-white text-ink-600 hover:border-ink-300 hover:text-ink-800'
                }`}
              >
                {patient.patientId}
              </button>
            )
          })}
          {filteredPatients.length === 0 && (
            <p className="py-1 text-sm text-ink-400">No patients match the current filters.</p>
          )}
        </div>
      </div>

      {!p ? null : (
        <>
      <div className="rounded-lg border border-ink-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-mono text-base font-semibold text-ink-950">{p.patientId}</h3>
          <p className="text-xs text-ink-500">
            {p.lineOfTherapy}L · daraxonrasib start {addWeeks(p.daraxonrasibStartDate, 0)} · progression{' '}
            {addWeeks(p.daraxonrasibStartDate, p.progressionFreeSurvivalWeeks)} ({p.progressionFreeSurvivalWeeks} wks)
          </p>
          {resistant && (
            <button
              type="button"
              onClick={() => {
                onSelectedMechanismChange(p.resistanceMechanism)
                onNavigate('mechanism-strategy')
              }}
              className="ml-auto text-xs font-medium text-accent-600 hover:text-accent-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500"
            >
              See {p.resistanceMechanism} combination strategy →
            </button>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
          <MetaField
            label="Resistance status"
            value={
              resistanceStatus === 'none'
                ? 'No genomic driver'
                : resistanceStatus === 'unknown'
                  ? 'Unknown / panel-negative'
                  : p.resistanceMechanism
            }
            sub={
              resistanceStatus === 'none'
                ? 'Progressed without acquired resistance'
                : resistanceStatus === 'unknown'
                  ? `${p.resistanceMechanism} (panel-negative)`
                  : p.resistanceMechanismSource
            }
          />
          <MetaField label="Best response" value={p.bestResponse} />
          <MetaField label="Baseline KRAS" value={p.genomics.baseline.diagnosticBiopsyNGS.baselineKrasVariant} />
          <MetaField
            label="TP53 / BRCA"
            value={tp53 === 'mutant' ? 'TP53-mut' : 'TP53-wt'}
            sub={germline.brca1Brca2PathogenicVariant ? `${germline.gene}-mutant` : 'BRCA-negative'}
          />
          <MetaField label="Dose band" value={p.doseBand} />
          <MetaField
            label="ECOG (baseline → progression)"
            value={`${p.clinical.baseline.ecog} → ${p.clinical.progression.performanceStatusEOT}`}
          />
          <MetaField
            label="New metastatic sites"
            value={p.clinical.progression.newMetastaticSites ? 'Yes' : 'No'}
          />
        </div>
      </div>

      <div className="rounded-lg border border-ink-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
            ctDNA VAF across treatment {resistant ? '— resistance emergence annotated' : ''}
          </p>
          <div className="flex items-center gap-1.5" role="group" aria-label="Overlay laboratory trends">
            <button
              type="button"
              onClick={() => setShowCa199((v) => !v)}
              aria-pressed={showCa199}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500 ${
                showCa199 ? 'border-medaffairs-600 bg-medaffairs-100 text-medaffairs-600' : 'border-ink-200 bg-white text-ink-500 hover:text-ink-800'
              }`}
            >
              <span className="h-1.5 w-4 rounded-full bg-medaffairs-600" aria-hidden="true" />
              CA 19-9
            </button>
            <button
              type="button"
              onClick={() => setShowNlr((v) => !v)}
              aria-pressed={showNlr}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500 ${
                showNlr ? 'border-epi-600 bg-epi-100 text-epi-600' : 'border-ink-200 bg-white text-ink-500 hover:text-ink-800'
              }`}
            >
              <span className="h-1.5 w-4 rounded-full bg-epi-600" aria-hidden="true" />
              NLR
            </button>
          </div>
        </div>

        <div className="mt-3" style={{ width: '100%', height: 340 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 16, right: showOverlay ? 56 : 88, bottom: 8, left: 8 }}>
              <CartesianGrid stroke="var(--color-ink-100)" vertical={false} />
              <XAxis
                dataKey="week"
                type="number"
                domain={[0, 'dataMax']}
                tick={{ fontSize: 11, fill: 'var(--color-ink-400)' }}
                axisLine={false}
                tickLine={false}
                label={{ value: 'Weeks on treatment', position: 'insideBottom', offset: -4, fontSize: 11, fill: 'var(--color-ink-400)' }}
              />
              <YAxis
                yAxisId="vaf"
                domain={[0, 'auto']}
                tickFormatter={(v) => v.toFixed(0)}
                tick={{ fontSize: 11, fill: 'var(--color-ink-400)' }}
                axisLine={false}
                tickLine={false}
                width={40}
                label={{ value: 'VAF %', angle: -90, position: 'insideLeft', fontSize: 11, fill: 'var(--color-ink-500)' }}
              />
              {showOverlay && (
                <YAxis
                  yAxisId="index"
                  orientation="right"
                  domain={[0, 'auto']}
                  tickFormatter={(v) => v.toFixed(0)}
                  tick={{ fontSize: 11, fill: 'var(--color-ink-400)' }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                  label={{ value: '% of baseline', angle: 90, position: 'insideRight', fontSize: 11, fill: 'var(--color-ink-500)' }}
                />
              )}
              <Tooltip content={<TrajectoryTooltip showCa199={showCa199} showNlr={showNlr} />} />

              {showOverlay && (
                <ReferenceLine yAxisId="index" y={100} stroke="var(--color-ink-300)" strokeDasharray="3 3" />
              )}
              {showCa199 && (
                <Line
                  yAxisId="index"
                  dataKey="ca199Index"
                  stroke="var(--color-medaffairs-600)"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  dot={{ r: 3, fill: 'var(--color-medaffairs-600)', strokeWidth: 0 }}
                  connectNulls
                  isAnimationActive={false}
                />
              )}
              {showNlr && (
                <Line
                  yAxisId="index"
                  dataKey="nlrIndex"
                  stroke="var(--color-epi-600)"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  dot={{ r: 3, fill: 'var(--color-epi-600)', strokeWidth: 0 }}
                  connectNulls
                  isAnimationActive={false}
                />
              )}

              <Line
                yAxisId="vaf"
                dataKey="vafResponse"
                stroke="var(--color-accent-600)"
                strokeWidth={3}
                dot={{ r: 5, fill: 'var(--color-accent-600)', strokeWidth: 2, stroke: 'white' }}
                connectNulls
                isAnimationActive={false}
              />
              {resistant && (
                <Line
                  yAxisId="vaf"
                  dataKey="vafResistance"
                  stroke="var(--color-critical-600)"
                  strokeWidth={3}
                  dot={{ r: 5, fill: 'var(--color-critical-600)', strokeWidth: 2, stroke: 'white' }}
                  connectNulls
                  isAnimationActive={false}
                />
              )}

              {resistant && (
                <ReferenceDot
                  yAxisId="vaf"
                  x={p.progressionFreeSurvivalWeeks}
                  y={repeatBiopsy.eotVAF}
                  r={7}
                  fill="var(--color-critical-600)"
                  stroke="white"
                  strokeWidth={2}
                  label={{
                    value: mechanismLabel,
                    position: 'left',
                    fill: 'var(--color-critical-700)',
                    fontSize: 11,
                    fontWeight: 600,
                    offset: 12,
                  }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-ink-500">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-4 rounded-full bg-accent-600" /> VAF (response)
          </span>
          {resistant && (
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-4 rounded-full bg-critical-600" /> VAF (resistance emergence)
            </span>
          )}
        </div>

        {discordant && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            ⚠ Tissue biopsy and ctDNA were discordant at progression — the repeat biopsy and liquid biopsy
            did not agree on the resistance finding.
          </div>
        )}
      </div>

      <LongitudinalTimeline patient={p} />
        </>
      )}
    </div>
  )
}

function ViewHeader() {
  return (
    <div>
      <h2 className="text-lg font-semibold text-ink-950">Patient Trajectory</h2>
      <p className="mt-1 max-w-2xl text-sm text-ink-600">
        Individual-patient view for Translational Medicine — ctDNA VAF across treatment, with laboratory
        trends available as a secondary overlay to check whether they track the molecular pattern.
      </p>
    </div>
  )
}

export default PatientTrajectory
