# PP-StructureV3 CPU experiment

This directory is an isolated evaluation, excluded from the production Docker
image. Production does not import it. It does not change the parsing contract.
Real documents, model weights, extracted text, logs and results belong outside
the Git repository. No document is sent to a model host or remote service.

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

The baseline mode invokes the unchanged production `LocalOCR` class and records
its source hashes. It measures OCR only, not PDF rendering or production table
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
