// JSDoc type definitions for a patient record in cohort.json, as produced by
// generateCohort.js. This project is plain JS (no TypeScript/tsconfig), so
// these are documentation/editor-hint types only — reference them from other
// files with `@type {import('./types.js').Patient}`.
//
// Schema shape: 11 data layers (Genomics, Biospecimens, Deep Sequencing,
// Transcriptomics, Epigenomics, Flow Cytometry, Digital Pathology,
// Phospho-proteomics, Clinical, Imaging, Laboratory) × up to 3 timepoints
// each (baseline, midTreatment, progression). Every {layer}.{timepoint}
// object carries a `date` (ISO 8601 `YYYY-MM-DD`); events with their own
// distinct schedule (e.g. a lab series, ctDNA's earlier on-treatment sample)
// also carry their own `weeksOnTreatment` (relative to daraxonrasibStartDate).
// A layer/timepoint that requires fresh-frozen tissue is `null` when that
// tissue wasn't collected (see Biospecimens) rather than omitted.

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

/** @typedef {'160-300mg' | '≤120mg'} DoseBand */
/** @typedef {'CR' | 'PR' | 'SD'} BestResponse */
/** @typedef {'KRASamp' | 'MAPK-RAF' | 'RTK' | 'PI3K' | 'PPIA' | 'NF1' | 'KEAP1' | 'MYC' | 'PTPN11'} ResistanceMechanism */
/** @typedef {'tissue/ctDNA NGS panel' | 'high-depth WES/WGS (non-panel gene)'} ResistanceMechanismSource */
/** @typedef {'liver' | 'lung' | 'peritoneum' | 'lymph nodes'} MetastaticSite */
/** @typedef {'pancreas (primary)' | MetastaticSite} BiopsySite */
/** @typedef {'mutant' | 'wild-type'} Tp53Status */
/** @typedef {'G12D' | 'G12V' | 'G12C' | 'G12R' | 'Q61H' | 'other'} KrasVariant */
/** @typedef {'BRCA1' | 'BRCA2'} BrcaGene */
/** @typedef {'fatigue' | 'rash' | 'diarrhea' | 'nausea'} ToxicityTerm */
/** @typedef {1 | 2 | 3} ToxicityGrade */
/** @typedef {'SD' | 'PR' | 'CR'} RecistAssessment */
/** @typedef {'normal' | 'mildly elevated'} LiverFunction */
/** @typedef {'WES' | 'WGS'} SequencingAssay */
/** @typedef {'ATAC-seq' | 'genome-wide methylation array'} EpigenomicsAssay */
/** @typedef {'classical' | 'basal-like/squamoid' | 'mesenchymal-like'} LineageState */
/** @typedef {2 | 3 | 4} LineOfTherapy 4 means "4th line or later" */
/**
 * @typedef {'FOLFIRINOX' | 'Gemcitabine + nab-paclitaxel' | 'NALIRIFOX' |
 *   'Gemcitabine monotherapy' | '5-FU/leucovorin + liposomal irinotecan'} PriorRegimen
 */

// ---------------------------------------------------------------------------
// Genomics: germline/diagnostic NGS -> serial ctDNA -> repeat biopsy NGS
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} GermlineDNA
 * @property {boolean} brca1Brca2PathogenicVariant
 * @property {BrcaGene | null} gene
 */

/**
 * @typedef {Object} DiagnosticBiopsyNGS
 * @property {KrasVariant} baselineKrasVariant
 * @property {number} baselineVAF - Percent variant allele fraction at diagnosis.
 * @property {Tp53Status} pretreatmentTP53Status
 */

/**
 * @typedef {Object} GenomicsBaseline
 * @property {string} date
 * @property {GermlineDNA} germlineDNA
 * @property {DiagnosticBiopsyNGS} diagnosticBiopsyNGS
 */

/**
 * @typedef {Object} SerialCtDNA
 * @property {number} weeksOnTreatment
 * @property {string} date
 * @property {number} vaf - Percent VAF, early on-treatment (deep response expected).
 */

/**
 * @typedef {Object} GenomicsMidTreatment
 * @property {string} date - Matches serialCtDNA.date (its own early schedule).
 * @property {SerialCtDNA} serialCtDNA
 */

