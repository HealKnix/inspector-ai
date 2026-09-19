import {
  FindingStatus,
  ReviewPriority,
  VERIFICATION_FIXTURE_SOURCE,
  VerificationDocumentPreviewKind,
  VerificationDocumentStage,
  VerificationUiMarker,
  VerificationViewerSlotId,
  type VerificationDocument,
  type VerificationFinding,
  type VerificationPackageFixture,
} from "@/pages/verification/types";

const documents = [
  {
    id: "synthetic-demo-reference-pd",
    title: "Эталон: проектная документация (демо)",
    fileName: "ДЕМО_Эталон_ПД.pdf",
    stage: VerificationDocumentStage.PD,
    cipher: "ДЕМО-ПД-ЭТАЛОН",
    revision: "Демо-редакция 1",
    changeReference: "Демо: исходная редакция",
    approvalStatus: "Утверждено (синтетический пример)",
    totalPages: 32,
    previewKind: VerificationDocumentPreviewKind.REQUIREMENTS,
    heading: "Демонстрационные требования к конструкциям",
    highlight: "Применить сталь C245 (синтетический пример).",
    source: VERIFICATION_FIXTURE_SOURCE,
    isSynthetic: true,
  },
  {
    id: "synthetic-demo-reference-rd",
    title: "Эталон: рабочая документация (демо)",
    fileName: "ДЕМО_Эталон_РД.pdf",
    stage: VerificationDocumentStage.RD,
    cipher: "ДЕМО-РД-ЭТАЛОН",
    revision: "Демо-редакция 1",
    changeReference: "Демо: исходная редакция",
    approvalStatus: "Утверждено (синтетический пример)",
    totalPages: 44,
    previewKind: VerificationDocumentPreviewKind.TABLE,
    heading: "Демонстрационная ведомость элементов",
    highlight: "Марка материала: C245 (синтетический пример).",
    source: VERIFICATION_FIXTURE_SOURCE,
    isSynthetic: true,
  },
  {
    id: "synthetic-demo-reference-id",
    title: "Эталон: исполнительная документация (демо)",
    fileName: "ДЕМО_Эталон_ИД.pdf",
    stage: VerificationDocumentStage.ID,
    cipher: "ДЕМО-ИД-ЭТАЛОН",
    revision: "Демо-редакция 1",
    changeReference: "Демо: исходная редакция",
    approvalStatus: "Утверждено (синтетический пример)",
    totalPages: 28,
    previewKind: VerificationDocumentPreviewKind.TABLE,
    heading: "Демонстрационный реестр исполнительных данных",
    highlight: "Исполнительное значение ожидает сопоставления (демо).",
    source: VERIFICATION_FIXTURE_SOURCE,
    isSynthetic: true,
  },
  {
    id: "synthetic-demo-actual-pd",
    title: "Проверяемая проектная документация (демо)",
    fileName: "ДЕМО_Проверяемая_ПД.pdf",
    stage: VerificationDocumentStage.PD,
    cipher: "ДЕМО-ПД-ФАКТ",
    revision: "Демо-редакция 2",
    changeReference: "Демо-изменение ИЗМ-ПД-02",
    approvalStatus: "На демонстрационной проверке",
    totalPages: 56,
    previewKind: VerificationDocumentPreviewKind.DRAWING,
    heading: "Демонстрационный чертёж опорной балки",
    highlight: "На чертеже указано C255 (синтетический пример).",
    source: VERIFICATION_FIXTURE_SOURCE,
    isSynthetic: true,
  },
  {
    id: "synthetic-demo-actual-rd",
    title: "Проверяемая рабочая документация (демо)",
    fileName: "ДЕМО_Проверяемая_РД.pdf",
    stage: VerificationDocumentStage.RD,
    cipher: "ДЕМО-РД-ФАКТ",
    revision: "Демо-редакция 2",
    changeReference: "Демо-изменение ИЗМ-РД-02",
    approvalStatus: "На демонстрационной проверке",
    totalPages: 64,
    previewKind: VerificationDocumentPreviewKind.DRAWING,
    heading: "Демонстрационный рабочий чертёж",
    highlight: "Распознано значение C255 (синтетический пример).",
    source: VERIFICATION_FIXTURE_SOURCE,
    isSynthetic: true,
  },
  {
    id: "synthetic-demo-actual-id",
    title: "Проверяемая исполнительная документация (демо)",
    fileName: "ДЕМО_Проверяемая_ИД.pdf",
    stage: VerificationDocumentStage.ID,
    cipher: "ДЕМО-ИД-ФАКТ",
    revision: "Демо-редакция 2",
    changeReference: "Демо-изменение ИЗМ-ИД-02",
    approvalStatus: "На демонстрационной проверке",
    totalPages: 38,
    previewKind: VerificationDocumentPreviewKind.TABLE,
    heading: "Демонстрационная исполнительная схема",
    highlight: "Извлечённое значение требует решения инспектора (демо).",
    source: VERIFICATION_FIXTURE_SOURCE,
    isSynthetic: true,
  },
] as const satisfies readonly VerificationDocument[];

