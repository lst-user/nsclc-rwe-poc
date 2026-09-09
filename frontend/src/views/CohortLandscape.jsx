import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import FilterSelect from '../components/FilterSelect'
import { selectCohortStats, useCohort } from '../data/useCohort'

const KRAS_VARIANT_OPTIONS = ['G12D', 'G12V', 'G12C', 'G12R', 'Q61H', 'other']
const DOSE_BAND_OPTIONS = ['160-300mg', '≤120mg']
const TP53_OPTIONS = ['mutant', 'wild-type']

const krasVariantOf = (p) => p.genomics.baseline.diagnosticBiopsyNGS.baselineKrasVariant
const tp53StatusOf = (p) => p.genomics.baseline.diagnosticBiopsyNGS.pretreatmentTP53Status

function StatTile({ label, value, sub }) {
  return (
    <div className="rounded-lg border border-ink-200 bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{label}</p>
      <p className="mt-1 font-mono text-xl font-semibold text-ink-950">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-500">{sub}</p>}
    </div>
  )
}

function MechanismTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const { mechanism, count } = payload[0].payload
  return (
    <div className="rounded-md border border-ink-200 bg-white px-3 py-2 text-xs shadow-sm">
      <p className="font-semibold text-ink-950">{mechanism}</p>
      <p className="mt-0.5 text-ink-600">
        <span className="font-mono font-semibold text-ink-950">{count}</span> resistance-positive patient
        {count === 1 ? '' : 's'}
      </p>
    </div>
  )
}

