import { z } from "zod";

export const confirmationBasis = "Подтверждаю сведения по документу.";
export const reviewFormSchema = z
  .object({
    fields: z.record(z.string(), z.string().max(2000)),
    note: z.string().max(3500),
    reference: z.string(),
    approvalChanged: z.boolean(),
    confirmed: z.boolean(),
    replaces: z.string(),
    effectiveFrom: z.string(),
    effectiveTo: z.string(),
    approvalBasis: z.string().max(4000),
  })
  .superRefine((value, context) => {
    if (value.approvalChanged && value.confirmed && !value.approvalBasis.trim())
      context.addIssue({
        code: "custom",
        path: ["approvalBasis"],
        message: "Укажите документ или решение, подтверждающее утверждение",
      });
    if (
      value.approvalChanged &&
      value.effectiveFrom &&
      value.effectiveTo &&
      value.effectiveFrom > value.effectiveTo
    )
      context.addIssue({
        code: "custom",
        path: ["effectiveTo"],
        message: "Конец периода раньше начала",
      });
    if (
      value.fields.works_from &&
      value.fields.works_to &&
      value.fields.works_from > value.fields.works_to
    )
      context.addIssue({
        code: "custom",
        path: ["fields", "works_to"],
        message: "Конец работ раньше начала",
      });
  });
export type ReviewFormValues = z.infer<typeof reviewFormSchema>;