interface FindingSeed {
  title: string;
  expectedValue: string;
  actualValue: string;
}

const findingSeeds = [
  {
    title: "Замена марки стали",
    expectedValue: "C245 (синтетический пример)",
    actualValue: "C255 (синтетический пример)",
  },
  {
    title: "Несоответствие веса",
    expectedValue: "2,45 демо-т",
    actualValue: "2,80 демо-т",
  },
  {
    title: "Шифр в штампе отличается",
    expectedValue: "ДЕМО-25-0173",
    actualValue: "ДЕМО-25-0173-КР",
  },
  {
    title: "Отсутствует антикоррозионная защита",
    expectedValue: "Демо-покрытие предусмотрено",
    actualValue: "Демо-значение отсутствует",
  },
  {
    title: "Расходится размер между осями",
    expectedValue: "6000 демо-мм",
    actualValue: "5980 демо-мм",
  },
  {
    title: "Класс бетона указан по-разному",
    expectedValue: "Демо-класс B1",
    actualValue: "Демо-класс B2",
  },
  {
    title: "Диаметр арматуры не совпадает",
    expectedValue: "16 демо-мм",
    actualValue: "14 демо-мм",
  },
  {
    title: "Длина нахлёста отличается",
    expectedValue: "640 демо-мм",
    actualValue: "560 демо-мм",
  },
  {
    title: "Класс крепежа требует проверки",
    expectedValue: "Демо-класс K1",
    actualValue: "Демо-класс K2",
  },
  {
    title: "Категория сварного шва различается",
    expectedValue: "Демо-категория 1",
    actualValue: "Демо-категория 2",
  },
  {
    title: "Отметка фундамента не совпадает",
    expectedValue: "−1,200 демо-м",
    actualValue: "−1,150 демо-м",
  },
  {
    title: "Предел огнестойкости отличается",
    expectedValue: "Демо-уровень F1",
    actualValue: "Демо-уровень F2",
  },
  {
    title: "Площадь помещения расходится",
    expectedValue: "42,0 демо-м²",
    actualValue: "40,8 демо-м²",
  },
  {
    title: "Ширина дверного проёма отличается",
    expectedValue: "1200 демо-мм",
    actualValue: "1100 демо-мм",
  },
  {
    title: "Направление открывания требует уточнения",
    expectedValue: "Наружу (демо)",
    actualValue: "Внутрь (демо)",
  },
  {
    title: "Уклон кровли не совпадает",
    expectedValue: "3,0% (демо)",
    actualValue: "2,0% (демо)",
  },
  {
    title: "Толщина слоя отличается",
    expectedValue: "120 демо-мм",
    actualValue: "100 демо-мм",
  },
  {
    title: "Плотность утеплителя указана иначе",
    expectedValue: "Демо-плотность 120",
    actualValue: "Демо-плотность 100",
  },
  {
    title: "Сечение воздуховода не совпадает",
    expectedValue: "600×400 демо-мм",
    actualValue: "500×400 демо-мм",
  },
  {
    title: "Расход воздуха отличается",
    expectedValue: "2400 демо-м³/ч",
    actualValue: "2200 демо-м³/ч",
  },
  {
    title: "Сечение кабеля расходится",
    expectedValue: "10 демо-мм²",
    actualValue: "6 демо-мм²",
  },
  {
    title: "Номинал автомата отличается",
    expectedValue: "32 демо-А",
    actualValue: "25 демо-А",
  },
  {
    title: "Диаметр трубопровода не совпадает",
    expectedValue: "80 демо-мм",
    actualValue: "65 демо-мм",
  },
  {
    title: "Рабочее давление указано по-разному",
    expectedValue: "1,0 демо-МПа",
    actualValue: "0,8 демо-МПа",
  },
  {
    title: "Температура теплоносителя расходится",
    expectedValue: "95°C (демо)",
    actualValue: "90°C (демо)",
  },
  {
    title: "Обозначение оборудования отличается",
    expectedValue: "ДЕМО-Н1",
    actualValue: "ДЕМО-Н2",
  },
  {
    title: "Производительность насоса не совпадает",
    expectedValue: "18 демо-м³/ч",
    actualValue: "16 демо-м³/ч",
  },
  {
    title: "Расчётный уровень шума отличается",
    expectedValue: "45 демо-дБ",
    actualValue: "48 демо-дБ",
  },
  {
    title: "Освещённость указана по-разному",
    expectedValue: "300 демо-лк",
    actualValue: "250 демо-лк",
  },
  {
    title: "Аварийное освещение не отражено",
    expectedValue: "Предусмотрено (демо)",
    actualValue: "Демо-значение отсутствует",
  },
  {
    title: "Тип гидроизоляции отличается",
    expectedValue: "Демо-тип H1",
    actualValue: "Демо-тип H2",
  },
  {
    title: "Герметизация стыка требует уточнения",
    expectedValue: "Демо-узел U1",
    actualValue: "Демо-узел U2",
  },
  {
    title: "Тип геомембраны не совпадает",
    expectedValue: "Демо-мембрана M1",
    actualValue: "Демо-мембрана M2",
  },
  {
    title: "Геодезическая отметка отличается",
    expectedValue: "+12,300 демо-м",
    actualValue: "+12,270 демо-м",
  },
  {
    title: "Координата оси расходится",
    expectedValue: "Демо-ось 7/А",
    actualValue: "Демо-ось 7/Б",
  },
  {
    title: "Длина сваи не совпадает",
    expectedValue: "12,0 демо-м",
    actualValue: "11,5 демо-м",
  },
  {
    title: "Несущая способность указана иначе",
    expectedValue: "Демо-значение 800",
    actualValue: "Демо-значение 750",
  },
  {
    title: "Номер протокола испытаний отличается",
    expectedValue: "ДЕМО-ПИ-014",
    actualValue: "ДЕМО-ПИ-041",
  },
  {
    title: "Акт скрытых работ требует сопоставления",
    expectedValue: "ДЕМО-АСР-08",
    actualValue: "ДЕМО-АСР-09",
  },
  {
    title: "Сертификат материала указан не полностью",
    expectedValue: "ДЕМО-СЕРТ-202",
    actualValue: "ДЕМО-СЕРТ без номера",
  },
  {
    title: "Шифр исполнительной схемы отличается",
    expectedValue: "ДЕМО-ИС-11",
    actualValue: "ДЕМО-ИС-12",
  },
  {
    title: "Редакция документа не совпадает",
    expectedValue: "Демо-редакция 3",
    actualValue: "Демо-редакция 2",
  },
  {
    title: "Дата согласования требует уточнения",
    expectedValue: "Демо-дата 01.04",
    actualValue: "Демо-дата 03.04",
  },
  {
    title: "Количество листов расходится",
    expectedValue: "24 демо-листа",
    actualValue: "23 демо-листа",
  },
  {
    title: "Позиция спецификации отличается",
    expectedValue: "Демо-позиция 18",
    actualValue: "Демо-позиция 81",
  },
  {
    title: "Единица измерения не совпадает",
    expectedValue: "Демо-единица м²",
    actualValue: "Демо-единица м³",
  },
  {
    title: "Примечания к листу противоречат друг другу",
    expectedValue: "Демо-примечание A",
    actualValue: "Демо-примечание B",
  },
] as const satisfies readonly FindingSeed[];

