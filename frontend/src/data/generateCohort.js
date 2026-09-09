// Synthetic PDAC cohort generator, modeled on the acquired-resistance statistics
// reported in Aronchik, Kar et al., Nature Medicine 2026 (daraxonrasib in PDAC).
// Run with: node src/data/generateCohort.js  (from the frontend/ directory)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_PATH = path.join(__dirname, 'cohort.json')

const N_PATIENTS = 130
const SEED = 20260226

// ---------------------------------------------------------------------------
// RNG (seeded, so re-running the generator is reproducible)
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rng = mulberry32(SEED)

const clamp = (x, min, max) => Math.min(max, Math.max(min, x))
const round = (x, decimals = 1) => Number(x.toFixed(decimals))
const bernoulli = (p) => rng() < p
const randInt = (min, max) => Math.floor(rng() * (max - min + 1)) + min
const randFloat = (min, max) => rng() * (max - min) + min

function randNormal(mean, sd) {
  let u = 0
  let v = 0
  while (u === 0) u = rng()
  while (v === 0) v = rng()
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  return mean + z * sd
}

// items: [{ value, p }] — weights need not sum to exactly 1
function weightedChoice(items) {
  const total = items.reduce((sum, item) => sum + item.p, 0)
  let r = rng() * total
  for (const item of items) {
    if (r < item.p) return item.value
    r -= item.p
  }
  return items[items.length - 1].value
}

function sampleWithoutReplacement(array, k) {
  const pool = [...array]
  const out = []
  for (let i = 0; i < k && pool.length > 0; i++) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0])
  }
  return out
}

