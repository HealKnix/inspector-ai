// Independent evaluator primitives; no application/model imports and no dataset discovery.
export function normalizeText(value, caseInsensitive = false) {
  const normalized = String(value)
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .trim();
  return caseInsensitive ? normalized.toLocaleLowerCase("ru-RU") : normalized;
}

export function levenshtein(a, b) {
  const left = typeof a === "string" ? [...a] : a;
  const right = typeof b === "string" ? [...b] : b;
  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    const next = [i];
    for (let j = 1; j <= right.length; j++)
      next[j] = Math.min(
        next[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    previous = next;
  }
  return previous[right.length];
}

const ratio = (n, d) => (d > 0 ? n / d : null);
const words = (s) => (s ? s.split(" ") : []);

export function rectangleIoU(a, b) {
  for (const box of [a, b])
    if (
      !Array.isArray(box) ||
      box.length !== 4 ||
      box.some((v) => !Number.isFinite(v) || v < 0 || v > 1) ||
      box[2] <= box[0] ||
      box[3] <= box[1]
    )
      throw new Error(
        "Expected normalized nonempty [left, top, right, bottom] rectangle",
      );
  const intersection =
    Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) *
    Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  return (
    intersection /
    ((a[2] - a[0]) * (a[3] - a[1]) +
      (b[2] - b[0]) * (b[3] - b[1]) -
      intersection)
  );
}

export function ocrMetrics(samples) {
  let characters = 0,
    distance = 0,
    referenceWords = 0,
    wordDistance = 0,
    eligible = 0,
    processed = 0;
  const errors = [];
  for (const row of samples) {
    if (!["PROCESSED", "LOW_QUALITY", "ABSTAIN"].includes(row.status))
      throw new Error("Unknown OCR technical outcome");
    const usable = row.kind === "printed" && row.dpi >= 300;
    if (!usable) {
      if (!row.premarked_exclusion)
        errors.push("exclusion not frozen before evaluation");
      if (!["LOW_QUALITY", "ABSTAIN"].includes(row.status))
        errors.push("excluded zone has no quality/abstention outcome");
      continue;
    }
    eligible++;
    if (
      typeof row.expected !== "string" ||
      (row.status === "PROCESSED" && typeof row.actual !== "string")
    )
      throw new Error(
        "Eligible OCR requires reference text and processed output",
      );
    const expected = normalizeText(row.expected);
    const actual = normalizeText(
      row.status === "ABSTAIN" || row.status === "LOW_QUALITY"
        ? ""
        : row.actual,
    );
    if (row.status === "PROCESSED") processed++;
    characters += [...expected].length;
    distance += levenshtein(expected, actual);
    referenceWords += words(expected).length;
    wordDistance += levenshtein(words(expected), words(actual));
  }
  const cer = ratio(distance, characters);
  return {
    zones: samples.length,
    eligible_zones: eligible,
    excluded_zones: samples.length - eligible,
    reference_characters: characters,
    edit_distance: distance,
    character_accuracy: cer === null ? null : 1 - cer,
    cer,
    wer: ratio(wordDistance, referenceWords),
    eligibility_coverage: ratio(eligible, samples.length),
    processing_coverage: ratio(processed, eligible),
    abstention_rate: ratio(eligible - processed, eligible),
    errors,
  };
}

export function fieldMetrics(fields) {
  const correct = fields.filter(
    (r) =>
      r.actual != null &&
      normalizeText(r.expected, r.case_insensitive === true) ===
        normalizeText(r.actual, r.case_insensitive === true),
  ).length;
  return {
    total: fields.length,
    correct,
    exact_match: ratio(correct, fields.length),
    coverage: ratio(
      fields.filter((r) => r.actual != null).length,
      fields.length,
    ),
  };
}

const atomicKey = (row) =>
  JSON.stringify([
    row.object_id,
    row.parameter_code ?? row.rule_id,
    row.location,
  ]);
const linkageKey = (e) =>
  JSON.stringify([e.object_id, e.stage, e.document_code, e.revision]);