const stageSequence = [
  VerificationDocumentStage.PD,
  VerificationDocumentStage.RD,
  VerificationDocumentStage.ID,
] as const;

const referenceDocumentIds = {
  [VerificationDocumentStage.PD]: "synthetic-demo-reference-pd",
  [VerificationDocumentStage.RD]: "synthetic-demo-reference-rd",
  [VerificationDocumentStage.ID]: "synthetic-demo-reference-id",
} as const satisfies Record<VerificationDocumentStage, string>;

const actualDocumentIds = {
  [VerificationDocumentStage.PD]: "synthetic-demo-actual-pd",
  [VerificationDocumentStage.RD]: "synthetic-demo-actual-rd",
  [VerificationDocumentStage.ID]: "synthetic-demo-actual-id",
} as const satisfies Record<VerificationDocumentStage, string>;

function getFindingStatus(index: number): VerificationFinding["findingStatus"] {
  const ordinal = index + 1;

  if ([5, 9, 14, 22, 30, 37].includes(ordinal)) {
    return FindingStatus.CONFIRMED_VIOLATION;
  }

  if ([2, 6, 11, 17, 25, 33, 44].includes(ordinal)) {
    return FindingStatus.NEGATIVE_VERIFIED;
  }

  if ([4, 13, 20, 31, 47].includes(ordinal)) {
    return FindingStatus.CLARIFICATION_REQUIRED;
  }

  return FindingStatus.CANDIDATE;
}

