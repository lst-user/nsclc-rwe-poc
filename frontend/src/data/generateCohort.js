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
// PPIA (cyclophilin A, required for daraxonrasib tri-complex formation) is a
// non-panel gene: only high-depth WES/WGS can call it, never the standard
// 800-gene tissue/ctDNA panel, so it's deliberately rare.
const OTHER_MECHANISM_WEIGHTS = [
  { value: 'MAPK-RAF', p: 5 },
  { value: 'RTK', p: 4 },
  { value: 'PI3K', p: 4 },
  { value: 'PPIA', p: 2 },
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

// Fresh-frozen tissue (paired with FFPE) is required for high-depth WES/WGS
// and single-cell RNA-seq; realistic attrition, worse at progression biopsy.
const FRESH_FROZEN_COLLECTED_BASELINE_P = 0.88
const FRESH_FROZEN_COLLECTED_PROGRESSION_P = 0.75
const DEEP_SEQ_ASSAY_WEIGHTS = [
  { value: 'WES', p: 0.8 },
  { value: 'WGS', p: 0.2 },
]

// Lineage-shift rate (single-cell RNA-seq dominant state + ATAC-seq/methylation
// reprogramming), by resistance-mechanism class: epigenetic/lineage-plasticity
// resistance is far more associated with non-RAS-reactivation mechanisms than
// with direct genetic RAS-pathway reactivation (KRASamp/MAPK-RAF).
const LINEAGE_SHIFT_RATE_NEGATIVE = 0.05
const LINEAGE_SHIFT_RATE_RAS_REACTIVATION = 0.15
const LINEAGE_SHIFT_RATE_NON_RAS_MECHANISM = 0.45

// Reactivation ranges for MAPK-pathway-output markers (DUSP6 RNA, pERK IHC,
// pERK/pMEK/pCDK1 Western blot): suppressed on-treatment, then rebounding
// strongly at progression for KRASamp/MAPK-RAF (direct pathway reactivation),
// mildly for other resistant mechanisms, and staying low if not resistant.
const DUSP6_RANGES = { suppressed: [0.05, 0.25], reboundStrong: [1.3, 2.6], reboundMild: [0.3, 0.8], reboundNone: [0.1, 0.4] }
const PERK_IHC_RANGES = { suppressed: [0.15, 0.35], reboundStrong: [1.1, 1.7], reboundMild: [0.4, 0.85], reboundNone: [0.2, 0.45] }
const PERK_WB_RANGES = { suppressed: [0.1, 0.3], reboundStrong: [1.8, 3.2], reboundMild: [0.5, 1.1], reboundNone: [0.15, 0.45] }
const PMEK_WB_RANGES = { suppressed: [0.15, 0.35], reboundStrong: [1.6, 2.8], reboundMild: [0.5, 1.1], reboundNone: [0.2, 0.5] }
const PCDK1_WB_RANGES = { suppressed: [0.2, 0.45], reboundStrong: [1.4, 2.4], reboundMild: [0.55, 1.15], reboundNone: [0.3, 0.65] }

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

// Lineage shift (single-cell RNA-seq + ATAC-seq/methylation), by mechanism class.
const mechanismClassKeys = Array.from({ length: N_PATIENTS }, (_, i) => {
  if (!resistanceFlags[i]) return 'negative'
  return resistanceMechanisms[i] === 'KRASamp' || resistanceMechanisms[i] === 'MAPK-RAF'
    ? 'ras-reactivation'
    : 'non-ras-mechanism'
})
const lineageShiftFlags = assignStratifiedBoolean(mechanismClassKeys, {
  negative: LINEAGE_SHIFT_RATE_NEGATIVE,
  'ras-reactivation': LINEAGE_SHIFT_RATE_RAS_REACTIVATION,
  'non-ras-mechanism': LINEAGE_SHIFT_RATE_NON_RAS_MECHANISM,
})

// Fresh-frozen tissue availability gates WES/WGS and single-cell RNA-seq.
const freshFrozenCollectedBaseline = quotaAssign(N_PATIENTS, [
  { value: true, p: FRESH_FROZEN_COLLECTED_BASELINE_P },
  { value: false, p: 1 - FRESH_FROZEN_COLLECTED_BASELINE_P },
])
const freshFrozenCollectedProgression = quotaAssign(N_PATIENTS, [
  { value: true, p: FRESH_FROZEN_COLLECTED_PROGRESSION_P },
  { value: false, p: 1 - FRESH_FROZEN_COLLECTED_PROGRESSION_P },
])
// A PPIA call is by construction a WES finding, so those patients must have
// had sufficient progression material — otherwise the mechanism could never
// have been identified in the first place.
resistanceMechanisms.forEach((mechanism, i) => {
  if (mechanism === 'PPIA') freshFrozenCollectedProgression[i] = true
})
const deepSeqAssayBaseline = quotaAssign(N_PATIENTS, DEEP_SEQ_ASSAY_WEIGHTS)
const deepSeqAssayProgression = quotaAssign(N_PATIENTS, DEEP_SEQ_ASSAY_WEIGHTS)

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
// Pathway-reactivation / marker helpers (DUSP6, pERK IHC, phospho-Western blot)
// ---------------------------------------------------------------------------
function pathwayFoldChange(timepoint, hasAcquiredResistance, resistanceMechanism, ranges) {
  if (timepoint === 'midTreatment') return randFloat(...ranges.suppressed)
  if (!hasAcquiredResistance) return randFloat(...ranges.reboundNone)
  const strong = resistanceMechanism === 'KRASamp' || resistanceMechanism === 'MAPK-RAF'
  return randFloat(...(strong ? ranges.reboundStrong : ranges.reboundMild))
}

function gammaH2AXFoldChange(timepoint, isDdrComboEligible) {
  if (timepoint === 'midTreatment') return round(randFloat(0.8, 1.4), 2)
  return round(isDdrComboEligible ? randFloat(1.8, 3.5) : randFloat(0.7, 1.5), 2)
}

function buildDeepSequencing(assay, feasible, extra) {
  if (!feasible) return null
  const meanDepthX = assay === 'WES' ? round(randFloat(300, 600), 0) : round(randFloat(60, 120), 0)
  return { assay, meanDepthX, ...extra }
}

// Distributes the remaining share across the two non-dominant lineage states.
function lineageComposition(dominantKey) {
  const majority = randFloat(55, 80)
  const remainder = 100 - majority
  const split = randFloat(0.3, 0.7)
  const others = ['classicalPct', 'basalLikePct', 'mesenchymalPct'].filter((k) => k !== dominantKey)
  return {
    [dominantKey]: round(majority, 1),
    [others[0]]: round(remainder * split, 1),
    [others[1]]: round(remainder * (1 - split), 1),
  }
}

const LINEAGE_STATE_KEYS = {
  classical: 'classicalPct',
  'basal-like/squamoid': 'basalLikePct',
  'mesenchymal-like': 'mesenchymalPct',
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

  // PPIA is not on the standard 800-gene panel: the tissue/ctDNA panel call
  // comes back with no reportable alteration, and only high-depth WES/WGS
  // recovers the true mechanism.
  const isPanelMiss = resistanceMechanism === 'PPIA'
  const panelResistanceMechanism = isPanelMiss ? null : resistanceMechanism
  const resistanceMechanismSource = !hasAcquiredResistance
    ? null
    : isPanelMiss
      ? 'high-depth WES/WGS (non-panel gene)'
      : 'tissue/ctDNA NGS panel'

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

  // --- biospecimens (paired FFPE / fresh-frozen) ---
  const ffCollectedBaseline = freshFrozenCollectedBaseline[index]
  const ffCollectedProgression = freshFrozenCollectedProgression[index]
  const biopsySitePool = [
    { value: 'pancreas (primary)', p: 0.55 },
    ...metastaticSitesBaseline.map((site) => ({ value: site, p: 0.45 / metastaticSitesBaseline.length })),
  ]

  // --- deep sequencing (WES/WGS), gated on fresh-frozen availability ---
  const deepSequencingBaseline = buildDeepSequencing(deepSeqAssayBaseline[index], ffCollectedBaseline, {
    tumorMutationalBurdenPerMb: round(randFloat(0.5, 4.5), 2),
  })
  const deepSequencingProgression = buildDeepSequencing(deepSeqAssayProgression[index], ffCollectedProgression, {
    nonPanelAlterationDetected: isPanelMiss,
    nonPanelAlterationGene: isPanelMiss ? 'PPIA' : null,
    nonPanelAlterationDetail: isPanelMiss
      ? 'PPIA splice-site deletion disrupting cyclophilin A tri-complex formation (absent from 800-gene panel)'
      : null,
  })

  // --- transcriptomics (bulk RNA-seq always available; scRNA-seq gated) ---
  const dusp6Baseline = round(randFloat(15, 150), 1)
  const lineageShift = lineageShiftFlags[index]
  const baselineDominantLineage = bernoulli(0.92)
    ? 'classical'
    : weightedChoice([
        { value: 'basal-like/squamoid', p: 0.6 },
        { value: 'mesenchymal-like', p: 0.4 },
      ])
  const progressionDominantLineage = lineageShift
    ? weightedChoice([
        { value: 'basal-like/squamoid', p: 0.6 },
        { value: 'mesenchymal-like', p: 0.4 },
      ])
    : baselineDominantLineage

  // --- epigenomics (ATAC-seq / methylation), cross-validates the lineage shift ---
  const epigenomicsAssay = weightedChoice([
    { value: 'ATAC-seq', p: 0.6 },
    { value: 'genome-wide methylation array', p: 0.4 },
  ])
  const chromatinShiftScoreProgression = round(lineageShift ? randFloat(0.55, 0.9) : randFloat(0.05, 0.35), 2)
  const topDifferentialLocus = lineageShift
    ? weightedChoice([
        { value: 'GATA6 promoter (loss of accessibility)', p: 1 },
        { value: 'KRT17 / basal-program enhancer (gain of accessibility)', p: 1 },
        { value: 'HNF4A locus (loss of accessibility)', p: 1 },
      ])
    : null

  // --- flow cytometry (HER2 surface upregulation, especially RTK mechanism) ---
  const her2MfiBaseline = round(randFloat(400, 3500), 1)
  const her2MfiProgression = round(
    her2MfiBaseline * (resistanceMechanism === 'RTK' ? randFloat(2.5, 5.0) : randFloat(0.8, 1.8)),
    1,
  )

  // --- digital pathology (quantitative pERK IHC) ---
  const perkIhcBaseline = round(randFloat(35, 75), 1)

  // --- phospho-proteomics (Western blot) ---
  const isDdrComboEligible = combinationStrategy === DDR_COMBO

  return {
    patientId,
    doseBand,
    bestResponse,
    hasAcquiredResistance,
    resistanceMechanism,
    resistanceMechanismSource,
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
          resistanceMechanism: panelResistanceMechanism,
          tissueCtdnaConcordant,
          eotVAF,
        },
      },
    },
    biospecimens: {
      baseline: {
        ffpeCollected: true,
        freshFrozenCollected: ffCollectedBaseline,
        tumorContentPct: round(randFloat(15, 55), 1),
        collectionSite: weightedChoice(biopsySitePool),
      },
      progression: {
        ffpeCollected: true,
        freshFrozenCollected: ffCollectedProgression,
        tumorContentPct: round(randFloat(15, 55), 1),
        collectionSite: weightedChoice(biopsySitePool),
      },
    },
    deepSequencing: {
      baseline: deepSequencingBaseline,
      progression: deepSequencingProgression,
    },
    transcriptomics: {
      baseline: {
        bulkRNAseq: { assay: 'Salmon quasi-mapping (bulk RNA-seq)', dusp6Tpm: dusp6Baseline },
        singleCellRNAseq: ffCollectedBaseline
          ? {
              assay: 'scRNA-seq (10x Genomics)',
              dominantLineageState: baselineDominantLineage,
              cellStateComposition: lineageComposition(LINEAGE_STATE_KEYS[baselineDominantLineage]),
            }
          : null,
      },
      midTreatment: {
        bulkRNAseq: {
          dusp6Tpm: round(
            dusp6Baseline * pathwayFoldChange('midTreatment', hasAcquiredResistance, resistanceMechanism, DUSP6_RANGES),
            1,
          ),
        },
      },
      progression: {
        bulkRNAseq: {
          dusp6Tpm: round(
            dusp6Baseline * pathwayFoldChange('progression', hasAcquiredResistance, resistanceMechanism, DUSP6_RANGES),
            1,
          ),
        },
        singleCellRNAseq: ffCollectedProgression
          ? {
              assay: 'scRNA-seq (10x Genomics)',
              dominantLineageState: progressionDominantLineage,
              cellStateComposition: lineageComposition(LINEAGE_STATE_KEYS[progressionDominantLineage]),
              lineageShiftFromBaseline: lineageShift,
            }
          : null,
      },
    },
    epigenomics: {
      baseline: {
        assay: epigenomicsAssay,
        chromatinAccessibilityShiftScore: round(randFloat(0.05, 0.35), 2),
      },
      progression: {
        assay: epigenomicsAssay,
        epigeneticReprogrammingDetected: lineageShift,
        chromatinAccessibilityShiftScore: chromatinShiftScoreProgression,
        topDifferentialLocus,
      },
    },
    flowCytometry: {
      baseline: { assay: 'Flow cytometry (Alexa Fluor 647–HER2)', her2MFI: her2MfiBaseline },
      midTreatment: { her2MFI: round(her2MfiBaseline * randFloat(0.9, 1.6), 1) },
      progression: {
        her2MFI: her2MfiProgression,
        her2Upregulated: her2MfiProgression > her2MfiBaseline * 2,
      },
    },
    digitalPathology: {
      baseline: {
        assay: 'Automated quantitative IHC (HALO random forest classifier)',
        pERKPositivityPctEpithelial: perkIhcBaseline,
        classifierConfidence: round(randFloat(0.85, 0.99), 2),
      },
      midTreatment: {
        pERKPositivityPctEpithelial: round(
          clamp(
            perkIhcBaseline * pathwayFoldChange('midTreatment', hasAcquiredResistance, resistanceMechanism, PERK_IHC_RANGES),
            0,
            100,
          ),
          1,
        ),
        classifierConfidence: round(randFloat(0.85, 0.99), 2),
      },
      progression: {
        pERKPositivityPctEpithelial: round(
          clamp(
            perkIhcBaseline * pathwayFoldChange('progression', hasAcquiredResistance, resistanceMechanism, PERK_IHC_RANGES),
            0,
            100,
          ),
          1,
        ),
        classifierConfidence: round(randFloat(0.85, 0.99), 2),
      },
    },
    phosphoproteomics: {
      midTreatment: {
        assay: 'Western blot / phospho-RPPA',
        pERKFoldChangeVsBaseline: round(
          pathwayFoldChange('midTreatment', hasAcquiredResistance, resistanceMechanism, PERK_WB_RANGES),
          2,
        ),
        pMEKFoldChangeVsBaseline: round(
          pathwayFoldChange('midTreatment', hasAcquiredResistance, resistanceMechanism, PMEK_WB_RANGES),
          2,
        ),
        pCDK1FoldChangeVsBaseline: round(
          pathwayFoldChange('midTreatment', hasAcquiredResistance, resistanceMechanism, PCDK1_WB_RANGES),
          2,
        ),
        gammaH2AXFoldChangeVsBaseline: gammaH2AXFoldChange('midTreatment', isDdrComboEligible),
      },
      progression: {
        pERKFoldChangeVsBaseline: round(
          pathwayFoldChange('progression', hasAcquiredResistance, resistanceMechanism, PERK_WB_RANGES),
          2,
        ),
        pMEKFoldChangeVsBaseline: round(
          pathwayFoldChange('progression', hasAcquiredResistance, resistanceMechanism, PMEK_WB_RANGES),
          2,
        ),
        pCDK1FoldChangeVsBaseline: round(
          pathwayFoldChange('progression', hasAcquiredResistance, resistanceMechanism, PCDK1_WB_RANGES),
          2,
        ),
        gammaH2AXFoldChangeVsBaseline: gammaH2AXFoldChange('progression', isDdrComboEligible),
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
console.log(`  PPIA (non-panel, WES/WGS-only): ${mechCounts.PPIA || 0}/${resistant.length} (${pct(mechCounts.PPIA || 0, resistant.length)})`)
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

console.log('\nNew data-type checks:')
const ppiaPatients = resistant.filter((p) => p.resistanceMechanism === 'PPIA')
console.log(
  `  PPIA (panel-missed, WES/WGS-only) mechanism: ${ppiaPatients.length}/${resistant.length} resistant patients` +
    ` — panel call null for all: ${ppiaPatients.every((p) => p.genomics.progression.repeatBiopsyNGS.resistanceMechanism === null)}`,
)
const rtkPatients = resistant.filter((p) => p.resistanceMechanism === 'RTK')
const her2UpRate = (arr) => pct(arr.filter((p) => p.flowCytometry.progression.her2Upregulated).length, arr.length)
console.log(`  HER2 upregulation (flow MFI > 2x baseline) among RTK-mechanism patients: ${her2UpRate(rtkPatients)}`)
console.log(`  HER2 upregulation among all other patients: ${her2UpRate(cohort.filter((p) => !rtkPatients.includes(p)))}`)
// Ground truth (set by quota, unaffected by scRNA-seq missingness) vs what a
// real analysis would observe once fresh-frozen tissue availability is factored in.
for (const group of ['negative', 'ras-reactivation', 'non-ras-mechanism']) {
  const groundTruthIdx = mechanismClassKeys.map((g, i) => (g === group ? i : -1)).filter((i) => i >= 0)
  const groundTruthRate = pct(groundTruthIdx.filter((i) => lineageShiftFlags[i]).length, groundTruthIdx.length)
  const withScRnaSeq = groundTruthIdx
    .map((i) => cohort[i])
    .filter((p) => p.transcriptomics.progression.singleCellRNAseq)
  const observedRate = pct(
    withScRnaSeq.filter((p) => p.transcriptomics.progression.singleCellRNAseq.lineageShiftFromBaseline).length,
    withScRnaSeq.length,
  )
  console.log(
    `  Lineage shift rate — ${group}: ${groundTruthRate} ground truth, ${observedRate} observed (${withScRnaSeq.length}/${groundTruthIdx.length} had scRNA-seq data)`,
  )
}
const ffAvailable = (arr, timepoint) => pct(arr.filter((p) => p.biospecimens[timepoint].freshFrozenCollected).length, arr.length)
console.log(`  Fresh-frozen tissue available — baseline: ${ffAvailable(cohort, 'baseline')}, progression: ${ffAvailable(cohort, 'progression')}`)