function shuffle(array) {
  const a = [...array]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Allocates exactly n values across items in proportion to their weights
// (largest-remainder rounding), then shuffles. Used for cohort-level
// covariates where we want the realized count to land on the target
// percentage rather than drift with per-patient sampling noise.
function quotaAssign(n, items) {
  const total = items.reduce((sum, item) => sum + item.p, 0)
  const raw = items.map((item) => (item.p / total) * n)
  const counts = raw.map(Math.floor)
  let remaining = n - counts.reduce((sum, c) => sum + c, 0)
  const byRemainder = raw
    .map((r, i) => ({ i, frac: r - counts[i] }))
    .sort((a, b) => b.frac - a.frac)
  for (let k = 0; k < remaining; k++) counts[byRemainder[k].i]++
  const arr = []
  items.forEach((item, i) => {
    for (let k = 0; k < counts[i]; k++) arr.push(item.value)
  })
  return shuffle(arr)
}

// Splits `groupValues` (one entry per patient) into buckets and quota-assigns
// a boolean within each bucket at that bucket's target rate.
function assignStratifiedBoolean(groupValues, rateByGroup) {
  const result = new Array(groupValues.length)
  const indicesByGroup = {}
  groupValues.forEach((g, i) => {
    ;(indicesByGroup[g] ??= []).push(i)
  })
  for (const [group, indices] of Object.entries(indicesByGroup)) {
    const p = rateByGroup[group]
    const flags = quotaAssign(indices.length, [
      { value: true, p },
      { value: false, p: 1 - p },
    ])
    indices.forEach((idx, k) => {
      result[idx] = flags[k]
    })
  }
  return result
}

// ---------------------------------------------------------------------------
// Distribution constants
// ---------------------------------------------------------------------------
const KRAS_VARIANTS = [
  { value: 'G12D', p: 0.4 },
  { value: 'G12V', p: 0.29 },
  { value: 'G12C', p: 0.1 },
  { value: 'G12R', p: 0.1 },
  { value: 'Q61H', p: 0.06 },
  { value: 'other', p: 0.05 },
]

const HIGH_DOSE_SHARE = 0.76
const HIGH_DOSE_RESISTANCE_P = 0.59
const LOW_DOSE_RESISTANCE_P = 0.31
const KRASAMP_RATE_TP53_MUTANT = 0.47
const KRASAMP_RATE_TP53_WT = 0.08

// Relative weights among resistance-positive patients who are NOT KRASamp,
// approximating the paper's MAPK-RAF 5 / RTK 4 / PI3K 4 / remainder split.
const OTHER_MECHANISM_WEIGHTS = [
  { value: 'MAPK-RAF', p: 5 },
  { value: 'RTK', p: 4 },
  { value: 'PI3K', p: 4 },
  { value: 'NF1', p: 0.5 },
  { value: 'KEAP1', p: 0.5 },
  { value: 'MYC', p: 0.5 },
  { value: 'PTPN11', p: 0.5 },
]

const METASTATIC_SITES = ['liver', 'lung', 'peritoneum', 'lymph nodes']
const TOXICITY_TERMS = ['fatigue', 'rash', 'diarrhea', 'nausea']

const DDR_COMBO = 'DDR inhibitor combination (e.g., WEE1/CHK1)'
const RTK_COMBO = 'RTK-targeted ADC or bispecific (e.g., T-DXd, amivantamab)'
const RASON_COMBO = 'RAS(ON) inhibitor doublet (daraxonrasib + zoldonrasib)'
const UNDER_INVESTIGATION = 'under investigation'

// ---------------------------------------------------------------------------
// Cohort-level covariate assignment (quota-based, see quotaAssign above)
// ---------------------------------------------------------------------------
const doseBands = quotaAssign(N_PATIENTS, [
  { value: '160-300mg', p: HIGH_DOSE_SHARE },
  { value: '≤120mg', p: 1 - HIGH_DOSE_SHARE },
])
const tp53Statuses = quotaAssign(N_PATIENTS, [
  { value: 'mutant', p: 0.73 },
  { value: 'wild-type', p: 0.27 },
])
const brcaFlags = quotaAssign(N_PATIENTS, [
  { value: true, p: 0.07 },
  { value: false, p: 0.93 },
])
const krasVariants = quotaAssign(N_PATIENTS, KRAS_VARIANTS)
const bestResponses = quotaAssign(N_PATIENTS, [
  { value: 'CR', p: 0.03 },
  { value: 'PR', p: 0.62 },
  { value: 'SD', p: 0.35 },
])
const concordanceFlags = quotaAssign(N_PATIENTS, [
  { value: true, p: 0.85 },
  { value: false, p: 0.15 },
])

const resistanceFlags = assignStratifiedBoolean(doseBands, {
  '160-300mg': HIGH_DOSE_RESISTANCE_P,
  '≤120mg': LOW_DOSE_RESISTANCE_P,
})

function assignMechanisms() {
  const result = new Array(N_PATIENTS).fill(null)
  const resistantIdx = resistanceFlags.map((f, i) => i).filter((i) => resistanceFlags[i])
  const mutantResistantIdx = resistantIdx.filter((i) => tp53Statuses[i] === 'mutant')
  const wtResistantIdx = resistantIdx.filter((i) => tp53Statuses[i] === 'wild-type')
  const totalMutant = tp53Statuses.filter((s) => s === 'mutant').length
  const totalWt = tp53Statuses.filter((s) => s === 'wild-type').length

  // Target counts are unconditional on resistance (per the paper's subgroup
  // rates), so cap at how many resistant patients are actually available.
  const krasampMutantTarget = Math.min(
    Math.round(KRASAMP_RATE_TP53_MUTANT * totalMutant),
    mutantResistantIdx.length,
  )
  const krasampWtTarget = Math.min(Math.round(KRASAMP_RATE_TP53_WT * totalWt), wtResistantIdx.length)

  const krasampSet = new Set([
    ...shuffle(mutantResistantIdx).slice(0, krasampMutantTarget),
    ...shuffle(wtResistantIdx).slice(0, krasampWtTarget),
  ])
  krasampSet.forEach((i) => {
    result[i] = 'KRASamp'
  })

  const remaining = resistantIdx.filter((i) => result[i] === null)
  const mechanismsForRemaining = quotaAssign(remaining.length, OTHER_MECHANISM_WEIGHTS)
  shuffle(remaining).forEach((idx, k) => {
    result[idx] = mechanismsForRemaining[k]
  })

  return result
}

const resistanceMechanisms = assignMechanisms()

// newMetastaticSites at progression: ~2x more common in resistance-positive
// patients, especially when the mechanism is KRASamp.
const metastasisGroupKeys = Array.from({ length: N_PATIENTS }, (_, i) => {
  if (!resistanceFlags[i]) return 'negative'
  return resistanceMechanisms[i] === 'KRASamp' ? 'krasamp' : 'other-resistant'
})
const newMetastaticSitesFlags = assignStratifiedBoolean(metastasisGroupKeys, {
  negative: 0.18,
  krasamp: 0.38,
  'other-resistant': 0.28,
})

// ---------------------------------------------------------------------------
// Helpers for time-series lab values (CA19-9 / NLR)
// ---------------------------------------------------------------------------
function buildVisitWeeks(numPoints) {
  const weeks = []
  let week = randInt(2, 4)
  for (let i = 0; i < numPoints; i++) {
    weeks.push(week)
    week += randInt(2, 4)
  }
  return weeks
}

// Declines from baseline toward a nadir; resistance-positive patients rebound
// back up over the back half of the series, resistance-negative patients stay
// near nadir with small noise.
function buildLabSeries(baseline, weeks, { nadirFactorRange, reboundFactorRange, resistant, floor }) {
  const nadirFactor = randFloat(...nadirFactorRange)
  const nadir = baseline * nadirFactor
  const n = weeks.length
  const points = weeks.map((week, i) => {
    const frac = n === 1 ? 1 : i / (n - 1)
    let value
    if (!resistant) {
      const declineFrac = Math.min(1, frac * 1.3)
      value = baseline + (nadir - baseline) * declineFrac
    } else if (frac < 0.6) {
      const declineFrac = frac / 0.6
      value = baseline + (nadir - baseline) * declineFrac
    } else {
      const reboundFrac = (frac - 0.6) / 0.4
      const reboundTarget = baseline * randFloat(...reboundFactorRange)
      value = nadir + (reboundTarget - nadir) * reboundFrac
    }
    value *= randFloat(0.95, 1.05)
    return { weeksOnTreatment: week, value: round(Math.max(value, floor), 2) }
  })
  return { points, nadir }
}

function buildInterimRECIST(bestResponse) {
  const order = ['SD', 'PR', 'CR']
  const bestIdx = order.indexOf(bestResponse)
  const n = randInt(2, 3)
  const points = []
  let week = randInt(6, 8)
  for (let i = 0; i < n; i++) {
    const idx = i === n - 1 ? bestIdx : Math.max(0, bestIdx - randInt(0, 1))
    points.push({ weeksOnTreatment: week, assessment: order[idx] })
    week += randInt(6, 8)
  }
  return points
}

// ---------------------------------------------------------------------------
// Patient generation
// ---------------------------------------------------------------------------
function generatePatient(index) {
  const patientId = `PDAC-${String(index + 1).padStart(3, '0')}`

  const doseBand = doseBands[index]
  const pretreatmentTP53Status = tp53Statuses[index]
  const germlineBRCApathogenic = brcaFlags[index]
  const brcaGene = germlineBRCApathogenic ? (bernoulli(0.5) ? 'BRCA1' : 'BRCA2') : null
  const baselineKrasVariant = krasVariants[index]
  const baselineVAF = round(randFloat(5, 40), 1)
  const bestResponse = bestResponses[index]
  const tissueCtdnaConcordant = concordanceFlags[index]

  const hasAcquiredResistance = resistanceFlags[index]
  const resistanceMechanism = resistanceMechanisms[index]

  let combinationStrategy = null
  if (hasAcquiredResistance) {
    if (germlineBRCApathogenic) {
      combinationStrategy = DDR_COMBO
    } else if (resistanceMechanism === 'KRASamp' && pretreatmentTP53Status === 'mutant') {
      combinationStrategy = DDR_COMBO
    } else if (resistanceMechanism === 'RTK') {
      combinationStrategy = RTK_COMBO
    } else if (resistanceMechanism === 'MAPK-RAF' || resistanceMechanism === 'NF1') {
      combinationStrategy = RASON_COMBO
    } else {
      combinationStrategy = UNDER_INVESTIGATION
    }
  }

  let eotVAF
  if (!hasAcquiredResistance) {
    eotVAF = round(randFloat(0, 5), 2)
  } else if (resistanceMechanism === 'KRASamp') {
    eotVAF = round(baselineVAF * randFloat(0.9, 2.3), 2)
  } else {
    eotVAF = round(randFloat(8, 30), 2)
  }

  // --- clinical layer ---
  const ecogBaseline = weightedChoice([
    { value: 0, p: 0.55 },
    { value: 1, p: 0.45 },
  ])
  const weightKg = round(clamp(randNormal(75, 14), 45, 130), 1)
  const numMetSites = weightedChoice([
    { value: 1, p: 0.3 },
    { value: 2, p: 0.45 },
    { value: 3, p: 0.25 },
  ])
  const metastaticSitesBaseline = sampleWithoutReplacement(METASTATIC_SITES, numMetSites)

  const toxicityCount = weightedChoice([
    { value: 0, p: 0.2 },
    { value: 1, p: 0.5 },
    { value: 2, p: 0.3 },
  ])
  const toxicityProfile = sampleWithoutReplacement(TOXICITY_TERMS, toxicityCount).map((term) => ({
    term,
    grade: weightedChoice([
      { value: 1, p: 0.5 },
      { value: 2, p: 0.35 },
      { value: 3, p: 0.15 },
    ]),
  }))
  const ecogDrift = weightedChoice([
    { value: 0, p: 0.8 },
    { value: 1, p: 0.15 },
    { value: -1, p: 0.05 },
  ])
  const performanceStatusMidTreatment = clamp(ecogBaseline + ecogDrift, 0, 3)

  const eotEcogBump = bernoulli(hasAcquiredResistance ? 0.45 : 0.15) ? 1 : 0
  const performanceStatusEOT = clamp(performanceStatusMidTreatment + eotEcogBump, 0, 3)

  const newMetastaticSites = newMetastaticSitesFlags[index]

  // --- imaging layer ---
  const numLesions = randInt(2, 4)
  const targetLesions = Array.from({ length: numLesions }, (_, i) => ({
    lesionId: `L${i + 1}`,
    longestDiameterMm: round(randFloat(10, 55), 1),
  }))
  const sumOfDiametersMm = round(
    targetLesions.reduce((sum, lesion) => sum + lesion.longestDiameterMm, 0),
    1,
  )

  const interimRECIST = buildInterimRECIST(bestResponse)

  const newLesionAgreesWithClinical = bernoulli(0.9)
  const newLesionDetected = newLesionAgreesWithClinical ? newMetastaticSites : !newMetastaticSites

  // --- laboratory layer ---
  const ca199Baseline = round(clamp(Math.exp(randNormal(5.5, 1.0)), 35, 5000), 1)
  const nlrBaseline = round(clamp(randNormal(4.2, 1.4), 1.0, 12.0), 2)
  const liverElevatedP = metastaticSitesBaseline.includes('liver') ? 0.6 : 0.15
  const liverFunction = bernoulli(liverElevatedP) ? 'mildly elevated' : 'normal'

  const numLabPoints = randInt(2, 4)
  const visitWeeks = buildVisitWeeks(numLabPoints)
  const ca199SeriesResult = buildLabSeries(ca199Baseline, visitWeeks, {
    nadirFactorRange: [0.15, 0.45],
    reboundFactorRange: [0.5, 1.3],
    resistant: hasAcquiredResistance,
    floor: 5,
  })
  const nlrSeriesResult = buildLabSeries(nlrBaseline, visitWeeks, {
    nadirFactorRange: [0.55, 0.85],
    reboundFactorRange: [0.7, 1.2],
    resistant: hasAcquiredResistance,
    floor: 0.5,
  })

  const ca199ProgressionMultiplier = hasAcquiredResistance ? randFloat(2.5, 5.5) : randFloat(1.3, 2.2)
  const ca199AtProgression = round(
    clamp(ca199SeriesResult.nadir * ca199ProgressionMultiplier, 35, 20000),
    1,
  )
  const nlrProgressionMultiplier = hasAcquiredResistance ? randFloat(1.6, 2.8) : randFloat(1.1, 1.6)
  const nlrAtProgression = round(clamp(nlrSeriesResult.nadir * nlrProgressionMultiplier, 1, 20), 2)

  return {
    patientId,
    doseBand,
    bestResponse,
    hasAcquiredResistance,
    resistanceMechanism,
    combinationStrategy,
    genomics: {
      baseline: {
        germlineDNA: {
          brca1Brca2PathogenicVariant: germlineBRCApathogenic,
          gene: brcaGene,
        },
        diagnosticBiopsyNGS: {
          baselineKrasVariant,
          baselineVAF,
          pretreatmentTP53Status,
        },
      },
      midTreatment: {
        serialCtDNA: {
          weeksOnTreatment: randInt(4, 8),
          vaf: round(randFloat(0, 3), 2),
        },
      },
      progression: {
        repeatBiopsyNGS: {
          hasAcquiredResistance,
          resistanceMechanism,
          tissueCtdnaConcordant,
          eotVAF,
        },
      },
    },
    clinical: {
      baseline: {
        ecog: ecogBaseline,
        weightKg,
        metastaticSitesBaseline,
      },
      midTreatment: {
        toxicityProfile,
        performanceStatusMidTreatment,
      },
      progression: {
        performanceStatusEOT,
        newMetastaticSites,
      },
    },
    imaging: {
      baseline: {
        targetLesions,
        sumOfDiametersMm,
      },
      midTreatment: {
        interimRECIST,
      },
      progression: {
        confirmationScan: {
          assessment: 'PD',
          newLesionDetected,
        },
      },
    },
    laboratory: {
      baseline: {
        ca199: ca199Baseline,
        nlr: nlrBaseline,
        liverFunction,
      },
      midTreatment: {
        ca199Series: ca199SeriesResult.points,
        nlrSeries: nlrSeriesResult.points,
      },
      progression: {
        ca199AtProgression,
        nlrAtProgression,
      },
    },
  }
}

const cohort = Array.from({ length: N_PATIENTS }, (_, i) => generatePatient(i))

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(cohort, null, 2))
console.log(`Wrote ${cohort.length} patient records to ${OUTPUT_PATH}\n`)