/**
 * @typedef {Object} RepeatBiopsyNGS
 * @property {boolean} hasAcquiredResistance
 * @property {ResistanceMechanism | null} resistanceMechanism - Null when the
 *   mechanism is a panel miss (see Patient.resistanceMechanismSource): the
 *   standard 800-gene tissue/ctDNA panel found no reportable alteration even
 *   though a mechanism was later identified by deep sequencing (PPIA).
 * @property {boolean} tissueCtdnaConcordant
 * @property {number} eotVAF - Percent VAF at end of treatment/progression.
 */

/**
 * @typedef {Object} GenomicsProgression
 * @property {string} date
 * @property {RepeatBiopsyNGS} repeatBiopsyNGS
 */

/**
 * @typedef {Object} Genomics
 * @property {GenomicsBaseline} baseline
 * @property {GenomicsMidTreatment} midTreatment
 * @property {GenomicsProgression} progression
 */

// ---------------------------------------------------------------------------
// Biospecimens: paired FFPE / fresh-frozen collection
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} BiospecimenRecord
 * @property {string} date
 * @property {true} ffpeCollected - Always true; FFPE is essentially universal.
 * @property {boolean} freshFrozenCollected - Gates WES/WGS and single-cell
 *   RNA-seq for this timepoint (null there when false).
 * @property {number} tumorContentPct
 * @property {BiopsySite} collectionSite
 */

/**
 * @typedef {Object} Biospecimens
 * @property {BiospecimenRecord} baseline
 * @property {BiospecimenRecord} progression
 */

// ---------------------------------------------------------------------------
// Deep sequencing (WES/WGS) - null when fresh-frozen tissue wasn't collected
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} DeepSequencingBaseline
 * @property {string} date
 * @property {SequencingAssay} assay
 * @property {number} meanDepthX
 * @property {number} tumorMutationalBurdenPerMb
 */

/**
 * @typedef {Object} DeepSequencingProgression
 * @property {string} date
 * @property {SequencingAssay} assay
 * @property {number} meanDepthX
 * @property {boolean} nonPanelAlterationDetected - True only for PPIA cases.
 * @property {'PPIA' | null} nonPanelAlterationGene
 * @property {string | null} nonPanelAlterationDetail
 */

/**
 * @typedef {Object} DeepSequencing
 * @property {DeepSequencingBaseline | null} baseline
 * @property {DeepSequencingProgression | null} progression
 */

// ---------------------------------------------------------------------------
// Transcriptomics: bulk RNA-seq (always) + single-cell RNA-seq (gated)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} CellStateComposition
 * @property {number} classicalPct
 * @property {number} basalLikePct
 * @property {number} mesenchymalPct
 */

/**
 * @typedef {Object} SingleCellRNAseqBaseline
 * @property {'scRNA-seq (10x Genomics)'} assay
 * @property {LineageState} dominantLineageState
 * @property {CellStateComposition} cellStateComposition
 */

/**
 * @typedef {Object} SingleCellRNAseqProgression
 * @property {'scRNA-seq (10x Genomics)'} assay
 * @property {LineageState} dominantLineageState
 * @property {CellStateComposition} cellStateComposition
 * @property {boolean} lineageShiftFromBaseline
 */

/**
 * @typedef {Object} TranscriptomicsBaseline
 * @property {string} date
 * @property {{ assay: 'Salmon quasi-mapping (bulk RNA-seq)', dusp6Tpm: number }} bulkRNAseq
 * @property {SingleCellRNAseqBaseline | null} singleCellRNAseq
 */

/**
 * @typedef {Object} TranscriptomicsMidTreatment
 * @property {string} date
 * @property {number} weeksOnTreatment
 * @property {{ dusp6Tpm: number }} bulkRNAseq
 */

/**
 * @typedef {Object} TranscriptomicsProgression
 * @property {string} date
 * @property {{ dusp6Tpm: number }} bulkRNAseq
 * @property {SingleCellRNAseqProgression | null} singleCellRNAseq
 */

/**
 * @typedef {Object} Transcriptomics
 * @property {TranscriptomicsBaseline} baseline
 * @property {TranscriptomicsMidTreatment} midTreatment
 * @property {TranscriptomicsProgression} progression
 */

// ---------------------------------------------------------------------------
// Epigenomics: ATAC-seq / methylation array (baseline + progression only)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} EpigenomicsBaseline
 * @property {string} date
 * @property {EpigenomicsAssay} assay
 * @property {number} chromatinAccessibilityShiftScore - 0-1, noise-floor at baseline.
 */

