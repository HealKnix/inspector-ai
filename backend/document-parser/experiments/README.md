# Local document parser experiments

This directory is an isolated evaluation, excluded from the production Docker
image. Production does not import it. It does not change the parsing contract.
Real documents, model weights, extracted text, logs and results belong outside
the Git repository. No document is sent to a model host or remote service.

## Layout-only gate before adaptive routing

`layout_probe.py` measures the existing `PP-DocLayout_plus-L` on original,
unmasked page renders. It creates one reusable standalone `LayoutDetection`
instance. It never calls PP-StructureV3, general OCR, text recognition, document
orientation, or a VLM. Page pixels are neither masked nor rotated. This is an
experiment prerequisite, not an implementation or acceptance of adaptive
native/OCR routing. Production does not import this runner.

Freeze annotations, evaluation rules, input hashes and the development/holdout
split **before** inference. Include expected tables, captions and drawing/title
block regions, plus explicit ambiguous areas. Keep truth and inputs outside Git.
The runner checks the declared truth hash but never uses truth content to change
predictions. Do not retune thresholds after seeing holdout output. A missed
caption or table must remain visible in the evaluation; an image classification
alone does not justify excluding the entire area from recognition. A failed gate
leaves automatic exclusion/adaptive production routing disabled. Uncertain
regions retain the original image and available native text with a warning;
this version does not add a manual editor or VLM.

The frozen baseline copies the pinned PaddleX 3.7.2 PP-StructureV3 layout
configuration: NMS enabled, unclip `[1.0, 1.0]`, threshold `0.5` for each class
except class `0: 0.3`, `2: 0.4`, `7: 0.3`, `15: 0.45`; merge mode `large` for
classes `0, 1, 7, 16`, `union` for all other classes. The model's pinned resize is
800×800 with `keep_ratio=false`. Full class names are saved in `run.json`; the
model has `image`, `chart`, `table`, `figure_title` and text-related labels, but
no dedicated CAD drawing or title-block class. Scores are model scores, not
measured semantic or transcription accuracy.

The input manifest has the following shape. Replace placeholders with the
actual hashes; paths must be absolute and outside the Git repository. A Linux
container manifest must use its mounted paths, for example `/probe/inputs/...`.

```json
{
  "schema_version": 1,
  "truth_path": "/probe/truth.json",
  "truth_sha256": "<64 lowercase hexadecimal characters>",
  "pages": [
    {
      "id": "synthetic-native-table",
      "image_path": "/probe/inputs/native-table.png",
      "image_sha256": "<PNG SHA256>",
      "source_sha256": "<original PDF SHA256>",
      "page_number": 1,
      "split": "development"
    }
  ]
}
```

IDs must be unique and contain only letters, digits, `_` or `-` (1–80
characters). `split` is `development` or `holdout`. Limits: 1–100 PNG pages,
strictly at most 20,000,000 pixels and 100 MiB per input, manifest at most 1 MiB,
and a 1–1800 second budget for the entire manifest (default 600). Inputs and
truth are hash-verified before model initialization; every page is hash-verified
again immediately before prediction. Only the layout model's three inference
assets are loaded, verified against the production `../model-lock.json`.
There is no download command in this runner.

With the previously prepared local virtual environment and pinned model cache:

```powershell
$python = 'D:/Projects/plcb-ds-hach-mik/tmp/ppstructure-probe-20260918/.venv/Scripts/python.exe'
$probe = 'D:/Projects/plcb-ds-hach-mik/tmp/adaptive-layout-probe-20260918'
$models = 'D:/Projects/plcb-ds-hach-mik/tmp/ppstructure-probe-20260918/models'
& $python -B backend/document-parser/experiments/layout_probe.py run `
  --manifest "$probe/manifest-windows.json" --models $models `
  --output "$probe/layout-baseline-windows" --timeout 600
```

Linux requires an existing cgroup memory limit of at most 4 GiB. With the
prepared production image and model volume, from the repository root:

```powershell
$repo = (Get-Location).Path
$probe = 'D:/Projects/plcb-ds-hach-mik/tmp/adaptive-layout-probe-20260918'
docker run --rm --network none --cpus 2 --memory 4g --user 1000:1000 `
  --mount "type=bind,source=$repo/backend/document-parser,target=/workspace/inspector-ai/backend/document-parser,readonly" `
  --mount "type=bind,source=$probe,target=/probe" `
  --mount "type=volume,source=inspector-ai_parser-models,target=/models,readonly" `
  --entrypoint python inspector-document-parser:local -B `
  /workspace/inspector-ai/backend/document-parser/experiments/layout_probe.py run `
  --manifest /probe/manifest-linux.json --models /models `
  --output /probe/layout-baseline-linux --timeout 600