// mechanismFilter/onMechanismFilterChange are lifted to App.jsx so the
// selection survives a jump to Patient Trajectory (and back).
function CohortLandscape({ mechanismFilter: selectedMechanism, onMechanismFilterChange: setSelectedMechanism }) {
  const { cohort } = useCohort()
  const [krasFilter, setKrasFilter] = useState('all')
  const [doseFilter, setDoseFilter] = useState('all')
  const [tp53Filter, setTp53Filter] = useState('all')

  const filtersActive = krasFilter !== 'all' || doseFilter !== 'all' || tp53Filter !== 'all'

  const filteredCohort = useMemo(
    () =>
      cohort.filter((p) => {
        if (krasFilter !== 'all' && krasVariantOf(p) !== krasFilter) return false
        if (doseFilter !== 'all' && p.doseBand !== doseFilter) return false
        if (tp53Filter !== 'all' && tp53StatusOf(p) !== tp53Filter) return false
        return true
      }),
    [cohort, krasFilter, doseFilter, tp53Filter],
  )

  const stats = useMemo(() => selectCohortStats(filteredCohort), [filteredCohort])

  const mechanismChartData = useMemo(
    () =>
      Object.entries(stats.mechanismCounts)
        .map(([mechanism, count]) => ({ mechanism, count }))
        .sort((a, b) => b.count - a.count),
    [stats],
  )

  // Computed over the KRAS-variant + dose-band filters only — pre-filtering by
  // TP53 status here would be self-defeating (the callout IS the TP53 split).
  const krasampTp53Stat = useMemo(() => {
    const base = cohort.filter((p) => {
      if (krasFilter !== 'all' && krasVariantOf(p) !== krasFilter) return false
      if (doseFilter !== 'all' && p.doseBand !== doseFilter) return false
      return true
    })
    const byStatus = (status) => base.filter((p) => tp53StatusOf(p) === status)
    const rateFor = (status) => {
      const group = byStatus(status)
      const withKrasamp = group.filter((p) => p.resistanceMechanism === 'KRASamp').length
      return { count: group.length, withKrasamp, rate: group.length ? withKrasamp / group.length : 0 }
    }
    return { mutant: rateFor('mutant'), wildType: rateFor('wild-type') }
  }, [cohort, krasFilter, doseFilter])

  const selectedSubgroup = useMemo(
    () => (selectedMechanism ? filteredCohort.filter((p) => p.resistanceMechanism === selectedMechanism) : []),
    [filteredCohort, selectedMechanism],
  )

  const strategyBreakdown = useMemo(() => {
    const counts = {}
    for (const p of selectedSubgroup) {
      counts[p.combinationStrategy] = (counts[p.combinationStrategy] || 0) + 1
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }, [selectedSubgroup])

  function toggleMechanism(mechanism) {
    setSelectedMechanism((prev) => (prev === mechanism ? null : mechanism))
  }

  function resetFilters() {
    setKrasFilter('all')
    setDoseFilter('all')
    setTp53Filter('all')
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-ink-950">Cohort Landscape</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-600">
          Population-level view for Epidemiology / RWE — dose-response, resistance rates, and mechanism
          distribution across the trial cohort.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-ink-200 bg-white px-4 py-3">
        <FilterSelect label="Baseline KRAS variant" value={krasFilter} options={KRAS_VARIANT_OPTIONS} onChange={setKrasFilter} />
        <FilterSelect label="Dose band" value={doseFilter} options={DOSE_BAND_OPTIONS} onChange={setDoseFilter} />
        <FilterSelect label="Pretreatment TP53 status" value={tp53Filter} options={TP53_OPTIONS} onChange={setTp53Filter} />
        {filtersActive && (
          <button
            type="button"
            onClick={resetFilters}
            className="ml-auto text-xs font-medium text-accent-600 hover:text-accent-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500"
          >
            Reset filters
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Patients" value={stats.total} sub={filtersActive ? `of ${cohort.length} total` : undefined} />
        <StatTile
          label="Resistance rate"
          value={`${(stats.resistanceRate * 100).toFixed(1)}%`}
          sub={`${stats.resistantCount} of ${stats.total}`}
        />
        <StatTile
          label="Tissue/ctDNA concordance"
          value={`${(stats.tissueCtdnaConcordanceRate * 100).toFixed(1)}%`}
          sub={`${stats.tissueCtdnaConcordantCount} of ${stats.total}`}
        />
        <StatTile
          label="Resistance mechanisms"
          value={Object.keys(stats.mechanismCounts).length}
          sub="distinct mechanisms observed"
        />
      </div>

      <div className="rounded-lg border border-ink-200 bg-white p-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
            Resistance mechanism distribution ({stats.resistantCount} resistance-positive patients)
          </p>
          {selectedMechanism && (
            <button
              type="button"
              onClick={() => setSelectedMechanism(null)}
              className="text-xs font-medium text-accent-600 hover:text-accent-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500"
            >
              Clear selection
            </button>
          )}
        </div>

        {mechanismChartData.length === 0 ? (
          <p className="mt-6 py-8 text-center text-sm text-ink-400">
            No resistance-positive patients match the current filters.
          </p>
        ) : (
          <>
            <div className="mt-2" style={{ width: '100%', height: 28 * mechanismChartData.length + 40 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={mechanismChartData} layout="vertical" margin={{ top: 8, right: 36, bottom: 8, left: 8 }}>
                  <CartesianGrid horizontal={false} stroke="var(--color-ink-100)" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--color-ink-400)' }} axisLine={false} tickLine={false} />
                  <YAxis
                    type="category"
                    dataKey="mechanism"
                    width={84}
                    tick={{ fontSize: 12, fill: 'var(--color-ink-800)', fontFamily: 'var(--font-mono)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<MechanismTooltip />} cursor={{ fill: 'var(--color-ink-50)' }} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={24} onClick={(data) => toggleMechanism(data.mechanism)} style={{ cursor: 'pointer' }}>
                    {mechanismChartData.map((entry) => {
                      const isDimmed = selectedMechanism !== null && entry.mechanism !== selectedMechanism
                      return (
                        <Cell
                          key={entry.mechanism}
                          fill={isDimmed ? 'var(--color-ink-200)' : 'var(--color-accent-600)'}
                        />
                      )
                    })}
                    <LabelList dataKey="count" position="right" style={{ fill: 'var(--color-ink-600)', fontSize: 11, fontFamily: 'var(--font-mono)' }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter by resistance mechanism">
              {mechanismChartData.map(({ mechanism, count }) => {
                const isSelected = mechanism === selectedMechanism
                return (
                  <button
                    key={mechanism}
                    type="button"
                    onClick={() => toggleMechanism(mechanism)}
                    aria-pressed={isSelected}
                    className={`rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500 ${
                      isSelected
                        ? 'border-accent-600 bg-accent-100 text-accent-700'
                        : 'border-ink-200 bg-white text-ink-600 hover:border-ink-300 hover:text-ink-800'
                    }`}
                  >
                    {mechanism} · {count}
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>

      {selectedMechanism && (
        <div className="rounded-lg border border-accent-100 bg-accent-50 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-accent-700">
            {selectedMechanism} — {selectedSubgroup.length} of {stats.resistantCount} resistance-positive patients
          </p>

          {selectedMechanism === 'KRASamp' && (
            <p className="mt-2 max-w-2xl text-sm text-ink-800">
              <span className="font-mono font-semibold">{(krasampTp53Stat.mutant.rate * 100).toFixed(1)}%</span> of
              TP53-mutant patients ({krasampTp53Stat.mutant.withKrasamp}/{krasampTp53Stat.mutant.count}) vs.{' '}
              <span className="font-mono font-semibold">{(krasampTp53Stat.wildType.rate * 100).toFixed(1)}%</span> of
              TP53-wild-type patients ({krasampTp53Stat.wildType.withKrasamp}/{krasampTp53Stat.wildType.count})
              acquired KRASamp.
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Combination strategy</p>
              <ul className="mt-1 space-y-0.5 text-sm text-ink-800">
                {strategyBreakdown.map(([strategy, count]) => (
                  <li key={strategy}>
                    <span className="font-mono font-semibold">{count}</span> · {strategy}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Patients in this subgroup</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {selectedSubgroup.map((p) => (
                <span
                  key={p.patientId}
                  className="rounded-full border border-ink-200 bg-white px-2.5 py-1 font-mono text-[11px] text-ink-800"
                >
                  {p.patientId}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-dashed border-ink-200 bg-white px-5 py-4 text-sm text-ink-500">
        Next up here: dose-band resistance-rate comparison and PFS distribution by best response — all
        driven by the same <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-xs text-ink-800">useCohort()</code>{' '}
        + filter pattern above.
      </div>
    </div>
  )
}

export default CohortLandscape