/**
 * @typedef {Object} EpigenomicsProgression
 * @property {string} date
 * @property {EpigenomicsAssay} assay
 * @property {boolean} epigeneticReprogrammingDetected - Mirrors
 *   transcriptomics' lineageShiftFromBaseline (same underlying biology,
 *   cross-validated across two assay modalities).
 * @property {number} chromatinAccessibilityShiftScore - 0-1.
 * @property {string | null} topDifferentialLocus
 */

/**
 * @typedef {Object} Epigenomics
 * @property {EpigenomicsBaseline} baseline
 * @property {EpigenomicsProgression} progression
 */

// ---------------------------------------------------------------------------
// Flow cytometry: HER2 (Alexa Fluor 647) MFI
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} FlowCytometry
 * @property {{ date: string, assay: 'Flow cytometry (Alexa Fluor 647–HER2)', her2MFI: number }} baseline
 * @property {{ date: string, weeksOnTreatment: number, her2MFI: number }} midTreatment
 * @property {{ date: string, her2MFI: number, her2Upregulated: boolean }} progression
 */

// ---------------------------------------------------------------------------
// Digital pathology: quantitative pERK IHC (HALO classifier)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} DigitalPathologyBaseline
 * @property {string} date
 * @property {'Automated quantitative IHC (HALO random forest classifier)'} assay
 * @property {number} pERKPositivityPctEpithelial
 * @property {number} classifierConfidence - 0-1.
 */

/**
 * @typedef {Object} DigitalPathology
 * @property {DigitalPathologyBaseline} baseline
 * @property {{ date: string, weeksOnTreatment: number, pERKPositivityPctEpithelial: number, classifierConfidence: number }} midTreatment
 * @property {{ date: string, pERKPositivityPctEpithelial: number, classifierConfidence: number }} progression
 */

// ---------------------------------------------------------------------------
// Phospho-proteomics: Western blot / phospho-RPPA (no baseline; fold-change
// is expressed relative to baseline, so baseline is implicitly 1.0x)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} PhosphoproteomicsMidTreatment
 * @property {string} date
 * @property {number} weeksOnTreatment
 * @property {'Western blot / phospho-RPPA'} assay
 * @property {number} pERKFoldChangeVsBaseline
 * @property {number} pMEKFoldChangeVsBaseline
 * @property {number} pCDK1FoldChangeVsBaseline
 * @property {number} gammaH2AXFoldChangeVsBaseline - Elevated specifically
 *   for DDR-combo-eligible patients (BRCA-mutant or KRASamp+TP53-mutant).
 */

/**
 * @typedef {Object} PhosphoproteomicsProgression
 * @property {string} date
 * @property {number} pERKFoldChangeVsBaseline
 * @property {number} pMEKFoldChangeVsBaseline
 * @property {number} pCDK1FoldChangeVsBaseline
 * @property {number} gammaH2AXFoldChangeVsBaseline
 */

/**
 * @typedef {Object} Phosphoproteomics
 * @property {PhosphoproteomicsMidTreatment} midTreatment
 * @property {PhosphoproteomicsProgression} progression
 */

// ---------------------------------------------------------------------------
// Clinical: ECOG, weight, adverse events, new metastases
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ToxicityEvent
 * @property {ToxicityTerm} term
 * @property {ToxicityGrade} grade
 */

/**
 * @typedef {Object} ClinicalBaseline
 * @property {string} date
 * @property {0 | 1} ecog
 * @property {number} weightKg
 * @property {MetastaticSite[]} metastaticSitesBaseline - 1-3 sites.
 */

/**
 * @typedef {Object} ClinicalMidTreatment
 * @property {string} date
 * @property {number} weeksOnTreatment
 * @property {ToxicityEvent[]} toxicityProfile - 0-2 events.
 * @property {0 | 1 | 2 | 3} performanceStatusMidTreatment
 */

/**
 * @typedef {Object} ClinicalProgression
 * @property {string} date
 * @property {number} weeksOnTreatment
 * @property {0 | 1 | 2 | 3} performanceStatusEOT
 * @property {boolean} newMetastaticSites
 */

