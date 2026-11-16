// htan2 file identifier convention (BForePC fileid-kit): codes, per-module examples and a small builder.
// format: HTA{center}_{participant}[_{pool}]_D{specimen 4}{modality 2}{tier 2}{seq 5}, max 50 chars.
// codes copied from https://github.com/BForePC/fileid-kit README.

export const KIT_URL = 'https://github.com/BForePC/fileid-kit';

export const MODALITIES = [
  ['01', 'H&E / slide scanner'], ['02', 'CODEX'], ['03', 'CyCIF'], ['04', 'mIHC'], ['05', 'MxIF'], ['06', 'GeoMx DSP'],
  ['07', 'Visium'], ['08', 'Xenium'], ['09', 'MERFISH'], ['10', 'CosMx / CODA'], ['11', 'Imaging fusion'], ['12', 'MIBI'],
  ['13', 'IMC'], ['14', 'Vectra Polaris'], ['15', 'Slide-seq'], ['16', 'SABER'], ['17', 'COMET'],
  ['18', 'Bulk RNA-seq'], ['19', 'Bulk DNA-seq (WGS, WES)'], ['20', 'sc/snRNA-seq'], ['21', 'sc/snATAC-seq'],
  ['22', 'scDNA-seq'], ['23', 'Hi-C-seq'], ['24', 'Methylation-seq'],
];

// tiers are data types, not pipeline steps
export const TIERS = [
  ['00', 'Raw', 'FASTQ, SVS, NDPI, CZI'], ['01', 'Registered / aligned', 'BAM, CRAM, registered TIFF'],
  ['02', 'Converted', 'OME-TIFF, Zarr'], ['03', 'Mask / segmentation', 'TIFF, PNG, GeoJSON'],
  ['04', 'Quantification', 'CSV, H5, H5AD, MTX'], ['05', 'Metadata', 'JSON, XML, XLSX'],
  ['06', 'Derived / integrated', 'Parquet, RDS, H5AD'], ['07', 'Variants', 'VCF, MAF'],
  ['11', 'Bundle / composite', 'ZIP, TAR.GZ, directory'], ['15', 'QC / reports', 'HTML, PDF, PNG'],
];

// one worked example per htan2 module: [level, file, tier, seq, format]
export const MODULE_EXAMPLES = {
  wes: { code: '19', rows: [
    ['1', 'Raw reads (R1)', '00', 1, 'FASTQ.gz'], ['1', 'Raw reads (R2)', '00', 2, 'FASTQ.gz'],
    ['2', 'Aligned reads', '01', 1, 'BAM'], ['3', 'Variant calls', '07', 1, 'VCF.gz'],
    ['-', 'QC report', '15', 1, 'HTML'], ['-', 'Metadata', '05', 1, 'JSON']] },
  scrna_seq: { code: '20', rows: [
    ['1', 'Raw reads (R1)', '00', 1, 'FASTQ.gz'], ['2', 'Aligned reads', '01', 1, 'BAM'],
    ['3-4', 'Gene expression matrix', '04', 1, 'H5AD'], ['3-4', 'Annotated / integrated object', '06', 1, 'H5AD, RDS']] },
  scatac_seq: { code: '21', rows: [
    ['1', 'Raw reads (R1)', '00', 1, 'FASTQ.gz'], ['2', 'Aligned reads', '01', 1, 'BAM'],
    ['3-4', 'Fragment file', '04', 1, 'fragments.tsv.gz'], ['3-4', 'Peak-by-cell matrix', '04', 2, 'H5']] },
  spatial: { code: '07', note: 'Visium shown; Xenium 08, GeoMx 06, CosMx 10, MERFISH 09, Slide-seq 15', rows: [
    ['1', 'Raw reads / tissue image', '00', 1, 'FASTQ.gz, TIFF'], ['3', 'Segmentation', '03', 1, 'GeoJSON'],
    ['3', 'Spot / cell matrix', '04', 1, 'H5'], ['4', 'Harmonized object', '06', 1, 'H5AD, RDS, Zarr']] },
  multiplex_microscopy: { code: '03', note: 'CyCIF shown; CODEX 02, mIHC 04, MxIF 05, MIBI 12, IMC 13, Vectra 14, COMET 17', rows: [
    ['2', 'Stitched, registered image', '01', 1, 'TIFF'], ['2', 'Pyramidal image', '02', 1, 'OME-TIFF'],
    ['3', 'Segmentation mask', '03', 1, 'TIFF'], ['4', 'Cell-by-marker table', '04', 1, 'CSV']] },
  digital_pathology: { code: '01', rows: [
    ['2', 'Whole-slide scan', '00', 1, 'SVS, NDPI'], ['2', 'Converted scan', '02', 1, 'OME-TIFF']] },
  mass_spectrometry_imaging: { code: null, note: 'no modality code in fileid-kit yet' },
};

export const pad = (n, w) => String(n).padStart(w, '0');

// segments of an id, for colored display; returns {segs, id, errors}
export function buildId({ participant, pool, specimen, modality, tier, seq }) {
  const errors = [];
  participant = (participant || '').trim(); pool = (pool || '').trim();
  if (!/^HTA\d{3}_[A-Za-z0-9]+$/.test(participant)) errors.push('participant must look like HTA201_4 (HTA + 3-digit center _ participant)');
  if (pool && !/^[A-Za-z0-9]+$/.test(pool)) errors.push('pool id: letters and digits only');
  const sp = +specimen, sq = +seq;
  if (!Number.isInteger(sp) || sp < 0 || sp > 9999) errors.push('specimen index: 0-9999');
  if (!Number.isInteger(sq) || sq < 1 || sq > 99999) errors.push('file sequence: 1-99999');
  const segs = [
    ['participant', participant], ...(pool ? [['pool', '_' + pool]] : []), ['marker', '_D'],
    ['specimen', pad(sp || 0, 4)], ['modality', modality], ['tier', tier], ['seq', pad(sq || 0, 5)],
  ];
  const id = segs.map(s => s[1]).join('');
  if (id.length > 50) errors.push(`${id.length} characters; maximum is 50`);
  return { segs, id, errors };
}

export const exampleId = (participant, specimen, code, tier, seq) =>
  `${participant}_D${pad(specimen, 4)}${code}${tier}${pad(seq, 5)}`;