// ---------------------------------------------------------------------------
// Summary statistics, for sanity-checking the generated cohort
// ---------------------------------------------------------------------------
function pct(n, d) {
  return d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(1)}%`
}

function pearsonCorrelation(xs, ys) {
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let dx2 = 0
  let dy2 = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx
    const dy = ys[i] - my
    num += dx * dy
    dx2 += dx * dx
    dy2 += dy * dy
  }
  const denom = Math.sqrt(dx2 * dy2)
  return denom === 0 ? 0 : num / denom
}

const resistant = cohort.filter((p) => p.hasAcquiredResistance)
const nonResistant = cohort.filter((p) => !p.hasAcquiredResistance)

console.log('=== Cohort summary ===')
console.log(`Total patients: ${cohort.length}`)
console.log(`Resistance rate: ${resistant.length}/${cohort.length} (${pct(resistant.length, cohort.length)})`)

console.log('\nMechanism breakdown (of resistance-positive patients):')
const mechCounts = {}
for (const p of resistant) mechCounts[p.resistanceMechanism] = (mechCounts[p.resistanceMechanism] || 0) + 1
for (const cat of ['KRASamp', 'MAPK-RAF', 'RTK', 'PI3K']) {
  const n = mechCounts[cat] || 0
  console.log(`  ${cat}: ${n}/${resistant.length} (${pct(n, resistant.length)})`)
}
const otherGenes = ['NF1', 'KEAP1', 'MYC', 'PTPN11']
const otherTotal = otherGenes.reduce((sum, g) => sum + (mechCounts[g] || 0), 0)
console.log(`  other (NF1/KEAP1/MYC/PTPN11): ${otherTotal}/${resistant.length} (${pct(otherTotal, resistant.length)})`)
for (const g of otherGenes) if (mechCounts[g]) console.log(`    - ${g}: ${mechCounts[g]}`)

console.log('\nTP53 / KRASamp association:')
const tp53mut = cohort.filter((p) => p.genomics.baseline.diagnosticBiopsyNGS.pretreatmentTP53Status === 'mutant')
const tp53wt = cohort.filter((p) => p.genomics.baseline.diagnosticBiopsyNGS.pretreatmentTP53Status === 'wild-type')
const krasampAmongMut = tp53mut.filter((p) => p.resistanceMechanism === 'KRASamp').length
const krasampAmongWt = tp53wt.filter((p) => p.resistanceMechanism === 'KRASamp').length
console.log(`  TP53-mutant -> KRASamp: ${krasampAmongMut}/${tp53mut.length} (${pct(krasampAmongMut, tp53mut.length)})`)
console.log(`  TP53-wild-type -> KRASamp: ${krasampAmongWt}/${tp53wt.length} (${pct(krasampAmongWt, tp53wt.length)})`)

console.log('\nDose-band resistance rates:')
for (const band of ['160-300mg', '≤120mg']) {
  const group = cohort.filter((p) => p.doseBand === band)
  const resistantInGroup = group.filter((p) => p.hasAcquiredResistance).length
  console.log(`  ${band}: ${resistantInGroup}/${group.length} (${pct(resistantInGroup, group.length)})`)
}

console.log('\nTissue/ctDNA concordance:')
const concordant = cohort.filter((p) => p.genomics.progression.repeatBiopsyNGS.tissueCtdnaConcordant).length
console.log(`  ${concordant}/${cohort.length} (${pct(concordant, cohort.length)})`)

console.log('\nhasAcquiredResistance vs newMetastaticSites:')
const nmsRate = (arr) => pct(arr.filter((p) => p.clinical.progression.newMetastaticSites).length, arr.length)
console.log(`  Resistance-positive: ${nmsRate(resistant)} have new metastatic sites`)
console.log(`  Resistance-negative: ${nmsRate(nonResistant)} have new metastatic sites`)
const xs = cohort.map((p) => (p.hasAcquiredResistance ? 1 : 0))
const ys = cohort.map((p) => (p.clinical.progression.newMetastaticSites ? 1 : 0))
console.log(`  Pearson correlation (phi coefficient): ${pearsonCorrelation(xs, ys).toFixed(3)}`)