export function groupMetrics(reference, predictions) {
  const keys = reference.map(atomicKey),
    predictionKeys = predictions.map(atomicKey);
  if (
    new Set(keys).size !== keys.length ||
    new Set(predictionKeys).size !== predictionKeys.length
  )
    throw new Error(
      "Duplicate atomic control point; split grouped locations before evaluation",
    );
  const predictionMap = new Map(predictions.map((r) => [atomicKey(r), r]));
  let tp = 0,
    fp = 0,
    fn = 0,
    tn = 0,
    fprN = 0,
    fprFp = 0,
    linked = 0,
    localized = 0,
    evidenceN = 0,
    abstained = 0;
  const cases = [];
  for (const expected of reference) {
    const actual = predictionMap.get(atomicKey(expected));
    const emitted = actual?.decision === "VIOLATION";
    if (!actual || actual.decision === "ABSTAIN") abstained++;
    let linkCorrect = false,
      localizationCorrect = false;
    if (expected.evidence?.length) {
      evidenceN++;
      const used = new Set();
      const expectedLinks = expected.evidence.map(linkageKey).sort();
      const actualLinks = (actual?.evidence ?? []).map(linkageKey).sort();
      linkCorrect =
        JSON.stringify(expectedLinks) === JSON.stringify(actualLinks);
      localizationCorrect = expected.evidence.every((e) => {
        const match = actual?.evidence?.findIndex(
          (p, i) =>
            !used.has(i) &&
            linkageKey(e) === linkageKey(p) &&
            e.file_id === p.file_id &&
            e.pdf_page_number === p.pdf_page_number &&
            rectangleIoU(e.bbox, p.bbox) >= 0.5,
        );
        if (match == null || match < 0) return false;
        used.add(match);
        return true;
      });
      if (linkCorrect) linked++;
      if (
        localizationCorrect &&
        actual.evidence.length === expected.evidence.length
      )
        localized++;
      else localizationCorrect = false;
    }
    const correct =
      emitted &&
      expected.case_type === "confirmed_positive" &&
      actual.difference_type === expected.difference_type &&
      linkCorrect &&
      localizationCorrect;
    if (correct) tp++;
    if (emitted && !correct) fp++;
    if (expected.case_type === "confirmed_positive" && !correct) fn++;
    if (
      expected.case_type === "verified_negative" &&
      actual?.decision === "CLEAR"
    )
      tn++;
    if (
      expected.case_type === "verified_negative" ||
      expected.obsolete_revision_case === true
    ) {
      fprN++;
      if (emitted) fprFp++;
    }
    cases.push({
      object_id: expected.object_id,
      section: expected.section,
      difference_type: expected.difference_type,
      case_type: expected.case_type,
      emitted,
      correct,
      link_correct: linkCorrect,
      localization_correct: localizationCorrect,
    });
  }
  fp += predictions.filter(
    (p) => !keys.includes(atomicKey(p)) && p.decision === "VIOLATION",
  ).length;
  const precision = ratio(tp, tp + fp),
    recall = ratio(tp, tp + fn);
  return {
    total: reference.length,
    tp,
    fp,
    fn,
    tn,
    precision,
    recall,
    f1: ratio(2 * tp, 2 * tp + fp + fn),
    fpr: ratio(fprFp, fprN),
    fpr_n: fprN,
    fpr_fp: fprFp,
    evidence_groups: evidenceN,
    linkage: ratio(linked, evidenceN),
    localization: ratio(localized, evidenceN),
    coverage: ratio(reference.length - abstained, reference.length),
    abstention: ratio(abstained, reference.length),
    cases,
  };
}

// Bootstrap entire objects, preserving correlation between pages/groups of one building.
export function objectBootstrap(
  rows,
  measure,
  { iterations = 2000, seed = 20260927 } = {},
) {
  const objects = [...new Set(rows.map((r) => r.object_id))].sort();
  if (objects.length < 2)
    return {
      level: 0.95,
      method: "object_cluster_percentile_bootstrap",
      objects: objects.length,
      interval: null,
      reason: "fewer than two independent objects",
      iterations,
      seed,
    };
  let state = seed >>> 0;
  const random = () =>
    (state = (1664525 * state + 1013904223) >>> 0) / 4294967296;
  const values = [];
  for (let i = 0; i < iterations; i++) {
    const sample = Array.from(
      { length: objects.length },
      () => objects[Math.floor(random() * objects.length)],
    ).flatMap((id) => rows.filter((r) => r.object_id === id));
    const value = measure(sample);
    if (value != null && Number.isFinite(value)) values.push(value);
  }
  values.sort((a, b) => a - b);
  const valid = values.length / iterations;
  return {
    level: 0.95,
    method: "object_cluster_percentile_bootstrap",
    objects: objects.length,
    iterations,
    seed,
    valid_replicates: values.length,
    interval:
      valid < 0.95
        ? null
        : [
            values[Math.floor(0.025 * (values.length - 1))],
            values[Math.ceil(0.975 * (values.length - 1))],
          ],
    reason: valid < 0.95 ? "too many undefined-denominator resamples" : null,
  };
}