function getUiMarker(index: number): VerificationFinding["uiMarker"] {
  if (index < 12) {
    return VerificationUiMarker.IMPACT;
  }

  if (index < 21) {
    return VerificationUiMarker.ATTENTION;
  }

  return VerificationUiMarker.FORMALITY;
}

function getReviewPriority(
  index: number,
): VerificationFinding["reviewPriority"] {
  const prioritySequence = [
    ReviewPriority.HIGH,
    ReviewPriority.MEDIUM,
    ReviewPriority.LOW,
    ReviewPriority.MEDIUM,
  ] as const;

  return prioritySequence[index % prioritySequence.length]!;
}

function getDecisionReason(
  status: VerificationFinding["findingStatus"],
): string | null {
  if (status !== FindingStatus.NEGATIVE_VERIFIED) {
    return null;
  }

  return "Ошибка привязки доказательства";
}

function getReviewComment(
  status: VerificationFinding["findingStatus"],
): string | null {
  if (status === FindingStatus.CANDIDATE) {
    return null;
  }

  if (status === FindingStatus.CONFIRMED_VIOLATION) {
    return "Демонстрационный комментарий: кандидат подтверждён для показа интерфейса.";
  }

  if (status === FindingStatus.NEGATIVE_VERIFIED) {
    return "Демонстрационный комментарий: доказательства сопоставлены вручную.";
  }

  return "Демонстрационный комментарий: требуется уточнить исходные данные.";
}

function createFinding(seed: FindingSeed, index: number): VerificationFinding {
  const ordinal = index + 1;
  const expectedStage = stageSequence[index % stageSequence.length]!;
  const actualStage = stageSequence[(index + 1) % stageSequence.length]!;
  const findingStatus = getFindingStatus(index);
  const page = (index % 24) + 1;

  return {
    id: `synthetic-demo-finding-${String(ordinal).padStart(2, "0")}`,
    ordinal,
    title: seed.title,
    description: `Синтетический пример расхождения №${ordinal} для демонстрации сценария проверки.`,
    uiMarker: getUiMarker(index),
    findingStatus,
    reviewPriority: getReviewPriority(index),
    expectedEvidence: {
      documentId: referenceDocumentIds[expectedStage],
      page,
      location: `Демо-раздел ${expectedStage}, пункт ${ordinal}.1`,
      excerpt: `Демонстрационное требование №${ordinal}: ${seed.expectedValue}.`,
      value: seed.expectedValue,
    },
    actualEvidence: {
      documentId: actualDocumentIds[actualStage],
      page: page + 2,
      location: `Демо-лист ${actualStage}-${ordinal}`,
      excerpt: `Синтетически извлечённое значение №${ordinal}: ${seed.actualValue}.`,
      value: seed.actualValue,
    },
    consequences: [
      "Учебный пример возможного влияния; не является техническим или правовым заключением.",
    ],
    recommendation:
      "Сопоставить демонстрационные доказательства и зафиксировать учебное решение.",
    decisionReason: getDecisionReason(findingStatus),
    reviewComment: getReviewComment(findingStatus),
    source: VERIFICATION_FIXTURE_SOURCE,
    isSynthetic: true,
  };
}

const findings = findingSeeds.map(createFinding);

export const mockVerificationPackage = {
  id: "synthetic-demo-verification-package",
  title: "Проверка демонстрационного комплекта",
  objectLabel: "Демонстрационный объект «Северный»",
  sectionLabel: "Демо-раздел КР",
  source: VERIFICATION_FIXTURE_SOURCE,
  isSynthetic: true,
  fixtureNotice:
    "Синтетические данные для демонстрации интерфейса. Они не являются ответом API, результатом реальной проверки, нормативным выводом или основанием для решения.",
  documents,
  viewerSlots: [
    {
      id: VerificationViewerSlotId.LEFT,
      label: "Эталон (демо)",
      availableDocumentIds: [
        "synthetic-demo-reference-pd",
        "synthetic-demo-reference-rd",
        "synthetic-demo-reference-id",
      ],
      initialDocumentId: "synthetic-demo-reference-pd",
      initialPage: 4,
    },
    {
      id: VerificationViewerSlotId.RIGHT,
      label: "Факт (демо)",
      availableDocumentIds: [
        "synthetic-demo-actual-pd",
        "synthetic-demo-actual-rd",
        "synthetic-demo-actual-id",
      ],
      initialDocumentId: "synthetic-demo-actual-rd",
      initialPage: 12,
    },
  ],
  findings,
} as const satisfies VerificationPackageFixture;