```

The mounted source path above preserves the runner's repository-boundary check.
The process user must be able to read inputs/models and write the fresh output
directory. The supervisor restricts the worker to two available logical CPUs;
model/BLAS thread counts are two and MKLDNN is disabled. On Windows it attaches a
kernel Job Object with a 4 GiB process committed-memory limit **before** opening
the worker's stdin gate. Linux uses the surrounding container memory cgroup.
The supervisor kills the child on timeout; it samples RSS every 0.1 seconds and
labels that measurement as an observed peak, not a guaranteed instantaneous
maximum. Commit limits and RSS measurements are distinct quantities. Python
socket/DNS calls are denied before Paddle import; Docker `--network none` adds
the OS-level network boundary.

Output directories must be empty. Outputs are a frozen `manifest.json`,
`run.json` (baseline, labels, model/source hashes, versions, initialization time,
per-page prediction times), `supervisor.json` (exit status, wall time, CPU/memory
limits and observed RSS), private `process.log`, and for each page:

- `<id>.raw.json`: the native layout result, with original labels and scores;
- `<id>.json`: boxes in **original render pixel coordinates**, source identity,
  prediction time and `orientation_applied: 0`;
- `<id>.overlay.png`: the original pixels with labelled bounding rectangles.

No OCR text or table-cell topology is produced. The first prediction may include
lazy initialization; there is no extra warm-up inference. Later pages reuse the
same predictor. Report initialization, page times and whole-run wall time
separately, and compare timings only under the same resource limits.

`layout_fixtures.py` creates seven synthetic controls before inference:
native vector table, native+raster+graphic page, broken ToUnicode mapping, and
CropBox with four rotations. The corrupt mapping deliberately produces U+FFFD
with `page.get_text(flags=0)` while default MuPDF CID repair can conceal it.
The generator's normalized annotations are source fixtures, not a complete
native-table or crop-mapping production adapter. Tests verify PDF/PNG hashes,
actual mixed content, visible glyph preservation, CropBox/rotation and table
frame annotation IoU; they do not establish production routing accuracy.

```powershell
& $python -B backend/document-parser/experiments/layout_fixtures.py "$probe/synthetic"
& $python -B -m unittest discover -s backend/document-parser/experiments -p test_layout_probe.py -v
& $python -B -m unittest discover -s backend/document-parser/experiments -p test_layout_fixtures.py -v
```

## Earlier PP-StructureV3 versus OCR experiment

The experiment compares the existing Russian OCR with PP-StructureV3 layout and
table recognition. The initial configuration keeps `PP-OCRv5_mobile_det` and
`eslav_PP-OCRv5_mobile_rec`, with a maximum detection side of 1536 pixels. It adds
`PP-DocLayout_plus-L`, `PP-LCNet_x1_0_table_cls`, `SLANeXt_wired`, `SLANet_plus`,
`RT-DETR-L_wired_table_cell_det`, and `RT-DETR-L_wireless_table_cell_det`.
`PP-LCNet_x1_0_doc_ori` handles page and table orientation. Region grouping,
unwarping, text-line orientation, formulas, seal and chart recognition are off.
This is not a claim that arbitrary tables, drawings or Cyrillic codes are read
correctly. Confidence is a model score, not measured transcription accuracy.

The API was verified against the installed PaddleOCR 3.7.0 and PaddleX 3.7.2
sources; see the official [PP-StructureV3 documentation](https://paddlepaddle.github.io/PaddleOCR/main/en/version3.x/pipeline_usage/PP-StructureV3.html).
PaddlePaddle is 3.3.1. `requirements.lock.txt` records the complete Python 3.12
Windows evaluation environment, including the `paddlex[ocr]` extras. No Torch,
Transformers or CUDA package is required for this configuration.
`model-lock.json` pins 30 SHA-256 values: the nine initial models plus the optional
server detector. Bootstrap verifies known assets against this lock; inference
requires every selected asset in both the lock and the local bootstrap manifest.

## Reproduce

Create a dedicated virtual environment outside the repository and install this
directory's requirements. The following PowerShell commands assume the current
directory is the repository root. Change `$probe` for another machine.

```powershell
$probe = 'D:/Projects/plcb-ds-hach-mik/tmp/ppstructure-probe-20260918'
uv venv --python 3.12 "$probe/.venv"
$python = "$probe/.venv/Scripts/python.exe"
uv pip install --python $python -r backend/document-parser/experiments/requirements.lock.txt
$runner = 'backend/document-parser/experiments/ppstructure_probe.py'