/**
 * @typedef {Object} Clinical
 * @property {ClinicalBaseline} baseline
 * @property {ClinicalMidTreatment} midTreatment
 * @property {ClinicalProgression} progression
 */

// ---------------------------------------------------------------------------
// Imaging: RECIST 1.1
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} TargetLesion
 * @property {string} lesionId - e.g. "L1".
 * @property {number} longestDiameterMm
 */

/**
 * @typedef {Object} ImagingBaseline
 * @property {string} date
 * @property {TargetLesion[]} targetLesions - 2-4 lesions.
 * @property {number} sumOfDiametersMm
 */

/**
 * @typedef {Object} RecistPoint
 * @property {number} weeksOnTreatment
 * @property {RecistAssessment} assessment
 * @property {string} date
 */

/**
 * @typedef {Object} ImagingMidTreatment
 * @property {string} date
 * @property {RecistPoint[]} interimRECIST - 2-3 assessments, trending toward Patient.bestResponse.
 */

/**
 * @typedef {Object} ImagingProgression
 * @property {string} date
 * @property {number} weeksOnTreatment
 * @property {{ assessment: 'PD', newLesionDetected: boolean }} confirmationScan
 */

/**
 * @typedef {Object} Imaging
 * @property {ImagingBaseline} baseline
 * @property {ImagingMidTreatment} midTreatment
 * @property {ImagingProgression} progression
 */

// ---------------------------------------------------------------------------
// Laboratory: CA19-9, neutrophil-lymphocyte ratio
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} LaboratoryBaseline
 * @property {string} date
 * @property {number} ca199 - U/mL.
 * @property {number} nlr
 * @property {LiverFunction} liverFunction
 */

/**
 * @typedef {Object} LabSeriesPoint
 * @property {number} weeksOnTreatment
 * @property {number} value
 * @property {string} date
 */

/**
 * @typedef {Object} LaboratoryMidTreatment
 * @property {string} date
 * @property {LabSeriesPoint[]} ca199Series - 2-4 points, same visit weeks as nlrSeries.
 * @property {LabSeriesPoint[]} nlrSeries
 */

/**
 * @typedef {Object} LaboratoryProgression
 * @property {string} date
 * @property {number} weeksOnTreatment
 * @property {number} ca199AtProgression
 * @property {number} nlrAtProgression
 */

/**
 * @typedef {Object} Laboratory
 * @property {LaboratoryBaseline} baseline
 * @property {LaboratoryMidTreatment} midTreatment
 * @property {LaboratoryProgression} progression
 */

// ---------------------------------------------------------------------------
// Patient: top-level record (one entry in cohort.json)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Patient
 * @property {string} patientId - e.g. "PDAC-001".
 * @property {LineOfTherapy} lineOfTherapy - Daraxonrasib trials enroll
 *   previously-treated PDAC, so this is always 2L or later.
 * @property {PriorRegimen[]} priorRegimens - Length = lineOfTherapy - 1.
 * @property {string} enrollmentDate - Screening/consent date.
 * @property {string} daraxonrasibStartDate - Cycle 1 Day 1 (first dose);
 *   the anchor every weeksOnTreatment value in this record is relative to.
 * @property {string} progressionDate
 * @property {number} progressionFreeSurvivalWeeks
 * @property {DoseBand} doseBand
 * @property {BestResponse} bestResponse
 * @property {boolean} hasAcquiredResistance
 * @property {ResistanceMechanism | null} resistanceMechanism - Ground truth
 *   (may differ from genomics.progression.repeatBiopsyNGS.resistanceMechanism
 *   when the standard panel missed it — see resistanceMechanismSource).
 * @property {ResistanceMechanismSource | null} resistanceMechanismSource
 * @property {string | null} combinationStrategy - Null unless hasAcquiredResistance.
 * @property {Genomics} genomics
 * @property {Biospecimens} biospecimens
 * @property {DeepSequencing} deepSequencing
 * @property {Transcriptomics} transcriptomics
 * @property {Epigenomics} epigenomics
 * @property {FlowCytometry} flowCytometry
 * @property {DigitalPathology} digitalPathology
 * @property {Phosphoproteomics} phosphoproteomics
 * @property {Clinical} clinical
 * @property {Imaging} imaging
 * @property {Laboratory} laboratory
 */

/** @typedef {Patient[]} Cohort */

export {}