# Online stage: only model names and model files, no document parameters.
& $python $runner bootstrap --root $probe

# Copy authorized source PNGs into $probe/inputs and compare SHA-256 with originals.
# Inference blocks Python socket connections and DNS before importing Paddle.
& $python $runner run --root $probe --input "$probe/inputs/passport.png" --output "$probe/passport-mobile" --timeout 1200
& $python $runner run --root $probe --input "$probe/inputs/drawing.png" --output "$probe/drawing-mobile" --timeout 1200

# Same interpreter, machine, CPU affinity and OCR models; no concurrent OCR jobs.
& $python $runner run --root $probe --input "$probe/inputs/passport.png" --output "$probe/passport-baseline" --mode baseline --timeout 1200
& $python $runner run --root $probe --input "$probe/inputs/drawing.png" --output "$probe/drawing-baseline" --mode baseline --timeout 1200
```

An existing official-model cache can be reused with bootstrap `--reuse PATH`.
An optional, separately labelled detector experiment requires bootstrap
`--server-detector`, then run `--server-detector --det-limit 3072`; it must not be
confused with the initial configuration.

The actual server-detector/3072 trial on 2026-09-18 was explicitly stopped after
Windows reported a 9,962,450,944-byte peak working set (9.28 GiB) and severe memory
pressure. It produced no completed recognition result. Its private evidence is
marked `resource-aborted`, separately from the supervisor's nonzero process exit.
This configuration is not recommended for the current 4 GiB parser container.

Each run uses two logical CPUs and two CPU threads with MKLDNN disabled. A
supervisor kills the worker when its wall-time budget expires. The network guard
is process-level Python socket/audit enforcement, not an operating-system
firewall. Local model paths and offline Hub flags prevent automatic downloads.
For an OS network boundary, run the same worker in a network-disabled sandbox
after bootstrap. Downloads and inference are deliberately separate commands.
Input limits are 64 MiB and 32 million pixels; detection side is limited to
512–4096 and timeout to 10–1800 seconds. There is no hard RSS memory cap in this
trusted-input experiment. Windows peak working set is recorded by the worker.
Run refuses nonempty output directories so failed or repeated runs cannot retain
stale tables from earlier output.

Outputs include `result.json` (the complete native library result), `text.txt`
(overall OCR only), `layout-text.txt` (ordered layout blocks with table text),
one sanitized `table-N.html` and tab-separated `table-N.txt` per recognized table,
`tables.json` with cells/spans, `run.json` with package/model/source hashes,
configuration and separate initialization/prediction times, the resolved PaddleX
YAML, and supervisor wall time. Preview HTML preserves only table/tr/td/th and
bounded positive row/column spans; arbitrary model-produced markup is never used
as executable preview content. Raw predicted HTML remains inert inside JSON.

The baseline mode invokes the frozen pre-PP-Structure `LocalOCR` in `legacy_ocr.py`
and records its source hashes. Production now uses PP-StructureV3; importing its
current adapter would invalidate the historical comparison. Baseline measures
OCR only, not PDF rendering or production table
geometry heuristics. Previously stored production artifacts can be compared for
structure, but their Docker timings are not interchangeable with these Windows
timings. Initialization and first-page prediction are reported separately. Each
case starts a new process without a warm-up inference; lazy table-OCR model
initialization therefore belongs to prediction time. OS file caches may be warm.

PaddleOCR 3.7.0's public `use_textline_orientation=False` flag does not update the
lazy OCR pipeline inside table recognition. The runner also sets
`SubPipelines.TableRecognition.SubPipelines.GeneralOCR.use_textline_orientation`
to false in the loaded PaddleX configuration. Unconfigured model-name lookups
fail immediately in offline inference. The initial failed attempt exposed this
API behavior without downloading a model or sending the document.

Native `result.html` table numbering may follow detection order rather than page
reading order. Use `parsing_res_list` block order and coordinates for association;
do not infer document order from `table-1` and `table-2`. Overall OCR and table OCR
can disagree. Their text is exported separately without silently choosing one.

Boundary checks (no models or real documents):

```powershell
& $python -m unittest discover -s backend/document-parser/experiments -p test_probe.py -v
```
